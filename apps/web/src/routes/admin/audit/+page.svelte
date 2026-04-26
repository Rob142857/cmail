<script>
  let { data } = $props();
  /** @type {any} */
  const d = $derived(data);

  /** @param {any} e */
  function actorLabel(e) {
    if (e.actor_email) return e.actor_display_name ? `${e.actor_display_name} <${e.actor_email}>` : e.actor_email;
    if (e.actor_id) return e.actor_id.slice(0, 8) + '…';
    return 'system';
  }
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <h2>Audit Log</h2>
    <form method="GET" style="display: flex; gap: 8px;">
      <select name="event_type">
        <option value="">All Events</option>
        {#each d.eventTypes as et}
          <option value={et} selected={d.eventType === et}>{et}</option>
        {/each}
      </select>
      <button type="submit">Filter</button>
      {#if d.eventType}
        <a href="?" class="btn">Clear</a>
      {/if}
    </form>
  </div>

  <div class="card" style="padding: 0; overflow-x: auto;">
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="border-bottom: 2px solid var(--border);">
          <th style="text-align: left; padding: 10px 16px;">Time</th>
          <th style="text-align: left; padding: 10px 8px;">Event</th>
          <th style="text-align: left; padding: 10px 8px;">Actor</th>
          <th style="text-align: left; padding: 10px 8px;">Detail</th>
          <th style="text-align: left; padding: 10px 8px;">IP</th>
        </tr>
      </thead>
      <tbody>
        {#each d.entries as entry}
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 16px; white-space: nowrap;">{new Date(entry.timestamp).toLocaleString()}</td>
            <td style="padding: 8px;"><span class="badge">{entry.event_type}</span></td>
            <td style="padding: 8px;">{actorLabel(entry)}</td>
            <td style="padding: 8px;">{entry.detail || '—'}</td>
            <td style="padding: 8px; font-size: 12px;">{entry.ip_address || '—'}</td>
          </tr>
        {/each}
        {#if d.entries.length === 0}
          <tr><td colspan="5" style="padding: 24px; text-align: center; color: var(--text-muted);">No audit entries.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>

  {#if d.entries.length >= 100 || d.page > 1}
    <div style="display: flex; justify-content: center; gap: 8px; margin-top: 12px;">
      {#if d.page > 1}
        <a href="?page={d.page - 1}{d.eventType ? `&event_type=${d.eventType}` : ''}" class="btn">← Newer</a>
      {/if}
      {#if d.entries.length >= 100}
        <a href="?page={d.page + 1}{d.eventType ? `&event_type=${d.eventType}` : ''}" class="btn">Older →</a>
      {/if}
    </div>
  {/if}
</div>
