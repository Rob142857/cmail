<script>
  let {
    html = '',
    title = 'Email content',
    describedBy = undefined,
    allowRemoteImages = false,
    remoteImages = false,
    imageOrigin = '',
    allowLinks = false,
    compact = false,
  } = $props();

  // The caller can only loosen the image policy when it explicitly enables
  // remote images. This keeps previews and drafts locked to data: images.
  const remoteImagesEnabled = $derived(Boolean(allowRemoteImages && remoteImages));
  const safeImageOrigin = $derived.by(() => {
    try {
      const url = new URL(imageOrigin);
      const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return url.protocol === 'https:' || localDevelopment ? url.origin : '';
    } catch {
      return '';
    }
  });
  const imageSources = $derived(`data:${safeImageOrigin ? ` ${safeImageOrigin}` : ''}${remoteImagesEnabled ? ' https:' : ''}`);
  const frameCsp = $derived(`default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline'; font-src data:; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';`);
  const frameDocument = $derived(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><style>html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;line-height:1.5;color:#1f2937;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#2563eb}a[data-cmail-link-risk]{color:#9a3412;text-decoration:underline;text-decoration-style:wavy;text-underline-offset:2px}a[data-cmail-link-risk]::after{content:" \\26A0";font-size:.9em}blockquote{margin-left:8px;padding-left:8px;border-left:2px solid #d1d5db;color:#6b7280}hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0}</style></head><body>${html}</body></html>`);

  // Links open in a new tab (target=_blank, rel=noopener, set by the
  // sanitizer). Without allow-popups-to-escape-sandbox that tab inherits this
  // frame's sandbox, and sites with strict headers (Instagram, Facebook)
  // refuse to load in it (ERR_BLOCKED_BY_RESPONSE). The frame itself stays
  // script-free either way.
  // Full messages size the frame to their content so the page is the only
  // scroller. Reading contentDocument is possible because the sandbox grants
  // allow-same-origin WITHOUT allow-scripts, and the frame's own CSP is
  // default-src 'none' — the message can never run script, so same-origin
  // access flows strictly parent → frame. Compact previews keep a fixed box.
  let frameEl = $state(null);
  let measuredHeight = $state(0);
  let timers = [];

  /**
   * Newsletters are often laid out at a fixed 600px or more. On a phone the
   * frame is narrower and auto-sized frames don't scroll sideways, so the
   * right-hand side was simply cut off. Shrink the content to fit, as mail
   * apps do. Only the frame's own presentation changes: no script runs in
   * the frame and its CSP and sandbox are untouched.
   * @param {Document} doc
   */
  function fitWidth(doc) {
    const body = doc.body;
    if (!body || !frameEl) return;
    body.style.zoom = '';
    const available = frameEl.clientWidth;
    if (available <= 0) return;
    // The frame's own padding doesn't scale, so settle in a few passes.
    let zoom = 1;
    for (let pass = 0; pass < 4; pass += 1) {
      const needed = doc.documentElement.scrollWidth;
      if (needed <= available + 1) break;
      zoom = Math.max(0.4, Math.floor(zoom * ((available - 2) / needed) * 1000) / 1000);
      body.style.zoom = String(zoom);
      if (zoom === 0.4) break;
    }
  }

  function measure() {
    if (!frameEl || compact) return;
    try {
      const doc = frameEl.contentDocument;
      if (doc) fitWidth(doc);
      const h = Math.max(doc?.documentElement?.scrollHeight || 0, doc?.body?.scrollHeight || 0);
      if (h > 0) measuredHeight = h;
    } catch {
      measuredHeight = 0;
    }
  }

  function handleLoad() {
    measure();
    timers.forEach(clearTimeout);
    // Images inside the frame cannot signal the parent (no scripts), so
    // re-measure a little later to catch late layout shifts.
    timers = [setTimeout(measure, 250), setTimeout(measure, 1500)];
  }

  // The load listener is attached here rather than with an onload attribute:
  // Svelte's server render turns onload into an inline handler, which the
  // app's CSP (correctly) blocks, so a frame that finished loading before
  // hydration was never measured. A frame already showing its srcdoc is
  // measured straight away.
  $effect(() => {
    const frame = frameEl;
    if (!frame) return;
    frame.addEventListener('load', handleLoad);
    try {
      if (frame.contentDocument?.URL === 'about:srcdoc' && frame.contentDocument.readyState === 'complete') handleLoad();
    } catch {
      // Measuring is a nicety; the fixed-height frame still shows the message.
    }
    return () => frame.removeEventListener('load', handleLoad);
  });

  $effect(() => () => timers.forEach(clearTimeout));
</script>

<svelte:window onresize={measure} />

<iframe
  bind:this={frameEl}
  class:compact
  class:autosized={!compact && measuredHeight > 0}
  style={!compact && measuredHeight > 0 ? `height:${measuredHeight + 2}px` : ''}
  scrolling={!compact && measuredHeight > 0 ? 'no' : 'auto'}
  title={title}
  aria-describedby={describedBy}
  sandbox={allowLinks ? 'allow-same-origin allow-popups allow-popups-to-escape-sandbox' : 'allow-same-origin'}
  referrerpolicy="no-referrer"
  srcdoc={frameDocument}
></iframe>

<style>
  /* Mail HTML expects white: no frame in either theme; in dark mode the
     white sheet's own tone is its edge. */
  iframe { display:block; width:100%; min-height:360px; height:65vh; border:0; border-radius:var(--radius-md); background:#fff; }
  iframe.autosized { min-height:120px; height:auto; }
  iframe.compact { min-height:140px; height:280px; }

  @media (max-width:560px) {
    iframe { height:58vh; }
    iframe.autosized { height:auto; }
    iframe.compact { height:220px; }
  }
</style>
