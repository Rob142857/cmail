<script lang="ts">
  let { data, form } = $props();
  const s = $derived(data.settings);
</script>

<svelte:head><title>Org settings · Admin</title></svelte:head>

<section class="settings">
  <header class="hd">
    <h2>Organisation settings</h2>
    <p class="muted">
      These values control invite emails, footer branding, and the system "From" address. Changes take effect immediately — no redeploy.
      The system mailbox must be on a domain that is verified with your outbound email provider (Resend / Postmark).
    </p>
  </header>

  {#if form?.error}<div class="banner err">{form.error}</div>{/if}
  {#if form?.success}<div class="banner ok">{form.success}</div>{/if}

  {#if s}
    <form method="post" action="?/save" class="form">
      <fieldset>
        <legend>System mail</legend>
        <label>
          <span>System mailbox <em>(From address)</em></span>
          <input type="email" name="system_email" value={s.systemEmail} placeholder="desk@{data.mailDomain || 'yourdomain.com'}" autocomplete="off" />
          <small class="hint">Used as the From address for invite emails and other system mail. Must be a verified sender on your outbound provider.</small>
        </label>
        <label>
          <span>From display name</span>
          <input type="text" name="system_from_name" value={s.systemFromName} placeholder="{s.orgShortName || 'Your Org'} Desk" autocomplete="off" />
          <small class="hint">Shown to recipients in their inbox, e.g. "{s.orgShortName || 'Your Org'} Desk &lt;{s.systemEmail || 'desk@…'}&gt;".</small>
        </label>
        <label>
          <span>Support email</span>
          <input type="email" name="support_email" value={s.supportEmail} placeholder="desk@{data.mailDomain || 'yourdomain.com'}" autocomplete="off" />
          <small class="hint">Address shown to recipients for replies / questions. Defaults to the system mailbox if blank.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>Organisation</legend>
        <label>
          <span>Organisation name</span>
          <input type="text" name="org_name" value={s.orgName} placeholder="Acme Inc." autocomplete="off" />
        </label>
        <label>
          <span>Short name</span>
          <input type="text" name="org_short_name" value={s.orgShortName} placeholder="Acme" autocomplete="off" />
          <small class="hint">Used in subject lines like "Welcome to {s.orgShortName || 'Acme'}" and the From display name.</small>
        </label>
        <label>
          <span>Organisation URL</span>
          <input type="url" name="org_url" value={s.orgUrl} placeholder="https://acme.com" autocomplete="off" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Application</legend>
        <label>
          <span>App name</span>
          <input type="text" name="app_name" value={s.appName} placeholder="cmail" autocomplete="off" />
        </label>
        <label>
          <span>App URL</span>
          <input type="url" name="app_url" value={s.appUrl} placeholder="https://mail.acme.com" autocomplete="off" />
          <small class="hint">Sign-in links in invite emails are built from this base.</small>
        </label>
        <label>
          <span>Landing page URL</span>
          <input type="url" name="landing_url" value={s.landingUrl} placeholder="https://acme.com/email" autocomplete="off" />
        </label>
        <label>
          <span>Policy page URL</span>
          <input type="url" name="policy_url" value={s.policyUrl} placeholder="https://mail.acme.com/policy" autocomplete="off" />
          <small class="hint">Defaults to the in-app /policy page when blank.</small>
        </label>
      </fieldset>

      <div class="actions">
        <button type="submit" class="btn primary">Save settings</button>
      </div>
    </form>
  {:else}
    <p class="muted">Settings unavailable.</p>
  {/if}
</section>

<style>
  .settings { max-width: 760px; }
  .hd { margin-bottom: 18px; }
  .hd h2 { margin: 0 0 6px; font-size: 22px; }
  .muted { color: var(--muted, #888); font-size: 14px; line-height: 1.5; margin: 0; }
  .banner { padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 14px; }
  .banner.ok { background: #0d3d24; color: #c4f5d8; border: 1px solid #1e6e44; }
  .banner.err { background: #3d1414; color: #ffc8c8; border: 1px solid #7a2828; }
  fieldset { border: 1px solid var(--border, #2a2a2a); border-radius: 10px; padding: 16px 18px; margin: 0 0 18px; }
  legend { padding: 0 8px; font-weight: 600; font-size: 14px; color: var(--accent, #6aa8ff); }
  label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; font-size: 14px; }
  label > span { font-weight: 500; }
  label > span em { color: var(--muted, #888); font-style: normal; font-weight: 400; font-size: 12px; }
  input[type="text"], input[type="email"], input[type="url"] {
    background: var(--bg-input, #0e0e0e);
    color: inherit;
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 14px;
    font-family: inherit;
  }
  input:focus { outline: 2px solid var(--accent, #6aa8ff); outline-offset: -1px; }
  .hint { font-size: 12px; color: var(--muted, #888); }
  .actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px; }
  .btn.primary { background: var(--accent, #2563eb); color: #fff; border: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .btn.primary:hover { filter: brightness(1.1); }
</style>
