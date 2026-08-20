/**
 * Wraps a sanitised signature fragment in a complete srcdoc document pinned to
 * the light scheme.
 *
 * A bare fragment in an iframe inherits the embedder's color-scheme in
 * Chromium, so in dark mode the iframe canvas is painted dark while the
 * signature keeps inline colours chosen for white email paper — unreadable
 * dark-on-dark. Recipients read email on a white canvas, so previews must
 * render on one too, in both app themes. The reading pane's EmailHtmlFrame
 * already does exactly this for message bodies.
 */
export function signaturePreviewDocument(fragment: string): string {
  return '<!doctype html><html><head><meta name="color-scheme" content="light">'
    + '<style>body{margin:10px 12px;background:#ffffff;color:#242424;'
    + "font:13px/1.55 'Segoe UI',system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}"
    + 'img{max-width:100%;height:auto}a{color:#2563eb}</style></head><body>'
    + fragment
    + '</body></html>';
}
