<script lang="ts">
  import Icon from '#lib/ui/Icon.svelte';

  let { data, form } = $props();
  const appName = $derived(data.appName || 'cmail');
  let sendScopeChecked = $state(false);

  const permissionLabels: Record<string, string> = {
    read: 'You can read',
    'send-as': 'You can read and send',
    full: 'Full access',
  };
</script>

<svelte:head>
  <title>Connect an AI app · {appName}</title>
  {#if form?.done && form.redirectTo}
    <meta http-equiv="refresh" content={`1;url=${form.redirectTo}`} />
  {/if}
</svelte:head>

<main id="main-content" class="authorize-page nb-quiet" tabindex="-1">
  <div class="authorize-card card">
    <img src={data.brandLogoUrl || '/logo.svg'} alt="" class="brand-logo" width="200" height="68" />

    {#if form?.done}
      <div class="outcome" role="status">
        <span class="outcome-icon" class:denied={!form.approved}><Icon name={form.approved ? 'check' : 'block'} size={22} /></span>
        <h1>{form.approved ? 'Connected' : 'Not connected'}</h1>
        <p>
          {#if form.approved}
            {form.clientName} can now use the mailboxes and permissions you chose. Returning you to the app…
          {:else}
            {form.clientName} was not given access. Returning you to the app…
          {/if}
        </p>
        <a class="btn btn-primary btn-block" href={form.redirectTo}>Return to the app</a>
        <p class="fine">You can close this window if nothing happens. Manage connections any time in <a href="/mail/connected-apps">Connected AI apps</a>.</p>
      </div>
    {:else if data.view === 'error'}
      <div class="outcome" role="alert">
        <span class="outcome-icon denied"><Icon name="warning" size={22} /></span>
        <h1>Can't connect this app</h1>
        <p>{data.message}</p>
        <a class="btn btn-block" href="/mail">Go to your mailbox</a>
      </div>
    {:else if data.view === 'signin'}
      <h1>Sign in to connect {data.clientName}</h1>
      <p class="lead">An AI app wants to use your {appName} mail. Sign in first, then you'll choose exactly what it may do.</p>
      <div class="providers">
        {#each data.authProviders as provider}
          <a href="/auth/login/{provider}" class="btn btn-block provider">
            Sign in with {provider === 'google' ? 'Google' : provider === 'microsoft' ? 'Microsoft' : provider}
          </a>
        {/each}
        {#if data.otpEnabled}
          <a href="/auth/email" class="btn btn-ghost btn-block">Sign in with an email code</a>
        {/if}
      </div>
      <p class="fine">Nothing is shared until you approve it on the next screen.</p>
    {:else if data.view === 'disabled'}
      <div class="outcome">
        <span class="outcome-icon denied"><Icon name="lock" size={22} /></span>
        <h1>AI app connections are off</h1>
        <p>Your organisation hasn't turned on AI agent (MCP) connections, so {data.clientName} can't be connected. A manager can turn this on in Management › Settings.</p>
        <form method="POST" action="?/decide">
          <input type="hidden" name="request_id" value={data.requestId} />
          <input type="hidden" name="decision" value="deny" />
          <button type="submit" class="btn btn-primary btn-block">Return to the app</button>
        </form>
      </div>
    {:else if data.view === 'consent'}
      <p class="eyebrow">Connect an AI app</p>
      <h1>Allow <span class="client-name">{data.client.name}</span> to use your mail?</h1>

      <dl class="client-facts">
        <div>
          <dt>App</dt>
          <dd>
            {#if data.client.verifiedHost}
              <span class="verified"><Icon name="shieldCheck" size={13} /> Identified by {data.client.verifiedHost}</span>
            {:else}
              <span class="unverified"><Icon name="info" size={13} /> Name supplied by the app and not verified</span>
            {/if}
          </dd>
        </div>
        <div><dt>Returns to</dt><dd>{data.returnTo}</dd></div>
        <div><dt>Signed in as</dt><dd>{data.userEmail}</dd></div>
      </dl>

      {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}

      <form method="POST" action="?/decide" class="consent-form">
        <input type="hidden" name="request_id" value={data.requestId} />

        <fieldset>
          <legend>What it may do</legend>
          {#each data.scopes as scope (scope.id)}
            <label class="choice" class:high={scope.risk === 'high'}>
              {#if scope.id === 'mail.send'}
                <input type="checkbox" name="scope" value={scope.id} bind:checked={sendScopeChecked} />
              {:else}
                <input type="checkbox" name="scope" value={scope.id} checked={scope.checked} />
              {/if}
              <span>
                <strong>{scope.label}{#if scope.risk === 'high'} <em class="risk">Off unless you turn it on</em>{/if}</strong>
                <small>{scope.detail}</small>
              </span>
            </label>
          {/each}
          {#if sendScopeChecked}
            <p class="send-warning" role="note"><Icon name="warning" size={14} /> The app will be able to send email as you without asking each time. Emails can't be unsent.</p>
          {/if}
        </fieldset>

        <fieldset>
          <legend>Which mailboxes</legend>
          {#if data.mailboxes.length === 0}
            <p class="fine">You don't have access to any active mailboxes.</p>
          {/if}
          {#each data.mailboxes as mailbox (mailbox.id)}
            <label class="choice">
              <input type="checkbox" name="mailbox" value={mailbox.id} checked={mailbox.checked} />
              <span>
                <strong>{mailbox.name || mailbox.address}</strong>
                <small>{mailbox.address} · {mailbox.type === 'shared' ? 'Shared' : 'Personal'} · {permissionLabels[mailbox.permission] || mailbox.permission}</small>
              </span>
            </label>
          {/each}
        </fieldset>

        <div class="safety">
          <Icon name="shieldCheck" size={16} />
          <p>The app sees only what you tick here, only while you still have access yourself. Email it reads is treated as untrusted. Every action is logged, and you can disconnect it any time in <strong>Connected AI apps</strong>.</p>
        </div>

        <div class="actions">
          <button type="submit" name="decision" value="deny" class="btn">Deny</button>
          <button type="submit" name="decision" value="approve" class="btn btn-primary">Allow</button>
        </div>
      </form>
    {/if}
  </div>
</main>

<style>
  .authorize-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; overflow-x: clip; }
  .authorize-card { width: 100%; max-width: min(520px, 100%); min-width: 0; padding: 28px; }
  .brand-logo { display: block; width: min(180px, 100%); height: auto; margin: 0 auto 18px; object-fit: contain; }
  h1 { margin: 0 0 8px; font-size: 21px; line-height: 1.3; overflow-wrap: anywhere; }
  .client-name { color: var(--primary-text, var(--primary)); }
  .eyebrow { margin: 0 0 4px; color: var(--primary-text); font-size: 13px; font-weight: 500; }
  .lead { margin: 0 0 18px; color: var(--text-muted); }
  .client-facts { display: grid; gap: 6px; margin: 14px 0 20px; padding: 0; font-size: 13px; }
  .client-facts div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; }
  .client-facts dt { color: var(--text-muted); }
  .client-facts dd { margin: 0; overflow-wrap: anywhere; }
  .verified, .unverified { display: inline-flex; align-items: center; gap: 5px; }
  .verified { color: var(--success-text); }
  .unverified { color: var(--warning-text); }
  fieldset { margin: 0 0 14px; padding: 0; border: 0; }
  legend { margin-bottom: 8px; font-size: 14px; font-weight: 650; }
  .choice { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 8px; margin-bottom: 2px; border: 0; border-radius: var(--radius-md); cursor: pointer; }
  .choice:hover { background: var(--bg-hover); }
  .choice input { margin-top: 3px; width: 16px; height: 16px; }
  .choice strong { display: block; font-size: 13.5px; }
  .choice small { display: block; margin-top: 2px; color: var(--text-muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  .risk { margin-left: 6px; padding: 1px 6px; border-radius: var(--radius-pill); background: var(--warning-soft); color: var(--warning-text); font-size: 10.5px; font-style: normal; font-weight: 600; }
  .send-warning { display: flex; gap: 6px; align-items: flex-start; margin: 4px 0 0; padding: 9px 11px; border-left: 3px solid var(--warning); background: var(--warning-soft); color: var(--warning-text); font-size: 12px; }
  .safety { display: flex; gap: 9px; margin: 4px 0 20px; padding: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
  .safety :global(svg) { flex: 0 0 auto; margin-top: 2px; color: var(--success); }
  .safety p { margin: 0; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; }
  .actions .btn { min-width: 110px; }
  .providers { display: grid; gap: 10px; margin-bottom: 14px; }
  .outcome { display: grid; gap: 10px; justify-items: center; text-align: center; }
  .outcome h1 { margin: 0; }
  .outcome p { margin: 0; color: var(--text-muted); }
  .outcome form { width: 100%; }
  .outcome-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--success-soft); color: var(--success); }
  .outcome-icon.denied { background: var(--warning-soft); color: var(--warning); }
  .fine { margin: 10px 0 0; color: var(--text-faint); font-size: 11.5px; text-align: center; }
  .notice { margin-bottom: 12px; padding: 8px 12px; border-radius: 0; }
  .notice-error { border: 0; border-left: 3px solid var(--danger); background: var(--danger-soft); color: var(--danger-text); }
  @media (max-width: 480px) {
    .authorize-page { padding: 12px; align-items: flex-start; }
    .authorize-card { padding: 20px 16px; }
    .client-facts div { grid-template-columns: 1fr; gap: 0; }
    .actions { flex-direction: column-reverse; }
    .actions .btn { width: 100%; }
  }
</style>
