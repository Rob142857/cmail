// D1 helper utilities

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export async function audit(
  db: D1Database,
  event: {
    event_type: string;
    actor_id?: string | null;
    actor_role?: 'standard' | 'manager' | 'system';
    target?: string | null;
    detail?: string | null;
    ip_address?: string | null;
    session_id?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_log (event_id, timestamp, actor_id, actor_role, event_type, target, detail, ip_address, session_id)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    generateId(),
    event.actor_id ?? null,
    event.actor_role ?? 'system',
    event.event_type,
    event.target ?? null,
    event.detail ?? null,
    event.ip_address ?? null,
    event.session_id ?? null,
  ).run();
}

export async function traceEmail(
  db: D1Database,
  trace: {
    message_id_header?: string | null;
    direction: 'inbound' | 'outbound';
    envelope_from?: string | null;
    envelope_to?: string | null;
    header_from?: string | null;
    subject?: string | null;
    size_bytes?: number | null;
    status: 'delivered' | 'bounced' | 'rejected' | 'quarantined' | 'deferred' | 'sent';
    status_detail?: string | null;
    spf_result?: string | null;
    dkim_result?: string | null;
    dmarc_result?: string | null;
    spam_score?: number | null;
    source_ip?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, envelope_from, envelope_to, header_from, subject, size_bytes, status, status_detail, spf_result, dkim_result, dmarc_result, spam_score, source_ip)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    generateId(),
    trace.message_id_header ?? null,
    trace.direction,
    trace.envelope_from ?? null,
    trace.envelope_to ?? null,
    trace.header_from ?? null,
    trace.subject ?? null,
    trace.size_bytes ?? null,
    trace.status,
    trace.status_detail ?? null,
    trace.spf_result ?? null,
    trace.dkim_result ?? null,
    trace.dmarc_result ?? null,
    trace.spam_score ?? null,
    trace.source_ip ?? null,
  ).run();
}
