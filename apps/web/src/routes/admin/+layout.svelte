<script>
  let { children } = $props();
</script>

<div class="admin-shell">
  <div class="admin-header">
    <a href="/mail" class="btn">← Mail</a>
    <h1>Admin Dashboard</h1>
    <nav class="admin-nav">
      <a href="/admin" class="btn">Overview</a>
      <a href="/admin/users" class="btn">Users</a>
      <a href="/admin/mailboxes" class="btn">Mailboxes</a>
      <a href="/admin/policy" class="btn">Policy</a>
      <a href="/admin/audit" class="btn">Audit Log</a>
      <a href="/admin/trace" class="btn">Mail Trace</a>
      <a href="/admin/settings" class="btn">Settings</a>
    </nav>
  </div>
  {@render children()}
</div>

<style>
  .admin-shell { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .admin-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 16px;
    flex-wrap: wrap;
  }
  .admin-header h1 { font-size: 20px; margin: 0; }
  .admin-nav { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
  @media (max-width: 768px) {
    .admin-shell { padding: 12px; }
    .admin-nav { margin-left: 0; width: 100%; overflow-x: auto; flex-wrap: nowrap; }
    .admin-nav .btn { white-space: nowrap; }
  }
</style>
