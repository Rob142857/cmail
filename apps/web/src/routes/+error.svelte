<script lang="ts">
  import { page } from '$app/state';

  const notFound = $derived(page.status === 404);
  const reference = $derived(page.error?.reference || '');
  const destination = $derived(page.data?.user ? '/mail' : '/');
</script>

<svelte:head>
  <title>{notFound ? 'Page not found' : 'Something went wrong'} · {page.data?.appName || 'cmail'}</title>
</svelte:head>

<main id="main-content" class="error-page" tabindex="-1">
  <section class="card error-card" aria-labelledby="error-title">
    <p class="status-code">{page.status}</p>
    <h1 id="error-title">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
    <p>
      {notFound
        ? 'The address may be incorrect, or the page may have moved.'
        : 'The request failed. Try again, or contact support if the problem continues.'}
    </p>

    {#if reference}
      <p class="reference">Support reference: <code>{reference}</code></p>
    {/if}

    <div class="actions">
      <a class="btn btn-primary" href={destination}>{page.data?.user ? 'Return to mail' : 'Return to sign in'}</a>
      <button type="button" onclick={() => history.back()}>Go back</button>
    </div>

    {#if page.data?.supportEmail}
      <a class="support" href={`mailto:${page.data.supportEmail}`}>Contact support</a>
    {/if}
  </section>
</main>

<style>
  .error-page {
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .error-card { width: min(100%, 520px); padding: 32px; text-align: center; }
  .status-code { margin: 0 0 8px; color: var(--primary); font-size: 13px; font-weight: 750; letter-spacing: .1em; }
  h1 { margin: 0; font-size: clamp(24px, 5vw, 34px); }
  h1 + p { margin: 12px auto 0; max-width: 430px; color: var(--text-muted); }
  .reference { margin-top: 14px; color: var(--text-muted); font-size: 12px; }
  .reference code { overflow-wrap: anywhere; color: var(--text); }
  .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 22px; }
  .support { display: inline-block; margin-top: 18px; font-size: 13px; }
  @media (max-width: 480px) {
    .error-page { padding: 14px; }
    .error-card { padding: 24px 18px; }
    .actions { flex-direction: column; }
    .actions > :global(*) { width: 100%; }
  }
</style>
