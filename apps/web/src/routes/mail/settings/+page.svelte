<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import SignatureEditor from '#lib/SignatureEditor.svelte';
  import { signaturePreviewDocument } from '#lib/signature-preview.js';
  import { COMPOSE_FONTS, COMPOSE_FONT_SIZES_PT, DEFAULT_COMPOSE_DEFAULTS, composeDefaultsStyle } from '@cmail/shared/compose-style';

  let { data, form: rawForm } = $props();
  // Each action returns its own message keys.
  const form = $derived(rawForm as { error?: string; success?: string; fontError?: string; fontSuccess?: string } | null);
  const personal = $derived(data.personalSignature);
  const organisation = $derived(data.organisationSignature);
  let previewHtml = $state(untrack(() => data.personalSignature?.html || ''));
  const savedDefaults = $derived(data.composeDefaults || DEFAULT_COMPOSE_DEFAULTS);
  let fontFamily = $state(untrack(() => (data.composeDefaults || DEFAULT_COMPOSE_DEFAULTS).fontFamily));
  let fontSizePt = $state(untrack(() => String((data.composeDefaults || DEFAULT_COMPOSE_DEFAULTS).fontSizePt)));
  const fontPreviewStyle = $derived(composeDefaultsStyle({ fontFamily, fontSizePt: Number(fontSizePt) }));
  const fontChanged = $derived(fontFamily !== savedDefaults.fontFamily || Number(fontSizePt) !== savedDefaults.fontSizePt);
</script>

<svelte:head><title>Font and signature · {data.appName || 'cmail'}</title></svelte:head>

