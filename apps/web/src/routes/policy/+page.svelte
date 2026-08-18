<script>
  import { stopPushBeforeSignOut } from '$lib/push-client';
  let { data, form } = $props();
  let signingOut = $state(false);

  /** @param {SubmitEvent} event */
  async function signOut(event) {
    event.preventDefault();
    if (signingOut) return;
    signingOut = true;
    await stopPushBeforeSignOut();
    /** @type {HTMLFormElement} */ (event.currentTarget).submit();
  }
</script>

<svelte:head><title>Usage policy · {data.appName || 'cmail'}</title></svelte:head>

<main id="main-content" class="policy-wrap" tabindex="-1">
  {#if data.user}
    <div class="account-bar">
      <span>Signed in as <strong>{data.user.display_name || data.user.email}</strong></span>
      <form method="POST" action="/auth/logout" onsubmit={signOut}><button type="submit" class="btn btn-sm" disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></form>
    </div>
  {/if}
  <div class="card policy-card">
    <h1 class="policy-title">Usage policy</h1>

    {#if data.policy}
      <p class="policy-meta">
        Version {data.policy.version_label} · Published {new Date(data.policy.published_at.includes('T') ? data.policy.published_at : data.policy.published_at.replace(' ', 'T') + 'Z').toLocaleDateString(data.locale || 'en', { timeZone: data.timeZone || 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}
      </p>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="policy-body" role="region" aria-label="Policy text" tabindex="0">
        <div class="policy-text">{data.policy.body_text}</div>
      </div>

      {#if !data.user}
        <!-- Public / unauthenticated visitor — read-only -->
        <div class="policy-info">
          <p>Viewing as a guest. <a href="/">Sign in</a> to accept and access your mailbox.</p>
        </div>
      {:else if data.alreadySigned}
        <div class="policy-info signed">
          <p>✓ You've accepted this policy version. <a href="/mail">Go to mailbox</a></p>
        </div>
      {:else}
        {#if form?.error}
          <div class="badge badge-error policy-error" role="alert">{form.error}</div>
        {/if}

        <p class="policy-lede">
          Read and accept the policy to access your mailbox.
        </p>

        <form method="POST" class="policy-form">
          <input type="hidden" name="policy_version_id" value={data.policy.id} />
          <label class="policy-accept">
            <input type="checkbox" name="accept" value="1" required />
            <span>I have read and accept this ICT usage policy.</span>
          </label>
          <button type="submit" class="btn btn-primary policy-submit">
            Accept &amp; Continue
          </button>
        </form>
      {/if}
    {:else}
      <div class="policy-info" class:unavailable={data.policyUnavailable} role={data.policyUnavailable ? 'status' : undefined}>
        <p>{data.policyUnavailable ? "The policy service isn't configured or is temporarily unavailable." : 'No policy published yet.'} {#if !data.user}<a href="/">Return to sign in</a>{/if}</p>
      </div>
    {/if}
  </div>
</main>

<style>
  .policy-wrap {
    max-width: 720px;
    margin: 40px auto;
    padding: 0 16px;
  }
  .policy-card {
    padding: 24px;
  }
  .account-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--text-muted); font-size: 12px; }
  .account-bar form { display: inline-flex; }
  .account-bar strong { color: var(--text); }
  .policy-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .policy-title {
    margin: 0 0 6px;
  }
  .policy-lede {
    color: var(--text-muted);
    margin: 0 0 4px;
  }
  .policy-meta {
    font-size: 13px;
    color: var(--text-muted);
    margin: 0 0 16px;
  }
  .policy-body {
    max-height: 50vh;
    overflow-y: auto;
    padding: 16px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    margin-bottom: 20px;
    line-height: 1.55;
  }
  .policy-body :global(h3) {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .policy-body :global(h4) {
    margin: 18px 0 6px;
    font-size: 15px;
  }
  .policy-body :global(p) {
    margin: 0 0 10px;
  }
  .policy-body :global(ul) {
    margin: 0 0 10px;
    padding-left: 22px;
  }
  .policy-body :global(li) {
    margin-bottom: 4px;
  }
  .policy-body :global(code) {
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12.5px;
  }
  .policy-body :global(em) {
    color: var(--text-muted);
  }

  .policy-error {
    display: block;
    padding: 8px 12px;
    margin-bottom: 12px;
  }
  .policy-info {
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .policy-info p { margin: 0; }
  .policy-info a { color: var(--accent, #6aa8ff); }
  .policy-info.signed { border-color: #1e6e44; background: #0d3d24; color: #c4f5d8; }
  .policy-info.unavailable { border-color: color-mix(in srgb, var(--warning) 35%, var(--border)); background: var(--warning-soft); color: var(--warning); }

  .policy-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .policy-accept {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    line-height: 1.4;
  }
  .policy-accept input[type="checkbox"] {
    margin: 2px 0 0;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .policy-accept span {
    flex: 1 1 auto;
  }
  .policy-submit {
    width: 100%;
    justify-content: center;
    padding: 12px 16px;
    font-size: 15px;
  }

  @media (max-width: 600px) {
    .policy-wrap {
      margin: 16px auto;
      padding: 0 12px;
    }
    .policy-card {
      padding: 16px;
    }
    .policy-body {
      max-height: 55vh;
      padding: 12px 14px;
    }
  }
</style>
