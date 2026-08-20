<script lang="ts">
  import { formatDateTime } from '$lib/dates';

  let { data, form } = $props();
</script>

<svelte:head><title>Travel approvals · Management · {data.appName || 'cmail'}</title></svelte:head>

<section class="admin-page" aria-labelledby="travel-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Identity &amp; organisation</p>
      <h1 id="travel-heading">Travel approvals</h1>
      <p>Sign-ins from outside your organisation's approved countries wait here for a manager to grant a temporary exception. Off entirely until countries are chosen in <a href="/admin/settings">Settings</a>.</p>
    </div>
  </header>

  {#if data.unavailable}
    <div class="notice notice-error" role="alert">
      <strong>Travel approvals data is unavailable.</strong>
      <span>Check the D1 binding and run pending migrations.</span>
    </div>
  {/if}
  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  <section aria-labelledby="pending-heading">
    <div class="section-row">
      <h2 id="pending-heading">Pending requests</h2>
      <span>{data.pending.length} {data.pending.length === 1 ? 'request' : 'requests'}</span>
    </div>

    {#if data.pending.length}
      <div class="card table-card">
        <table>
          <caption class="sr-only">Pending sign-in country requests</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Country</th>
              <th scope="col">Requested</th>
              <th scope="col">Denied before</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each data.pending as request (request.id)}
              <tr>
                <td>
                  <strong>{request.displayName || request.email}</strong>
                  {#if request.displayName}<span class="secondary">{request.email}</span>{/if}
                </td>
                <td>{request.countryLabel} <span class="secondary">{request.country}</span></td>
                <td class="nowrap"><time datetime={request.requestedAt}>{formatDateTime(request.requestedAt, data.locale, data.timeZone)}</time></td>
                <td>{request.deniedCount > 0 ? request.deniedCount : '—'}</td>
                <td>
                  <div class="button-group">
                    <form method="POST" action="?/approve">
                      <input type="hidden" name="id" value={request.id} />
                      <button type="submit" name="duration" value="24h" class="btn btn-sm">24 hours</button>
                      <button type="submit" name="duration" value="7d" class="btn btn-sm">7 days</button>
                      <button type="submit" name="duration" value="30d" class="btn btn-sm">30 days</button>
                    </form>
                    <form method="POST" action="?/deny">
                      <input type="hidden" name="id" value={request.id} />
                      <button type="submit" class="btn btn-sm btn-ghost-danger">Deny</button>
                    </form>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="card empty-state">
        <h3 class="empty-title">No pending requests.</h3>
        <p class="empty-note">A refused sign-in from outside the approved list will show up here.</p>
      </div>
    {/if}
  </section>

  <section aria-labelledby="exceptions-heading">
    <div class="section-row">
      <h2 id="exceptions-heading">Active exceptions</h2>
      <span>{data.exceptions.length} active</span>
    </div>

    {#if data.exceptions.length}
      <div class="card table-card">
        <table>
          <caption class="sr-only">Active sign-in country exceptions</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Country</th>
              <th scope="col">Approved by</th>
              <th scope="col">Expires</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {#each data.exceptions as exception (exception.id)}
              <tr>
                <td>
                  <strong>{exception.displayName || exception.email}</strong>
                  {#if exception.displayName}<span class="secondary">{exception.email}</span>{/if}
                </td>
                <td>{exception.countryLabel} <span class="secondary">{exception.country}</span></td>
                <td>{exception.approvedByName || '—'}</td>
                <td class="nowrap"><time datetime={exception.expiresAt}>{formatDateTime(exception.expiresAt, data.locale, data.timeZone)}</time></td>
                <td>
                  <form method="POST" action="?/revoke" onsubmit={(event) => { if (!confirm(`Revoke the exception for ${exception.countryLabel}?`)) event.preventDefault(); }}>
                    <input type="hidden" name="id" value={exception.id} />
                    <button type="submit" class="btn btn-sm btn-ghost-danger">Revoke</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="card empty-state">
        <h3 class="empty-title">No active exceptions.</h3>
        <p class="empty-note">An approved request grants a temporary exception that appears here until it expires.</p>
      </div>
    {/if}
  </section>

  <section aria-labelledby="decisions-heading">
    <div class="section-row">
      <h2 id="decisions-heading">Recent decisions</h2>
      <span>Last {data.decisions.length}</span>
    </div>

    {#if data.decisions.length}
      <div class="card table-card">
        <table>
          <caption class="sr-only">Recent travel approval decisions</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Country</th>
              <th scope="col">Decision</th>
              <th scope="col">Decided by</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {#each data.decisions as decision (decision.id)}
              <tr>
                <td>
                  <strong>{decision.displayName || decision.email}</strong>
                  {#if decision.displayName}<span class="secondary">{decision.email}</span>{/if}
                </td>
                <td>{decision.countryLabel} <span class="secondary">{decision.country}</span></td>
                <td><span class="badge" class:badge-success={decision.status === 'approved'} class:badge-danger={decision.status === 'denied'}>{decision.status}</span></td>
                <td>{decision.decidedByName || '—'}</td>
                <td class="nowrap">{#if decision.decidedAt}<time datetime={decision.decidedAt}>{formatDateTime(decision.decidedAt, data.locale, data.timeZone)}</time>{:else}—{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="card empty-state">
        <h3 class="empty-title">No decisions yet.</h3>
        <p class="empty-note">Approvals and denials appear here, most recent first.</p>
      </div>
    {/if}
  </section>
</section>

<style>
  .admin-page { display: grid; gap: 26px; }
  .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
  .page-header h1 { margin: 3px 0 5px; font-size: var(--fs-title-2); }
  .page-header p:last-child { margin: 0; max-width: 74ch; color: var(--text-muted); font-size: 13px; }

  .notice { display: grid; gap: 2px; }
  .notice span { color: var(--text-muted); font-size: 13px; }

  .section-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
  .section-row h2 { margin: 0; font-size: var(--fs-subtitle); }
  .section-row > span { color: var(--text-muted); font-size: 12px; }

  .table-card { padding: 0; overflow-x: auto; }
  .secondary { display: block; color: var(--text-muted); font-size: 11px; }
  .nowrap { white-space: nowrap; }

  .button-group { display: flex; flex-wrap: wrap; gap: 6px; }
  .button-group form { display: flex; flex-wrap: wrap; gap: 6px; }

  .empty-state { text-align: center; padding-block: 40px; }

  @media (max-width: 640px) {
    .page-header { align-items: stretch; flex-direction: column; }
    .section-row { align-items: flex-start; flex-direction: column; }
  }
</style>
