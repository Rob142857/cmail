<script lang="ts">
  import { formatDateTime } from '$lib/dates';
  let { data } = $props();

  function actorLabel(entry: typeof data.entries[number]): string {
    if (entry.actor_email) return entry.actor_display_name || entry.actor_email;
    if (entry.actor_id) return `${entry.actor_id.slice(0, 8)}…`;
    return 'System';
  }

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (data.eventType) params.set('event_type', data.eventType);
    const query = params.toString();
    return query ? `?${query}` : '?';
  }
</script>

<svelte:head><title>Audit log · Management · {data.appName || 'cmail'}</title></svelte:head>

<section class="audit-page" aria-labelledby="audit-heading">
  <header class="page-heading">
    <div><p class="eyebrow">Governance</p><h1 id="audit-heading">Audit log</h1><p>Review security-sensitive, administrative, and lifecycle events.</p></div>
    <form method="GET" class="filters">
      <label for="event-filter">Event type</label>
      <div><select id="event-filter" name="event_type">
        <option value="">All events</option>
        {#each data.eventTypes as eventType}<option value={eventType} selected={data.eventType === eventType}>{eventType}</option>{/each}
      </select><button type="submit">Apply</button>{#if data.eventType}<a href="?" class="btn btn-ghost">Clear</a>{/if}</div>
    </form>
  </header>

  <div class="card table-card">
    <table>
      <caption class="sr-only">Audit events, newest first</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Actor</th><th scope="col">Target and detail</th><th scope="col">Source IP</th></tr></thead>
      <tbody>
        {#each data.entries as entry}
          <tr>
            <td class="nowrap"><time datetime={entry.timestamp}>{formatDateTime(entry.timestamp, data.locale, data.timeZone)}</time></td>
            <td><span class="badge badge-info">{entry.event_type}</span></td>
            <td><strong>{actorLabel(entry)}</strong>{#if entry.actor_email && entry.actor_display_name}<span>{entry.actor_email}</span>{/if}<small>{entry.actor_role}</small></td>
            <td>{#if entry.target}<code>{entry.target}</code>{/if}<span>{entry.detail || 'No additional detail'}</span></td>
            <td><code>{entry.ip_address || '—'}</code></td>
          </tr>
        {:else}
          <tr><td colspan="5"><div class="empty-state"><strong>No audit events found</strong><span>{data.eventType ? 'Clear the filter to review all events.' : 'Events will appear after administrative or security activity.'}</span></div></td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if data.entries.length >= 100 || data.page > 1}
    <nav class="pagination" aria-label="Audit log pages">
      {#if data.page > 1}<a href={pageHref(data.page - 1)} class="btn btn-sm" rel="prev">Newer</a>{/if}
      <span>Page {data.page}</span>
      {#if data.entries.length >= 100}<a href={pageHref(data.page + 1)} class="btn btn-sm" rel="next">Older</a>{/if}
    </nav>
  {/if}
</section>

<style>
  .audit-page { display: grid; gap: 16px; }
  .page-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
  .page-heading h1 { margin: 2px 0 5px; font-size: clamp(25px, 3vw, 34px); }
  .page-heading > div > p:last-child { color: var(--text-muted); }
  .eyebrow { margin: 0; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .filters { display: grid; gap: 4px; width: min(100%, 430px); }
  .filters > label { color: var(--text-muted); font-size: 11px; font-weight: 650; }
  .filters > div { display: flex; gap: 7px; }
  .filters select { min-width: 180px; }
  .table-card { padding: 0; overflow-x: auto; }
  table { min-width: 900px; }
  td strong, td span, td small { display: block; }
  td > span, td small { color: var(--text-muted); font-size: 11px; }
  td code { overflow-wrap: anywhere; font-size: 11px; }
  td:nth-child(4) code { margin-bottom: 3px; }
  .nowrap { white-space: nowrap; }
  .empty-state { display: flex; flex-direction: column; gap: 4px; padding: 30px; text-align: center; }
  .empty-state span { color: var(--text-muted); }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); font-size: 12px; }
  @media (max-width: 720px) {
    .page-heading { align-items: stretch; flex-direction: column; }
    .filters { width: 100%; }
    .filters > div { flex-wrap: wrap; }
    .filters select { flex: 1 1 100%; }
  }
</style>
