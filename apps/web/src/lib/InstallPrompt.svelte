<!--
  PWA install banner. Shows once per session — dismissed = gone until next session.
  Uses the beforeinstallprompt event (Chrome/Edge/Samsung) + a manual fallback hint for Safari.
-->
<script>
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  /** @type {any} */
  let deferredPrompt = $state(null);
  let dismissed = $state(false);
  let installed = $state(false);
  let wasDismissed = $state(false);

  // Check if already in standalone mode (already installed)
  const isStandalone = Boolean(browser && (window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone)));
  const isIos = Boolean(browser && (
    /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ));
  const isIosSafari = Boolean(browser && isIos
    && /Safari/i.test(navigator.userAgent)
    && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(navigator.userAgent));

  // Session-dismiss key (sessionStorage so it resets each session)
  const DISMISS_KEY = 'cmail_pwa_dismissed';
  onMount(() => {
    try {
      wasDismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Installation remains available when storage is blocked.
    }
    if (isStandalone || wasDismissed) return;
    const beforeInstall = (e) => {
      e.preventDefault();
      deferredPrompt = e;
    };
    const appInstalled = () => {
      installed = true;
      deferredPrompt = null;
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', appInstalled);
    };
  });

  function dismiss() {
    dismissed = true;
    deferredPrompt = null;
    if (browser) {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* non-essential */ }
    }
  }

  async function install() {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') installed = true;
    } catch {
      // Browser-owned prompts can disappear when another install UI wins.
    }
  }

  const show = $derived(!isStandalone && !wasDismissed && !dismissed && !installed && (deferredPrompt || isIosSafari));
</script>

{#if show}
  <section class="pwa-banner" aria-label="Install application" aria-live="polite">
    <div class="pwa-content">
      <img src={page.data?.brandIconUrl || '/icon.svg'} alt="" width="28" height="28" />
      <span>
        {#if isIosSafari}
          Install <strong>{page.data?.appName || 'cmail'}</strong>: Share → Add to Home Screen → Open as Web App
        {:else}
          Install <strong>{page.data?.appName || 'cmail'}</strong> for quicker access
        {/if}
      </span>
    </div>
    <div class="pwa-actions">
      {#if isIosSafari}
        <a class="pwa-install" href="/help/mobile">View steps</a>
      {:else}
        <button class="pwa-install" onclick={install}>Install</button>
      {/if}
      <button class="pwa-close" onclick={dismiss} aria-label="Dismiss install suggestion">✕</button>
    </div>
  </section>
{/if}

<style>
  .pwa-banner {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px max(20px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
    background: var(--bg-surface, #fff);
    border-top: 1px solid var(--border, #e5e7eb);
    box-shadow: 0 -2px 12px rgba(0,0,0,0.08);
    font-size: 14px;
  }
  .pwa-content {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pwa-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .pwa-install {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 16px;
    background: var(--primary, #2563eb);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .pwa-install:hover {
    background: var(--primary-hover, #1d4ed8);
  }
  .pwa-close {
    background: transparent;
    border: none;
    color: var(--text-muted, #6b7280);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    line-height: 1;
  }
  @media (max-width: 520px) {
    .pwa-banner { align-items: flex-start; padding-inline: 12px; }
    .pwa-content { min-width: 0; }
    .pwa-content span { line-height: 1.35; }
  }
</style>
