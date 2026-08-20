<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  // form only ever holds the most recent action's result. A successful
  // `request` sets requestSent; a failed `verify` sets verifyError but not
  // requestSent — both belong on the code-entry step. Only a fresh load or
  // a request-side validation error (requestError, no requestSent) stays on
  // the address step.
  const step = $derived(form?.requestSent || form?.verifyError ? 'verify' : 'request');
  const actionSuffix = $derived(data.enroll ? '&enroll=1' : '');
  const startOverHref = $derived(data.enroll ? '/auth/email?enroll=1' : '/auth/email');
</script>

<svelte:head>
  <title>{data.enroll ? 'Activate your mailbox' : 'Sign in with an email code'} · cmail</title>
  <meta name="referrer" content="strict-origin" />
  {#if data.turnstileEnabled}
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  {/if}
</svelte:head>

<main id="main-content" class="otp-page" tabindex="-1">
  <section class="card otp-card" aria-labelledby="otp-heading">
    <h1 id="otp-heading">{data.enroll ? 'Activate your mailbox' : 'Sign in with an email code'}</h1>

    {#if step === 'request'}
      <p class="subtitle">
        {#if data.enroll}
          We'll send a one-time code to confirm this is your address.
        {:else}
          Enter the address you were invited with. If it's registered for email sign-in, we'll send a one-time code.
        {/if}
      </p>

      {#if form?.requestError}
        <div class="notice" role="alert">{form.requestError}</div>
      {/if}

      <form method="POST" action={`?/request${actionSuffix}`} use:enhance>
        <input type="hidden" name="purpose" value={data.enroll ? 'enroll' : 'signin'} />
        <div class="field">
          <label for="address">Email address</label>
          <input
            id="address"
            name="address"
            type="email"
            autocomplete="email"
            required
            maxlength="320"
            readonly={data.enroll && !!data.enrollAddress}
            value={data.enroll ? data.enrollAddress : ''}
          />
        </div>
        {#if data.turnstileEnabled}
          <div class="cf-turnstile" data-sitekey={data.turnstileSiteKey}></div>
        {/if}
        <button type="submit" class="btn btn-primary btn-block">Send code</button>
      </form>
    {:else}
      <p class="subtitle" role="status">
        {form?.message || "If this address is registered for email sign-in, a code is on its way."}
        Check your inbox for an 8-digit code — it expires in 5 minutes.
      </p>

      {#if form?.verifyError}
        <div class="notice" role="alert">{form.verifyError}</div>
      {/if}

      <form method="POST" action={`?/verify${actionSuffix}`} use:enhance>
        <div class="field">
          <label for="code">8-digit code</label>
          <input
            id="code"
            name="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]*"
            maxlength="8"
            required
          />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Verify code</button>
      </form>

      <p class="resend-hint">Didn't get it? <a href={startOverHref}>Request a new code</a>.</p>
    {/if}

    <p class="back-link"><a href="/">Back to sign in</a></p>
  </section>
</main>

<style>
  .otp-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .otp-card { width: min(100%, 420px); padding: 32px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .subtitle { color: var(--text-muted); line-height: 1.55; margin: 0 0 20px; }
  .field { text-align: left; margin-bottom: 16px; }
  .notice {
    margin: 0 0 16px;
    padding: 11px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    text-align: left;
    font-size: 13px;
  }
  .cf-turnstile { margin: 4px 0 16px; display: flex; justify-content: center; }
  .resend-hint { margin-top: 16px; font-size: 13px; color: var(--text-muted); }
  .back-link { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 12px; }
  .back-link a, .resend-hint a { color: var(--text-muted); }
  @media (max-width: 420px) {
    .otp-page { padding: 12px; align-items: flex-start; }
    .otp-card { padding: 20px 16px; }
  }
</style>
