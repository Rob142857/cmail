<script>
  import { formatDateTime } from '$lib/dates';
  let { data } = $props();

  /** @type {any} */
  let selected = $state(null);

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
</script>

<div>
  <div class="header">
    <h2>Mail Trace</h2>
    <span class="total-badge">{data.total} event{data.total !== 1 ? 's' : ''}</span>
  </div>

  <!-- Filters -->
  <form method="GET" class="filters">
    <input type="search" name="q" placeholder="Search email, subject, IP…" value={data.search} class="search-input" />
    <select name="direction">
      <option value="">All directions</option>
      <option value="inbound" selected={data.direction === 'inbound'}>📥 Inbound</option>
      <option value="outbound" selected={data.direction === 'outbound'}>📤 Outbound</option>
    </select>
    <select name="status">
      <option value="">All statuses</option>
      <option value="delivered" selected={data.status === 'delivered'}>Delivered</option>
      <option value="sent" selected={data.status === 'sent'}>Sent</option>
      <option value="rejected" selected={data.status === 'rejected'}>Rejected</option>
      <option value="bounced" selected={data.status === 'bounced'}>Bounced</option>
      <option value="quarantined" selected={data.status === 'quarantined'}>Quarantined</option>
      <option value="deferred" selected={data.status === 'deferred'}>Deferred</option>
    </select>
    <select name="pageSize" onchange={(e) => e.currentTarget.form?.submit()}>
      <option value="20" selected={data.pageSize === 20}>20 per page</option>
      <option value="50" selected={data.pageSize === 50}>50 per page</option>
      <option value="100" selected={data.pageSize === 100}>100 per page</option>
    </select>
    <button type="submit" class="btn btn-primary">Search</button>
  </form>

  <!-- Table -->
  <div class="card" style="padding: 0; overflow-x: auto;">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Direction</th>
          <th>From</th>
          <th>To</th>
          <th>Subject</th>
          <th>Status</th>
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
              <button class="btn-link" onclick={() => selected = trace}>View</button>
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
</div>

<!-- Detail modal -->
{#if selected}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={() => selected = null} onkeydown={(e) => e.key === 'Escape' && (selected = null)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="detail-panel" onclick={(e) => e.stopPropagation()}>
      <div class="detail-header">
        <h3>Trace Detail</h3>
        <button class="btn-close" onclick={() => selected = null}>✕</button>
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
  </div>
{/if}

<style>
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .header h2 { margin: 0; }
  .total-badge {
    font-size: 12px; color: var(--text-muted); background: var(--bg-hover);
    padding: 2px 8px; border-radius: 10px;
  }

  .filters {
    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center;
  }
  .search-input { flex: 1; min-width: 180px; }
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
  .overlay {
    position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,0.35);
    display: flex; justify-content: flex-end;
  }
  .detail-panel {
    width: min(480px, 90vw); height: 100%; background: var(--bg-surface);
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
</style>
