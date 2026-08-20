<script>
  import { page } from '$app/state';
  let { data } = $props();

  const providerLabels = {
    google: 'Google',
    microsoft: 'Microsoft',
  };

  const providerDescriptions = {
    google: 'Google Workspace or a personal Google Account',
    microsoft: 'Microsoft 365, Outlook, Hotmail or Live',
  };

  const errorMessages = {
    configuration: 'This deployment isn\'t fully set up. Ask the operator to check the settings.',
    provider_not_configured: 'That sign-in method isn\'t available here.',
    invalid_state: 'Sign-in expired or couldn\'t be verified. Try again.',
    oauth_failed: 'Sign-in didn\'t complete. Try again.',
    unverified_email: 'Google or Microsoft didn\'t confirm an email address for this account. Use the invited account and try again.',
    not_registered: 'This account hasn\'t been invited to this organisation.',
    enrollment_required: 'First sign-in needs the link in your latest invitation. Ask a manager to send or resend it.',
    enrollment_expired: 'That invitation expired, was already used, or was replaced. Ask a manager to resend it.',
    enrollment_email_mismatch: 'Sign in with the Google or Microsoft account that received the invitation, or ask a manager to fix the account.',
    identity_conflict: 'That identity or invitation is already linked to another account. Contact a manager — it can\'t be reassigned during sign-in.',
    bootstrap_invalid: 'Setup authorisation expired or didn\'t match the administrator account. Start setup again.',
    account_suspended: 'This account is paused or was offboarded.',
    provider_mismatch: 'Use the sign-in method connected during your first sign-in.',
    rate_limited: 'Too many sign-in attempts. Wait a few minutes and try again.',
  };

  const errorCode = $derived(page.url.searchParams.get('error'));
</script>

<svelte:head><title>Sign in · {data.appName || 'cmail'}</title></svelte:head>

