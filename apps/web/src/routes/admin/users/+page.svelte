<script>
  let { data, form } = $props();
  /** @type {any} */
  const f = $derived(form);
  /** @type {any} */
  const d = $derived(data);
</script>

<div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <h2>Users</h2>
    <form method="GET" style="display: flex; gap: 8px;">
      <input type="search" name="q" placeholder="Search users..." value={data.search} />
      <button type="submit">Search</button>
    </form>
  </div>

  {#if f?.error}
    <div class="badge badge-error" style="display: block; padding: 8px; margin-bottom: 12px;">{f.error}</div>
  {/if}
  {#if f?.success}
    <div class="badge badge-info" style="display: block; padding: 8px; margin-bottom: 12px;">{f.success}</div>
  {/if}
  {#if f?.warning}
    <div class="badge badge-error" style="display: block; padding: 8px; margin-bottom: 12px;">⚠ {f.warning}</div>
  {/if}

  <details class="card" style="margin-bottom: 16px;">
    <summary style="cursor: pointer; font-weight: 600;">+ Add User</summary>
    <form method="POST" action="?/create" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: end;">
      <div>
        <label style="font-size: 12px; display: block;">Email (sign-in)</label>
        <input type="email" name="email" required placeholder="user@example.com" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Display Name</label>
        <input type="text" name="display_name" placeholder="Optional" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Mailbox name {d.mailDomain ? `(@${d.mailDomain})` : ''}</label>
        <input type="text" name="mailbox_local" placeholder={d.mailDomain ? `e.g. firstname` : 'MAIL_DOMAIN not set'} disabled={!d.mailDomain} pattern="[a-zA-Z0-9._-]+" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Role</label>
        <select name="role">
          <option value="standard">Standard</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <div style="display: flex; align-items: center;">
        <input type="checkbox" id="send_invite" name="send_invite" style="width: auto; margin: 0; margin-right: 6px;" />
        <label for="send_invite" style="font-size: 12px; margin: 0; cursor: pointer;">Send invite email</label>
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
