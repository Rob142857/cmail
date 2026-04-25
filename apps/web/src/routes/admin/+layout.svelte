<script>
  let { children } = $props();
</script>

<div style="max-width: 1200px; margin: 0 auto; padding: 24px;">
  <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px;">
    <a href="/mail" class="btn">← Mail</a>
    <h1 style="font-size: 20px; margin: 0;">⚙️ Admin Dashboard</h1>
    <nav style="display: flex; gap: 8px; margin-left: auto;">
      <a href="/admin" class="btn">Overview</a>
      <a href="/admin/users" class="btn">Users</a>
      <a href="/admin/mailboxes" class="btn">Mailboxes</a>
      <a href="/admin/policy" class="btn">Policy</a>
      <a href="/admin/audit" class="btn">Audit Log</a>
      <a href="/admin/trace" class="btn">Mail Trace</a>
    </nav>
  </div>
  {@render children()}
</div>
