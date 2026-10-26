<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import Icon from '#lib/ui/Icon.svelte';
  import {
    MAX_RULE_NAME_CHARS,
    describeActions,
    describeConditions,
    parseRuleDefinition,
    ruleNeedsBody,
    ruleNeedsHeaders,
  } from '@cmail/shared/inbox-rules';
  import {
    ACTION_OPTIONS,
    CONDITION_OPTIONS,
    EXCEPTION_OPTIONS,
    FOLDER_CHOICES,
    IMPORTANCE_CHOICES,
    POSITION_CHOICES,
    actionOption,
    conditionOption,
    definitionFromRows,
    definitionRows,
    newRow,
    startingRows,
    type EditorRow,
  } from '#lib/inbox-rule-editor.js';

  let { data, form: rawForm } = $props();
  const serverError = $derived((rawForm as { error?: string } | null)?.error || '');

  const initial = untrack(() => data.rule
    ? definitionRows(data.rule.definition)
    : { ...startingRows(data.prefill || {}), exceptions: [] as EditorRow[] });
  let name = $state(untrack(() => data.rule?.name || (data.prefill?.from ? `From ${data.prefill.from}` : '')));
  let conditions = $state<EditorRow[]>(initial.conditions);
  let exceptions = $state<EditorRow[]>(initial.exceptions);
  let actions = $state<EditorRow[]>(initial.actions);
  let stopProcessing = $state(untrack(() => data.rule ? data.rule.stopProcessing : true));
  let enabled = $state(untrack(() => data.rule ? data.rule.enabled : true));
  let runNow = $state(false);
  let saving = $state(false);
  let clientError = $state('');

  const definition = $derived(definitionFromRows(conditions, exceptions, actions));
  const checked = $derived(parseRuleDefinition(definition));
  const canRunNow = $derived(checked.ok && !ruleNeedsBody(checked.value) && !ruleNeedsHeaders(checked.value));
  const listHref = $derived(`/mail/rules?mailbox=${encodeURIComponent(data.mailbox.id)}`);
  const mailboxName = $derived(data.mailbox.display_name || data.mailbox.address);
  const error = $derived(clientError || serverError);

  $effect(() => {
    if (!canRunNow) runNow = false;
  });

  function add(rows: EditorRow[], kind: string) {
    if (kind && !rows.some((row) => row.kind === kind)) rows.push(newRow(kind));
  }

  function remove(rows: EditorRow[], row: EditorRow) {
    const index = rows.indexOf(row);
    if (index >= 0) rows.splice(index, 1);
  }

  /** A new kind starts with that kind's default value rather than the old one's. */
  function changeKind(rows: EditorRow[], row: EditorRow, kind: string) {
    const index = rows.indexOf(row);
    if (index >= 0) rows[index] = newRow(kind);
  }

  function addFromSelect(event: Event & { currentTarget: HTMLSelectElement }, rows: EditorRow[]) {
    add(rows, event.currentTarget.value);
    event.currentTarget.value = '';
  }
</script>

<svelte:head><title>{data.rule ? 'Edit rule' : 'New rule'} · {data.appName || 'cmail'}</title></svelte:head>

