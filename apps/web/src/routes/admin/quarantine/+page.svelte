<script lang="ts">
  import { formatDateTime } from '$lib/dates';
  import { quarantineReasonPhrase } from '$lib/quarantine-reason';

  let { data, form } = $props();
  let newRuleAction = $state<'allow' | 'block'>('block');

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    return query ? `/admin/quarantine?${query}` : '/admin/quarantine';
  }

  function reasonLabel(message: { quarantine_reason: string | null; spam_score: number | null }): string {
    return quarantineReasonPhrase(message.quarantine_reason)
      ?? (message.spam_score != null ? `spam score ${message.spam_score}` : 'unspecified');
  }
</script>

<svelte:head><title>Quarantine · Management · {data.appName || 'cmail'}</title></svelte:head>

<section class="admin-page" aria-labelledby="quarantine-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Mail</p>
      <h1 id="quarantine-heading">Quarantine</h1>
      <p>Mail filed as spam, across every mailbox. Release and delete act on one message; allow and block add a rule for future mail.</p>
    </div>
  </header>

  {#if data.unavailable}
    <div class="notice notice-error" role="alert">
      <strong>Quarantine data is unavailable.</strong>
      <span>Check the D1 binding and run pending migrations.</span>
    </div>
  {/if}
  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  <section aria-labelledby="messages-heading">
    <div class="section-row">
      <h2 id="messages-heading">Quarantined messages</h2>
      <span>{data.total} {data.total === 1 ? 'message' : 'messages'}</span>
    </div>

    {#if data.messages.length}
      <div class="card table-card">
        <table>
          <caption class="sr-only">Quarantined messages</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Subject</th>
              <th scope="col">Mailbox</th>
              <th scope="col">Reason</th>
              <th scope="col">Date</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each data.messages as message (message.id)}
              <tr>
                <td>
                  <strong>{message.from_name || message.from_address}</strong>
                  {#if message.from_name}<span class="secondary">{message.from_address}</span>{/if}
                </td>
                <td class="ellipsis-wide">{message.subject || '(no subject)'}</td>
                <td>{message.mailbox_display_name || message.mailbox_address}</td>
                <td><span class="badge badge-warning">{reasonLabel(message)}</span></td>
                <td class="nowrap"><time datetime={message.received_at}>{formatDateTime(message.received_at, data.locale, data.timeZone)}</time></td>
                <td>
                  <div class="button-group">
                    <form method="POST" action="?/release">
                      <input type="hidden" name="id" value={message.id} />
                      <button type="submit" class="btn btn-sm">Release</button>
                    </form>
                    <form method="POST" action="?/remove">
                      <input type="hidden" name="id" value={message.id} />
                      <button type="submit" class="btn btn-sm btn-ghost-danger">Delete</button>
                    </form>
                    <form method="POST" action="?/allowSender">
                      <input type="hidden" name="message_id" value={message.id} />
                      <button type="submit" class="btn btn-sm">Allow sender</button>
                    </form>
                    <form method="POST" action="?/blockSender">
                      <input type="hidden" name="message_id" value={message.id} />
                      <button type="submit" class="btn btn-sm btn-outline-danger">Block sender</button>
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
        <h3 class="empty-title">Quarantine is empty.</h3>
        <p class="empty-note">Mail filed as spam will show up here.</p>
      </div>
    {/if}

    {#if data.totalPages > 1}
      <nav class="pagination" aria-label="Quarantine pages">
        {#if data.page > 1}<a class="btn btn-sm" href={pageHref(data.page - 1)} rel="prev">Newer</a>{/if}
        <span>Page {data.page} of {data.totalPages}</span>
        {#if data.page < data.totalPages}<a class="btn btn-sm" href={pageHref(data.page + 1)} rel="next">Older</a>{/if}
      </nav>
    {/if}
  </section>

  <section aria-labelledby="rules-heading">
    <div class="section-row">
      <h2 id="rules-heading">Sender rules</h2>
      <span>{data.rules.length} {data.rules.length === 1 ? 'rule' : 'rules'}</span>
    </div>

    <form method="POST" action={newRuleAction === 'allow' ? '?/allowSender' : '?/blockSender'} class="card rule-form">
      <div class="field">
        <label for="rule-pattern">Address or domain</label>
        <input id="rule-pattern" type="text" name="pattern" maxlength="254" placeholder="someone@example.com or example.com" autocapitalize="off" spellcheck="false" required />
      </div>
      <div class="field">
        <label for="rule-action">Action</label>
        <select id="rule-action" bind:value={newRuleAction}>
          <option value="block">Block</option>
          <option value="allow">Allow</option>
        </select>
      </div>
      <div class="field">
        <label for="rule-note">Note <span>(optional)</span></label>
        <input id="rule-note" type="text" name="note" maxlength="500" placeholder="Why this rule exists" />
      </div>
      <button type="submit" class="btn btn-primary">Add rule</button>
    </form>

    {#if data.rules.length}
      <div class="card table-card">
        <table>
          <caption class="sr-only">Sender allow and block rules</caption>
          <thead>
            <tr>
              <th scope="col">Pattern</th>
              <th scope="col">Action</th>
              <th scope="col">Note</th>
              <th scope="col">Added</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {#each data.rules as rule (rule.id)}
              <tr>
                <td><code>{rule.pattern}</code></td>
                <td>
                  <span class="badge" class:badge-success={rule.action === 'allow'} class:badge-danger={rule.action === 'block'}>{rule.action}</span>
                </td>
                <td>{rule.note || '—'}</td>
                <td class="nowrap"><time datetime={rule.created_at}>{formatDateTime(rule.created_at, data.locale, data.timeZone)}</time></td>
                <td>
                  <form method="POST" action="?/removeRule" onsubmit={(event) => { if (!confirm(`Remove the rule for ${rule.pattern}?`)) event.preventDefault(); }}>
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" class="btn btn-sm btn-ghost-danger">Remove</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="card empty-state">
        <h3 class="empty-title">No sender rules yet.</h3>
        <p class="empty-note">Rules you add here apply to future mail.</p>
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
  .ellipsis-wide { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  code { font-size: 12px; }

  .button-group { display: flex; flex-wrap: wrap; gap: 6px; }

  .rule-form { display: grid; grid-template-columns: minmax(220px, 1fr) 120px minmax(180px, 1fr) auto; gap: 14px; align-items: end; padding: 16px; margin-bottom: 14px; }
  .rule-form .field span { color: var(--text-muted); font-weight: 400; }

  .empty-state { text-align: center; padding-block: 40px; }

  @media (max-width: 900px) {
    .rule-form { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 640px) {
    .page-header { align-items: stretch; flex-direction: column; }
    .section-row { align-items: flex-start; flex-direction: column; }
    .rule-form { grid-template-columns: 1fr; }
  }
</style>
