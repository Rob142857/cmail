<script lang="ts">
  import { page } from '$app/state';
  import Icon from '#lib/ui/Icon.svelte';

  let { data, form: rawForm } = $props();
  const form = $derived(rawForm as { error?: string; success?: string } | null);

  const mailbox = $derived(data.mailbox);
  const editorHref = $derived(mailbox ? `/mail/rules/edit?mailbox=${encodeURIComponent(mailbox.id)}` : '/mail/rules/edit');
  const atLimit = $derived(data.rules.length >= data.maxRules);
  const savedNotice = $derived.by(() => {
    const saved = page.url.searchParams.get('saved');
    if (saved !== 'created' && saved !== 'updated') return '';
    const ran = page.url.searchParams.get('ran');
    const count = ran !== null && /^\d+$/.test(ran) ? Number(ran) : null;
    const base = saved === 'created' ? 'Rule created.' : 'Rule saved.';
    if (count === null) return base;
    return `${base} It applied to ${count} ${count === 1 ? 'message' : 'messages'} already in the Inbox.`;
  });

  function mailboxLabel(value: { display_name: string; address: string; type: string }): string {
    return `${value.type === 'shared' ? 'Shared — ' : ''}${value.display_name || value.address}`;
  }

  function confirmDelete(event: SubmitEvent, name: string) {
    if (!confirm(`Delete the rule "${name}"? Mail it already moved stays where it is.`)) event.preventDefault();
  }
</script>

<svelte:head><title>Rules · {data.appName || 'cmail'}</title></svelte:head>

