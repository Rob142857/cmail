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
    configuration: 'This deployment is not fully configured yet. Ask the operator to check the runtime settings.',
    provider_not_configured: 'That sign-in provider is not available for this deployment.',
    invalid_state: 'The sign-in attempt expired or could not be verified. Please try again.',
    oauth_failed: 'The identity provider could not complete sign-in. Please try again.',
    unverified_email: 'Google did not confirm this address, or Microsoft OIDC UserInfo did not return an email. Use the invited account and try again.',
    not_registered: 'This account has not been invited to this organisation.',
    enrollment_required: 'First sign-in requires the secure link in your newest invitation. Ask a manager to send or resend it.',
    enrollment_expired: 'That invitation has expired, was already used, or was replaced. Ask a manager to resend it.',
    enrollment_email_mismatch: 'Use the same Google or Microsoft UserInfo address that received the invitation, or ask a manager to correct the account.',
    identity_conflict: 'That identity or invitation is already connected to another account. Contact a manager; it cannot be reassigned during sign-in.',
    bootstrap_invalid: 'The one-time setup authorisation expired or did not match the configured administrator. Start initial setup again.',
    account_suspended: 'This account is paused or has been offboarded.',
    provider_mismatch: 'Use the identity provider connected during first sign-in.',
    rate_limited: 'Too many sign-in attempts were started. Wait a few minutes, then try again.',
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
        <strong>Personal mail and shared team addresses, one familiar workspace.</strong>
        <span>Use Exchange-style mailbox delegation with your own invited Google or Microsoft identity.</span>
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
        <p>Sign-in only verifies your identity. We cannot access your personal inbox, drive, or search history.</p>
      </div>

      <a class="mobile-access" href="/help/mobile">
        <strong>Mobile access</strong>
        <span>Install {data.appName || 'cmail'} as an app on your phone or tablet, and check the current device guidance.</span>
      </a>

      <div class="providers">
        {#each data.authProviders as provider}
          <a href="/auth/login/{provider}" class="btn btn-primary provider-btn">
            <strong>Sign in with {providerLabels[provider]}</strong>
            <span>{providerDescriptions[provider]}</span>
          </a>
        {/each}
      </div>

      {#if data.authProviders.length === 0}
        <p class="error">No sign-in method is ready. The operator should check APP_URL, SESSION_SECRET, and the provider credentials.</p>
      {/if}

      {#if data.bootstrapAvailable && !data.bootstrapReady}
        <div class="bootstrap-start">
          <span>Preparing a new deployment?</span>
          <a href="/bootstrap">Authorise the first manager</a>
        </div>
      {/if}

      <details class="faq">
        <summary>Privacy FAQ</summary>
        <dl>
          <dt>Can the organisation read my personal inbox?</dt>
          <dd>No. Sign-in verifies identity only — it does not grant access to your personal email, drive, or search history.</dd>
          <dt>Will people I email see my personal address?</dt>
          <dd>No. Outbound email uses your assigned service address.</dd>
          <dt>Why not a separate password?</dt>
          <dd>Reusing your existing account's security (2FA, phishing protection) is stronger than a new password.</dd>
          <dt>Which Microsoft accounts work?</dt>
          <dd>Microsoft 365 work or school accounts are supported. Outlook, Hotmail, and Live accounts are also supported when the deployment's app registration allows personal Microsoft accounts.</dd>
        </dl>
      </details>

      <nav class="login-links" aria-label="Public information">
        <a href="/help/getting-started">New user guide</a>
        <a href="/help/mobile">Mobile access guide</a>
        {#if data.publicDirectoryEnabled}<a href="/organization">Organisation directory</a>{/if}
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
  }
  .login-card {
    max-width: 420px;
    width: 100%;
    text-align: center;
    padding: 32px;
  }
  .brand-logo { display: block; margin: 0 auto 12px; max-width: min(240px, 100%); height: auto; }
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
  .mobile-access span { color: var(--text-muted); font-size: 12px; line-height: 1.45; }
  .providers { display: flex; flex-direction: column; gap: 10px; }
  .provider-btn { flex-direction: column; justify-content: center; padding: 11px 12px; }
  .provider-btn strong { font-size: 15px; }
  .provider-btn span { color: color-mix(in srgb, var(--on-primary) 82%, transparent); font-size: 11px; font-weight: 400; }
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
  .login-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 14px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; }
  .product-credit { margin: 13px 0 0; color: var(--text-faint); font-size: 10px; }
</style>
