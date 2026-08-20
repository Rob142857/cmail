<script lang="ts">
  import { page } from '$app/state';
  import { dateTimeAttribute, formatDateTime } from '$lib/dates';
  import Icon from '$lib/ui/Icon.svelte';
  import MessageBar from '$lib/ui/MessageBar.svelte';
  import type { PageData } from './$types';

  type EventRow = PageData['events'][number];

  let { data }: { data: PageData } = $props();
  const d = $derived(data);

  let selected = $state<EventRow | null>(null);

  const locale = $derived(page.data?.locale || 'en');
  const timeZone = $derived(page.data?.timeZone || 'UTC');
  const when = (value: string) => formatDateTime(value, locale, timeZone);

  const totalPages = $derived(Math.max(1, Math.ceil(d.total / d.filters.pageSize)));
  const hasFilters = $derived(
    Boolean(d.filters.q || d.filters.event || d.filters.from || d.filters.to
      || d.filters.source !== 'all' || d.filters.outcome !== 'all'
      || d.filters.direction || d.filters.status),
  );

  const STATUS_TONE: Record<string, string> = {
    delivered: 'badge-success',
    sent: 'badge-success',
    bounced: 'badge-danger',
    rejected: 'badge-danger',
    quarantined: 'badge-warning',
    deferred: 'badge-warning',
  };
  const AUTH_TONE: Record<string, string> = {
    pass: 'auth-pass', fail: 'auth-fail', softfail: 'auth-warn',
    neutral: 'auth-none', none: 'auth-none', temperror: 'auth-warn', permerror: 'auth-fail',
  };

  function pageHref(next: number): string {
    const params = new URLSearchParams();
    const f = d.filters;
    if (f.q) params.set('q', f.q);
    if (f.source !== 'all') params.set('source', f.source);
    if (f.outcome !== 'all') params.set('outcome', f.outcome);
    if (f.direction) params.set('direction', f.direction);
    if (f.status) params.set('status', f.status);
    if (f.event) params.set('event', f.event);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    if (f.pageSize !== 50) params.set('pageSize', String(f.pageSize));
    if (next > 1) params.set('page', String(next));
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  }

  function bytes(value: number | null): string {
    if (!value) return '—';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  /** Message-ID is the strongest correlation key across both sources. */
  function correlationHref(row: EventRow): string {
    const key = row.msgid || row.party_to || row.party_from || '';
    return key ? `?q=${encodeURIComponent(key)}` : '?';
  }
</script>

<svelte:head><title>Investigate · Management · {page.data?.appName || 'cmail'}</title></svelte:head>
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && selected) selected = null; }} />