<section class="rules-page nb-quiet" aria-labelledby="rules-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Mail settings</p>
      <h1 id="rules-heading">Rules</h1>
      <p>Rules act on new mail as it arrives in the Inbox: they can file it, mark it read, star it or set its importance. They run in the order shown, after your organisation's junk filtering.</p>
    </div>
    {#if mailbox}
      {#if atLimit}
        <span class="limit-note">{data.maxRules} rules is the most a mailbox can have.</span>
      {:else}
        <a href={editorHref} class="btn btn-primary"><Icon name="plus" size={15} /> New rule</a>
      {/if}
    {/if}
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{:else if savedNotice}<div class="notice notice-success" role="status">{savedNotice}</div>{/if}

  {#if !mailbox}
    <div class="card empty-state">
      <span class="empty-icon"><Icon name="filter" size={28} /></span>
      <p class="empty-title">No mailbox to set rules for</p>
      <p class="empty-note">Rules can be set for mailboxes you have full access to. Ask a manager if you need full access to a shared mailbox.</p>
    </div>
  {:else}
    {#if data.mailboxes.length > 1}
      <form method="GET" class="mailbox-picker">
        <label for="rules-mailbox">Mailbox</label>
        <select id="rules-mailbox" name="mailbox" value={mailbox.id} onchange={(event) => event.currentTarget.form?.requestSubmit()}>
          {#each data.mailboxes as option (option.id)}
            <option value={option.id}>{mailboxLabel(option)}</option>
          {/each}
        </select>
        <noscript><button type="submit" class="btn btn-sm">Show</button></noscript>
      </form>
    {/if}

    {#if data.rules.length === 0}
      <div class="card empty-state">
        <span class="empty-icon"><Icon name="filter" size={28} /></span>
        <p class="empty-title">No rules for {mailbox.display_name || mailbox.address}</p>
        <p class="empty-note">For example, move newsletters to Archive, or star everything from your manager. You can also start a rule from a message: open it and choose Create rule.</p>
        <a href={editorHref} class="btn btn-primary"><Icon name="plus" size={15} /> New rule</a>
      </div>
    {:else}
      <ol class="rule-list" aria-label="Rules for {mailbox.display_name || mailbox.address}, in the order they run">
        {#each data.rules as rule, index (rule.id)}
          <li class="card rule" class:off={!rule.enabled}>
            <div class="rule-head">
              <span class="order" aria-hidden="true">{index + 1}</span>
              <h2>{rule.name}</h2>
              <span class="badge" class:badge-success={rule.enabled && rule.valid} class:badge-danger={!rule.valid}>
                {!rule.valid ? 'Needs attention' : rule.enabled ? 'On' : 'Off'}
              </span>
            </div>

            {#if rule.valid}
              <dl class="summary">
                <div><dt>If</dt><dd>{#each rule.conditions as line}<span>{line}</span>{/each}</dd></div>
                {#if rule.exceptions.length}
                  <div><dt>Except if</dt><dd>{#each rule.exceptions as line}<span>{line}</span>{/each}</dd></div>
                {/if}
                <div><dt>Then</dt><dd>{#each rule.actions as line}<span>{line}</span>{/each}{#if rule.stopProcessing}<span class="stop">Stop processing more rules</span>{/if}</dd></div>
              </dl>
            {:else}
              <p class="invalid">This rule can no longer be read, so it is skipped. Delete it and create it again.</p>
            {/if}

            <div class="rule-actions">
              {#if rule.valid}
                <a class="btn btn-sm" href={`${editorHref}&rule=${encodeURIComponent(rule.id)}`}>Edit</a>
                <form method="POST" action="?/toggle">
                  <input type="hidden" name="mailbox_id" value={mailbox.id} />
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <button type="submit" class="btn btn-sm" aria-label="{rule.enabled ? 'Turn off' : 'Turn on'} {rule.name}">{rule.enabled ? 'Turn off' : 'Turn on'}</button>
                </form>
                <form method="POST" action="?/run">
                  <input type="hidden" name="mailbox_id" value={mailbox.id} />
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <button
                    type="submit"
                    class="btn btn-sm"
                    disabled={!rule.canRunNow}
                    aria-label="Run now: {rule.name}"
                    title={rule.canRunNow
                      ? `Apply this rule to the ${data.runNowLimit.toLocaleString()} newest messages in the Inbox`
                      : 'Rules that look at the message body or header only apply to new mail'}
                  >Run now</button>
                </form>
              {/if}
              <span class="reorder">
                <form method="POST" action="?/move">
                  <input type="hidden" name="mailbox_id" value={mailbox.id} />
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" class="btn btn-sm btn-icon" disabled={index === 0} aria-label="Move {rule.name} up"><Icon name="chevronDown" size={16} class="up" /></button>
                </form>
                <form method="POST" action="?/move">
                  <input type="hidden" name="mailbox_id" value={mailbox.id} />
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button type="submit" class="btn btn-sm btn-icon" disabled={index === data.rules.length - 1} aria-label="Move {rule.name} down"><Icon name="chevronDown" size={16} /></button>
                </form>
              </span>
              <form method="POST" action="?/delete" onsubmit={(event) => confirmDelete(event, rule.name)}>
                <input type="hidden" name="mailbox_id" value={mailbox.id} />
                <input type="hidden" name="rule_id" value={rule.id} />
                <button type="submit" class="btn btn-sm btn-ghost-danger" aria-label="Delete {rule.name}">Delete</button>
              </form>
            </div>
          </li>
        {/each}
      </ol>
    {/if}

    <p class="footnote">
      Rules never forward or redirect mail automatically: automatic forwarding is a common way for mail to leak outside an organisation. Rules don't run on mail your organisation filed to Junk.
    </p>
  {/if}
</section>

<style>
  /* Sleek uplift (settings): one hairline list, no card per rule. */
  .rules-page { display: grid; gap: 14px; max-width: 880px; margin: 0 auto; }
  .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
  .page-header h1 { margin: 2px 0 4px; font-size: var(--fs-title-2); font-weight: 600; }
  .page-header p:last-child { margin: 0; max-width: 640px; color: var(--text-muted); font-size: 13px; }
  .eyebrow { margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .page-header .btn { flex: 0 0 auto; }
  .limit-note { flex: 0 0 auto; color: var(--text-muted); font-size: 12px; }
  .mailbox-picker { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid var(--border-input); }
  .mailbox-picker:focus-within { border-bottom-color: var(--primary); }
  .mailbox-picker label { margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .mailbox-picker select { min-width: 0; max-width: 100%; min-height: 40px; padding: 0; border: 0; border-radius: 0; background-color: transparent; box-shadow: none; cursor: pointer; }
  .mailbox-picker select:focus { border: 0; padding-bottom: 0; }
  .empty-state { box-shadow: none; }
  .empty-state .btn { margin-top: 6px; }
  .rule-list { margin: 0; padding: 0; list-style: none; }
  .rule { padding: 14px 4px; border: 0; border-bottom: 1px solid var(--divider, var(--border)); border-radius: 0; background: transparent; box-shadow: none; }
  .rule.off { background: transparent; }
  .rule.off .rule-head h2, .rule.off .summary { color: var(--text-muted); }
  .rule-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .order { display: grid; place-items: center; width: 22px; height: 22px; flex: 0 0 auto; border-radius: 50%; background: var(--primary-soft); color: var(--primary-text); font-size: 12px; font-weight: 600; }
  .rule-head h2 { margin: 0; min-width: 0; font-size: var(--fs-subtitle); font-weight: 600; overflow-wrap: anywhere; }
  .rule-head .badge { margin-left: auto; flex: 0 0 auto; }
  .summary { display: grid; gap: 4px; margin: 8px 0 0 32px; font-size: 13px; }
  .summary div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; }
  .summary dt { color: var(--text-muted); font-weight: 500; }
  .summary dd { display: flex; flex-direction: column; gap: 2px; margin: 0; overflow-wrap: anywhere; }
  .stop { color: var(--text-muted); font-size: 12px; }
  .invalid { margin: 8px 0 0 32px; color: var(--danger-text); font-size: 13px; }
  .rule-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 0 32px; }
  .rule-actions form { display: inline-flex; }
  .reorder { display: inline-flex; gap: 4px; margin-left: auto; }
  .reorder :global(.up) { transform: rotate(180deg); }
  .footnote { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; }

  @media (max-width: 600px) {
    .page-header { flex-direction: column; align-items: flex-start; gap: 10px; }
    .summary, .invalid, .rule-actions { margin-left: 0; }
    .summary div { grid-template-columns: 1fr; gap: 2px; }
    .reorder { margin-left: 0; }
  }
</style>
