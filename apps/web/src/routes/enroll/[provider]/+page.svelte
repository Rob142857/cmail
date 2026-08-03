<script lang="ts">
  import { onMount } from 'svelte';

  let { data, form } = $props();
  let enrollmentForm: HTMLFormElement;
  let tokenInput: HTMLInputElement;
  let missingToken = $state(false);

  const providerLabel = $derived(data.provider === 'microsoft' ? 'Microsoft' : 'Google');

  onMount(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get('token') || '';
    // Remove the capability from browser history before making any request.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!token) {
      missingToken = true;
      return;
    }
    tokenInput.value = token;
    enrollmentForm.requestSubmit();
  });
</script>

<svelte:head>
  <title>Prepare secure sign-in · {data.appName || 'cmail'}</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main id="main-content" class="enrollment-page" tabindex="-1">
  <section class="card enrollment-card" aria-labelledby="enrollment-heading">
    <img src={data.brandLogoUrl || '/logo.svg'} alt="" class="brand-logo" width="220" height="56" />
    <div class="security-mark" aria-hidden="true">✓</div>
    <h1 id="enrollment-heading">Preparing secure sign-in</h1>
    <p>We are securely connecting this invitation to your {providerLabel} sign-in. The invitation itself is never placed in a request URL.</p>

    {#if form?.error || missingToken}
      <div class="notice" role="alert">
        {form?.error || 'This invitation link is incomplete. Ask a manager to resend it.'}
      </div>
      <a class="btn btn-primary" href="/">Return to sign in</a>
    {:else}
      <div class="progress" role="status"><span></span>Checking invitation…</div>
      <noscript>
        <p class="notice">JavaScript is required to move the invitation securely out of the link. Enable it, then open the invitation again.</p>
      </noscript>
    {/if}

    <form method="POST" bind:this={enrollmentForm} class="hidden-form" aria-hidden="true">
      <input type="hidden" name="token" bind:this={tokenInput} />
    </form>
  </section>
</main>

<style>
  .enrollment-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .enrollment-card { width: min(100%, 440px); padding: 32px; text-align: center; }
  .brand-logo { display: block; max-width: min(220px, 100%); height: auto; margin: 0 auto 18px; }
  .security-mark { width: 38px; height: 38px; display: grid; place-items: center; margin: 0 auto 12px; border-radius: 50%; background: var(--success-soft); color: var(--success); font-weight: 800; }
  h1 { margin: 0; font-size: 22px; }
  p { color: var(--text-muted); line-height: 1.55; }
  .notice { margin: 18px 0; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); text-align: left; }
  .progress { display: inline-flex; align-items: center; gap: 9px; margin-top: 12px; color: var(--text-muted); font-size: 13px; }
  .progress span { width: 14px; height: 14px; border: 2px solid var(--border-strong); border-top-color: var(--primary); border-radius: 50%; animation: spin .8s linear infinite; }
  .hidden-form { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .progress span { animation: none; } }
</style>
