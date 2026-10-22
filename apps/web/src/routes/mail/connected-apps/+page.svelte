<script lang="ts">
  import Icon from '#lib/ui/Icon.svelte';

  let { data, form } = $props();

  const reasonLabels: Record<string, string> = {
    user: 'Disconnected by you',
    admin: 'Disconnected by a manager',
    admin_all: 'All AI apps were disconnected by a manager',
    replaced: 'Replaced when you connected it again',
    refresh_reuse: 'Stopped automatically: a sign-in token was reused, which can mean it was copied',
    code_reuse: 'Stopped automatically: a sign-in code was reused',
    offboarded: 'Account offboarded',
    paused: 'Account paused',
    client_revocation: 'Disconnected by the app',
  };

  function when(value: string | null): string {
    if (!value) return 'Never';
    return new Date(value).toLocaleString(data.locale || undefined, {
      timeZone: data.timeZone || undefined,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  const active = $derived(data.apps.filter((app) => app.status === 'active'));
  const inactive = $derived(data.apps.filter((app) => app.status !== 'active'));
</script>

<svelte:head><title>Connected AI apps · {data.appName || 'cmail'}</title></svelte:head>

<section class="apps-page" aria-labelledby="apps-heading">
  <header class="page-header">
    <p class="eyebrow">Mail settings</p>
    <h1 id="apps-heading">Connected AI apps</h1>
    <p>AI assistants such as Claude can work with your mail through the Model Context Protocol (MCP), only with the mailboxes and permissions you approved.</p>
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  {#if !data.enabled}
    <div class="callout" role="status">
      <Icon name="lock" size={16} />
      <p><strong>AI app connections are turned off for your organisation.</strong> Existing connections can't be used until a manager turns them on in Management › Settings. You can still disconnect apps here.</p>
    </div>
  {:else if data.mcpUrl}
    <div class="callout connect">
      <Icon name="info" size={16} />
      <div>
        <p><strong>To connect an app</strong>, add this server address in the app's connector or MCP settings, then approve it in the sign-in window that opens:</p>
        <code>{data.mcpUrl}</code>
      </div>
    </div>
  {/if}

  {#if active.length === 0}
    <div class="card empty">
      <Icon name="shieldCheck" size={22} />
      <h2>No AI apps connected</h2>
      <p>When you approve an app, it appears here with exactly what it can do.</p>
    </div>
  {/if}

  {#each active as app (app.id)}
    <article class="card app">
      <div class="app-head">
        <div>
          <h2>{app.clientName}</h2>
          <p class="meta">
            {#if app.verifiedHost}<span class="verified"><Icon name="shieldCheck" size={12} /> {app.verifiedHost}</span>{:else}<span class="unverified">Name not verified</span>{/if}
            · Connected {when(app.createdAt)} · Last used {when(app.lastUsedAt)}
          </p>
        </div>
        <form method="POST" action="?/revoke">
          <input type="hidden" name="grant_id" value={app.id} />
          <button type="submit" class="btn btn-outline-danger btn-sm">Disconnect</button>
        </form>
      </div>
      <dl class="facts">
        <div><dt>Can</dt><dd>{#each app.scopes as scope}<span class="chip" class:send={scope.id === 'mail.send'}>{scope.label}</span>{/each}</dd></div>
        <div><dt>Mailboxes</dt><dd>{app.mailboxes.length ? app.mailboxes.join(', ') : 'None available'}</dd></div>
        <div><dt>Expires</dt><dd>{when(app.expiresAt)} (reconnect after this)</dd></div>
      </dl>
      {#if app.recentCalls.length}
        <details>
          <summary>Recent activity</summary>
          <ul class="calls">
            {#each app.recentCalls as call}
              <li><span>{call.tool}</span><span class="result result-{call.result}">{call.result}</span><time>{when(call.at)}</time></li>
            {/each}
          </ul>
        </details>
      {/if}
    </article>
  {/each}

  {#if inactive.length}
    <h2 class="section-title">Disconnected</h2>
    {#each inactive as app (app.id)}
      <article class="card app inactive">
        <h3>{app.clientName}</h3>
        <p class="meta">{app.status === 'expired' ? 'Expired' : reasonLabels[app.revokedReason || ''] || 'Disconnected'} · Connected {when(app.createdAt)}</p>
      </article>
    {/each}
  {/if}
</section>

<style>
  .apps-page { display: grid; gap: 14px; max-width: 880px; margin: 0 auto; }
  .page-header h1 { margin: 3px 0 5px; font-size: var(--fs-title-2); }
  .page-header > p:last-child { margin: 0; color: var(--text-muted); font-size: 13px; max-width: 700px; }
  .eyebrow { margin: 0; color: var(--primary-text); font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .notice { padding: 10px 12px; border-radius: var(--radius); }
  .notice-error { border: 1px solid var(--danger-border); background: var(--danger-soft); color: var(--danger-text); }
  .notice-success { border: 1px solid var(--success-border); background: var(--success-soft); color: var(--success-text); }
  .callout { display: flex; gap: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-subtle); font-size: 13px; }
  .callout :global(svg) { flex: 0 0 auto; margin-top: 2px; color: var(--primary-text); }
  .callout p { margin: 0; }
  .callout code { display: inline-block; margin-top: 6px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-surface); font-size: 12.5px; overflow-wrap: anywhere; user-select: all; }
  .empty { display: grid; justify-items: center; gap: 6px; padding: 32px 20px; text-align: center; }
  .empty :global(svg) { color: var(--success); }
  .empty h2 { margin: 0; font-size: var(--fs-subtitle); }
  .empty p { margin: 0; color: var(--text-muted); font-size: 13px; }
  .app { padding: 16px 18px; }
  .app-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
  .app h2, .app h3 { margin: 0; font-size: var(--fs-subtitle); overflow-wrap: anywhere; }
  .meta { margin: 3px 0 0; color: var(--text-muted); font-size: 12px; }
  .verified { color: var(--success-text); display: inline-flex; gap: 4px; align-items: center; }
  .unverified { color: var(--warning-text); }
  .facts { display: grid; gap: 6px; margin: 12px 0 0; font-size: 13px; }
  .facts div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 8px; }
  .facts dt { color: var(--text-muted); }
  .facts dd { margin: 0; display: flex; flex-wrap: wrap; gap: 5px; overflow-wrap: anywhere; }
  .chip { padding: 1px 8px; border-radius: var(--radius-pill); background: var(--primary-soft); color: var(--primary-text); font-size: 11.5px; }
  .chip.send { background: var(--warning-soft); color: var(--warning-text); }
  details { margin-top: 10px; font-size: 12.5px; }
  summary { cursor: pointer; color: var(--text-muted); }
  .calls { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .calls li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; }
  .calls time { color: var(--text-faint); }
  .result { font-weight: 600; }
  .result-ok { color: var(--success-text); }
  .result-denied, .result-rate_limited, .result-invalid { color: var(--warning-text); }
  .result-error { color: var(--danger-text); }
  .section-title { margin: 8px 0 0; font-size: 14px; color: var(--text-muted); }
  .inactive { opacity: .8; }
  @media (max-width: 600px) {
    .app-head { flex-direction: column; }
    .facts div { grid-template-columns: 1fr; gap: 2px; }
    .calls li { grid-template-columns: 1fr auto; }
    .calls time { grid-column: 1 / -1; }
  }
</style>
