import type { PageServerLoad } from './$types';

/**
 * Unified investigation view: message trace and the audit log in one timeline.
 *
 * Exchange keeps message trace and admin auditing in separate tools, which
 * means an investigator correlating "who changed this delegation" against
 * "what happened to that message" has to work across two screens and line up
 * timestamps by eye. Both tables here are already timestamped, append-only and
 * cheap to scan, so they are projected into one shape and queried together.
 *
 * Every filter value is validated against an allowlist or a bound parameter —
 * nothing from the query string reaches SQL as text.
 */

const PAGE_SIZES = [25, 50, 100, 200];
const SOURCES = ['all', 'trace', 'audit'] as const;
const DIRECTIONS = ['inbound', 'outbound'] as const;
const STATUSES = ['delivered', 'sent', 'bounced', 'rejected', 'quarantined', 'deferred'] as const;
const OUTCOMES = ['all', 'failures', 'quarantine'] as const;

type Source = (typeof SOURCES)[number];
type Outcome = (typeof OUTCOMES)[number];

export interface UnifiedEvent {
  kind: 'trace' | 'audit';
  id: string;
  timestamp: string;
  label: string | null;
  detail: string | null;
  party_from: string | null;
  party_to: string | null;
  status: string | null;
  direction: string | null;
  ip: string | null;
  msgid: string | null;
  actor: string | null;
  actor_role: string | null;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  tls: string | null;
  spam_score: number | null;
  size_bytes: number | null;
}

/**
 * Both tables projected into one row shape. Column order must match exactly
 * across the two arms of the UNION.
 */
const UNIFIED = `
  SELECT 'trace' AS kind, t.trace_id AS id, t.timestamp AS timestamp,
         t.subject AS label, COALESCE(t.status_detail, t.relay_response) AS detail,
         t.envelope_from AS party_from, t.envelope_to AS party_to,
         t.status AS status, t.direction AS direction,
         t.source_ip AS ip, t.message_id_header AS msgid,
         NULL AS actor, NULL AS actor_role,
         t.spf_result AS spf, t.dkim_result AS dkim, t.dmarc_result AS dmarc,
         t.tls_version AS tls, t.spam_score AS spam_score, t.size_bytes AS size_bytes
  FROM mail_trace t
  UNION ALL
  SELECT 'audit', a.event_id, a.timestamp,
         a.event_type, a.detail,
         COALESCE(u.email, a.actor_id), a.target,
         NULL, NULL,
         a.ip_address, NULL,
         COALESCE(u.display_name, u.email, a.actor_id), a.actor_role,
         NULL, NULL, NULL,
         NULL, NULL, NULL
  FROM audit_log a
  LEFT JOIN users u ON u.id = a.actor_id
`;

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value || '') ? (value as T) : fallback;
}

/** Accepts YYYY-MM-DD only; anything else is ignored rather than guessed at. */
function isoDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  const empty = {
    events: [] as UnifiedEvent[],
    total: 0,
    summary: { trace: 0, audit: 0, failures: 0, quarantined: 0 },
    eventTypes: [] as string[],
    filters: {
      q: '', source: 'all' as Source, direction: '', status: '', event: '',
      outcome: 'all' as Outcome, from: '', to: '', page: 1, pageSize: 50,
    },
    unavailable: true,
  };
  if (!env) return empty;

  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const source = oneOf<Source>(url.searchParams.get('source'), SOURCES, 'all');
  const outcome = oneOf<Outcome>(url.searchParams.get('outcome'), OUTCOMES, 'all');
  const direction = oneOf(url.searchParams.get('direction'), ['', ...DIRECTIONS] as const, '');
  const status = oneOf(url.searchParams.get('status'), ['', ...STATUSES] as const, '');
  const event = (url.searchParams.get('event') || '').trim().slice(0, 64);
  const from = isoDate(url.searchParams.get('from'));
  const to = isoDate(url.searchParams.get('to'));
  const page = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const pageSize = PAGE_SIZES.includes(Number(url.searchParams.get('pageSize')))
    ? Number(url.searchParams.get('pageSize'))
    : 50;

  const where: string[] = [];
  const binds: (string | number)[] = [];

  if (source !== 'all') {
    where.push('kind = ?');
    binds.push(source);
  }
  if (direction) {
    where.push('direction = ?');
    binds.push(direction);
  }
  if (status) {
    where.push('status = ?');
    binds.push(status);
  }
  if (event) {
    where.push("kind = 'audit' AND label = ?");
    binds.push(event);
  }
  if (outcome === 'failures') {
    where.push("status IN ('bounced', 'rejected', 'deferred')");
  } else if (outcome === 'quarantine') {
    where.push("status = 'quarantined'");
  }
  if (from) {
    where.push('timestamp >= ?');
    binds.push(`${from} 00:00:00`);
  }
  if (to) {
    where.push('timestamp <= ?');
    binds.push(`${to} 23:59:59`);
  }
  if (q) {
    // One box across both sources: addresses, subject, Message-ID, IP, actor,
    // audit detail and event type.
    where.push(`(
      party_from LIKE ? OR party_to LIKE ? OR label LIKE ? OR detail LIKE ?
      OR msgid LIKE ? OR ip LIKE ? OR actor LIKE ?
    )`);
    const term = `%${q}%`;
    binds.push(term, term, term, term, term, term, term);
  }

  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const scoped = `WITH unified AS (${UNIFIED}) SELECT * FROM unified ${filter}`;
  const counted = `WITH unified AS (${UNIFIED}) SELECT COUNT(*) AS total FROM unified ${filter}`;

  try {
    const [rows, totalRow, summaryRow, types] = await Promise.all([
      env.DB.prepare(`${scoped} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`)
        .bind(...binds, pageSize, (page - 1) * pageSize)
        .all<UnifiedEvent>(),
      env.DB.prepare(counted).bind(...binds).first<{ total: number }>(),
      // Summary reflects the same filter window, so the tiles agree with the list.
      env.DB.prepare(
        `WITH unified AS (${UNIFIED})
         SELECT SUM(kind = 'trace') AS trace,
                SUM(kind = 'audit') AS audit,
                SUM(status IN ('bounced', 'rejected', 'deferred')) AS failures,
                SUM(status = 'quarantined') AS quarantined
         FROM unified ${filter}`,
      ).bind(...binds).first<{ trace: number; audit: number; failures: number; quarantined: number }>(),
      env.DB.prepare('SELECT DISTINCT event_type FROM audit_log ORDER BY event_type ASC')
        .all<{ event_type: string }>(),
    ]);

    return {
      events: rows.results || [],
      total: totalRow?.total ?? 0,
      summary: {
        trace: summaryRow?.trace ?? 0,
        audit: summaryRow?.audit ?? 0,
        failures: summaryRow?.failures ?? 0,
        quarantined: summaryRow?.quarantined ?? 0,
      },
      eventTypes: (types.results || []).map((row) => row.event_type),
      filters: { q, source, direction, status, event, outcome, from, to, page, pageSize },
      unavailable: false,
    };
  } catch {
    return { ...empty, filters: { q, source, direction, status, event, outcome, from, to, page, pageSize } };
  }
};
