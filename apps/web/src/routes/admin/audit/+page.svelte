<script>
  let { data } = $props();
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <h2>Audit Log</h2>
    <form method="GET" style="display: flex; gap: 8px;">
      <select name="event_type">
        <option value="">All Events</option>
        <option value="auth.sign_in" selected={data.eventType === 'auth.sign_in'}>Sign In</option>
        <option value="auth.session_expired" selected={data.eventType === 'auth.session_expired'}>Sign Out</option>
        <option value="user.provisioned" selected={data.eventType === 'user.provisioned'}>User Created</option>
        <option value="user.offboarded" selected={data.eventType === 'user.offboarded'}>User Offboarded</option>
        <option value="email.moved" selected={data.eventType === 'email.moved'}>Email Moved</option>
        <option value="policy.signed" selected={data.eventType === 'policy.signed'}>Policy Signed</option>
        <option value="policy.published" selected={data.eventType === 'policy.published'}>Policy Published</option>
        <option value="mailbox.created" selected={data.eventType === 'mailbox.created'}>Mailbox Created</option>
      </select>
      <button type="submit">Filter</button>
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
        {#each data.entries as entry}
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 16px; white-space: nowrap;">{new Date(entry.created_at).toLocaleString()}</td>
            <td style="padding: 8px;"><span class="badge">{entry.event_type}</span></td>
            <td style="padding: 8px;">{entry.actor_id}</td>
            <td style="padding: 8px;">{entry.detail || '—'}</td>
            <td style="padding: 8px; font-size: 12px;">{entry.ip_address || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if data.entries.length >= 100}
    <div style="display: flex; justify-content: center; gap: 8px; margin-top: 12px;">
      {#if data.page > 1}
        <a href="?page={data.page - 1}&event_type={data.eventType}" class="btn">← Newer</a>
      {/if}
      <a href="?page={data.page + 1}&event_type={data.eventType}" class="btn">Older →</a>
    </div>
  {/if}
</div>
