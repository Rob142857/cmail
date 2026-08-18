<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import SignatureEditor from '$lib/SignatureEditor.svelte';

  let { data, form } = $props();
  const personal = $derived(data.personalSignature);
  const organisation = $derived(data.organisationSignature);
  let previewHtml = $state(untrack(() => data.personalSignature?.html || ''));
</script>

<svelte:head><title>Email signature · {data.appName || 'cmail'}</title></svelte:head>

<section class="settings-page" aria-labelledby="signature-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Mail settings</p>
      <h1 id="signature-heading">Email signature</h1>
      <p>The sign-off cmail adds to new messages, replies, and forwards.</p>
    </div>
    <a href="/mail/compose" class="btn"><Icon name="compose" size={15} /> Preview in a message</a>
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

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
              <iframe title="Personal signature preview" sandbox="" srcdoc={previewHtml}></iframe>
            {:else}
              <p class="empty-layer">No personal signature yet</p>
            {/if}
          </div>
          {#if organisation?.enabled && organisation?.html}
            <div class="signature-layer org-layer">
              <span class="layer-label">Organisation</span>
              <iframe title="Organisation signature preview" sandbox="" srcdoc={organisation.html}></iframe>
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
  .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
  .page-header h1 { margin: 3px 0 5px; font-size: var(--fs-title-2); }
  .page-header > div > p:last-child, .section-head p { margin: 0; color: var(--text-muted); font-size: 13px; }
  .notice { margin-bottom: 14px; }
  .eyebrow { margin: 0; color: var(--primary-text); font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .signature-order {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(390px, .9fr);
    gap: 28px;
    align-items: center;
    padding: 18px 20px;
    margin-bottom: 16px;
    border: 1px solid var(--primary-border);
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, var(--primary-soft), var(--bg-surface) 68%);
  }
  .order-copy h2 { margin: 3px 0 5px; font-size: var(--fs-subtitle); }
  .order-copy > p:last-child { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
  .order-flow { display: flex; align-items: center; }
  .order-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .order-item > span { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700; }
  .personal-mark > span { background: var(--primary); }
  .org-mark > span { background: #7c3aed; }
  .order-item strong, .order-item small { display: block; white-space: nowrap; }
  .order-item strong { font-size: 11.5px; }
  .order-item small { color: var(--text-muted); font-size: 9.5px; }
  .flow-line { height: 1px; min-width: 22px; flex: 1; margin: 0 9px; background: var(--border-strong); }
  .settings-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(290px, .65fr); gap: 16px; align-items: start; }
  .editor-card { padding: 20px; }
  .section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
  .section-head h2 { margin: 0 0 4px; font-size: var(--fs-subtitle); }
  .status-badge, .lock-badge { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 4px 8px; border-radius: var(--radius-pill); font-size: 10.5px; font-weight: 650; }
  .status-badge { background: var(--success-soft); color: var(--success); }
  .lock-badge { background: var(--warning-soft); color: var(--warning); }
  .managed-note { display: flex; gap: 10px; margin: 0 0 15px; padding: 10px 12px; border-left: 3px solid var(--warning); background: var(--warning-soft); color: var(--warning); font-size: 12px; }
  .managed-note div { display: flex; flex-direction: column; gap: 2px; }
  .managed-note span { color: var(--text-muted); }
  .form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 17px; }
  .save-hint { margin-right: auto; color: var(--text-muted); font-size: 10.5px; }
  .preview-card { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); box-shadow: var(--shadow-2); }
  .preview-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 13px; border-bottom: 1px solid var(--border); background: var(--bg-subtle); color: var(--text-muted); font-size: 10.5px; }
  .preview-head > div { display: flex; align-items: center; gap: 7px; color: var(--text); font-size: 11.5px; }
  .preview-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px var(--success-soft); }
  .mock-message { min-height: 280px; padding: 20px 17px; }
  .mock-copy { margin: 0 0 25px; font-size: 12px; }
  .signature-stack { display: flex; flex-direction: column; gap: 14px; padding-top: 13px; border-top: 1px solid var(--border); }
  .signature-layer { position: relative; padding: 11px; border: 1px solid var(--border); border-radius: var(--radius-md); }
  .org-layer { border-left: 3px solid #7c3aed; background: color-mix(in srgb, #7c3aed 4%, var(--bg-surface)); }
  .layer-label { position: absolute; top: -8px; left: 8px; padding: 1px 6px; background: var(--bg-surface); color: var(--text-faint); font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .signature-layer iframe { display: block; width: 100%; min-height: 74px; border: 0; background: #fff; }
  .empty-layer { margin: 0; color: var(--text-faint); font-size: 11.5px; font-style: italic; }
  .privacy-note { display: flex; gap: 8px; padding: 11px 13px; border-top: 1px solid var(--border); background: var(--bg-subtle); color: var(--text-muted); font-size: 10.5px; }
  .privacy-note :global(svg) { color: var(--success); }
  .privacy-note p { margin: 0; }
  .privacy-note strong { color: var(--text); }

  @media (max-width: 920px) {
    .signature-order, .settings-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .page-header { align-items: flex-start; flex-direction: column; gap: 11px; }
    .signature-order { padding: 16px; }
    .order-flow { align-items: flex-start; flex-direction: column; gap: 6px; }
    .flow-line { width: 1px; height: 14px; min-width: 0; flex: none; margin: 0 0 0 13px; }
    .editor-card { padding: 15px; }
    .section-head, .form-actions { align-items: flex-start; flex-direction: column; }
  }
</style>
