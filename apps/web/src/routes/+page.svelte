<script>
  let { data } = $props();

  const providerLabels = {
    google: 'Google',
    microsoft: 'Microsoft',
  };
</script>

{#if data.user}
  <meta http-equiv="refresh" content="0;url=/mail" />
{:else}
  <div class="login-page">
    <div class="login-card card">
      <img src="/logo.svg" alt={data.appName} class="brand-logo" width="240" height="60" />
      <p class="subtitle">Secure email for your organisation</p>

      <div class="trust-message">
        <p>Sign-in only verifies your identity. We cannot access your personal inbox, drive, or search history.</p>
      </div>

      <div class="providers">
        {#each data.authProviders as provider}
          <a href="/auth/login/{provider}" class="btn btn-primary provider-btn">
            Sign in with {providerLabels[provider]}
          </a>
        {/each}
      </div>

      {#if data.authProviders.length === 0}
        <p class="error">No authentication providers configured. Check your environment variables.</p>
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
        </dl>
      </details>
    </div>
  </div>
{/if}

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
  .login-card h1 { font-size: 28px; margin-bottom: 4px; }
  .brand-logo { display: block; margin: 0 auto 8px; max-width: 240px; height: auto; }
  .subtitle { color: var(--text-muted); margin-bottom: 24px; }  .trust-message {
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
  .shield { font-size: 20px; flex-shrink: 0; }
  .providers { display: flex; flex-direction: column; gap: 10px; }
  .provider-btn { justify-content: center; padding: 12px; font-size: 16px; }
  .error { color: var(--danger); margin-top: 16px; }
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
</style>
