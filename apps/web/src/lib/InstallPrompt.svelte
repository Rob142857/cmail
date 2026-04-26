<!--
  PWA install banner. Shows once per session — dismissed = gone until next session.
  Uses the beforeinstallprompt event (Chrome/Edge/Samsung) + a manual fallback hint for Safari.
-->
<script>
  import { browser } from '$app/environment';

  /** @type {any} */
  let deferredPrompt = $state(null);
  let dismissed = $state(false);
  let installed = $state(false);

  // Check if already in standalone mode (already installed)
  const isStandalone = browser && (window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone));

  // Session-dismiss key (sessionStorage so it resets each session)
  const DISMISS_KEY = 'cmail_pwa_dismissed';
  const wasDismissed = browser && sessionStorage.getItem(DISMISS_KEY) === '1';

  if (browser && !isStandalone && !wasDismissed) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });
    window.addEventListener('appinstalled', () => {
      installed = true;
      deferredPrompt = null;
    });
  }

  function dismiss() {
    dismissed = true;
    deferredPrompt = null;
    if (browser) sessionStorage.setItem(DISMISS_KEY, '1');
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installed = true;
    deferredPrompt = null;
  }

  const show = $derived(!isStandalone && !wasDismissed && !dismissed && !installed && deferredPrompt);
</script>

{#if show}
  <div class="pwa-banner" role="alert">
    <div class="pwa-content">
      <img src="/icon.svg" alt="" width="28" height="28" />
      <span>Install <strong>cmail</strong> for a better experience</span>
    </div>
    <div class="pwa-actions">
      <button class="pwa-install" onclick={install}>Install</button>
      <button class="pwa-close" onclick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  </div>
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
    padding: 12px 20px;
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
    padding: 6px 16px;
    background: var(--primary, #2563eb);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
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
</style>
