<script>
  let { data } = $props();
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <h2>Mail Trace</h2>
    <form method="GET" style="display: flex; gap: 8px;">
      <input type="search" name="q" placeholder="Search by email, subject..." value={data.search} />
      <select name="direction">
        <option value="">All</option>
        <option value="inbound" selected={data.direction === 'inbound'}>Inbound</option>
        <option value="outbound" selected={data.direction === 'outbound'}>Outbound</option>
      </select>
      <button type="submit">Search</button>
    </form>
  </div>

  <div class="card" style="padding: 0; overflow-x: auto;">
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="border-bottom: 2px solid var(--border);">
          <th style="text-align: left; padding: 10px 16px;">Time</th>
          <th style="text-align: left; padding: 10px 8px;">Direction</th>
          <th style="text-align: left; padding: 10px 8px;">From</th>
          <th style="text-align: left; padding: 10px 8px;">To</th>
          <th style="text-align: left; padding: 10px 8px;">Subject</th>
          <th style="text-align: left; padding: 10px 8px;">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each data.traces as trace}
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 16px; white-space: nowrap;">{new Date(trace.created_at).toLocaleString()}</td>
            <td style="padding: 8px;">
              <span class="badge" class:badge-info={trace.direction === 'inbound'}>
                {trace.direction === 'inbound' ? '📥' : '📤'} {trace.direction}
              </span>
            </td>
            <td style="padding: 8px; max-width: 180px; overflow: hidden; text-overflow: ellipsis;">{trace.envelope_from}</td>
            <td style="padding: 8px; max-width: 180px; overflow: hidden; text-overflow: ellipsis;">{trace.envelope_to}</td>
            <td style="padding: 8px;">{trace.subject || '—'}</td>
            <td style="padding: 8px;">
              <span class="badge" class:badge-info={trace.status === 'delivered' || trace.status === 'sent'} class:badge-error={trace.status === 'rejected' || trace.status === 'bounced'}>
                {trace.status}
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if data.traces.length >= 100}
    <div style="display: flex; justify-content: center; gap: 8px; margin-top: 12px;">
      {#if data.page > 1}
        <a href="?page={data.page - 1}&q={data.search}&direction={data.direction}" class="btn">← Newer</a>
      {/if}
      <a href="?page={data.page + 1}&q={data.search}&direction={data.direction}" class="btn">Older →</a>
    </div>
  {/if}
</div>
