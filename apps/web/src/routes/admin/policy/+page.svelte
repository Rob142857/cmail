<script lang="ts">
  import { untrack } from 'svelte';
  import { formatDateOnly } from '$lib/dates';

  let { data, form } = $props();
  const initialForm = untrack(() => {
    const values = (form && 'values' in form ? form.values : undefined) as
      | { versionLabel?: string; bodyText?: string }
      | undefined;
    return {
      versionLabel: values?.versionLabel || '',
      bodyText: values?.bodyText || '',
      hasError: Boolean(form && 'error' in form && form.error),
    };
  });
  let versionLabel = $state(initialForm.versionLabel);
  let bodyText = $state(initialForm.bodyText);
  let previewing = $state(initialForm.hasError && Boolean(initialForm.bodyText));

  function confirmPublication(event: SubmitEvent): void {
    const people = data.affectedUsers === 1 ? '1 account' : `${data.affectedUsers} accounts`;
    if (!window.confirm(`Publish and enforce policy ${versionLabel}? ${people} will need to accept it before using mail.`)) {
      event.preventDefault();
    }
  }
</script>

<svelte:head><title>Usage policy · Management · {data.appName || 'cmail'}</title></svelte:head>

<section class="policy-page" aria-labelledby="policy-heading">
  <header class="page-heading">
    <p class="eyebrow">Governance</p>
    <h1 id="policy-heading">Usage policy</h1>
    <p>Publish policy versions and track acceptance. New versions take effect immediately.</p>
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  {#if data.policies.length}
    <section class="current-card card" aria-labelledby="current-policy-heading">
      <div>
        <span class="badge badge-success">Current</span>
        <h2 id="current-policy-heading">Version {data.policies[0].version_label}</h2>
        <p>Published {formatDateOnly(data.policies[0].published_at, data.locale, data.timeZone)}</p>
      </div>
      <div class="coverage">
        <strong>{data.policies[0].signature_count}</strong>
        <span>acknowledgements</span>
      </div>
    </section>
  {/if}

  <section class="publish-card card" aria-labelledby="publish-heading">
    <div class="section-heading">
      <div>
        <h2 id="publish-heading">Publish a new version</h2>
        <p>Review the text before publishing.</p>
      </div>
      <span class="impact">Affects {data.affectedUsers} active or pending {data.affectedUsers === 1 ? 'account' : 'accounts'}</span>
    </div>

    <form method="POST" action="?/publish" onsubmit={confirmPublication}>
      {#if !previewing}
        <div class="field">
          <label for="version-label">Version label</label>
          <input id="version-label" type="text" bind:value={versionLabel} required maxlength="100" placeholder="For example, 2026.1" />
        </div>
        <div class="field">
          <label for="policy-body">Policy text</label>
          <textarea id="policy-body" bind:value={bodyText} required rows="14" maxlength="100000" placeholder="Plain text; blank lines are kept."></textarea>
          <small>{bodyText.length.toLocaleString(data.locale || 'en')} of 100,000 characters</small>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" disabled={!versionLabel.trim() || !bodyText.trim()} onclick={() => previewing = true}>Preview policy</button>
        </div>
      {:else}
        <input type="hidden" name="version_label" value={versionLabel} />
        <textarea class="hidden-value" name="body_text" value={bodyText} aria-hidden="true" tabindex="-1"></textarea>
        <div class="preview-heading">
          <div><span class="badge badge-warning">Preview</span><h3>Version {versionLabel}</h3></div>
          <button type="button" class="btn" onclick={() => previewing = false}>Back to editing</button>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="policy-preview" role="region" aria-label="Policy preview" tabindex="0">{bodyText}</div>
        <div class="publication-warning">
          <strong>This takes effect immediately.</strong>
          <span>Every active or pending user must accept it before using mail or management.</span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Publish and enforce</button>
        </div>
      {/if}
    </form>
  </section>

  <section aria-labelledby="history-heading">
    <div class="history-heading">
      <div><h2 id="history-heading">Version history</h2><p>The 50 most recent versions. Once published, a version can't be changed.</p></div>
      <span>{data.policies.length} {data.policies.length === 1 ? 'version' : 'versions'}</span>
    </div>

    {#if data.policies.length}
      <div class="history-list">
        {#each data.policies as policy, index}
          <details class="card">
            <summary>
              <span><strong>Version {policy.version_label}</strong><small>{formatDateOnly(policy.published_at, data.locale, data.timeZone)}</small></span>
              <span class="summary-meta">{policy.signature_count} accepted{index === 0 ? ' · Current' : ''}</span>
            </summary>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="policy-text" role="region" aria-label={`Policy version ${policy.version_label}`} tabindex="0">{policy.body_text}</div>
          </details>
        {/each}
      </div>
    {:else}
      <div class="card empty-state"><h3>No policy versions yet</h3><p>Publish your first version above.</p></div>
    {/if}
  </section>
</section>

<style>
  .policy-page { display: grid; gap: 22px; max-width: 980px; }
  .page-heading h1 { margin: 2px 0 7px; font-size: clamp(25px, 3vw, 34px); }
  .page-heading > p:last-child { max-width: 760px; color: var(--text-muted); }
  .eyebrow { margin: 0; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .notice { padding: 11px 13px; border: 1px solid var(--border); border-radius: var(--radius); }
  .notice-error { color: var(--danger); background: var(--danger-soft); }
  .notice-success { color: var(--success); background: var(--success-soft); }
  .current-card { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
  .current-card h2 { margin: 7px 0 2px; font-size: 18px; }
  .current-card p, .section-heading p, .history-heading p { color: var(--text-muted); font-size: 12px; }
  .coverage { display: flex; flex-direction: column; align-items: end; }
  .coverage strong { font-size: 26px; }
  .coverage span { color: var(--text-muted); font-size: 11px; }
  .publish-card { padding: 20px; }
  .section-heading, .history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 16px; }
  .section-heading h2, .history-heading h2 { margin: 0 0 3px; font-size: 19px; }
  .impact { padding: 4px 9px; border-radius: 999px; background: var(--warning-soft); color: var(--warning); font-size: 11px; font-weight: 650; white-space: nowrap; }
  .field { display: grid; gap: 5px; margin-bottom: 14px; }
  .field label { font-size: 13px; font-weight: 650; }
  .field small { justify-self: end; color: var(--text-muted); font-size: 11px; }
  .field textarea { min-height: 260px; resize: vertical; line-height: 1.55; }
  .form-actions { display: flex; justify-content: flex-end; padding-top: 13px; border-top: 1px solid var(--border); }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .preview-heading > div { display: flex; align-items: center; gap: 9px; }
  .preview-heading h3 { margin: 0; font-size: 16px; }
  .policy-preview, .policy-text { max-height: 52vh; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
  .policy-preview { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-subtle); }
  .publication-warning { display: flex; flex-direction: column; gap: 2px; margin: 13px 0; padding: 12px; border-left: 3px solid var(--warning); background: var(--warning-soft); color: var(--warning); font-size: 12px; }
  .hidden-value { display: none; }
  .history-heading { align-items: end; margin-bottom: 10px; }
  .history-heading > span { color: var(--text-muted); font-size: 12px; }
  .history-list { display: grid; gap: 9px; }
  .history-list details { padding: 0; overflow: hidden; }
  .history-list summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; cursor: pointer; }
  .history-list summary > span:first-child { display: flex; flex-direction: column; }
  .history-list summary small, .summary-meta { color: var(--text-muted); font-size: 11px; }
  .policy-text { padding: 16px; border-top: 1px solid var(--border); background: var(--bg-subtle); font-size: 13px; }
  .empty-state { padding: 36px 20px; text-align: center; }
  .empty-state p { margin-top: 5px; color: var(--text-muted); }
  @media (max-width: 620px) {
    .section-heading, .history-heading, .current-card { align-items: flex-start; flex-direction: column; }
    .coverage { align-items: flex-start; }
    .preview-heading { align-items: stretch; flex-direction: column; }
    .history-list summary { align-items: flex-start; flex-direction: column; }
  }
</style>
