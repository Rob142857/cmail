<script lang="ts">
  type ReadinessItem = {
    label: string;
    detail: string;
    ready: boolean;
    optional?: boolean;
    href: string;
    action: string;
  };

  let { data } = $props();

  const checks = $derived.by<ReadinessItem[]>(() => data.readiness ? [
    {
      label: 'Mailbox domain',
      detail: data.readiness.mailDomain || 'Set MAIL_DOMAIN in deployment settings.',
      ready: Boolean(data.readiness.mailDomain),
      href: '/admin/settings',
      action: 'Review settings',
    },
    {
      label: 'Public application URL',
      detail: data.readiness.appUrl || 'Set APP_URL for sign-in links and invitations.',
      ready: Boolean(data.readiness.appUrl),
      href: '/admin/settings',
      action: 'Review settings',
    },
    {
      label: 'Authentication provider',
      detail: data.readiness.authProviders.length
        ? data.readiness.authProviders.map((provider: string) => provider === 'microsoft' ? 'Microsoft Entra ID' : 'Google').join(' and ')
        : 'Turn on Google or Microsoft sign-in in deployment settings.',
      ready: data.readiness.authProviders.length > 0,
      href: '/admin/settings',
      action: 'Review setup',
    },
    {
      label: 'Session protection',
      detail: data.readiness.sessionSecretReady
        ? 'Session secret is strong.'
        : 'Set SESSION_SECRET to a random value of 32+ characters.',
      ready: data.readiness.sessionSecretReady,
      href: '/admin/settings',
      action: 'Review guidance',
    },
    {
      label: 'System sender',
      detail: data.readiness.systemEmail || 'Set a verified sender for invitations and system mail.',
      ready: Boolean(data.readiness.systemEmail),
      href: '/admin/settings',
      action: 'Configure sender',
    },
    {
      label: 'Message storage',
      detail: data.readiness.storageReady
        ? 'Storage is connected for messages and attachments.'
        : 'Connect the R2 storage bucket before accepting mail.',
      ready: data.readiness.storageReady,
      href: '/admin/settings',
      action: 'Review setup',
    },
    {
      label: 'External delivery',
      detail: data.readiness.outboundProvider === 'none'
        ? 'No provider set; mail only sends between cmail mailboxes.'
        : `${data.readiness.outboundLabel} is selected.`,
      ready: data.readiness.outboundProvider !== 'none',
      optional: true,
      href: '/admin/settings',
      action: 'Review setup',
    },
    {
      label: 'Usage policy',
      detail: data.readiness.policyPublished
        ? 'A policy is published and acceptance is required.'
        : 'Optional: publish a policy before inviting users.',
      ready: data.readiness.policyPublished,
      optional: true,
      href: '/admin/policy',
      action: 'Manage policy',
    },
  ] : []);

  const requiredChecks = $derived(checks.filter((item) => !item.optional));
  const readyRequired = $derived(requiredChecks.filter((item) => item.ready).length);
</script>

