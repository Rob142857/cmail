<script>
  let { data } = $props();
</script>

<div>
  <h2 style="margin-bottom: 16px;">Dashboard Overview</h2>
  {#if data.stats}
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
      <div class="card" style="text-align: center;">
        <div style="font-size: 32px; font-weight: 700;">{data.stats.users}</div>
        <div style="color: var(--text-muted);">Users</div>
      </div>
      <div class="card" style="text-align: center;">
        <div style="font-size: 32px; font-weight: 700;">{data.stats.mailboxes}</div>
        <div style="color: var(--text-muted);">Mailboxes</div>
      </div>
      <div class="card" style="text-align: center;">
        <div style="font-size: 32px; font-weight: 700;">{data.stats.messages}</div>
        <div style="color: var(--text-muted);">Messages</div>
      </div>
      <div class="card" style="text-align: center;">
        <div style="font-size: 32px; font-weight: 700;">{data.stats.activeSessions}</div>
        <div style="color: var(--text-muted);">Active Sessions</div>
      </div>
    </div>
  {:else}
    <p class="card">Unable to load stats.</p>
  {/if}
</div>
