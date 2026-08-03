<script lang="ts">
  import { onMount } from 'svelte';

  let {
    appName = 'cmail',
    orgName = '',
    userId,
    isManager = false,
  } = $props<{
    appName?: string;
    orgName?: string;
    userId: string;
    isManager?: boolean;
  }>();

  let welcomeDialog: HTMLDialogElement | null = $state(null);
  const welcomeKey = $derived(`cmail:welcome:v1:${userId}`);

  onMount(() => {
    if (!userId || localStorage.getItem(welcomeKey) === 'complete') return;
    requestAnimationFrame(() => {
      if (welcomeDialog && !welcomeDialog.open) welcomeDialog.showModal();
    });
  });

  function rememberWelcome(): void {
    localStorage.setItem(welcomeKey, 'complete');
  }

  function closeWelcome(): void {
    rememberWelcome();
    welcomeDialog?.close();
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    closeWelcome();
  }
</script>

<dialog bind:this={welcomeDialog} class="welcome-dialog" aria-labelledby="welcome-title" oncancel={handleCancel}>
  <div class="welcome-accent" aria-hidden="true"></div>
  <div class="welcome-body">
    <p class="eyebrow">Welcome</p>
    <h2 id="welcome-title">Your mail is ready in {appName}</h2>
    <p class="welcome-copy">
      {orgName ? `${orgName} uses` : 'Your organisation uses'} personal and shared mailboxes with familiar,
      Exchange-style delegation and a privacy-first web experience.
    </p>

    <ol class="welcome-steps">
      <li>
        <span aria-hidden="true">1</span>
        <div><strong>Choose a mailbox</strong><p>Personal and shared mailboxes appear separately in the navigation.</p></div>
      </li>
      <li>
        <span aria-hidden="true">2</span>
        <div><strong>Check the From address</strong><p>Compose and reply only offer addresses you are authorised to use.</p></div>
      </li>
      <li>
        <span aria-hidden="true">3</span>
        <div><strong>Set up this device</strong><p>Install the web app and, when offered, opt in to privacy-minimised new-mail alerts.</p></div>
      </li>
    </ol>

    {#if isManager}
      <aside class="manager-note">
        <strong>You have the Manager role.</strong>
        <span>The Management centre includes setup checks, people, shared mailbox delegation, mail trace, policy, audit, and organisation controls.</span>
        <a href="/help/managers" onclick={rememberWelcome}>Open the manager handbook</a>
      </aside>
    {/if}

    <div class="welcome-actions">
      <a class="btn" href="/help/getting-started" onclick={rememberWelcome}>Read the user guide</a>
      <button type="button" class="btn btn-primary" onclick={closeWelcome}>Go to my mail</button>
    </div>
  </div>
</dialog>

<style>
  .welcome-dialog {
    width: min(620px, calc(100% - 28px));
    max-height: min(820px, calc(100dvh - 28px));
    padding: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-surface);
    color: var(--text);
    box-shadow: 0 28px 80px rgba(15, 23, 42, .32);
  }
  .welcome-dialog::backdrop {
    background: rgba(15, 23, 42, .62);
    backdrop-filter: blur(4px);
  }
  .welcome-accent { height: 6px; background: var(--primary); }
  .welcome-body { padding: clamp(22px, 5vw, 38px); }
  .eyebrow { margin: 0 0 5px; color: var(--primary); font-size: 11px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
  h2 { margin: 0; font-size: clamp(24px, 5vw, 32px); }
  .welcome-copy { margin: 10px 0 0; color: var(--text-muted); line-height: 1.6; }
  .welcome-steps { display: grid; gap: 13px; margin: 24px 0; padding: 0; list-style: none; }
  .welcome-steps li { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; align-items: start; }
  .welcome-steps li > span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--primary-soft);
    color: var(--primary);
    font-size: 12px;
    font-weight: 750;
  }
  .welcome-steps strong { display: block; font-size: 14px; }
  .welcome-steps p { margin: 2px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; }
  .manager-note { display: grid; gap: 4px; padding: 14px 15px; border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border)); border-radius: 10px; background: var(--primary-soft); }
  .manager-note strong { font-size: 13px; }
  .manager-note span { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
  .manager-note a { margin-top: 3px; font-size: 12px; font-weight: 650; }
  .welcome-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; }
  @media (max-width: 520px) {
    .welcome-dialog { width: calc(100% - 20px); max-height: calc(100dvh - 20px); }
    .welcome-actions { align-items: stretch; flex-direction: column-reverse; }
    .welcome-actions .btn { width: 100%; }
  }
</style>
