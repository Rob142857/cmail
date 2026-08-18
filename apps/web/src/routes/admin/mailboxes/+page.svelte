<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import MailboxAssigneePicker from '$lib/MailboxAssigneePicker.svelte';
  import { formatDateTime } from '$lib/dates';
  import {
    mailboxPermissionDescription,
    mailboxPermissionLabel,
  } from './mailbox-management';

  type MailboxPermission = 'read' | 'send-as' | 'full';

  let { data, form } = $props();
  let submitting = $state('');
  let resultNotice = $state<HTMLDivElement | null>(null);

  const hasFilters = $derived(Boolean(data.search || data.typeFilter || data.statusFilter));

  $effect(() => {
    if ((form?.error || form?.success) && resultNotice) resultNotice.focus();
  });

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (data.search) params.set('q', data.search);
    if (data.typeFilter) params.set('type', data.typeFilter);
    if (data.statusFilter) params.set('status', data.statusFilter);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    return query ? `/admin/mailboxes?${query}` : '/admin/mailboxes';
  }

  function mailboxTypeLabel(type: string): string {
    return type === 'shared' ? 'Shared mailbox' : 'Personal mailbox';
  }

  function hasEligibleOwner(mailbox: { owner_user_id: string | null; assignments: Array<{ user_id: string; permissions: string; user_status: string }> },
  ): boolean {
    return Boolean(mailbox.owner_user_id) && mailbox.assignments.some((assignment) =>
      assignment.user_id === mailbox.owner_user_id &&
      assignment.permissions === 'full' &&
      (assignment.user_status === 'active' || assignment.user_status === 'pending')
    );
  }

  function trackSubmission(
    key: string,
    confirm?: (formData: FormData) => boolean,
  ): SubmitFunction {
    return ({ cancel, formData }) => {
      if (submitting || (confirm && !confirm(formData))) {
        cancel();
        return;
      }
      submitting = key;
      return async ({ update }) => {
        try {
          await update();
        } finally {
          submitting = '';
        }
      };
    };
  }

  function confirmStatusChange(
    address: string,
    currentStatus: string,
    type: string,
    assignmentCount: number,
  ): boolean {
    const message = currentStatus === 'active'
      ? `Disable ${address}? It won't show in mailbox lists, can't send, and won't receive mail until re-enabled.`
      : type === 'shared' && assignmentCount === 0
        ? `Enable ${address} without delegation? It will accept mail, but no one can open or send from it.`
        : '';
    return !message || window.confirm(message);
  }

  function confirmPermissionChange(
    formData: FormData,
    email: string,
    address: string,
    currentPermission: MailboxPermission,
  ): boolean {
    const nextPermission = formData.get('permissions');
    if (nextPermission === 'full' && currentPermission !== 'full') {
      const message = `Grant Full access to ${email} for ${address}? Includes Send as, plus organising and moving messages.`;
      return window.confirm(message);
    }
    return true;
  }

  function confirmRemoval(
    email: string,
    address: string,
    permission: MailboxPermission,
  ): boolean {
    const message = `Remove ${mailboxPermissionLabel(permission)} for ${email} from ${address}? Access ends immediately.`;
    return window.confirm(message);
  }

  function assignmentMailbox(assignment: { personal_mailbox_address: string | null }): string {
    return assignment.personal_mailbox_address || 'Personal mailbox unavailable';
  }

  function assignmentName(assignment: { display_name: string; personal_mailbox_address: string | null }): string {
    return assignment.display_name || assignmentMailbox(assignment);
  }
</script>

