<script lang="ts">
  import { formatDateTime } from '$lib/dates';

  let { data, form } = $props();
  const hasFilters = $derived(Boolean(data.search || data.roleFilter || data.statusFilter || data.providerFilter));

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (data.search) params.set('q', data.search);
    if (data.roleFilter) params.set('role', data.roleFilter);
    if (data.statusFilter) params.set('status', data.statusFilter);
    if (data.providerFilter) params.set('provider', data.providerFilter);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    return query ? `/admin/users?${query}` : '/admin/users';
  }

  function providerLabel(provider: string, identityBound: boolean): string {
    if (!identityBound) return 'Identity not enrolled';
    if (provider === 'microsoft') return 'Microsoft';
    if (provider === 'google') return 'Google';
    return 'Identity enrolled';
  }

  function confirmRoleChange(
    event: SubmitEvent,
    email: string,
    currentRole: string,
  ): void {
    const nextRole = new FormData(event.currentTarget as HTMLFormElement).get('role');
    if (typeof nextRole !== 'string' || nextRole === currentRole) return;
    const message = nextRole === 'manager'
      ? `Grant management access to ${email}? Managers can change accounts, mailboxes, organisation settings, and policy.`
      : `Remove management access from ${email}? Their active sessions will be revoked.`;
    if (!window.confirm(message)) event.preventDefault();
  }
</script>

