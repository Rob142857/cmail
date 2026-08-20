<script lang="ts">
  import CountryPicker from '$lib/CountryPicker.svelte';

  let { data, form } = $props();
  const settings = $derived(data.settings);
</script>

<svelte:head><title>Settings · Management · {data.appName || 'cmail'}</title></svelte:head>

<section class="settings-page" aria-labelledby="settings-heading">
  <header class="page-heading">
    <p class="eyebrow">Configuration</p>
    <h1 id="settings-heading">Organisation settings</h1>
    <p>Manage organisation details and system email. Security settings are set outside this app.</p>
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  {#if settings}
    <form method="POST" action="?/save" class="settings-form">
      <fieldset class="card">
        <legend>System email</legend>
        <p class="group-intro">Used for invitations and other system messages.</p>

        <div class="field">
          <label for="system-email">System mailbox <span>From address</span></label>
          <input id="system-email" type="email" name="system_email" value={settings.systemEmail} maxlength="200" placeholder="noreply@{data.mailDomain || 'example.org'}" autocomplete="email" aria-describedby="system-email-hint" />
          <small id="system-email-hint">Must be verified with your Cloudflare Email or Postmark account.</small>
        </div>

        <div class="field">
          <label for="system-from-name">From display name</label>
          <input id="system-from-name" type="text" name="system_from_name" value={settings.systemFromName} maxlength="120" placeholder="{settings.orgShortName || 'Organisation'} Mail" autocomplete="organization" aria-describedby="system-from-hint" />
          <small id="system-from-hint">Recipients see this name beside the system mailbox address.</small>
        </div>

        <div class="field">
          <label for="support-email">Support email</label>
          <input id="support-email" type="email" name="support_email" value={settings.supportEmail} maxlength="200" placeholder="support@{data.mailDomain || 'example.org'}" autocomplete="email" aria-describedby="support-email-hint" />
          <small id="support-email-hint">Shown to users needing help; uses the system mailbox if blank.</small>
        </div>
      </fieldset>

      <fieldset class="card">
        <legend>Sign-in security</legend>
        <p class="group-intro">Restrict sign-in to specific countries, across Google, Microsoft, and email sign-in code alike. Off by default — every country is allowed until at least one is chosen here.</p>

        <div class="field field-wide">
          <label for="sign-in-countries">Approved sign-in countries</label>
          <CountryPicker id="sign-in-countries" name="sign_in_countries" selected={settings.signInCountries} />
          <small>A sign-in attempt from outside this list is held for manager approval, and every active manager is emailed. Grant a temporary exception from <a href="/admin/travel">Travel approvals</a>.</small>
        </div>
      </fieldset>

      <fieldset class="card">
        <legend>Organisation identity</legend>
        <p class="group-intro">Replace the defaults with your organisation's real details.</p>

        <div class="field">
          <label for="org-name">Organisation name</label>
          <input id="org-name" type="text" name="org_name" value={settings.orgName} maxlength="200" placeholder="Example Organisation" autocomplete="organization" />
        </div>

        <div class="field">
          <label for="org-short-name">Short name</label>
          <input id="org-short-name" type="text" name="org_short_name" value={settings.orgShortName} maxlength="80" placeholder="Example Org" aria-describedby="org-short-name-hint" />
          <small id="org-short-name-hint">Used where space is limited, including invitation subjects.</small>
        </div>

        <div class="field field-wide">
          <label for="org-url">Organisation website</label>
          <input id="org-url" type="url" name="org_url" value={settings.orgUrl} maxlength="300" placeholder="https://www.example.org" autocomplete="url" />
        </div>
      </fieldset>

      <fieldset class="card">
        <legend>Application</legend>
        <p class="group-intro">Update labels here. Security settings stay read-only.</p>

        <div class="field">
          <label for="app-name">Application name</label>
          <input id="app-name" type="text" name="app_name" value={settings.appName} maxlength="80" placeholder="cmail" />
        </div>

        <div class="field deployment-value">
          <span id="app-url-label">Application URL</span>
          <code aria-labelledby="app-url-label">{settings.appUrl || 'Not configured'}</code>
          <small>Set outside this app. Used for sign-in and invitation links.</small>
        </div>

        <div class="field">
          <label for="landing-url">Landing page URL</label>
          <input id="landing-url" type="url" name="landing_url" value={settings.landingUrl} maxlength="300" placeholder="https://www.example.org/mail" />
        </div>

        <div class="field">
          <label for="policy-url">Policy page URL</label>
          <input id="policy-url" type="url" name="policy_url" value={settings.policyUrl} maxlength="300" placeholder="https://mail.example.org/policy" aria-describedby="policy-url-hint" />
          <small id="policy-url-hint">Leave blank to use the built-in policy page.</small>
        </div>
      </fieldset>

      <div class="form-actions">
        <p>Changes take effect immediately and are recorded in the audit log.</p>
        <button type="submit" class="btn btn-primary">Save settings</button>
      </div>
    </form>
  {:else}
    <div class="card empty-state" role="status">
      <h2>Settings are unavailable</h2>
      <p>Check the D1 binding and run pending migrations.</p>
    </div>
  {/if}
</section>

<style>
  .settings-page { display: grid; gap: 16px; max-width: 960px; }
  .page-heading h1 { margin: 2px 0 7px; font-size: clamp(25px, 3vw, 34px); }
  .page-heading > p:last-child { max-width: 760px; color: var(--text-muted); }
  .eyebrow { margin: 0; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .notice { padding: 11px 13px; border: 1px solid var(--border); border-radius: var(--radius); }
  .notice-error { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 28%, var(--border)); }
  .notice-success { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, var(--border)); }
  .settings-form { display: grid; gap: 16px; }
  fieldset.card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px 18px; margin: 0; padding: 20px; }
  legend { padding: 0 8px; color: var(--text); font-size: 16px; font-weight: 650; }
  .group-intro { grid-column: 1 / -1; margin: -2px 0 2px; color: var(--text-muted); font-size: 13px; }
  .field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
  .field-wide { grid-column: 1 / -1; }
  .field label, .deployment-value > span { font-size: 13px; font-weight: 650; }
  .field label span { color: var(--text-muted); font-size: 11px; font-weight: 500; }
  .field small { color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .deployment-value code { min-height: 40px; padding: 9px 11px; overflow-wrap: anywhere; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-subtle); color: var(--text-muted); font-size: 13px; }
  .form-actions { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--bg-surface) 94%, transparent); box-shadow: var(--shadow); backdrop-filter: blur(10px); }
  .form-actions p { color: var(--text-muted); font-size: 12px; }
  .empty-state { padding: 42px 24px; text-align: center; }
  .empty-state p { margin-top: 6px; color: var(--text-muted); }
  @media (max-width: 680px) {
    fieldset.card { grid-template-columns: 1fr; padding: 16px; }
    .group-intro, .field-wide { grid-column: auto; }
    .form-actions { align-items: stretch; flex-direction: column; }
    .form-actions .btn { width: 100%; }
  }
</style>