<section class="overview">
  <header class="page-heading">
    <div>
      <p class="eyebrow">Workspace</p>
      <h1>Management overview</h1>
      <p>Manage people, mail, organisation structure, and governance in one place.</p>
    </div>
    <div class="quick-actions" aria-label="Quick actions">
      <a class="btn btn-primary" href="/admin/users">Add person</a>
      <a class="btn" href="/admin/mailboxes">Add mailbox</a>
      <a class="btn" href="/admin/orgchart">Build organisation</a>
    </div>
  </header>

  {#if data.stats && data.readiness}
    <div class:ready={readyRequired === requiredChecks.length} class="readiness-summary">
      <span class="summary-mark" aria-hidden="true"></span>
      <div>
        <strong>{readyRequired === requiredChecks.length ? 'Core configuration is ready' : `${readyRequired} of ${requiredChecks.length} core checks complete`}</strong>
        <span>{readyRequired === requiredChecks.length ? 'Test mail flow before going live.' : 'Finish setup before inviting people.'}</span>
      </div>
    </div>

    <section aria-labelledby="activity-heading">
      <div class="section-heading">
        <div><p class="eyebrow">Activity</p><h2 id="activity-heading">At a glance</h2></div>
        <span>Last 24 hours where noted</span>
      </div>
      <div class="stat-grid">
        <article><strong>{data.stats.users}</strong><span>People</span><small>All account states</small></article>
        <article><strong>{data.stats.mailboxes}</strong><span>Active mailboxes</span><small>{data.stats.sharedMailboxes} shared</small></article>
        <article><strong>{data.stats.recentMessages}</strong><span>Recent messages</span><small>{data.stats.messages} stored total</small></article>
        <article><strong>{data.stats.activeSessions}</strong><span>Active sessions</span><small>Not expired or revoked</small></article>
      </div>
    </section>

    <section aria-labelledby="readiness-heading">
      <div class="section-heading">
        <div><p class="eyebrow">Configuration</p><h2 id="readiness-heading">Setup checklist</h2></div>
        <a href="/admin/settings">Open settings</a>
      </div>
      <div class="check-list">
        {#each checks as item (item.label)}
          <article>
            <span class:ok={item.ready} class:optional={item.optional && !item.ready} class="status-dot" aria-hidden="true"></span>
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <span class:configured={item.ready} class:optional={item.optional && !item.ready} class="status-label">
              {item.ready ? 'Configured' : item.optional ? 'Optional' : 'Action needed'}
            </span>
            <a href={item.href}>{item.action}</a>
          </article>
        {/each}
      </div>
    </section>

    <section aria-labelledby="directory-heading">
      <div class="section-heading">
        <div><p class="eyebrow">Organisation</p><h2 id="directory-heading">Directory privacy</h2></div>
        <a href="/admin/orgchart">Manage organisation</a>
      </div>
      <div class="privacy-card">
        <span class:enabled={data.readiness.directoryEnabled} class="privacy-icon" aria-hidden="true"></span>
        <div>
          <strong>{data.readiness.directoryEnabled ? 'Public directory is enabled' : 'Public directory is off'}</strong>
          <p>Only positions marked Public appear there, showing just name, work email, and title.</p>
        </div>
        <a class="btn" href="/admin/orgchart">Review visibility</a>
      </div>
    </section>
  {:else}
    <div class="empty" role="alert">
      <h2>Management data is unavailable</h2>
      <p>Check the Cloudflare bindings and run pending D1 migrations.</p>
      <a class="btn" href="/admin">Try again</a>
    </div>
  {/if}
</section>

<style>
  .overview { display: grid; gap: 30px; max-width: 1280px; }
  .page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .page-heading h1 { margin: 2px 0 7px; font-size: clamp(25px, 3vw, 34px); }
  .page-heading p:not(.eyebrow) { max-width: 680px; color: var(--text-muted); }
  .eyebrow { margin: 0; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .quick-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .readiness-summary { display: flex; align-items: center; gap: 13px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--warning) 36%, var(--border)); border-radius: 10px; background: var(--warning-soft); }
  .readiness-summary.ready { border-color: color-mix(in srgb, var(--success) 32%, var(--border)); background: var(--success-soft); }
  .summary-mark { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; background: var(--warning); box-shadow: 0 0 0 4px color-mix(in srgb, var(--warning) 16%, transparent); }
  .ready .summary-mark { background: var(--success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 16%, transparent); }
  .readiness-summary div { display: flex; flex-direction: column; gap: 2px; }
  .readiness-summary span:last-child { color: var(--text-muted); font-size: 13px; }
  .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
  .section-heading h2 { margin-top: 2px; font-size: 20px; }
  .section-heading > span, .section-heading > a { color: var(--text-muted); font-size: 12px; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg-surface); }
  .stat-grid article { display: flex; min-width: 0; flex-direction: column; padding: 18px; border-right: 1px solid var(--border); }
  .stat-grid article:last-child { border-right: 0; }
  .stat-grid strong { font-size: 28px; font-variant-numeric: tabular-nums; }
  .stat-grid span { margin-top: 2px; font-size: 14px; font-weight: 600; }
  .stat-grid small { margin-top: 2px; overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .check-list { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg-surface); }
  .check-list article { display: grid; grid-template-columns: 12px minmax(180px, 1fr) auto 128px; align-items: center; gap: 13px; min-height: 70px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .check-list article:last-child { border-bottom: 0; }
  .check-list p { margin-top: 2px; color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
  .check-list article > a { justify-self: end; font-size: 12px; font-weight: 600; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .status-dot.ok { background: var(--success); }
  .status-dot.optional { background: var(--warning); }
  .status-label { padding: 3px 8px; border: 1px solid color-mix(in srgb, var(--danger) 50%, var(--border)); border-radius: 999px; background: var(--danger-soft); color: var(--text); font-size: 10px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; }
  .status-label.configured { border-color: color-mix(in srgb, var(--success) 50%, var(--border)); background: var(--success-soft); }
  .status-label.optional { border-color: color-mix(in srgb, var(--warning) 50%, var(--border)); background: var(--warning-soft); }
  .privacy-card { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 15px; padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-surface); }
  .privacy-icon { width: 30px; height: 30px; border: 1px solid var(--border-strong); border-radius: 50%; background: var(--bg-hover); }
  .privacy-icon.enabled { border-color: var(--success); background: var(--success-soft); box-shadow: inset 0 0 0 9px var(--success); }
  .privacy-card p { margin-top: 4px; max-width: 780px; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
  .empty { padding: 48px 24px; border: 1px dashed var(--border-strong); border-radius: 12px; text-align: center; }
  .empty p { margin-top: 6px; color: var(--text-muted); }
  .empty .btn { margin-top: 16px; }
  @media (max-width: 900px) {
    .page-heading { flex-direction: column; }
    .quick-actions { justify-content: flex-start; }
    .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .stat-grid article:nth-child(2) { border-right: 0; }
    .stat-grid article:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
    .check-list article { grid-template-columns: 12px minmax(0, 1fr) auto; }
    .check-list article > a { grid-column: 2 / -1; justify-self: start; }
  }
  @media (max-width: 560px) {
    .overview { gap: 24px; }
    .stat-grid { grid-template-columns: 1fr; }
    .stat-grid article { border-right: 0; border-bottom: 1px solid var(--border); }
    .stat-grid article:last-child { border-bottom: 0; }
    .section-heading { align-items: flex-start; flex-direction: column; gap: 4px; }
    .check-list article { grid-template-columns: 10px minmax(0, 1fr); align-items: start; }
    .status-label { grid-column: 2; justify-self: start; }
    .check-list article > a { grid-column: 2; }
    .privacy-card { grid-template-columns: 30px minmax(0, 1fr); align-items: start; }
    .privacy-card .btn { grid-column: 1 / -1; }
  }
</style>