<section class="admin-page" aria-labelledby="mailboxes-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Mail</p>
      <h1 id="mailboxes-heading">Mailbox management</h1>
      <p>Create shared mailboxes and manage their status and delegation.</p>
    </div>
  </header>

  {#if data.configurationUnavailable}
    <div class="notice notice-error" role="alert">
      <strong>Mailbox data is unavailable.</strong>
      <span>Check the D1 binding and run pending migrations.</span>
    </div>
  {/if}
  {#if form?.error}
    <div class="notice notice-error" role="alert" tabindex="-1" bind:this={resultNotice}>{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="notice notice-success" role="status" tabindex="-1" bind:this={resultNotice}>{form.success}</div>
  {/if}

  {#if !data.configurationUnavailable}
    <div class="command-row">
      <details class="create-panel" open={data.summary.total === 0}>
        <summary class="btn btn-primary">Create shared mailbox</summary>
        <div class="create-panel-body">
          <div class="panel-heading">
            <div>
              <h2>Create shared mailbox</h2>
              <p>The mailbox is active immediately. Add a delegate now or later.</p>
            </div>
            <span class="step-label">New resource</span>
          </div>

          {#if data.mailDomain}
            <form
              method="POST"
              action="?/create"
              class="create-form"
              use:enhance={trackSubmission('create')}
              aria-busy={submitting === 'create'}
            >
              <div class="field">
                <label for="new-mailbox-name">Display name</label>
                <input
                  id="new-mailbox-name"
                  type="text"
                  name="display_name"
                  maxlength="120"
                  placeholder="Customer support"
                  autocomplete="organization-title"
                  required
                />
                <small>The name people see in the mailbox list and From selector.</small>
              </div>
              <div class="field">
                <label for="new-mailbox-address">Email address</label>
                <div class="suffix-control">
                  <input
                    id="new-mailbox-address"
                    type="text"
                    name="address"
                    maxlength="64"
                    pattern={'[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?'}
                    placeholder="support"
                    aria-describedby="new-mailbox-hint"
                    spellcheck="false"
                    required
                  />
                  <span aria-hidden="true">@{data.mailDomain}</span>
                </div>
                <small id="new-mailbox-hint">Ends in @{data.mailDomain}. Letters, numbers, dots, underscores, and hyphens allowed.</small>
              </div>
              <div class="field">
                <label for="initial-delegate">Initial delegate <span>(optional)</span></label>
                <MailboxAssigneePicker
                  name="delegate_user_id"
                  id="initial-delegate"
                  placeholder="Start typing a name or email"
                  required={false}
                />
                <small>Choose their personal mailbox. Paused or offboarded people are excluded.</small>
              </div>
              <div class="field">
                <label for="initial-permission">Initial access level</label>
                <select id="initial-permission" name="permissions" aria-describedby="initial-permission-hint">
                  <option value="full">Full access</option>
                  <option value="send-as">Send as</option>
                  <option value="read">Read access</option>
                </select>
                <small id="initial-permission-hint">Used only when an initial delegate is entered.</small>
              </div>
              <div class="create-actions">
                <button type="submit" class="btn btn-primary" disabled={Boolean(submitting)}>
                  {submitting === 'create' ? 'Creating…' : 'Create mailbox'}
                </button>
                <span>Personal mailboxes are created with an owner from People.</span>
              </div>
            </form>
          {:else}
            <div class="inline-warning" role="status">
              Set <code>MAIL_DOMAIN</code> before creating a mailbox — see deployment values in
              <a href="/admin/settings">Settings</a>.
            </div>
          {/if}
        </div>
      </details>

      <details class="permission-guide">
        <summary>Mailbox delegation permissions</summary>
        <dl>
          <div>
            <dt>Read access</dt>
            <dd>View and mark messages read or unread — no sending or organising.</dd>
          </div>
          <div>
            <dt>Send as</dt>
            <dd>Read access, plus sending and replying as this mailbox.</dd>
          </div>
          <div>
            <dt>Full access</dt>
            <dd>Send as, plus folders, star, archive, Trash, and permanent delete.</dd>
          </div>
        </dl>
        <p>Details in the <a href="/help/shared-mailboxes">shared mailbox guide</a>.</p>
      </details>
    </div>

    <section class="summary-section" aria-labelledby="estate-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Overview</p>
          <h2 id="estate-heading">Mailbox summary</h2>
        </div>
        <span>Current configuration</span>
      </div>
      <div class="summary-grid">
        <article>
          <span>Total mailboxes</span>
          <strong>{data.summary.total}</strong>
          <small>{data.summary.shared} shared · {data.summary.personal} personal</small>
        </article>
        <article>
          <span>Active</span>
          <strong>{data.summary.active}</strong>
          <small>Available for mail flow and assigned users</small>
        </article>
        <article>
          <span>Disabled</span>
          <strong>{data.summary.disabled}</strong>
          <small>Hidden from users and not accepting new mail</small>
        </article>
        <article>
          <span>Delegations</span>
          <strong>{data.summary.delegations}</strong>
          <small>Access assignments across all mailboxes</small>
        </article>
      </div>
    </section>

    <section class="inventory" aria-labelledby="inventory-heading">
      <div class="section-heading inventory-heading">
        <div>
          <p class="eyebrow">Resources</p>
          <h2 id="inventory-heading">Mailboxes</h2>
        </div>
        <span>{data.total} {data.total === 1 ? 'result' : 'results'}{hasFilters ? ' after filters' : ''}</span>
      </div>

      <form method="GET" class="filter-bar" role="search" aria-label="Filter mailboxes">
        <div class="field search-field">
          <label for="mailbox-search">Search</label>
          <input
            id="mailbox-search"
            type="search"
            name="q"
            maxlength="100"
            placeholder="Address, display name, or delegate"
            value={data.search}
          />
        </div>
        <div class="field">
          <label for="mailbox-type-filter">Mailbox type</label>
          <select id="mailbox-type-filter" name="type" value={data.typeFilter}>
            <option value="">All types</option>
            <option value="shared">Shared mailbox</option>
            <option value="personal">Personal mailbox</option>
          </select>
        </div>
        <div class="field">
          <label for="mailbox-status-filter">Status</label>
          <select id="mailbox-status-filter" name="status" value={data.statusFilter}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div class="filter-actions">
          <button type="submit" class="btn">Apply filters</button>
          {#if hasFilters}<a class="btn btn-ghost" href="/admin/mailboxes">Clear</a>{/if}
        </div>
      </form>

      <div class="results-meta" aria-live="polite">
        <span>Showing {data.mailboxes.length} of {data.total}</span>
        {#if data.totalPages > 1}<span>Page {data.page} of {data.totalPages}</span>{/if}
      </div>

      {#if data.mailboxes.length}
        <div class="resource-list">
          {#each data.mailboxes as mailbox (mailbox.id)}
            <details
              id={`mailbox-${mailbox.id}`}
              class="resource-card"
              class:resource-disabled={mailbox.status === 'disabled'}
              open={data.mailboxes.length === 1 && hasFilters}
            >
              <summary>
                <span class="chevron" aria-hidden="true"></span>
                <span class="resource-identity">
                  <strong>{mailbox.display_name || mailbox.address}</strong>
                  <small>{mailbox.address}</small>
                </span>
                <span class="resource-type">{mailboxTypeLabel(mailbox.type)}</span>
                <span class="resource-count">
                  <strong>{mailbox.assignments.length}</strong>
                  <small>{mailbox.assignments.length === 1 ? 'delegation' : 'delegations'}</small>
                </span>
                <span
                  class="status-badge"
                  class:status-active={mailbox.status === 'active'}
                  class:status-disabled={mailbox.status === 'disabled'}
                >{mailbox.status}</span>
              </summary>

              <div class="resource-body">
                <section class="general-pane" aria-labelledby={`general-${mailbox.id}`}>
                  <div class="pane-heading">
                    <div>
                      <p class="eyebrow">Properties</p>
                      <h3 id={`general-${mailbox.id}`}>General</h3>
                    </div>
                  </div>

                  <dl class="property-list">
                    <div><dt>Email address</dt><dd>{mailbox.address}</dd></div>
                    <div><dt>Mailbox type</dt><dd>{mailboxTypeLabel(mailbox.type)}</dd></div>
                    {#if mailbox.type === 'personal'}
                      <div><dt>Owner</dt><dd>{mailbox.owner_display_name || (mailbox.owner_user_id ? mailbox.address : 'Ownership needs review')}</dd></div>
                    {/if}
                    <div><dt>Stored messages</dt><dd>{mailbox.message_count}</dd></div>
                    <div>
                      <dt>Created</dt>
                      <dd><time datetime={mailbox.created_at}>{formatDateTime(mailbox.created_at, data.locale, data.timeZone)}</time></dd>
                    </div>
                  </dl>

                  {#if mailbox.status === 'disabled'}
                    <div class="state-note state-note-info">
                      Disabled: hidden from users, can't send, and can't receive mail.
                    </div>
                    {#if mailbox.type === 'personal' && !hasEligibleOwner(mailbox)}
                      <div class="state-note state-note-warning" role="status">
                        Assign an active or pending owner with Full access before enabling this personal mailbox.
                      </div>
                    {/if}
                  {:else if mailbox.type === 'shared' && mailbox.assignments.length === 0}
                    <div class="state-note state-note-warning" role="status">
                      No delegation set — mail can arrive, but no one can open or send from it.
                    </div>
                  {/if}

                  <form
                    method="POST"
                    action="?/updateStatus"
                    class="status-form"
                    use:enhance={trackSubmission(
                      `status:${mailbox.id}`,
                      () => confirmStatusChange(mailbox.address, mailbox.status, mailbox.type, mailbox.assignments.length),
                    )}
                    aria-busy={submitting === `status:${mailbox.id}`}
                  >
                    <input type="hidden" name="mailbox_id" value={mailbox.id} />
                    <input type="hidden" name="status" value={mailbox.status === 'active' ? 'disabled' : 'active'} />
                    <button
                      type="submit"
                      class="btn btn-sm"
                      class:danger-outline={mailbox.status === 'active'}
                      disabled={Boolean(submitting) || (
                        mailbox.status === 'disabled' &&
                        mailbox.type === 'personal' &&
                        !hasEligibleOwner(mailbox)
                      )}
                      title={mailbox.status === 'disabled' && mailbox.type === 'personal' && !hasEligibleOwner(mailbox)
                        ? 'Assign an active or pending owner with Full access before enabling'
                        : undefined}
                    >
                      {submitting === `status:${mailbox.id}`
                        ? mailbox.status === 'active' ? 'Disabling…' : 'Enabling…'
                        : mailbox.status === 'active' ? 'Disable mailbox' : 'Enable mailbox'}
                    </button>
                  </form>
                </section>

                <section class="delegation-pane" aria-labelledby={`delegation-${mailbox.id}`}>
                  <div class="pane-heading">
                    <div>
                      <p class="eyebrow">Access</p>
                      <h3 id={`delegation-${mailbox.id}`}>Mailbox delegation</h3>
                      <p>
                        {mailbox.type === 'shared'
                          ? 'Add people and choose the access level they need.'
                          : 'Personal mailbox owners need Full access, managed from People.'}
                      </p>
                    </div>
                    <span>{mailbox.assignments.length} {mailbox.assignments.length === 1 ? 'assignment' : 'assignments'}</span>
                  </div>

                  {#if mailbox.type === 'shared'}
                  <details class="add-delegation">
                    <summary>Add delegation</summary>
                    <form
                      method="POST"
                      action="?/assign"
                      class="delegation-form"
                      use:enhance={trackSubmission(`add:${mailbox.id}`)}
                      aria-busy={submitting === `add:${mailbox.id}`}
                    >
                      <input type="hidden" name="mailbox_address" value={mailbox.address} />
                      <div class="field">
                        <label for={`delegate-user-${mailbox.id}`}>Account</label>
                        {#key mailbox.assignments.length}
                          <MailboxAssigneePicker
                            excludedUserIds={mailbox.assignments.map((assignment) => assignment.user_id)}
                            name="user_id"
                            id={`delegate-user-${mailbox.id}`}
                            placeholder="Start typing a name or email"
                            required={true}
                          />
                        {/key}
                      </div>
                      <div class="field">
                        <label for={`delegate-permission-${mailbox.id}`}>Access level</label>
                        <select id={`delegate-permission-${mailbox.id}`} name="permissions">
                          <option value="full">Full access</option>
                          <option value="send-as">Send as</option>
                          <option value="read">Read access</option>
                        </select>
                      </div>
                      <button type="submit" class="btn btn-primary" disabled={Boolean(submitting)}>
                        {submitting === `add:${mailbox.id}` ? 'Adding…' : 'Add delegation'}
                      </button>
                    </form>
                  </details>
                  {/if}

                  {#if mailbox.assignments.length}
                    <ul class="assignment-list">
                      {#each mailbox.assignments as assignment (assignment.user_id)}
                        <li>
                          <div class="principal">
                            <span class="principal-mark" aria-hidden="true">
                              {assignmentName(assignment).slice(0, 1).toUpperCase()}
                            </span>
                            <span>
                              <strong>{assignmentName(assignment)}</strong>
                              <small>{assignmentMailbox(assignment)}</small>
                              <small>
                                Assigned <time datetime={assignment.assigned_at}>{formatDateTime(assignment.assigned_at, data.locale, data.timeZone)}</time>
                              </small>
                            </span>
                          </div>

                          <span
                            class="status-badge account-status"
                            class:status-active={assignment.user_status === 'active'}
                            class:status-pending={assignment.user_status === 'pending'}
                            class:status-disabled={assignment.user_status === 'paused' || assignment.user_status === 'offboarded'}
                          >{assignment.user_status}</span>

                          {#if mailbox.type === 'shared'}
                            <form
                              method="POST"
                              action="?/assign"
                              class="permission-editor"
                              use:enhance={trackSubmission(
                                `permission:${mailbox.id}:${assignment.user_id}`,
                                (formData) => confirmPermissionChange(formData, assignmentMailbox(assignment), mailbox.address, assignment.permissions),
                              )}
                              aria-busy={submitting === `permission:${mailbox.id}:${assignment.user_id}`}
                            >
                              <input type="hidden" name="mailbox_address" value={mailbox.address} />
                              <input type="hidden" name="user_id" value={assignment.user_id} />
                              <label class="sr-only" for={`permission-${mailbox.id}-${assignment.user_id}`}>
                                Access level for {assignmentMailbox(assignment)}
                              </label>
                              <select
                                id={`permission-${mailbox.id}-${assignment.user_id}`}
                                name="permissions"
                                value={assignment.permissions}
                                disabled={assignment.user_status === 'paused' || assignment.user_status === 'offboarded' || Boolean(submitting)}
                                title={assignment.user_status === 'paused' || assignment.user_status === 'offboarded'
                                  ? 'Reactivate the account before changing delegation'
                                  : 'Mailbox access level'}
                              >
                                <option value="full">Full access</option>
                                <option value="send-as">Send as</option>
                                <option value="read">Read access</option>
                              </select>
                              <button
                                type="submit"
                                class="btn btn-sm"
                                disabled={assignment.user_status === 'paused' || assignment.user_status === 'offboarded' || Boolean(submitting)}
                              >
                                {submitting === `permission:${mailbox.id}:${assignment.user_id}` ? 'Updating…' : 'Update'}
                              </button>
                            </form>
                          {:else}
                            <div class="permission-readout">
                              <strong>{mailboxPermissionLabel(assignment.permissions)}</strong>
                              <small>{mailboxPermissionDescription(assignment.permissions)}</small>
                            </div>
                          {/if}

                          {#if mailbox.type === 'personal'}
                            <span class="protected-owner">Managed in People</span>
                          {:else}
                            <form
                              method="POST"
                              action="?/unassign"
                              use:enhance={trackSubmission(
                                `remove:${mailbox.id}:${assignment.user_id}`,
                                () => confirmRemoval(assignmentMailbox(assignment), mailbox.address, assignment.permissions),
                              )}
                              aria-busy={submitting === `remove:${mailbox.id}:${assignment.user_id}`}
                            >
                              <input type="hidden" name="mailbox_id" value={mailbox.id} />
                              <input type="hidden" name="user_id" value={assignment.user_id} />
                              <button type="submit" class="btn btn-sm btn-ghost remove-access" disabled={Boolean(submitting)}>
                                {submitting === `remove:${mailbox.id}:${assignment.user_id}` ? 'Removing…' : 'Remove'}
                              </button>
                            </form>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <div class="empty-access">
                      <strong>No mailbox delegation</strong>
                      <p>Add an active or pending account to make this mailbox usable.</p>
                    </div>
                  {/if}
                </section>
              </div>
            </details>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <h3>{hasFilters ? 'No mailboxes match these filters' : 'No mailboxes yet'}</h3>
          <p>{hasFilters ? 'Adjust or clear the search, type, and status filters.' : 'Create a shared mailbox above or provision a personal mailbox from People.'}</p>
          {#if hasFilters}<a class="btn" href="/admin/mailboxes">Clear filters</a>{/if}
        </div>
      {/if}

      {#if data.totalPages > 1}
        <nav class="pagination" aria-label="Mailbox pages">
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
  {/if}
</section>

<style>
  .admin-page { display: grid; gap: 28px; }
  .page-header { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
  .page-header h1 { margin: 2px 0 6px; font-size: clamp(25px, 3vw, 34px); }
  .page-header p:not(.eyebrow) { max-width: 720px; color: var(--text-muted); }
  .eyebrow { margin: 0; color: var(--primary); font-size: 10px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }

  .notice { display: grid; gap: 2px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); }
  .notice span { color: var(--text-muted); font-size: 13px; }
  .notice-error { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: var(--danger-soft); }
  .notice-success { border-color: color-mix(in srgb, var(--success) 45%, var(--border)); background: var(--success-soft); }

  .command-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px; }
  .create-panel { flex: 1 1 100%; order: 2; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); }
  .create-panel:not([open]) { flex: 0 0 auto; order: 0; border: 0; background: transparent; }
  .create-panel > summary { width: max-content; list-style: none; }
  .create-panel > summary::-webkit-details-marker { display: none; }
  .create-panel[open] > summary { margin: 12px 12px 0 auto; background: transparent; color: var(--text-muted); border-color: transparent; }
  .create-panel[open] > summary::before { content: 'Close '; }
  .create-panel-body { display: grid; gap: 18px; padding: 6px 20px 20px; }
  .panel-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; padding-right: 84px; }
  .panel-heading h2 { margin: 0; font-size: 19px; }
  .panel-heading p { margin-top: 4px; max-width: 760px; color: var(--text-muted); font-size: 13px; }
  .step-label { padding: 3px 7px; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: 10px; font-weight: 700; text-transform: uppercase; }

  .create-form { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 14px; align-items: start; }
  .field { display: grid; gap: 5px; min-width: 0; }
  .field label { color: var(--text); font-size: 12px; font-weight: 650; }
  .field label span { color: var(--text-muted); font-weight: 400; }
  .field small { color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .suffix-control { display: flex; align-items: stretch; }
  .suffix-control input { min-width: 0; border-radius: var(--radius) 0 0 var(--radius); }
  .suffix-control span { display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid var(--border); border-left: 0; border-radius: 0 var(--radius) var(--radius) 0; background: var(--bg-subtle); color: var(--text-muted); font-size: 12px; white-space: nowrap; }
  .create-actions { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 2px; }
  .create-actions span { color: var(--text-muted); font-size: 11px; }
  .inline-warning { padding: 12px; border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border)); border-radius: var(--radius); background: var(--warning-soft); color: var(--text); font-size: 13px; }

  .permission-guide { order: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-surface); }
  .permission-guide summary { cursor: pointer; color: var(--text-muted); font-size: 12px; font-weight: 650; }
  .permission-guide dl { display: grid; gap: 9px; margin: 14px 4px 0; }
  .permission-guide dl div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; }
  .permission-guide dt { font-size: 12px; font-weight: 700; }
  .permission-guide dd, .permission-guide p { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.5; }
  .permission-guide p { max-width: 620px; margin: 11px 4px 4px; padding-top: 9px; border-top: 1px solid var(--border); }

  .summary-section, .inventory { min-width: 0; }
  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 11px; }
  .section-heading h2 { margin: 2px 0 0; font-size: 19px; }
  .section-heading > span { color: var(--text-muted); font-size: 11px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-surface); }
  .summary-grid article { display: flex; min-width: 0; flex-direction: column; padding: 16px; border-right: 1px solid var(--border); }
  .summary-grid article:last-child { border-right: 0; }
  .summary-grid span { color: var(--text-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .03em; }
  .summary-grid strong { margin-top: 3px; font-size: 26px; font-variant-numeric: tabular-nums; }
  .summary-grid small { margin-top: 2px; color: var(--text-muted); font-size: 11px; line-height: 1.4; }

  .filter-bar { display: grid; grid-template-columns: minmax(240px, 1fr) 180px 160px auto; gap: 10px; align-items: end; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); }
  .filter-actions { display: flex; gap: 6px; }
  .results-meta { display: flex; justify-content: space-between; gap: 12px; margin: 10px 2px; color: var(--text-muted); font-size: 11px; }

  .resource-list { display: grid; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-surface); }
  .resource-card { border-bottom: 1px solid var(--border); }
  .resource-card:last-child { border-bottom: 0; }
  .resource-card > summary { display: grid; grid-template-columns: 14px minmax(220px, 1fr) minmax(130px, .45fr) 90px 88px; align-items: center; gap: 12px; min-height: 68px; padding: 10px 14px; list-style: none; cursor: pointer; }
  .resource-card > summary::-webkit-details-marker { display: none; }
  .resource-card > summary:hover { background: var(--bg-hover); }
  .resource-card[open] > summary { background: var(--primary-soft); box-shadow: inset 3px 0 var(--primary); }
  .resource-disabled > summary { background-image: linear-gradient(90deg, color-mix(in srgb, var(--danger-soft) 42%, transparent), transparent 42%); }
  .chevron { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform .16s ease; }
  .resource-card[open] .chevron { transform: rotate(45deg); }
  .resource-identity { display: flex; min-width: 0; flex-direction: column; }
  .resource-identity strong, .resource-identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .resource-identity strong { font-size: 13px; }
  .resource-identity small, .resource-type, .resource-count small { color: var(--text-muted); font-size: 11px; }
  .resource-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .resource-count { display: flex; flex-direction: column; align-items: flex-start; }
  .resource-count strong { font-size: 13px; font-variant-numeric: tabular-nums; }
  .status-badge { display: inline-flex; width: max-content; align-items: center; padding: 3px 8px; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text); font-size: 10px; font-weight: 700; text-transform: capitalize; }
  .status-active { border-color: color-mix(in srgb, var(--success) 55%, var(--border)); background: var(--success-soft); }
  .status-pending { border-color: color-mix(in srgb, var(--warning) 55%, var(--border)); background: var(--warning-soft); }
  .status-disabled { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); background: var(--danger-soft); }

  .resource-body { display: grid; grid-template-columns: minmax(240px, .7fr) minmax(420px, 1.5fr); border-top: 1px solid var(--border); background: var(--bg); }
  .general-pane, .delegation-pane { min-width: 0; padding: 18px; }
  .general-pane { border-right: 1px solid var(--border); background: var(--bg-surface); }
  .pane-heading { display: flex; align-items: start; justify-content: space-between; gap: 14px; }
  .pane-heading h3 { margin: 2px 0 0; font-size: 16px; }
  .pane-heading p:not(.eyebrow) { margin-top: 4px; max-width: 680px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .pane-heading > span { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
  .property-list { display: grid; gap: 0; margin: 14px 0; border-top: 1px solid var(--border); }
  .property-list div { display: grid; grid-template-columns: minmax(95px, .8fr) minmax(0, 1.2fr); gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); }
  .property-list dt { color: var(--text-muted); font-size: 11px; }
  .property-list dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: 11px; font-weight: 600; text-align: right; }
  .state-note { margin: 12px 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 11px; line-height: 1.45; }
  .state-note-info { background: var(--bg-subtle); }
  .state-note-warning { border-color: color-mix(in srgb, var(--warning) 45%, var(--border)); background: var(--warning-soft); }
  .status-form { margin-top: 14px; }
  .danger-outline, .remove-access { color: var(--danger); }
  .danger-outline { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }

  .delegation-pane { display: grid; align-content: start; gap: 13px; }
  .add-delegation { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-surface); }
  .add-delegation > summary { padding: 9px 11px; cursor: pointer; color: var(--primary); font-size: 12px; font-weight: 700; }
  .delegation-form { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(135px, .45fr) auto; gap: 10px; align-items: end; padding: 0 11px 11px; }
  .assignment-list { display: grid; gap: 0; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); list-style: none; overflow: hidden; background: var(--bg-surface); }
  .assignment-list li { display: grid; grid-template-columns: minmax(190px, 1fr) auto minmax(220px, auto) auto; gap: 10px; align-items: center; padding: 10px; border-bottom: 1px solid var(--border); }
  .assignment-list li:last-child { border-bottom: 0; }
  .principal { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 8px; align-items: center; min-width: 0; }
  .principal-mark { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 50%; background: var(--primary-soft); color: var(--primary); font-size: 11px; font-weight: 750; }
  .principal > span:last-child { display: flex; min-width: 0; flex-direction: column; }
  .principal strong, .principal small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .principal strong { font-size: 12px; }
  .principal small { color: var(--text-muted); font-size: 10px; }
  .account-status { align-self: center; }
  .permission-editor { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 5px; }
  .permission-editor select { min-width: 125px; padding-block: 5px; font-size: 11px; }
  .permission-readout { display: flex; max-width: 250px; flex-direction: column; }
  .permission-readout strong { font-size: 11px; }
  .permission-readout small { color: var(--text-muted); font-size: 10px; line-height: 1.4; }
  .protected-owner { justify-self: end; color: var(--text-muted); font-size: 10px; font-weight: 650; white-space: nowrap; }
  .empty-access { padding: 20px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; }
  .empty-access strong { font-size: 13px; }
  .empty-access p { margin-top: 3px; color: var(--text-muted); font-size: 11px; }

  .empty-state { padding: 42px 20px; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); text-align: center; }
  .empty-state h3 { margin: 0; font-size: 16px; }
  .empty-state p { margin: 5px 0 15px; color: var(--text-muted); font-size: 12px; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 15px; color: var(--text-muted); font-size: 12px; }
  .disabled { opacity: .55; cursor: not-allowed; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  @media (max-width: 1180px) {
    .create-form { grid-template-columns: repeat(2, minmax(190px, 1fr)); }
    .resource-body { grid-template-columns: 1fr; }
    .general-pane { border-right: 0; border-bottom: 1px solid var(--border); }
    .assignment-list li { grid-template-columns: minmax(180px, 1fr) auto minmax(210px, auto) auto; }
  }
  @media (max-width: 900px) {
    .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .summary-grid article:nth-child(2) { border-right: 0; }
    .summary-grid article:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
    .filter-bar { grid-template-columns: 1fr 1fr; }
    .search-field { grid-column: 1 / -1; }
    .assignment-list li { grid-template-columns: minmax(180px, 1fr) auto; align-items: start; }
    .permission-editor { grid-column: 1; }
    .assignment-list li > form:last-child { grid-column: 2; grid-row: 2; }
  }
  @media (max-width: 700px) {
    .admin-page { gap: 22px; }
    .page-header { align-items: stretch; flex-direction: column; }
    .panel-heading { padding-right: 0; flex-direction: column; }
    .step-label { order: -1; }
    .create-form, .filter-bar, .delegation-form { grid-template-columns: 1fr; }
    .search-field, .create-actions { grid-column: auto; }
    .filter-actions { flex-wrap: wrap; }
    .resource-card > summary { grid-template-columns: 12px minmax(0, 1fr) auto; gap: 9px; }
    .resource-type { grid-column: 2; }
    .resource-count { display: none; }
    .status-badge { grid-column: 3; grid-row: 1 / span 2; }
    .resource-body { display: block; }
    .general-pane, .delegation-pane { padding: 14px; }
    .pane-heading { flex-direction: column; }
    .assignment-list li { grid-template-columns: 1fr auto; }
    .principal { grid-column: 1; }
    .account-status { grid-column: 2; grid-row: 1; justify-self: end; }
    .permission-editor, .permission-readout { grid-column: 1 / -1; max-width: none; }
    .assignment-list li > form:last-child { grid-column: 2; grid-row: 3; }
    .protected-owner { grid-column: 2; grid-row: 3; }
  }
  @media (max-width: 480px) {
    .summary-grid { grid-template-columns: 1fr; }
    .summary-grid article { border-right: 0; border-bottom: 1px solid var(--border); }
    .summary-grid article:last-child { border-bottom: 0; }
    .permission-guide dl div, .property-list div { grid-template-columns: 1fr; gap: 3px; }
    .property-list dd { text-align: left; }
    .create-panel-body { padding-inline: 14px; }
  }
</style>
