<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head>
  <title>Initial manager setup · {data.appName || 'cmail'}</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main id="main-content" class="bootstrap-page" tabindex="-1">
  <section class="card bootstrap-card" aria-labelledby="bootstrap-heading">
    <img src={data.brandLogoUrl || '/logo.svg'} alt="" class="brand-logo" width="220" height="75" />
    <p class="eyebrow">One-time setup</p>
    <h1 id="bootstrap-heading">Authorise the first manager</h1>
    <p class="intro">Enter the strong token configured as <code>BOOTSTRAP_ADMIN_TOKEN</code>. A short-lived proof will let the configured administrator complete sign-in with Google or Microsoft.</p>

    {#if form?.error}<div class="notice" role="alert">{form.error}</div>{/if}

    <form method="POST" class="bootstrap-form">
      <label for="bootstrap-token">Bootstrap administrator token</label>
      <input
        id="bootstrap-token"
        name="token"
        type="password"
        minlength="32"
        maxlength="512"
        autocomplete="off"
        spellcheck="false"
        required
      />
      <small>The token is submitted only to this same-origin form and is never placed in a URL or log.</small>
      <button type="submit" class="btn btn-primary">Continue to identity sign-in</button>
    </form>

    <p class="safety-note">After the first manager signs in successfully, delete both bootstrap values from every environment.</p>
    <a href="/" class="cancel-link">Cancel</a>
  </section>
</main>

<style>
  .bootstrap-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .bootstrap-card { width: min(100%, 460px); padding: 32px; }
  .brand-logo { display: block; max-width: min(220px, 100%); height: auto; margin: 0 auto 22px; }
  .eyebrow { margin: 0 0 5px; color: var(--primary); font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }
  h1 { margin: 0; font-size: 23px; }
  .intro { margin: 9px 0 20px; color: var(--text-muted); line-height: 1.55; }
  code { overflow-wrap: anywhere; font-size: .88em; }
  .bootstrap-form { display: grid; gap: 8px; }
  .bootstrap-form label { font-size: 13px; font-weight: 650; }
  .bootstrap-form small { color: var(--text-muted); line-height: 1.45; }
  .bootstrap-form button { margin-top: 8px; }
  .notice { margin: 0 0 16px; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); }
  .safety-note { margin: 20px 0 0; padding: 10px 12px; border-radius: var(--radius); background: var(--warning-soft); color: var(--text); font-size: 12px; line-height: 1.45; }
  .cancel-link { display: block; margin-top: 16px; text-align: center; font-size: 13px; }
</style>
