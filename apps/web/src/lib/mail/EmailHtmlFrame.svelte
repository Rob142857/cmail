<script>
  let {
    html = '',
    title = 'Email content',
    describedBy = undefined,
    allowRemoteImages = false,
    remoteImages = false,
    allowLinks = false,
    compact = false,
  } = $props();

  // The caller can only loosen the image policy when it explicitly enables
  // remote images. This keeps previews and drafts locked to data: images.
  const remoteImagesEnabled = $derived(Boolean(allowRemoteImages && remoteImages));
  const frameCsp = $derived(remoteImagesEnabled
    ? "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';");
  const frameDocument = $derived(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><style>html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;line-height:1.5;color:#1f2937;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#2563eb}blockquote{margin-left:8px;padding-left:8px;border-left:2px solid #d1d5db;color:#6b7280}hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0}</style></head><body>${html}</body></html>`);
</script>

<iframe
  class:compact
  title={title}
  aria-describedby={describedBy}
  sandbox={allowLinks ? 'allow-popups' : ''}
  referrerpolicy="no-referrer"
  srcdoc={frameDocument}
></iframe>

<style>
  iframe { display:block; width:100%; min-height:360px; height:65vh; border:1px solid var(--border); border-radius:var(--radius); background:#fff; }
  iframe.compact { min-height:140px; height:280px; }

  @media (max-width:560px) {
    iframe { height:58vh; }
    iframe.compact { height:220px; }
  }
</style>