{#snippet conditionList(rows: EditorRow[], options: typeof CONDITION_OPTIONS, group: string)}
  {#if rows.length}
    <ul class="rows">
      {#each rows as row, index (row.id)}
        {@const option = conditionOption(row.kind)}
        <li class="row">
          <select
            aria-label="{group} {index + 1}"
            value={row.kind}
            onchange={(event) => changeKind(rows, row, event.currentTarget.value)}
          >
            {#each options as choice (choice.kind)}
              <option value={choice.kind} disabled={choice.kind !== row.kind && rows.some((other) => other.kind === choice.kind)}>{choice.label}</option>
            {/each}
          </select>
          <div class="value">
            {#if option?.input === 'addresses' || option?.input === 'words'}
              <input
                type="text"
                bind:value={row.text}
                aria-label={option.label}
                placeholder={option.placeholder}
                autocomplete="off"
                spellcheck={option.input === 'words'}
              />
              <span class="field-hint">{option.input === 'addresses' ? 'Addresses or domains, separated by semicolons' : 'Words or phrases, separated by semicolons'}</span>
            {:else if option?.input === 'size'}
              <input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={row.text} aria-label={option.label} placeholder={option.placeholder} />
            {:else if option?.input === 'position'}
              <select bind:value={row.choice} aria-label="Where my address is">
                {#each POSITION_CHOICES as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
              </select>
            {:else if option?.input === 'importance'}
              <select bind:value={row.choice} aria-label={option.label}>
                {#each IMPORTANCE_CHOICES as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
              </select>
            {/if}
          </div>
          <button type="button" class="btn btn-icon btn-sm remove" aria-label="Remove {option?.label || 'condition'}" onclick={() => remove(rows, row)}><Icon name="close" size={14} /></button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<section class="editor-page" aria-labelledby="editor-heading">
  <header class="page-header">
    <a href={listHref} class="back"><Icon name="arrowLeft" size={14} /> Rules</a>
    <h1 id="editor-heading">{data.rule ? 'Edit rule' : 'New rule'}</h1>
    <p>For mail arriving in {mailboxName} ({data.mailbox.address}).</p>
  </header>

  {#if error}<div class="notice notice-error" role="alert">{error}</div>{/if}

  <form
    method="POST"
    action="?/save"
    class="card editor"
    use:enhance={({ cancel }) => {
      if (!checked.ok) {
        clientError = checked.error;
        cancel();
        return;
      }
      clientError = '';
      saving = true;
      return async ({ update }) => {
        saving = false;
        await update({ reset: false });
      };
    }}
  >
    <input type="hidden" name="mailbox_id" value={data.mailbox.id} />
    {#if data.rule}<input type="hidden" name="rule_id" value={data.rule.id} />{/if}
    <input type="hidden" name="definition" value={JSON.stringify(definition)} />

    <div class="field name-field">
      <label for="rule-name">Name</label>
      <input id="rule-name" name="name" type="text" bind:value={name} maxlength={MAX_RULE_NAME_CHARS} required placeholder="Newsletters to Archive" />
    </div>

    <fieldset>
      <legend>When a message arrives, and it matches all of these</legend>
      {@render conditionList(conditions, CONDITION_OPTIONS, 'Condition')}
      <select class="add" aria-label="Add a condition" onchange={(event) => addFromSelect(event, conditions)}>
        <option value="">Add a condition…</option>
        {#each CONDITION_OPTIONS as option (option.kind)}
          <option value={option.kind} disabled={conditions.some((row) => row.kind === option.kind)}>{option.label}</option>
        {/each}
      </select>
    </fieldset>

    <fieldset>
      <legend>Do all of the following</legend>
      {#if actions.length}
        <ul class="rows">
          {#each actions as row, index (row.id)}
            {@const option = actionOption(row.kind)}
            <li class="row">
              <select aria-label="Action {index + 1}" value={row.kind} onchange={(event) => changeKind(actions, row, event.currentTarget.value)}>
                {#each ACTION_OPTIONS as choice (choice.kind)}
                  <option value={choice.kind} disabled={choice.kind !== row.kind && actions.some((other) => other.kind === choice.kind)}>{choice.label}</option>
                {/each}
              </select>
              <div class="value">
                {#if option?.input === 'folder'}
                  <select bind:value={row.choice} aria-label="Folder">
                    {#each FOLDER_CHOICES as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                {:else if option?.input === 'importance'}
                  <select bind:value={row.choice} aria-label="Importance">
                    {#each IMPORTANCE_CHOICES as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                {/if}
              </div>
              <button type="button" class="btn btn-icon btn-sm remove" aria-label="Remove {option?.label || 'action'}" onclick={() => remove(actions, row)}><Icon name="close" size={14} /></button>
            </li>
          {/each}
        </ul>
      {/if}
      <select class="add" aria-label="Add an action" onchange={(event) => addFromSelect(event, actions)}>
        <option value="">Add an action…</option>
        {#each ACTION_OPTIONS as option (option.kind)}
          <option value={option.kind} disabled={actions.some((row) => row.kind === option.kind)}>{option.label}</option>
        {/each}
      </select>
    </fieldset>

    <fieldset>
      <legend>Except if it matches any of these <span class="optional">(optional)</span></legend>
      {@render conditionList(exceptions, EXCEPTION_OPTIONS, 'Exception')}
      <select class="add" aria-label="Add an exception" onchange={(event) => addFromSelect(event, exceptions)}>
        <option value="">Add an exception…</option>
        {#each EXCEPTION_OPTIONS as option (option.kind)}
          <option value={option.kind} disabled={exceptions.some((row) => row.kind === option.kind)}>{option.label}</option>
        {/each}
      </select>
    </fieldset>

    <div class="switches">
      <label class="switch">
        <input type="checkbox" name="stop_processing" bind:checked={stopProcessing} />
        <span><strong>Stop processing more rules</strong><small>Later rules are skipped for a message this rule acts on.</small></span>
      </label>
      <label class="switch">
        <input type="checkbox" name="enabled" bind:checked={enabled} />
        <span><strong>Turn on this rule</strong><small>A rule that is off is kept but never runs.</small></span>
      </label>
      <label class="switch" class:disabled={!canRunNow}>
        <input type="checkbox" name="run_now" bind:checked={runNow} disabled={!canRunNow} />
        <span>
          <strong>Run it now on the Inbox</strong>
          <small>{canRunNow
            ? `Also applies it to the ${data.runNowLimit.toLocaleString()} newest messages already in the Inbox.`
            : 'Rules that look at the message body or header only apply to new mail.'}</small>
        </span>
      </label>
    </div>

    <aside class="preview" aria-label="Rule summary">
      <p class="preview-title">This rule</p>
      {#if checked.ok}
        <dl>
          <div><dt>If</dt><dd>{#each checked.value.appliesToAll ? ['All messages'] : describeConditions(checked.value.conditions) as line}<span>{line}</span>{/each}</dd></div>
          {#if Object.keys(checked.value.exceptions).length}
            <div><dt>Except if</dt><dd>{#each describeConditions(checked.value.exceptions) as line}<span>{line}</span>{/each}</dd></div>
          {/if}
          <div><dt>Then</dt><dd>{#each describeActions(checked.value.actions) as line}<span>{line}</span>{/each}{#if stopProcessing}<span class="muted">Stop processing more rules</span>{/if}</dd></div>
        </dl>
      {:else}
        <p class="muted">{checked.error}</p>
      {/if}
    </aside>

    <div class="form-actions">
      <a href={listHref} class="btn">Cancel</a>
      <button type="submit" class="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button>
    </div>
  </form>
</section>

<style>
  /* Sleek uplift (settings): typed-on-line fields, hairline sections, no boxed panels. */
  .editor-page { display: grid; gap: 14px; max-width: 880px; margin: 0 auto; }
  .page-header h1 { margin: 6px 0 4px; font-size: var(--fs-title-2); font-weight: 600; }
  .page-header p { margin: 0; color: var(--text-muted); font-size: 13px; overflow-wrap: anywhere; }
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
  .editor { display: grid; gap: 24px; padding: 16px 20px 20px; box-shadow: none; border-color: var(--divider, var(--border)); }
  .name-field { display: flex; flex-direction: row; align-items: center; gap: 10px; min-height: 44px; border-bottom: 1px solid var(--border); }
  .name-field:focus-within { border-bottom-color: var(--primary); }
  .editor .name-field > label { flex: 0 0 auto; text-align: left; margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .name-field input { flex: 1 1 auto; min-width: 0; max-width: none; min-height: 40px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; font-size: 15px; font-weight: 600; }
  .name-field input:focus { border: 0; box-shadow: none; }
  fieldset { display: grid; gap: 10px; margin: 0; padding: 0; border: 0; min-width: 0; }
  legend { float: left; width: 100%; margin: 0 0 10px; padding: 0; font-weight: 600; font-size: 14px; }
  legend + * { clear: left; }
  .optional { color: var(--text-muted); font-weight: 400; }
  .rows { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
  .row { display: grid; grid-template-columns: minmax(180px, 230px) minmax(0, 1fr) auto; gap: 12px; align-items: start; border-bottom: 1px solid var(--border); }
  .row:focus-within { border-bottom-color: var(--primary); }
  .row > select, .value input, .value select { width: 100%; min-width: 0; min-height: 40px; padding: 0; border: 0; border-radius: 0; background-color: transparent; box-shadow: none; }
  .row > select, .value select { cursor: pointer; }
  .value { display: grid; gap: 0; min-width: 0; }
  .value .field-hint { margin: -4px 0 6px; }
  .row > select:focus, .value input:focus, .value select:focus, .add:focus { border: 0; padding-bottom: 0; }
  .remove { margin-top: 0; border-color: transparent; background: transparent; box-shadow: none; }
  .add { justify-self: start; max-width: 100%; min-height: 36px; padding: 0; border: 0; border-radius: 0; background-color: transparent; box-shadow: none; color: var(--primary-text); cursor: pointer; }
  .switches { display: grid; gap: 12px; }
  .switch { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  .switch input { margin-top: 3px; flex: 0 0 auto; }
  .switch span { display: grid; gap: 1px; }
  .switch small { color: var(--text-muted); font-size: 12px; }
  .switch.disabled { cursor: default; opacity: .7; }
  .preview { padding: 12px 0 0; border-top: 1px solid var(--divider, var(--border)); font-size: 13px; }
  .preview-title { margin: 0 0 8px; color: var(--text-muted); font-size: 13px; font-weight: 500; }
  .preview dl { display: grid; gap: 6px; margin: 0; }
  .preview dl div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; }
  .preview dt { color: var(--text-muted); font-weight: 500; }
  .preview dd { display: flex; flex-direction: column; gap: 2px; margin: 0; overflow-wrap: anywhere; }
  .muted { margin: 0; color: var(--text-muted); }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; }

  @media (max-width: 600px) {
    .editor { padding: 14px; }
    .row { grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; }
    .row > select { grid-column: 1; }
    .row .value { grid-column: 1; }
    .row .remove { grid-column: 2; grid-row: 1; }
    .preview dl div { grid-template-columns: 1fr; gap: 2px; }
  }
</style>
