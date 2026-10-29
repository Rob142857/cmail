<script lang="ts">
  import { page } from '$app/state';

  const guides = [
    { href: '/help/mobile', eyebrow: 'Devices', title: 'Mobile access', description: 'Install the app on iPhone, iPad or Android.' },
    { href: '/help/getting-started', eyebrow: 'Everyone', title: 'Use your mailbox', description: 'Sign in, choose a mailbox, compose, and manage folders.' },
    { href: '/help/shared-mailboxes', eyebrow: 'Delegates', title: 'Work from a shared address', description: 'Shared state, From identity, and access levels for team mail.' },
    { href: '/help/managers', eyebrow: 'Managers', title: 'Operate the organisation', description: 'Workflows for people, mailboxes, delegation, mail trace, and policy.' },
    { href: '/help/support', eyebrow: 'Support', title: 'Triage and escalate safely', description: 'Internal support, safe evidence, and when to escalate.' },
    { href: '/help/standards', eyebrow: 'Assurance', title: 'Standards & assurance', description: 'Capabilities, responsibilities, and a candid gap register.' },
  ];
</script>

<section class="help-home">
  <header>
    <p class="eyebrow">{page.data?.appName || 'cmail'} help</p>
    <h1>What do you need to do?</h1>
    <p>Guidance for everyday mail and administration.</p>
  </header>

  <div class="guide-grid">
    {#each guides as guide}
      <a href={guide.href} class="guide-card">
        <span>{guide.eyebrow}</span>
        <h2>{guide.title}</h2>
        <p>{guide.description}</p>
        <strong>Open guide <span aria-hidden="true">→</span></strong>
      </a>
    {/each}
  </div>

  <aside class="privacy-note">
    <div>
      <strong>Sign-in verifies identity only.</strong>
      <p>{page.data?.appName || 'cmail'} cannot read your personal Google or Microsoft inbox, drive, contacts, or search history — only mailboxes assigned here.</p>
    </div>
    {#if page.data?.supportEmail}<a class="btn" href={`mailto:${page.data.supportEmail}`}>Contact support</a>{/if}
  </aside>
</section>

<style>
  .help-home { display: grid; gap: 34px; }
  header { max-width: 700px; }
  .eyebrow, .guide-card > span { margin: 0 0 6px; color: var(--primary-text); font-size: 13px; font-weight: 500; letter-spacing: 0; text-transform: none; }
  h1 { margin: 0; font-size: clamp(26px, 5vw, 32px); font-weight: 600; letter-spacing: -.02em; }
  header > p:last-child { margin-top: 12px; color: var(--text-muted); font-size: 17px; line-height: 1.65; }
  .guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 40px; }
  .guide-card { display: flex; flex-direction: column; padding: 0; border: 1px solid transparent; color: var(--text); text-decoration: none; }
  .guide-card:hover { text-decoration: none; }
  .guide-card:hover h2, .guide-card:hover > strong { text-decoration: underline; text-underline-offset: 3px; }
  .guide-card h2 { margin: 16px 0 6px; font-size: 18px; font-weight: 600; }
  .guide-card p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
  .guide-card > strong { margin-top: auto; padding-top: 14px; color: var(--primary-text); font-size: 13px; }
  .privacy-note { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 8px 0 0; }
  .privacy-note p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
  @media (max-width: 680px) {
    .guide-grid { grid-template-columns: 1fr; }
    .guide-card { min-height: 0; }
    .privacy-note { grid-template-columns: 1fr; }
    .privacy-note .btn { justify-self: start; }
  }
</style>