<main id="main-content" class="login-page" tabindex="-1">
    <div class="login-card card">
      <img src={data.brandLogoUrl || '/logo.svg'} alt="" class="brand-logo" width="240" height="82" />
      <h1>Connect to your {data.orgName || 'organisation'} email</h1>
      <p class="subtitle">Organisational email{data.orgName ? ` for ${data.orgName}` : ' for your organisation'}</p>

      <div class="welcome-message">
        <strong>One inbox for your personal and shared team mail.</strong>
        <span>Sign in with your existing Google or Microsoft account.</span>
      </div>

      {#if errorCode && errorMessages[errorCode]}
        <div class="login-error" role="alert">
          {errorMessages[errorCode]}
          {#if data.supportEmail}<a href={`mailto:${data.supportEmail}?subject=${encodeURIComponent(`${data.appName || 'cmail'} sign-in help (${errorCode})`)}`}>Contact support</a>{/if}
        </div>
      {/if}

      {#if data.bootstrapReady}
        <div class="setup-ready" role="status">
          <strong>Initial manager setup authorised</strong>
          <span>Sign in below using the configured administrator address. This proof expires after 10 minutes.</span>
        </div>
      {/if}

      <div class="trust-message">
        <p>Sign-in only confirms your identity. It can't access your personal inbox, drive, or search history.</p>
      </div>

      <a class="mobile-access" href="/help/mobile">
        <strong>Mobile access</strong>
        <span>Install {data.appName || 'cmail'} on your phone or tablet.</span>
      </a>

      <div class="providers">
        {#each data.authProviders as provider}
          {#if provider === 'google'}
            <a href="/auth/login/google" class="google-sign-in">
              <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                <path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.703-1.568 2.684-3.878 2.684-6.616Z" />
                <path fill="#4285F4" d="M9 18c2.43 0 4.467-.806 5.956-2.179l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.345 0-4.328-1.585-5.037-3.713H.956v2.333A9 9 0 0 0 9 18Z" />
                <path fill="#FBBC05" d="M3.963 10.709A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.281-1.709V4.958H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.042l3.007-2.333Z" />
                <path fill="#34A853" d="M9 3.578c1.32 0 2.506.454 3.441 1.345l2.581-2.581C13.463.891 11.426 0 9 0A9 9 0 0 0 .956 4.958l3.007 2.333C4.672 5.163 6.655 3.578 9 3.578Z" />
              </svg>
              <span>Sign in with Google</span>
            </a>
          {:else if provider === 'microsoft'}
            <a href="/auth/login/microsoft" class="microsoft-sign-in">
              <svg viewBox="0 0 21 21" aria-hidden="true" focusable="false">
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
              <span>Sign in with Microsoft</span>
            </a>
          {:else}
            <a href="/auth/login/{provider}" class="btn btn-primary provider-btn">
              <strong>Sign in with {providerLabels[provider]}</strong>
              <span>{providerDescriptions[provider]}</span>
            </a>
          {/if}
        {/each}
      </div>

      {#if data.authProviders.length === 0}
        <p class="error">No sign-in method is ready. The operator should check APP_URL, SESSION_SECRET, and provider credentials.</p>
      {/if}

      {#if data.bootstrapAvailable && !data.bootstrapReady}
        <div class="bootstrap-start">
          <span>New deployment?</span>
          <a href="/bootstrap">Set up the first manager</a>
        </div>
      {/if}

      <details class="faq">
        <summary>Privacy FAQ</summary>
        <dl>
          <dt>Can the organisation read my personal inbox?</dt>
          <dd>No. It only confirms your identity — not access to your personal email, drive, or search history.</dd>
          <dt>Will people I email see my personal address?</dt>
          <dd>No. Email you send uses your assigned address, not your personal one.</dd>
          <dt>Why not a separate password?</dt>
          <dd>It reuses the strong protections (like 2FA) already on your Google or Microsoft account.</dd>
          <dt>Which Microsoft accounts work?</dt>
          <dd>Microsoft 365 work or school accounts always work. Outlook, Hotmail, and Live accounts work if this deployment allows personal Microsoft accounts.</dd>
        </dl>
      </details>

      <nav class="login-links" aria-label="Public information">
        <a href="/help/getting-started">New user guide</a>
        <a href="/help/mobile">Mobile access guide</a>
        {#if data.publicDirectoryEnabled}<a href="/organization">Organisation directory</a>{/if}
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/policy">Usage policy</a>
        {#if data.supportEmail}<a href={`mailto:${data.supportEmail}`}>Contact support</a>{/if}
      </nav>

      <p class="product-credit">Powered by cmail · independent, MIT-licensed open-source email</p>
    </div>
</main>

<style>
  .login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
    overflow-x: clip;
  }
  .login-card {
    min-width: 0;
    max-width: min(420px, 100%);
    width: 100%;
    text-align: center;
    padding: 32px;
  }
  .login-card > * { min-width: 0; }
  .brand-logo { display: block; width: min(240px, 100%); height: auto; max-width: 100%; margin: 0 auto 12px; object-fit: contain; }
  h1 { margin: 0; font-size: 22px; }
  .subtitle { color: var(--text-muted); margin-bottom: 24px; }
  .welcome-message { display: grid; gap: 3px; margin: -8px 0 18px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-subtle); text-align: left; }
  .welcome-message strong { font-size: 13px; }
  .welcome-message span { color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .trust-message {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    text-align: left;
    padding: 12px;
    background: var(--bg-hover);
    border-radius: var(--radius);
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--text-muted);
  }
  .mobile-access { display: grid; gap: 3px; margin: -10px 0 20px; padding: 12px; border: 1px solid var(--primary); border-radius: var(--radius); background: var(--primary-soft); color: var(--text); text-align: left; text-decoration: none; }
  .mobile-access:hover { background: color-mix(in srgb, var(--primary-soft) 70%, var(--bg-surface)); }
  .mobile-access strong { color: var(--primary); font-size: 13px; }
  .mobile-access span { color: var(--text-muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  .providers { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
  .provider-btn { flex-direction: column; justify-content: center; padding: 11px 12px; }
  .provider-btn strong { font-size: 15px; }
  .provider-btn span { color: color-mix(in srgb, var(--on-primary) 82%, transparent); font-size: 11px; font-weight: 400; }
  .google-sign-in {
    display: grid;
    grid-template-columns: 18px 1fr;
    align-items: center;
    column-gap: 12px;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid #747775;
    border-radius: 4px;
    background: #fff;
    color: #1f1f1f;
    font-family: 'Google Sans', Roboto, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    text-decoration: none;
    text-align: left;
  }
  .google-sign-in:hover { background: #f8faff; border-color: #1a73e8; color: #1f1f1f; }
  .google-sign-in:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
  .google-sign-in svg { width: 18px; height: 18px; }
  .google-sign-in span { grid-column: 2; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
  .microsoft-sign-in {
    display: grid;
    grid-template-columns: 18px 1fr;
    align-items: center;
    column-gap: 12px;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid #8c8c8c;
    border-radius: 4px;
    background: #ffffff;
    color: #5e5e5e;
    font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    text-decoration: none;
    text-align: left;
  }
  .microsoft-sign-in:hover { background: #f3f3f3; border-color: #5e5e5e; color: #5e5e5e; }
  .microsoft-sign-in:focus-visible { outline: 2px solid #5e5e5e; outline-offset: 2px; }
  .microsoft-sign-in svg { width: 18px; height: 18px; }
  .microsoft-sign-in span { grid-column: 2; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
  .error { color: var(--danger); margin-top: 16px; }
  .login-error {
    margin-bottom: 18px;
    padding: 11px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 13px;
    text-align: left;
  }
  .login-error a { display: inline-block; margin-top: 5px; font-weight: 650; }
  .setup-ready { display: grid; gap: 3px; margin: 0 0 18px; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--success) 35%, var(--border)); border-radius: var(--radius); background: var(--success-soft); text-align: left; }
  .setup-ready strong { font-size: 13px; }
  .setup-ready span { color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .bootstrap-start { display: flex; justify-content: center; gap: 6px; margin-top: 14px; color: var(--text-muted); font-size: 12px; }
  .faq {
    margin-top: 24px;
    text-align: left;
    font-size: 13px;
    color: var(--text-muted);
  }
  .faq summary { cursor: pointer; font-weight: 500; }
  .faq dl { margin-top: 12px; }
  .faq dt { font-weight: 500; color: var(--text); margin-top: 8px; }
  .faq dd { margin: 4px 0 0 0; }
  .login-links { display: flex; min-width: 0; flex-wrap: wrap; justify-content: center; gap: 8px 14px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; }
  .login-links a { overflow-wrap: anywhere; }
  .product-credit { margin: 13px 0 0; color: var(--text-faint); font-size: 10px; }
  @media (max-width: 420px) {
    .login-page { padding: 12px; align-items: flex-start; }
    .login-card { padding: 20px 16px; }
    .brand-logo { width: min(210px, 100%); }
  }
</style>
