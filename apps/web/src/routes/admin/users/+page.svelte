<script>
  let { data, form } = $props();
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <h2>Users</h2>
    <form method="GET" style="display: flex; gap: 8px;">
      <input type="search" name="q" placeholder="Search users..." value={data.search} />
      <button type="submit">Search</button>
    </form>
  </div>

  {#if form?.error}
    <div class="badge badge-error" style="display: block; padding: 8px; margin-bottom: 12px;">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="badge badge-info" style="display: block; padding: 8px; margin-bottom: 12px;">{form.success}</div>
  {/if}

  <details class="card" style="margin-bottom: 16px;">
    <summary style="cursor: pointer; font-weight: 600;">+ Add User</summary>
    <form method="POST" action="?/create" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: end;">
      <div>
        <label style="font-size: 12px; display: block;">Email</label>
        <input type="email" name="email" required placeholder="user@example.com" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Display Name</label>
        <input type="text" name="display_name" placeholder="Optional" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Role</label>
        <select name="role">
          <option value="standard">Standard</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Create</button>
    </form>
  </details>

  <div class="card" style="padding: 0; overflow-x: auto;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="border-bottom: 2px solid var(--border);">
          <th style="text-align: left; padding: 10px 16px;">Email</th>
          <th style="text-align: left; padding: 10px 8px;">Name</th>
          <th style="text-align: left; padding: 10px 8px;">Role</th>
          <th style="text-align: left; padding: 10px 8px;">Status</th>
          <th style="text-align: left; padding: 10px 8px;">Last Sign In</th>
          <th style="text-align: left; padding: 10px 8px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each data.users as user}
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 16px;">{user.email}</td>
            <td style="padding: 8px;">{user.display_name || '—'}</td>
            <td style="padding: 8px;"><span class="badge">{user.role}</span></td>
            <td style="padding: 8px;">
              <span class="badge" class:badge-info={user.status === 'active'} class:badge-error={user.status === 'offboarded'}>
                {user.status}
              </span>
            </td>
            <td style="padding: 8px; font-size: 12px;">{user.last_sign_in || 'Never'}</td>
            <td style="padding: 8px;">
              <form method="POST" action="?/updateStatus" style="display: inline-flex; gap: 4px;">
                <input type="hidden" name="user_id" value={user.id} />
                {#if user.status !== 'active'}
                  <button type="submit" name="status" value="active" style="font-size: 12px; padding: 2px 8px;">Activate</button>
                {/if}
                {#if user.status !== 'paused'}
                  <button type="submit" name="status" value="paused" style="font-size: 12px; padding: 2px 8px;">Pause</button>
                {/if}
                {#if user.status !== 'offboarded'}
                  <button type="submit" name="status" value="offboarded" style="font-size: 12px; padding: 2px 8px; color: var(--danger);">Offboard</button>
                {/if}
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
