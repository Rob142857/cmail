import type { PageServerLoad } from './$types';
import type { MailTrace } from '@cmail/shared/types';
import { adminLoaderFailure } from '#lib/server/admin-loader-error.js';

const VALID_PAGE_SIZES = [20, 50, 100];

interface DeliveryEventRow {
  recipient: string;
  event_type: string;
  bounce_type: string | null;
  smtp_status: string | null;
  smtp_response: string | null;
  occurred_at: string;
}

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { traces: [], total: 0, deliveryEvents: {}, outboundJournals: [], outboundJournalTotal: 0, search: '', direction: '', status: '', page: 1, pageSize: 20 };

  const search = url.searchParams.get('q') || '';
  const direction = url.searchParams.get('direction') || '';
  const status = url.searchParams.get('status') || '';
  const page = Math.max(1, Math.min(10000, parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const pageSize = VALID_PAGE_SIZES.includes(Number(url.searchParams.get('pageSize')))
    ? Number(url.searchParams.get('pageSize'))
    : 20;

  const offset = (page - 1) * pageSize;

  try {
    const conditions: string[] = [];
    const binds: (string | number)[] = [];

    if (search) {
      const term = `%${search}%`;
      conditions.push(
        '(envelope_from LIKE ? OR envelope_to LIKE ? OR header_from LIKE ? OR subject LIKE ? OR message_id_header LIKE ? OR provider_message_ids LIKE ? OR failed_recipients LIKE ? OR status_detail LIKE ? OR source_ip LIKE ?)',
      );
      binds.push(term, term, term, term, term, term, term, term, term);
    }

    if (direction && ['inbound', 'outbound'].includes(direction)) {
      conditions.push('direction = ?');
      binds.push(direction);
    }

    if (status && ['delivered', 'bounced', 'rejected', 'quarantined', 'deferred', 'sent'].includes(status)) {
      conditions.push('status = ?');
      binds.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM mail_trace ${where}`,
    ).bind(...binds).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const traces = await env.DB.prepare(
      `SELECT * FROM mail_trace ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, pageSize, offset).all<MailTrace>();
    // Provider delivery events (bounces, complaints, deliveries) for the
    // outbound traces on this page, oldest first within each trace.
    const outboundTraceIds = (traces.results || [])
      .filter((trace) => trace.direction === 'outbound')
      .map((trace) => trace.trace_id);
    const deliveryEvents: Record<string, DeliveryEventRow[]> = {};
    if (outboundTraceIds.length) {
      const events = await env.DB.prepare(
        `SELECT trace_id, recipient, event_type, bounce_type, smtp_status, smtp_response,
                COALESCE(event_timestamp, received_at) AS occurred_at
         FROM delivery_events
         WHERE trace_id IN (SELECT value FROM json_each(?))
         ORDER BY trace_id, occurred_at
         LIMIT 1000`,
      ).bind(JSON.stringify(outboundTraceIds)).all<DeliveryEventRow & { trace_id: string }>();
      for (const { trace_id: traceId, ...event } of events.results || []) {
        (deliveryEvents[traceId] ||= []).push(event);
      }
    }
    const outboundJournalCount = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM outbound_send_journal
       WHERE state IN ('pending', 'dispatching', 'accepted', 'ambiguous', 'retryable_failure')`,
    ).first<{ total: number }>();
    const outboundJournals = await env.DB.prepare(
      `SELECT id, state, provider, from_address, envelope_recipients, subject,
              attempt_count, last_error, created_at, updated_at
       FROM outbound_send_journal
       WHERE state IN ('pending', 'dispatching', 'accepted', 'ambiguous', 'retryable_failure')
       ORDER BY updated_at DESC LIMIT 20`,
    ).all<{
      id: string;
      state: string;
      provider: string;
      from_address: string;
      envelope_recipients: string;
      subject: string;
      attempt_count: number;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>();

    return {
      traces: traces.results || [],
      total,
      deliveryEvents,
      outboundJournals: outboundJournals.results || [],
      outboundJournalTotal: outboundJournalCount?.total || 0,
      search,
      direction,
      status,
      page,
      pageSize,
    };
  } catch (e) {
    return {
      traces: [], total: 0, deliveryEvents: {}, outboundJournals: [], outboundJournalTotal: 0,
      search, direction, status, page, pageSize, ...adminLoaderFailure('trace', e),
    };
  }
};