<section class="admin-page" aria-labelledby="users-heading">
  <header class="page-header">
    <div>
      <h1 id="users-heading">People</h1>
      <p>Provision accounts, roles, invitations, and account lifecycle.</p>
    </div>
  </header>

  <!-- Filters are their own row. Beside the heading they had no width of
       their own, so each control stretched and the column collided with the
       title. -->
  <form method="GET" class="search-form" role="search">
      <label class="sr-only" for="user-search">Search people</label>
      <input
        id="user-search"
        type="search"
        name="q"
        maxlength="100"
        placeholder="Search name or email"
        value={data.search}
      />
      <label class="sr-only" for="user-role-filter">Filter by role</label>
      <select id="user-role-filter" name="role" value={data.roleFilter} aria-label="Filter people by role">
        <option value="">All roles</option>
        <option value="standard">Standard</option>
        <option value="manager">Manager</option>
      </select>
      <label class="sr-only" for="user-status-filter">Filter by status</label>
      <select id="user-status-filter" name="status" value={data.statusFilter} aria-label="Filter people by status">
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="offboarded">Offboarded</option>
      </select>
      <label class="sr-only" for="user-provider-filter">Filter by sign-in provider</label>
      <select id="user-provider-filter" name="provider" value={data.providerFilter} aria-label="Filter people by sign-in provider">
        <option value="">All sign-in states</option>
        <option value="google">Google</option>
        <option value="microsoft">Microsoft</option>
        <option value="none">Identity not enrolled</option>
      </select>
      <button type="submit">Search</button>
    {#if hasFilters}
      <a class="btn btn-ghost" href="/admin/users">Clear</a>
    {/if}
  </form>

  {#if data.configurationUnavailable}
    <div class="notice notice-error" role="alert">
      People data is unavailable. Confirm the Cloudflare D1 binding and apply the current migrations.
    </div>
  {/if}
  {#if form?.error}
    <div class="notice notice-error" role="alert">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="notice notice-success" role="status">{form.success}</div>
  {/if}
  {#if form?.warning}
    <div class="notice notice-warning" role="alert">{form.warning}</div>
  {/if}

  <details class="card create-card">
    <summary>Add a person</summary>
    <p class="form-intro">
      Create the account with its organisational personal mailbox. A new account remains pending and unbound until its owner uses a secure invitation.
    </p>
    <form method="POST" action="?/create" class="create-form">
      <div class="field">
        <label for="new-user-email">Sign-in email</label>
        <input
          id="new-user-email"
          type="email"
          name="email"
          maxlength="254"
          autocomplete="email"
          spellcheck="false"
          required
        />
      </div>
      <div class="field">
        <label for="new-user-name">Display name</label>
        <input
          id="new-user-name"
          type="text"
          name="display_name"
          maxlength="120"
          autocomplete="name"
        />
      </div>
      <div class="field">
        <label for="new-user-mailbox">Personal mailbox name <small>Required</small></label>
        <div class="suffix-control">
          <input
            id="new-user-mailbox"
            type="text"
            name="mailbox_local"
            maxlength="64"
            pattern={'[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?'}
            placeholder={data.mailDomain ? 'firstname.lastname' : 'MAIL_DOMAIN not configured'}
            aria-describedby="mailbox-domain-hint"
            disabled={!data.mailDomain}
            required
            spellcheck="false"
          />
          {#if data.mailDomain}<span aria-hidden="true">@{data.mailDomain}</span>{/if}
        </div>
        <small id="mailbox-domain-hint">
          {data.mailDomain
            ? 'Required. Use letters, numbers, dots, underscores, or hyphens.'
            : 'Configure MAIL_DOMAIN before provisioning personal mailboxes.'}
        </small>
      </div>
      <div class="field compact-field">
        <label for="new-user-role">Role</label>
        <select id="new-user-role" name="role" required>
          <option value="standard">Standard</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <div class="invite-field">
        <input
          id="send-invite"
          type="checkbox"
          name="send_invite"
          disabled={!data.inviteAvailable}
        />
        <div>
          <label for="send-invite">Send invitation now</label>
          <small>
            {data.inviteAvailable
              ? 'Required for first sign-in. The single-use link expires after 72 hours; resending rotates it.'
              : 'Configure APP_URL, an identity provider, and an outbound email provider to enable invites.'}
          </small>
        </div>
      </div>
      <div class="submit-row">
        <button type="submit" class="btn btn-primary" disabled={data.configurationUnavailable}>Create account</button>
      </div>
    </form>
  </details>

  <div class="results-meta" aria-live="polite">
    <span>{data.total} {data.total === 1 ? 'person' : 'people'}{hasFilters ? ' matching' : ''}</span>
    {#if data.totalPages > 1}<span>Page {data.page} of {data.totalPages}</span>{/if}
  </div>

  {#if data.users.length}
    <div class="card table-card">
      <table>
        <caption class="sr-only">User accounts and administrative actions</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each data.users as user}
            <tr>
              <td>
                <strong>{user.display_name || 'Unnamed account'}</strong>
                <span class="secondary">{user.email}</span>
                <span class="provider" class:identity-pending={!user.identity_bound}>
                  {providerLabel(user.auth_provider, Boolean(user.identity_bound))}
                </span>
              </td>
              <td>
                <form
                  method="POST"
                  action="?/updateRole"
                  class="inline-form"
                  aria-label={`Change role for ${user.email}`}
                  onsubmit={(event) => confirmRoleChange(event, user.email, user.role)}
                >
                  <input type="hidden" name="user_id" value={user.id} />
                  <label class="sr-only" for={`role-${user.id}`}>Role for {user.email}</label>
                  <select
                    id={`role-${user.id}`}
                    name="role"
                    value={user.role}
                    disabled={user.id === data.currentUserId}
                    aria-describedby={user.id === data.currentUserId ? `self-role-${user.id}` : undefined}
                  >
                    <option value="standard">Standard</option>
                    <option value="manager">Manager</option>
                  </select>
                  <button
                    type="submit"
                    class="btn btn-sm"
                    disabled={user.id === data.currentUserId}
                  >Save</button>
                </form>
                {#if user.id === data.currentUserId}
                  <small id={`self-role-${user.id}`} class="secondary">Your current account</small>
                {/if}
              </td>
              <td>
                <span
                  class="badge status-badge"
                  class:badge-success={user.status === 'active'}
                  class:badge-warning={user.status === 'pending' || user.status === 'paused'}
                  class:badge-error={user.status === 'offboarded'}
                >{user.status}</span>
              </td>
              <td class="last-sign-in">
                {#if user.last_sign_in}
                  <time datetime={user.last_sign_in}>{formatDateTime(user.last_sign_in, data.locale, data.timeZone)}</time>
                {:else}
                  Never
                {/if}
              </td>
              <td>
                <div class="actions">
                  <form method="POST" action="?/updateStatus" class="button-group" aria-label={`Change status for ${user.email}`}>
                    <input type="hidden" name="user_id" value={user.id} />
                    {#if user.status !== 'active'}
                      <button type="submit" name="status" value="active" class="btn btn-sm">Reactivate</button>
                    {/if}
                    {#if user.id !== data.currentUserId && user.status !== 'paused'}
                      <button
                        type="submit"
                        name="status"
                        value="paused"
                        class="btn btn-sm"
                        onclick={(event) => {
                          if (!window.confirm(`Pause ${user.email}? This immediately revokes active sessions. Mailbox assignments remain in place until reactivation or offboarding.`)) {
                            event.preventDefault();
                          }
                        }}
                      >Pause</button>
                    {/if}
                    {#if user.id !== data.currentUserId && user.status !== 'offboarded'}
                      <button
                        type="submit"
                        name="status"
                        value="offboarded"
                        class="btn btn-sm danger-outline"
                        formaction="?/updateStatus"
                        onclick={(event) => {
                           if (!window.confirm(`Offboard ${user.email}? This revokes sessions, pending invitations, and device notifications; disables the personal mailbox; removes shared access; and makes public positions internal. Stored mail is retained.`)) {
                            event.preventDefault();
                          }
                        }}
                      >Offboard</button>
                    {/if}
                  </form>
                  {#if !user.identity_bound && (user.status === 'active' || user.status === 'pending')}
                    <form method="POST" action="?/resendInvite" aria-label={`Send invitation to ${user.email}`}>
                      <input type="hidden" name="user_id" value={user.id} />
                      <button
                        type="submit"
                        class="btn btn-sm btn-ghost"
                        disabled={!data.inviteAvailable}
                        title={data.inviteAvailable ? 'Send a new single-use first-sign-in invitation' : 'Invite delivery is not configured'}
                      >Send invitation</button>
                    </form>
                  {:else if user.identity_bound}
                    <span class="secondary action-note">Identity enrolled</span>
                  {:else}
                    <span class="secondary action-note">Reactivate before inviting</span>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if !data.configurationUnavailable}
    <div class="card empty-state">
      <h3>{hasFilters ? 'No matching people' : 'No accounts yet'}</h3>
      <p>{hasFilters ? 'Adjust or clear the search and filters.' : 'Add the first account using the form above.'}</p>
    </div>
  {/if}

  {#if data.totalPages > 1}
    <nav class="pagination" aria-label="People pages">
      {#if data.page > 1}
        <a class="btn btn-sm" href={pageHref(data.page - 1)} rel="prev">Previous</a>
      {:else}
        <span class="btn btn-sm disabled" aria-disabled="true">Previous</span>
      {/if}
      <span>Page {data.page} of {data.totalPages}</span>
      {#if data.page < data.totalPages}
        <a class="btn btn-sm" href={pageHref(data.page + 1)} rel="next">Next</a>
      {:else}
        <span class="btn btn-sm disabled" aria-disabled="true">Next</span>
      {/if}
    </nav>
  {/if}
</section>

<style>
  .admin-page { display: grid; gap: 16px; }
  .page-header { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
  .page-header h1 { margin: 0; font-size: var(--fs-title-2); }
  .search-form {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 0 18px;
  }
  /* Capped so the search box cannot grow and push Search onto its own line. */
  .search-form input[type='search'] { flex: 1 1 240px; min-width: 180px; max-width: 320px; width: auto; }
  .search-form select { flex: 0 1 auto; width: auto; min-width: 150px; }
  .page-header p, .form-intro, .empty-state p { margin: 4px 0 0; color: var(--text-muted); }
  .search-form { display: flex; flex-wrap: wrap; gap: 8px; width: min(100%, 720px); justify-content: flex-end; }
  .search-form input { min-width: 180px; }
  .search-form select { min-width: 128px; }
  .notice { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; }
  .notice-error { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 25%, var(--border)); }
  .notice-success { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 25%, var(--border)); }
  .notice-warning { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 25%, var(--border)); }
  .create-card summary { cursor: pointer; font-weight: 600; }
  .create-form { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 14px; margin-top: 16px; align-items: start; }
  .field { display: grid; gap: 5px; }
  .field label, .invite-field label { font-size: 13px; font-weight: 600; }
  .field small, .invite-field small { color: var(--text-muted); font-size: 12px; }
  .compact-field { max-width: 220px; }
  .suffix-control { display: flex; align-items: stretch; }
  .suffix-control input { border-radius: var(--radius) 0 0 var(--radius); }
  .suffix-control span { display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid var(--border); border-left: 0; border-radius: 0 var(--radius) var(--radius) 0; background: var(--bg-subtle); color: var(--text-muted); font-size: 13px; white-space: nowrap; }
  .invite-field { grid-column: 1 / -1; display: flex; gap: 9px; align-items: start; }
  .invite-field input { width: auto; margin-top: 3px; }
  .invite-field div { display: grid; gap: 2px; }
  .submit-row { grid-column: 1 / -1; }
  .results-meta { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 13px; }
  .table-card { padding: 0; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  td strong, .secondary, .provider { display: block; }
  .secondary, .provider, .last-sign-in { color: var(--text-muted); font-size: 12px; }
  .provider { margin-top: 3px; }
  .identity-pending { color: var(--warning); font-weight: 600; }
  .status-badge { border: 1px solid var(--border-strong); color: var(--text); text-transform: capitalize; }
  .status-badge.badge-success { border-color: color-mix(in srgb, var(--success) 55%, var(--border)); }
  .status-badge.badge-warning { border-color: color-mix(in srgb, var(--warning) 55%, var(--border)); }
  .status-badge.badge-error { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
  .inline-form { display: flex; align-items: center; gap: 6px; min-width: 205px; }
  .inline-form select { min-width: 112px; padding-block: 5px; }
  .actions { display: grid; gap: 5px; min-width: 250px; }
  .button-group { display: flex; flex-wrap: wrap; gap: 5px; }
  .danger-outline { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
  .action-note { padding-block: 4px; }
  .empty-state { text-align: center; padding-block: 36px; }
  .empty-state h3 { margin: 0; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); font-size: 13px; }
  .disabled { opacity: .55; cursor: not-allowed; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  @media (max-width: 950px) {
    .create-form { grid-template-columns: repeat(2, minmax(180px, 1fr)); }
  }
  @media (max-width: 640px) {
    .page-header { align-items: stretch; flex-direction: column; }
    .search-form { width: 100%; flex-wrap: wrap; }
    .search-form input { flex: 1 1 100%; }
    .create-form { grid-template-columns: 1fr; }
    .invite-field, .submit-row { grid-column: auto; }
  }
</style>