<section class="settings-page nb-quiet" aria-labelledby="signature-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Mail settings</p>
      <h1 id="signature-heading">Font and signature</h1>
      <p>How your new messages, replies, and forwards start, and the sign-off cmail adds to them.</p>
    </div>
    <a href="/mail/compose" class="btn"><Icon name="compose" size={15} /> Preview in a message</a>
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  <section class="card font-card" aria-labelledby="font-heading">
    <div class="section-head">
      <div>
        <h2 id="font-heading">Default font</h2>
        <p>Rich-text messages start in this font and size, and recipients see it too. Outlook's default is Aptos, 12 pt.</p>
      </div>
    </div>
    {#if form?.fontError}<div class="notice notice-error" role="alert">{form.fontError}</div>{/if}
    {#if form?.fontSuccess}<div class="notice notice-success" role="status">{form.fontSuccess}</div>{/if}
    <form method="POST" action="?/saveComposeDefaults" class="font-form">
      <div class="font-fields">
        <div class="field">
          <label for="default-font-family">Font</label>
          <select id="default-font-family" name="font_family" bind:value={fontFamily}>
            {#each COMPOSE_FONTS as font (font.name)}
              <option value={font.name}>{font.name}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="default-font-size">Size</label>
          <select id="default-font-size" name="font_size_pt" bind:value={fontSizePt}>
            {#each COMPOSE_FONT_SIZES_PT as size (size)}
              <option value={String(size)}>{size} pt</option>
            {/each}
          </select>
        </div>
        <button type="submit" class="btn btn-primary" disabled={!fontChanged}>Save font</button>
      </div>
      <p class="font-preview" style={fontPreviewStyle} aria-label="Font preview">Thanks for the update. I'll send the final details shortly.</p>
    </form>
  </section>

  <section class="signature-order" aria-labelledby="signature-order-title">
    <div class="order-copy">
      <p class="eyebrow">Applied automatically</p>
      <h2 id="signature-order-title">One message, two clear layers</h2>
      <p>Your personal sign-off appears first. If your organisation uses a standard signature or legal notice, it goes directly underneath.</p>
    </div>
    <div class="order-flow" aria-label="Personal, then organisation signature">
      <div class="order-item personal-mark"><span>1</span><div><strong>Your signature</strong><small>Your details and sign-off</small></div></div>
      <span class="flow-line" aria-hidden="true"></span>
      <div class="order-item org-mark"><span>2</span><div><strong>Organisation signature</strong><small>Managed centrally and optional</small></div></div>
    </div>
  </section>

  <div class="settings-grid">
    <section class="card editor-card">
      <div class="section-head">
        <div>
          <h2>Personal signature</h2>
          <p>Use details you're comfortable including in every email.</p>
        </div>
        {#if personal?.locked}
          <span class="lock-badge"><Icon name="lock" size={12} /> Admin managed</span>
        {:else}
          <span class="status-badge"><Icon name="check" size={12} /> You control this</span>
        {/if}
      </div>

      {#if personal?.locked}
        <div class="managed-note">
          <Icon name="lock" size={16} />
          <div>
            <strong>This signature is locked by an administrator.</strong>
            <span>You can see what recipients receive, but only an administrator can change it.</span>
          </div>
        </div>
      {/if}

      <form method="POST" action="?/savePersonal">
        <SignatureEditor
          id="personal-signature"
          name="html"
          value={personal?.html || ''}
          disabled={personal?.locked || false}
          label="Signature content"
          description="Keep it short so replies stay easy to read."
          onchange={(html) => { previewHtml = html; }}
        />
        <div class="form-actions">
          {#if !personal?.locked}
            <span class="save-hint">Leaving this blank removes your personal signature.</span>
            <button type="submit" class="btn btn-primary">Save signature</button>
          {:else}
            <span class="save-hint">Ask a manager to change these details.</span>
          {/if}
        </div>
      </form>
    </section>

    <aside class="preview-card" aria-label="Recipient signature preview">
      <div class="preview-head">
        <div><span class="preview-dot"></span><strong>Recipient preview</strong></div>
        <span>Automatic</span>
      </div>
      <div class="mock-message">
        <p class="mock-copy">Thanks — I’ll send the final details shortly.</p>
        <div class="signature-stack">
          <div class="signature-layer">
            <span class="layer-label">Personal</span>
            {#if previewHtml}
              <iframe title="Personal signature preview" sandbox="" srcdoc={signaturePreviewDocument(previewHtml)}></iframe>
            {:else}
              <p class="empty-layer">No personal signature yet</p>
            {/if}
          </div>
          {#if organisation?.enabled && organisation?.html}
            <div class="signature-layer org-layer">
              <span class="layer-label">Organisation</span>
              <iframe title="Organisation signature preview" sandbox="" srcdoc={signaturePreviewDocument(organisation.html)}></iframe>
            </div>
          {/if}
        </div>
      </div>
      <div class="privacy-note">
        <Icon name="shieldCheck" size={16} />
        <p><strong>Consistent by design.</strong> Organisation content can't be changed by accident in the composer.</p>
      </div>
    </aside>
  </div>
</section>

<style>
  .settings-page { max-width: 1080px; margin: 0 auto; }
  .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
  .page-header h1 { margin: 2px 0 4px; font-size: var(--fs-title-2); font-weight: 600; }
  .page-header > div > p:last-child, .section-head p { margin: 0; color: var(--text-muted); font-size: 13px; }
  .notice { margin-bottom: 14px; }
  /* Sleek uplift (settings): hairline sections, typed-on-line fields, no boxes inside boxes. */
  /* No-borders pass: sections sit on the canvas, separated by headings and space. */
  .settings-page .card { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  .font-card { padding: 0; margin-bottom: 32px; }
  .font-card .section-head { margin-bottom: 8px; }
  .font-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 20px; }
  .font-fields .field { display: flex; flex-direction: column; gap: 0; margin: 0; min-width: 0; border-bottom: 1px solid var(--border); }
  .font-fields .field:focus-within { border-bottom-color: var(--primary); }
  .font-fields label { margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .font-fields select { min-width: 180px; max-width: 100%; min-height: 36px; padding: 0; border: 0; border-radius: 0; background-color: transparent; box-shadow: none; cursor: pointer; }
  .font-fields select:focus { border: 0; padding-bottom: 0; }
  .font-fields .field:nth-child(2) select { min-width: 110px; }
  /* Email paper: recipients read on white, so the preview stays white in dark mode. */
  .font-preview { margin: 14px 0 0; padding: 10px 0; border: 0; border-radius: var(--radius-md); background: #ffffff; color-scheme: light; overflow-wrap: anywhere; }
  @media (prefers-color-scheme: dark) { .font-preview { padding: 10px 14px; } }
  .eyebrow { margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  .signature-order {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(390px, .9fr);
    gap: 28px;
    align-items: center;
    padding: 0;
    margin-bottom: 32px;
  }
  .order-copy h2 { margin: 2px 0 4px; font-size: var(--fs-subtitle); font-weight: 600; }
  .order-copy > p:last-child { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; }
  .order-flow { display: flex; align-items: center; }
  .order-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .order-item > span { display: grid; place-items: center; width: 24px; height: 24px; flex: 0 0 auto; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 600; }
  .personal-mark > span { background: var(--primary); }
  .org-mark > span { background: #7c3aed; }
  .order-item strong, .order-item small { display: block; white-space: nowrap; }
  .order-item strong { font-size: 12.5px; font-weight: 600; }
  .order-item small { color: var(--text-muted); font-size: 11px; }
  .flow-line { height: 1px; min-width: 22px; flex: 1; margin: 0 9px; background: var(--border-strong); }
  .settings-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(290px, .65fr); gap: 20px; align-items: start; }
  .editor-card { padding: 0; }
  .section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
  .section-head h2 { margin: 0 0 3px; font-size: var(--fs-subtitle); font-weight: 600; }
  .status-badge, .lock-badge { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 2px 0; font-size: 12px; font-weight: 500; }
  .status-badge { color: var(--success); }
  .lock-badge { color: var(--warning); }
  .managed-note { display: flex; gap: 10px; margin: 0 0 15px; padding: 2px 0 2px 12px; border-left: 2px solid var(--warning); color: var(--warning); font-size: 13px; }
  .managed-note div { display: flex; flex-direction: column; gap: 2px; }
  .managed-note span { color: var(--text-muted); }
  .form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 16px; }
  .save-hint { margin-right: auto; color: var(--text-muted); font-size: 12px; }
  .preview-card { overflow: hidden; }
  .preview-head { display: flex; justify-content: space-between; align-items: center; padding: 0 0 6px; color: var(--text-muted); font-size: 12px; }
  .preview-head > div { display: flex; align-items: center; gap: 7px; color: var(--text); font-size: 13px; }
  .preview-head strong { font-weight: 600; }
  .preview-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
  .mock-message { min-height: 260px; padding: 10px 0 16px; }
  .mock-copy { margin: 0 0 20px; font-size: 13px; }
  .signature-stack { display: flex; flex-direction: column; gap: 16px; padding-top: 12px; border-top: 1px solid var(--divider, var(--border)); }
  .signature-layer { position: relative; padding: 0; }
  .org-layer { padding-left: 10px; border-left: 2px solid #7c3aed; }
  .layer-label { display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px; font-weight: 500; }
  .signature-layer iframe { display: block; width: 100%; min-height: 74px; border: 0; background: #fff; }
  .empty-layer { margin: 0; color: var(--text-faint); font-size: 13px; font-style: italic; }
  .privacy-note { display: flex; gap: 8px; padding: 4px 0 0; color: var(--text-muted); font-size: 12px; }
  .privacy-note :global(svg) { color: var(--success); flex: 0 0 auto; }
  .privacy-note p { margin: 0; }
  .privacy-note strong { color: var(--text); font-weight: 600; }

  @media (max-width: 920px) {
    .signature-order, .settings-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .page-header { align-items: flex-start; flex-direction: column; gap: 11px; }
    .signature-order { padding: 0; margin-bottom: 28px; }
    .order-flow { align-items: flex-start; flex-direction: column; gap: 6px; }
    .flow-line { width: 1px; height: 14px; min-width: 0; flex: none; margin: 0 0 0 12px; }
    .editor-card, .font-card { padding: 0; }
    .font-fields { align-items: stretch; flex-direction: column; gap: 12px; }
    .font-fields select { width: 100%; min-width: 0; min-height: 44px; }
    .section-head, .form-actions { align-items: flex-start; flex-direction: column; }
  }
</style>
