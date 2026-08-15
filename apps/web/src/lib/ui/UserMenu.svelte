<!--
  UserMenu — the account callout in the suite header.

  Mirrors the Microsoft 365 account flyout: identity first, then the moves an
  operator actually needs. Sign-out stays a real POST form so it still works
  with JavaScript disabled.
-->
<script>
  import Icon from './Icon.svelte';
  import Persona from './Persona.svelte';
  import { stopPushBeforeSignOut } from '$lib/push-client';

  /**
   * @type {{
   *   user: { display_name?: string, email?: string, role?: string } | null,
   *   supportEmail?: string,
   *   isManager?: boolean,
   *   mode?: 'mail' | 'admin',
   * }}
   */
  let { user, supportEmail = '', isManager = false, mode = 'mail' } = $props();

  let open = $state(false);
  /** @type {HTMLDivElement | null} */
  let root = $state(null);
  /** @type {HTMLButtonElement | null} */
  let trigger = $state(null);
  let signingOut = $state(false);

  const name = $derived(user?.display_name || user?.email || 'Account');
  const roleLabel = $derived(user?.role === 'manager' ? 'Manager' : 'Standard user');

  /** @param {MouseEvent} event */
  function onDocumentClick(event) {
    if (!open || !root) return;
    if (!root.contains(/** @type {Node} */ (event.target))) open = false;
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key !== 'Escape' || !open) return;
    open = false;
    trigger?.focus();
  }

  /** @param {SubmitEvent} event */
  async function signOut(event) {
    event.preventDefault();
    if (signingOut) return;
    signingOut = true;
    await stopPushBeforeSignOut();
    /** @type {HTMLFormElement} */ (event.currentTarget).submit();
  }
</script>

<svelte:window onclick={onDocumentClick} onkeydown={onKeydown} />

<div class="um" bind:this={root}>
  <button
    type="button"
    class="user-chip"
    bind:this={trigger}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="um-name">{name}</span>
    <Persona name={user?.display_name} email={user?.email} size="sm" />
  </button>

  {#if open}
    <div class="um-pop" role="menu" aria-label="Account">
      <div class="um-head">
        <Persona name={user?.display_name} email={user?.email} size="lg" />
        <div class="um-id">
          <div class="um-id-name">{name}</div>
          <div class="um-id-mail">{user?.email}</div>
          <span class="badge {user?.role === 'manager' ? 'badge-info' : ''} um-role">{roleLabel}</span>
        </div>
      </div>

      <div class="um-sep"></div>

      <nav class="um-list">
        {#if mode === 'admin'}
          <a href="/mail" class="um-item" role="menuitem"><Icon name="mail" /> Go to mailbox</a>
        {:else if isManager}
          <a href="/admin" class="um-item" role="menuitem"><Icon name="shieldCheck" /> Management centre</a>
        {/if}
        <a href="/help" class="um-item" role="menuitem"><Icon name="help" /> Help centre</a>
        <a href="/policy" class="um-item" role="menuitem"><Icon name="clipboard" /> Usage policy</a>
        {#if supportEmail}
          <a href="mailto:{supportEmail}" class="um-item" role="menuitem"><Icon name="send" /> Contact support</a>
        {/if}
      </nav>

      <div class="um-sep"></div>

      <form method="POST" action="/auth/logout" onsubmit={signOut}>
        <button type="submit" class="um-item um-item-btn" role="menuitem" disabled={signingOut}>
          <Icon name="signOut" /> {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </form>
    </div>
  {/if}
</div>

<style>
  .um { position: relative; display: inline-flex; }
  .um-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .um-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 120;
    width: 300px;
    padding: 6px;
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-64);
    animation: um-in var(--dur-slow) var(--ease-out);
  }
  @keyframes um-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

  .um-head { display: flex; gap: 12px; align-items: flex-start; padding: 12px 12px 10px; }
  .um-id { min-width: 0; }
  .um-id-name { font-weight: 600; font-size: var(--fs-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .um-id-mail { font-size: var(--fs-caption); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .um-role { margin-top: 6px; }

  .um-sep { height: 1px; background: var(--border); margin: 4px 6px; }

  .um-list { display: flex; flex-direction: column; }
  .um-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    border-radius: var(--radius);
    color: var(--text);
    font-size: var(--fs-body);
    text-decoration: none;
  }
  .um-item:hover { background: var(--bg-hover); text-decoration: none; color: var(--text); }
  .um-item :global(svg) { color: var(--text-muted); }

  .um-item-btn {
    width: 100%;
    justify-content: flex-start;
    border: none;
    background: transparent;
    font-weight: 400;
    min-height: 36px;
  }

  @media (max-width: 520px) {
    .um-name { display: none; }
    .um-pop { width: min(300px, calc(100vw - 24px)); }
  }
</style>
