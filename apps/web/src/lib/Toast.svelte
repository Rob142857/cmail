<script>
  let {
    message = '',
    tone = 'success',
    duration = 3200,
    onDismiss = () => {},
  } = $props();

  let visible = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  function dismiss() {
    visible = false;
    onDismiss();
  }

  $effect(() => {
    void message;
    if (timer) clearTimeout(timer);
    visible = Boolean(message);
    if (message && duration > 0) timer = setTimeout(dismiss, duration);
    return () => { if (timer) clearTimeout(timer); };
  });
</script>

{#if visible && message}
  <div class="toast toast-{tone}" role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
    <span class="toast-icon" aria-hidden="true">{tone === 'error' ? '!' : '✓'}</span>
    <span>{message}</span>
    <button type="button" class="toast-dismiss" onclick={dismiss} aria-label="Dismiss">×</button>
  </div>
{/if}

<style>
  .toast {
    position:fixed;
    right:max(20px, env(safe-area-inset-right));
    bottom:max(20px, env(safe-area-inset-bottom));
    z-index:1000;
    display:flex;
    align-items:center;
    gap:9px;
    max-width:min(420px, calc(100vw - 32px));
    padding:11px 12px;
    border:1px solid var(--border-strong);
    border-radius:var(--radius);
    background:var(--bg-surface);
    color:var(--text);
    box-shadow:var(--shadow-lg);
    font-size:13px;
    animation:toast-enter 140ms ease-out;
  }
  .toast-icon { display:grid; place-items:center; width:20px; height:20px; flex:0 0 auto; border-radius:999px; background:var(--success-soft); color:var(--success); font-weight:700; }
  .toast-error .toast-icon { background:var(--danger-soft); color:var(--danger); }
  .toast-warning .toast-icon { background:var(--warning-soft); color:var(--warning); }
  .toast-dismiss { width:28px; min-height:28px; margin-left:4px; padding:0; border:0; background:transparent; color:var(--text-muted); font-size:20px; line-height:1; }
  @keyframes toast-enter { from { opacity:0; transform:translateY(8px); } }

  @media (max-width:560px) {
    .toast { right:16px; left:16px; bottom:max(16px, env(safe-area-inset-bottom)); max-width:none; }
  }
</style>