<section class="investigate" aria-labelledby="investigate-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Diagnostics</p>
      <h1 id="investigate-heading">Investigate</h1>
      <p class="intro">
        Search mail trace and the audit log together, by address, subject, Message-ID, IP,
        or event detail.
      </p>
    </div>
  </header>

  {#if d.unavailable}
    <MessageBar tone="danger" title="Records unavailable.">
      The trace and audit tables could not be read. Check the D1 binding.
      {#if d.error}<span class="mono">{d.error}</span>{/if}
    </MessageBar>
  {:else}
    <form method="GET" class="filters" role="search">
      <div class="filter-row">
        <label class="sr-only" for="inv-q">Search records</label>
        <input
          id="inv-q"
          type="search"
          name="q"
          maxlength="200"
          value={d.filters.q}
          placeholder="Address, subject, Message-ID, IP, administrator or detail"
        />
        <button type="submit" class="btn btn-primary"><Icon name="search" size={14} /> Search</button>
        {#if hasFilters}<a class="btn btn-ghost" href="/admin/investigate">Clear</a>{/if}
      </div>

      <div class="filter-row">
        <label class="sr-only" for="inv-source">Record source</label>
        <select id="inv-source" name="source">
          <option value="all" selected={d.filters.source === 'all'}>Both sources</option>
          <option value="trace" selected={d.filters.source === 'trace'}>Message trace only</option>
          <option value="audit" selected={d.filters.source === 'audit'}>Audit log only</option>
        </select>

        <label class="sr-only" for="inv-outcome">Outcome</label>
        <select id="inv-outcome" name="outcome">
          <option value="all" selected={d.filters.outcome === 'all'}>Any outcome</option>
          <option value="failures" selected={d.filters.outcome === 'failures'}>Failures only</option>
          <option value="quarantine" selected={d.filters.outcome === 'quarantine'}>Quarantined only</option>
        </select>

        <label class="sr-only" for="inv-direction">Direction</label>
        <select id="inv-direction" name="direction">
          <option value="" selected={d.filters.direction === ''}>Any direction</option>
          <option value="inbound" selected={d.filters.direction === 'inbound'}>Inbound</option>
          <option value="outbound" selected={d.filters.direction === 'outbound'}>Outbound</option>
        </select>

        <label class="sr-only" for="inv-status">Delivery status</label>
        <select id="inv-status" name="status">
          <option value="" selected={d.filters.status === ''}>Any status</option>
          <option value="delivered" selected={d.filters.status === 'delivered'}>Delivered</option>
          <option value="sent" selected={d.filters.status === 'sent'}>Sent</option>
          <option value="bounced" selected={d.filters.status === 'bounced'}>Bounced</option>
          <option value="rejected" selected={d.filters.status === 'rejected'}>Rejected</option>
          <option value="quarantined" selected={d.filters.status === 'quarantined'}>Quarantined</option>
          <option value="deferred" selected={d.filters.status === 'deferred'}>Deferred</option>
        </select>

        <label class="sr-only" for="inv-event">Audit event</label>
        <select id="inv-event" name="event">
          <option value="" selected={d.filters.event === ''}>Any audit event</option>
          {#each d.eventTypes as type}<option value={type} selected={d.filters.event === type}>{type}</option>{/each}
        </select>

        <span class="date-pair">
          <label for="inv-from">From</label>
          <input id="inv-from" type="date" name="from" value={d.filters.from} />
          <label for="inv-to">to</label>
          <input id="inv-to" type="date" name="to" value={d.filters.to} />
        </span>

        <label class="sr-only" for="inv-size">Rows per page</label>
        <select id="inv-size" name="pageSize">
          <option value="25" selected={d.filters.pageSize === 25}>25 per page</option>
          <option value="50" selected={d.filters.pageSize === 50}>50 per page</option>
          <option value="100" selected={d.filters.pageSize === 100}>100 per page</option>
          <option value="200" selected={d.filters.pageSize === 200}>200 per page</option>
        </select>
      </div>
    </form>

    <div class="tiles summary">
      <div class="tile">
        <span class="tile-head"><Icon name="activity" size={14} /> Records matched</span>
        <span class="tile-value">{d.total.toLocaleString()}</span>
        <span class="tile-note">{hasFilters ? 'in this filter' : 'all records'}</span>
      </div>
      <div class="tile">
        <span class="tile-head"><Icon name="mail" size={14} /> Message trace</span>
        <span class="tile-value">{d.summary.trace.toLocaleString()}</span>
        <span class="tile-note">delivery events</span>
      </div>
      <div class="tile">
        <span class="tile-head"><Icon name="clipboard" size={14} /> Audit</span>
        <span class="tile-value">{d.summary.audit.toLocaleString()}</span>
        <span class="tile-note">administrative events</span>
      </div>
      <div class="tile {d.summary.failures > 0 ? 'tile-danger' : 'tile-success'}">
        <span class="tile-head"><Icon name="warning" size={14} /> Failures</span>
        <span class="tile-value">{d.summary.failures.toLocaleString()}</span>
        <span class="tile-note">bounced, rejected or deferred</span>
      </div>
      <div class="tile {d.summary.quarantined > 0 ? 'tile-warning' : ''}">
        <span class="tile-head"><Icon name="junk" size={14} /> Quarantined</span>
        <span class="tile-value">{d.summary.quarantined.toLocaleString()}</span>
        <span class="tile-note">held as junk</span>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" class="col-time">Time</th>
            <th scope="col" class="col-kind">Source</th>
            <th scope="col">From / actor</th>
            <th scope="col">To / target</th>
            <th scope="col">Subject or event</th>
            <th scope="col" class="col-status">Outcome</th>
            <th scope="col" class="col-open"><span class="sr-only">Detail</span></th>
          </tr>
        </thead>
        <tbody>
          {#each d.events as row (row.kind + row.id)}
            <tr class:audit-row={row.kind === 'audit'}>
              <td class="nowrap muted">
                <time datetime={dateTimeAttribute(row.timestamp)}>{when(row.timestamp)}</time>
              </td>
              <td>
                {#if row.kind === 'trace'}
                  <span class="kind kind-trace">
                    <Icon name={row.direction === 'inbound' ? 'inbound' : 'outbound'} size={13} />
                    {row.direction || 'trace'}
                  </span>
                {:else}
                  <span class="kind kind-audit"><Icon name="clipboard" size={13} /> audit</span>
                {/if}
              </td>
              <td class="ellipsis mono" title={row.party_from || ''}>{row.party_from || '—'}</td>
              <td class="ellipsis mono" title={row.party_to || ''}>{row.party_to || '—'}</td>
              <td class="ellipsis-wide" title={row.label || ''}>
                {#if row.kind === 'audit'}
                  <span class="event-type">{row.label}</span>
                  {#if row.detail}<span class="event-detail"> — {row.detail}</span>{/if}
                {:else}
                  {row.label || '—'}
                {/if}
              </td>
              <td>
                {#if row.status}
                  <span class="badge {STATUS_TONE[row.status] || ''}">{row.status}</span>
                {:else}
                  <span class="badge">recorded</span>
                {/if}
              </td>
              <td>
                <button type="button" class="btn btn-sm" onclick={() => (selected = row)}>Detail</button>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="table-empty">
                {hasFilters ? 'No records match these filters.' : 'No records yet.'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if totalPages > 1}
      <nav class="pagination" aria-label="Pagination">
        <a href={pageHref(d.filters.page - 1)} class="btn btn-sm" aria-disabled={d.filters.page <= 1}>
          <Icon name="chevronLeft" size={14} /> Newer
        </a>
        <span>Page {d.filters.page} of {totalPages} · {d.total.toLocaleString()} records</span>
        <a href={pageHref(d.filters.page + 1)} class="btn btn-sm" aria-disabled={d.filters.page >= totalPages}>
          Older <Icon name="chevronRight" size={14} />
        </a>
      </nav>
    {/if}
  {/if}
</section>

{#if selected}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Record detail">
    <button type="button" class="scrim" aria-label="Close record detail" onclick={() => (selected = null)}></button>
    <div class="panel">
      <header class="panel-head">
        <h2>{selected.kind === 'trace' ? 'Delivery record' : 'Administrative event'}</h2>
        <button type="button" class="btn-icon btn-subtle" onclick={() => (selected = null)} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div class="panel-body">
        <div class="verdict">
          {#if selected.status}
            <span class="badge {STATUS_TONE[selected.status] || ''}">{selected.status}</span>
          {/if}
          {#if selected.direction}
            <span class="kind kind-trace">
              <Icon name={selected.direction === 'inbound' ? 'inbound' : 'outbound'} size={13} />
              {selected.direction}
            </span>
          {/if}
          {#if selected.actor_role}<span class="badge">{selected.actor_role}</span>{/if}
          {#if selected.detail}<p class="verdict-detail">{selected.detail}</p>{/if}
        </div>

        <h3 class="panel-section">Record</h3>
        <dl class="deflist">
          <dt>Time</dt><dd>{when(selected.timestamp)}</dd>
          {#if selected.kind === 'audit'}
            <dt>Event</dt><dd class="mono">{selected.label}</dd>
            <dt>Administrator</dt><dd>{selected.actor || '—'}</dd>
            <dt>Target</dt><dd class="break">{selected.party_to || '—'}</dd>
          {:else}
            <dt>Subject</dt><dd class="break">{selected.label || '—'}</dd>
            <dt>From</dt><dd class="mono break">{selected.party_from || '—'}</dd>
            <dt>To</dt><dd class="mono break">{selected.party_to || '—'}</dd>
            <dt>Size</dt><dd>{bytes(selected.size_bytes)}</dd>
          {/if}
          {#if selected.ip}<dt>Source address</dt><dd class="mono">{selected.ip}</dd>{/if}
          <dt>Record ID</dt><dd class="mono break">{selected.id}</dd>
        </dl>

        {#if selected.kind === 'trace'}
          <h3 class="panel-section">Authentication</h3>
          {#if selected.spf || selected.dkim || selected.dmarc}
            <div class="auth-row">
              {#each [['SPF', selected.spf], ['DKIM', selected.dkim], ['DMARC', selected.dmarc]] as [label, value]}
                {#if value}
                  <span class="auth {AUTH_TONE[value] || 'auth-none'}">
                    <span class="auth-label">{label}</span><span class="auth-value">{value}</span>
                  </span>
                {/if}
              {/each}
            </div>
          {:else}
            <p class="not-recorded">
              Not recorded for this message — results are saved once <code>INBOUND_AUTHSERV_ID</code> is set (see the configuration guide).
            </p>
          {/if}
          {#if selected.spam_score !== null || selected.tls}
            <dl class="deflist tight">
              {#if selected.spam_score !== null}
                <dt>Spam score</dt><dd>{selected.spam_score}</dd>
              {/if}
              {#if selected.tls}<dt>TLS</dt><dd>{selected.tls}</dd>{/if}
            </dl>
          {/if}

          {#if selected.msgid}
            <h3 class="panel-section">Correlate</h3>
            <dl class="deflist">
              <dt>Message-ID</dt><dd class="mono break">{selected.msgid}</dd>
            </dl>
          {/if}
        {/if}

        <a class="btn correlate" href={correlationHref(selected)}>
          <Icon name="search" size={14} /> Show every record for this message
        </a>
      </div>
    </div>
  </div>
{/if}

<style>
  .investigate { display: grid; gap: 18px; }
  .page-header h1 { margin: 0; font-size: var(--fs-title-2); }
  .eyebrow { margin: 0 0 4px; }
  .intro { margin: 8px 0 0; color: var(--text-muted); font-size: 14px; line-height: 1.6; max-width: 78ch; }

  .filters { display: grid; gap: 10px; }
  .filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .filter-row input[type='search'] { flex: 1 1 320px; min-width: 220px; max-width: 560px; width: auto; }
  .filter-row select { width: auto; min-width: 150px; }
  .date-pair { display: inline-flex; align-items: center; gap: 6px; }
  .date-pair label { color: var(--text-muted); font-size: var(--fs-caption); }
  .date-pair input { width: auto; min-width: 140px; }

  .summary { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .summary .tile-value { font-size: 26px; }

  .col-time, .col-kind, .col-status, .col-open { width: 1%; }
  .nowrap { white-space: nowrap; }
  .muted { color: var(--text-muted); font-size: var(--fs-caption); }
  .ellipsis { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ellipsis-wide { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .audit-row { background: color-mix(in srgb, var(--primary) 3%, transparent); }

  .kind {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: var(--fs-caption); text-transform: capitalize;
    color: var(--text-muted); white-space: nowrap;
  }
  .kind-trace :global(svg) { color: var(--primary); }
  .kind-audit :global(svg) { color: var(--text-faint); }

  .event-type { font-family: var(--font-mono); font-size: 12px; }
  .event-detail { color: var(--text-muted); }

  .verdict {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 12px 14px; margin-bottom: 18px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .verdict-detail { flex-basis: 100%; margin: 0; font-size: 13px; color: var(--text-muted); }

  .panel-section {
    font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
    color: var(--text-faint); margin: 18px 0 8px;
  }
  .panel-section:first-of-type { margin-top: 0; }
  .deflist.tight { margin-top: 10px; }
  .break { word-break: break-word; }

  .not-recorded {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--warning-border);
    border-left: 3px solid var(--warning);
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.55;
  }
  .not-recorded code { font-family: var(--font-mono); font-size: 11.5px; }

  .auth-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .auth {
    display: inline-flex; align-items: stretch;
    border: 1px solid var(--border); border-radius: var(--radius);
    overflow: hidden; font-size: 11.5px; font-family: var(--font-mono);
  }
  .auth-label { padding: 3px 8px; background: var(--bg-hover); color: var(--text-muted); font-weight: 600; }
  .auth-value { padding: 3px 8px; font-weight: 600; }
  .auth-pass { border-color: var(--success-border); }
  .auth-pass .auth-value { background: var(--success-soft); color: var(--success-text); }
  .auth-fail { border-color: var(--danger-border); }
  .auth-fail .auth-value { background: var(--danger-soft); color: var(--danger-text); }
  .auth-warn { border-color: var(--warning-border); }
  .auth-warn .auth-value { background: var(--warning-soft); color: var(--warning-text); }
  .auth-none .auth-value { background: var(--bg-subtle); color: var(--text-muted); }

  .correlate { margin-top: 22px; width: 100%; justify-content: center; }

  .scrim {
    position: absolute; inset: 0;
    border: none; padding: 0; margin: 0;
    background: transparent; cursor: default; min-height: 0;
  }
  .scrim:hover { background: transparent; }
  .panel { position: relative; }

  @media (max-width: 860px) {
    .ellipsis, .ellipsis-wide { max-width: 150px; }
    table { min-width: 900px; }
  }
</style>
