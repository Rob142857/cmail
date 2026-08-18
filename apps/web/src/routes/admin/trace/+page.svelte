<script>
  import { formatDateTime } from '$lib/dates';
  import { tick } from 'svelte';
  let { data } = $props();

  /** @type {any} */
  let selected = $state(null);
  /** @type {HTMLDialogElement | null} */
  let detailDialog = $state(null);
  /** @type {HTMLButtonElement | null} */
  let closeButton = $state(null);
  /** @type {HTMLButtonElement | null} */
  let returnFocus = null;

  async function openTrace(trace, event) {
    selected = trace;
    returnFocus = event.currentTarget;
    await tick();
    detailDialog?.showModal();
    closeButton?.focus();
  }

  function closeTrace() { detailDialog?.close(); }
  function afterClose() {
    selected = null;
    requestAnimationFrame(() => returnFocus?.focus());
  }

  function buildUrl(overrides = {}) {
    const p = { q: data.search, direction: data.direction, status: data.status, page: data.page, pageSize: data.pageSize, ...overrides };
    const params = new URLSearchParams();
    if (p.q) params.set('q', p.q);
    if (p.direction) params.set('direction', p.direction);
    if (p.status) params.set('status', p.status);
    if (p.page > 1) params.set('page', String(p.page));
    if (p.pageSize !== 20) params.set('pageSize', String(p.pageSize));
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  }

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

  function statusColor(s) {
    if (s === 'delivered' || s === 'sent') return 'var(--success)';
    if (s === 'rejected' || s === 'bounced') return 'var(--danger)';
    if (s === 'quarantined') return 'var(--warning)';
    return 'var(--text-muted)';
  }

  function storedList(value) {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  function journalStateLabel(state) {
    if (state === 'accepted') return 'Accepted · storing copies';
    if (state === 'dispatching') return 'Delivery outcome pending';
    if (state === 'ambiguous') return 'Delivery unknown · do not retry';
    if (state === 'retryable_failure') return 'Not accepted · safe to retry';
    return 'Queued · provider not contacted';
  }
</script>

<section aria-labelledby="trace-heading">
  <div class="header">
    <div><p class="eyebrow">Mail</p><h1 id="trace-heading">Mail trace</h1></div>
    <span class="total-badge">{data.total} event{data.total !== 1 ? 's' : ''}</span>
  </div>

  {#if data.outboundJournalTotal > 0}
    <section class="journal-alert" aria-labelledby="journal-alert-heading">
      <div class="journal-alert-head">
        <div>
          <p class="eyebrow">Delivery recovery</p>
          <h2 id="journal-alert-heading">{data.outboundJournalTotal} unresolved outbound {data.outboundJournalTotal === 1 ? 'send' : 'sends'}</h2>
        </div>
        <span>These sends won't be retried automatically.</span>
      </div>
      <div class="journal-list">
        {#each data.outboundJournals as journal}
          <article>
            <div class="journal-main">
              <strong>{journal.subject || '(no subject)'}</strong>
              <span>{journal.from_address} → {storedList(journal.envelope_recipients).join(', ') || 'internal recipients'}</span>
            </div>
            <div class="journal-state" class:journal-danger={journal.state === 'ambiguous' || journal.state === 'dispatching'}>
              <strong>{journalStateLabel(journal.state)}</strong>
              <span>{journal.provider} · updated {formatDateTime(journal.updated_at)}</span>
              {#if journal.last_error}<span>{journal.last_error}</span>{/if}
              <code>{journal.id}</code>
            </div>
          </article>
        {/each}
      </div>
      {#if data.outboundJournalTotal > data.outboundJournals.length}
        <p class="journal-more">Showing the 20 most recent records.</p>
      {/if}
    </section>
  {/if}

  <!-- Filters -->
  <form method="GET" class="filters">
    <label class="search-field"><span>Search</span><input type="search" name="q" placeholder="Email, subject, message ID or IP" value={data.search} class="search-input" /></label>
    <label><span>Direction</span><select name="direction">
      <option value="">All directions</option>
      <option value="inbound" selected={data.direction === 'inbound'}>📥 Inbound</option>
      <option value="outbound" selected={data.direction === 'outbound'}>📤 Outbound</option>
    </select></label>
    <label><span>Status</span><select name="status">
      <option value="">All statuses</option>
      <option value="delivered" selected={data.status === 'delivered'}>Delivered</option>
      <option value="sent" selected={data.status === 'sent'}>Sent</option>
      <option value="rejected" selected={data.status === 'rejected'}>Rejected</option>
      <option value="bounced" selected={data.status === 'bounced'}>Bounced</option>
      <option value="quarantined" selected={data.status === 'quarantined'}>Quarantined</option>
      <option value="deferred" selected={data.status === 'deferred'}>Deferred</option>
    </select></label>
    <label><span>Rows</span><select name="pageSize" onchange={(e) => e.currentTarget.form?.submit()}>
      <option value="20" selected={data.pageSize === 20}>20 per page</option>
      <option value="50" selected={data.pageSize === 50}>50 per page</option>
      <option value="100" selected={data.pageSize === 100}>100 per page</option>
    </select></label>
    <button type="submit" class="btn btn-primary">Search</button>
  </form>

  <!-- Table -->
  <div class="card" style="padding: 0; overflow-x: auto;">
    <table>
      <caption class="sr-only">Inbound and outbound mail trace events</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Direction</th>
          <th scope="col">From</th>
          <th scope="col">To</th>
          <th scope="col">Subject</th>
          <th scope="col">Status</th>
          <th style="width: 56px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.traces as trace}
          <tr>
            <td class="nowrap">{formatDateTime(trace.timestamp)}</td>
            <td>
              <span class="dir-badge" class:dir-inbound={trace.direction === 'inbound'}>
                {trace.direction === 'inbound' ? '📥' : '📤'} {trace.direction}
              </span>
            </td>
            <td class="ellipsis" title={trace.envelope_from || ''}>{trace.envelope_from || '—'}</td>
            <td class="ellipsis" title={trace.envelope_to || ''}>{trace.envelope_to || '—'}</td>
            <td class="ellipsis-wide">{trace.subject || '—'}</td>
            <td>
              <span class="status-dot" style="color: {statusColor(trace.status)}">&bull;</span>
              {trace.status}
            </td>
            <td>
              <button class="btn-link" aria-label={`View trace to ${trace.envelope_to || 'unknown recipient'}`} onclick={(event) => openTrace(trace, event)}>View</button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="empty">No trace events found</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Pagination -->
  {#if totalPages > 1}
    <div class="pagination">
      {#if data.page > 1}
        <a href={buildUrl({ page: data.page - 1 })} class="btn btn-sm">← Newer</a>
      {/if}
      <span class="page-info">Page {data.page} of {totalPages}</span>
      {#if data.page < totalPages}
        <a href={buildUrl({ page: data.page + 1 })} class="btn btn-sm">Older →</a>
      {/if}
    </div>
  {/if}
</section>

<!-- Detail modal -->
{#if selected}
  <dialog
      bind:this={detailDialog}
      class="detail-dialog"
      onclose={afterClose}
      onclick={(event) => { if (event.target === detailDialog) closeTrace(); }}
      aria-labelledby="trace-detail-title"
  >
    <div
      class="detail-panel"
    >
      <div class="detail-header">
        <h3 id="trace-detail-title">Trace Detail</h3>
        <button bind:this={closeButton} type="button" class="btn-close" aria-label="Close trace detail" onclick={closeTrace}>✕</button>
      </div>
      <div class="detail-body">
        <dl>
          <dt>Trace ID</dt>
          <dd class="mono">{selected.trace_id}</dd>

          <dt>Timestamp</dt>
          <dd>{formatDateTime(selected.timestamp)}</dd>

          <dt>Direction</dt>
          <dd>{selected.direction === 'inbound' ? '📥 Inbound' : '📤 Outbound'}</dd>

          <dt>Status</dt>
          <dd>
            <span class="status-dot" style="color: {statusColor(selected.status)}">&bull;</span>
            <strong>{selected.status}</strong>
            {#if selected.status_detail}
              — {selected.status_detail}
            {/if}
          </dd>

          <dt>Envelope From</dt>
          <dd>{selected.envelope_from || '—'}</dd>

          <dt>Envelope To</dt>
          <dd>{selected.envelope_to || '—'}</dd>

          {#if selected.header_from && selected.header_from !== selected.envelope_from}
            <dt>Header From</dt>
            <dd>{selected.header_from}</dd>
          {/if}

          <dt>Subject</dt>
          <dd>{selected.subject || '—'}</dd>

          {#if selected.message_id_header}
            <dt>Message-ID</dt>
            <dd class="mono break">{selected.message_id_header}</dd>
          {/if}

          {#if storedList(selected.provider_message_ids).length}
            <dt>Provider IDs</dt>
            <dd class="mono break">{storedList(selected.provider_message_ids).join(', ')}</dd>
          {/if}

          {#if storedList(selected.failed_recipients).length}
            <dt>Failed recipients</dt>
            <dd>{storedList(selected.failed_recipients).join(', ')}</dd>
          {/if}

          {#if selected.size_bytes}
            <dt>Size</dt>
            <dd>{(selected.size_bytes / 1024).toFixed(1)} KB</dd>
          {/if}

          {#if selected.source_ip}
            <dt>Source IP</dt>
            <dd class="mono">{selected.source_ip}</dd>
          {/if}

          {#if selected.spf_result || selected.dkim_result || selected.dmarc_result}
            <dt>Authentication</dt>
            <dd>
              {#if selected.spf_result}<span class="auth-tag">SPF: {selected.spf_result}</span>{/if}
              {#if selected.dkim_result}<span class="auth-tag">DKIM: {selected.dkim_result}</span>{/if}
              {#if selected.dmarc_result}<span class="auth-tag">DMARC: {selected.dmarc_result}</span>{/if}
            </dd>
          {/if}

          {#if selected.spam_score != null}
            <dt>Spam Score</dt>
            <dd>{selected.spam_score}</dd>
          {/if}

          {#if selected.tls_version}
            <dt>TLS Version</dt>
            <dd>{selected.tls_version}</dd>
          {/if}

          {#if selected.relay_response}
            <dt>Relay Response</dt>
            <dd class="mono break">{selected.relay_response}</dd>
          {/if}
        </dl>
      </div>
    </div>
  </dialog>
{/if}

<style>
  .header { display: flex; align-items: end; gap: 12px; margin-bottom: 16px; }
  .header h1 { margin: 2px 0 0; font-size: clamp(25px, 3vw, 34px); }
  .eyebrow { margin: 0; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .total-badge {
    font-size: 12px; color: var(--text-muted); background: var(--bg-hover);
    padding: 2px 8px; border-radius: 10px;
  }

  .filters {
    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: end;
  }
  .journal-alert { margin-bottom:16px; padding:14px; border:1px solid color-mix(in srgb, var(--warning) 38%, var(--border)); border-radius:var(--radius); background:var(--warning-soft); }
  .journal-alert-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .journal-alert-head h2 { margin:2px 0 0; font-size:17px; }
  .journal-alert-head > span { max-width:52ch; color:var(--text-muted); font-size:12px; line-height:1.5; text-align:right; }
  .journal-list { display:grid; gap:7px; margin-top:12px; }
  .journal-list article { display:grid; grid-template-columns:minmax(0, 1fr) minmax(230px, .75fr); gap:18px; padding:10px 12px; border:1px solid color-mix(in srgb, var(--warning) 25%, var(--border)); border-radius:var(--radius-sm); background:var(--bg-surface); }
  .journal-main, .journal-state { display:flex; min-width:0; flex-direction:column; gap:3px; }
  .journal-main span, .journal-state span, .journal-more { color:var(--text-muted); font-size:11px; overflow-wrap:anywhere; }
  .journal-state strong { color:var(--warning); font-size:12px; }
  .journal-state.journal-danger strong { color:var(--danger); }
  .journal-state code { color:var(--text-muted); font-size:10px; overflow-wrap:anywhere; }
  .journal-more { margin:9px 2px 0; }
  .filters label { display: grid; gap: 4px; color: var(--text-muted); font-size: 11px; font-weight: 650; }
  .search-field { flex: 1; min-width: 220px; }
  .search-input { width: 100%; }
  .filters select, .filters input, .filters button {
    padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--bg-surface); color: var(--text); font-size: 13px;
  }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--border);
    font-weight: 600; color: var(--text-muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  tr:hover { background: var(--bg-hover); }
  .nowrap { white-space: nowrap; }
  .ellipsis { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ellipsis-wide { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { text-align: center; padding: 32px !important; color: var(--text-muted); }

  .dir-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--bg-hover);
  }
  .dir-inbound { background: var(--primary-soft); }

  .status-dot { font-size: 18px; vertical-align: middle; }

  .btn-link {
    background: none; border: none; color: var(--primary); cursor: pointer;
    font-size: 13px; padding: 2px 4px; text-decoration: underline;
  }
  .btn-link:hover { color: var(--primary-hover); }

  .btn { display: inline-flex; align-items: center; padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text); font-size: 13px; text-decoration: none; cursor: pointer; }
  .btn:hover { background: var(--bg-hover); }
  .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
  .btn-primary:hover { background: var(--primary-hover); }
  .btn-sm { padding: 4px 10px; font-size: 12px; }

  .pagination {
    display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 14px;
  }
  .page-info { font-size: 13px; color: var(--text-muted); }

  /* Detail panel (slide-in overlay) */
  .detail-dialog { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; }
  .detail-dialog::backdrop { background: rgba(0,0,0,0.42); backdrop-filter: blur(2px); }
  .detail-panel {
    width: min(480px, 92vw); height: 100%; margin-left: auto; background: var(--bg-surface);
    box-shadow: var(--shadow-lg); overflow-y: auto; display: flex; flex-direction: column;
  }
  .detail-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .detail-header h3 { margin: 0; font-size: 16px; }
  .btn-close {
    background: none; border: none; font-size: 18px; cursor: pointer;
    color: var(--text-muted); padding: 4px 8px; line-height: 1;
  }
  .detail-body { padding: 20px; flex: 1; }
  .detail-body dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 12px; font-size: 13px; margin: 0; }
  .detail-body dt { color: var(--text-muted); font-weight: 600; }
  .detail-body dd { margin: 0; word-break: break-word; }
  .mono { font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 12px; }
  .break { word-break: break-all; }

  .auth-tag {
    display: inline-block; font-size: 12px; padding: 1px 8px; margin: 2px 4px 2px 0;
    border-radius: 10px; background: var(--bg-hover); font-family: monospace;
  }

  @media (max-width: 720px) {
    .journal-alert-head { flex-direction:column; }
    .journal-alert-head > span { text-align:left; }
    .journal-list article { grid-template-columns:1fr; gap:8px; }
  }
</style>
