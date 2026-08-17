// Cleans clipboard HTML before it enters the signature editor. This mirrors
// the allowlist in packages/shared/src/sanitize-email.ts closely enough to
// keep the editing surface honest, but it is a UX nicety only — the server
// sanitizes independently (and more strictly) on every save and read.

const REMOVE_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'title', 'base', 'head', 'iframe', 'frame',
  'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select',
  'option', 'textarea', 'svg', 'math', 'video', 'audio', 'canvas', 'template', 'noscript',
]);

const ALLOWED_TAGS = new Set([
  'a', 'address', 'article', 'aside', 'b', 'blockquote', 'br', 'caption',
  'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark',
  'nav', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul',
]);

const GLOBAL_ATTRIBUTES = new Set(['dir', 'lang', 'style', 'title']);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target', 'title']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span', 'width']),
  img: new Set(['alt', 'height', 'loading', 'referrerpolicy', 'src', 'title', 'width']),
  ol: new Set(['reversed', 'start', 'type']),
  table: new Set(['align', 'border', 'cellpadding', 'cellspacing', 'height', 'width']),
  td: new Set(['align', 'colspan', 'height', 'rowspan', 'valign', 'width']),
  th: new Set(['align', 'colspan', 'height', 'rowspan', 'scope', 'valign', 'width']),
};

/** Drops Word's `mso-*` declarations and anything that could load a remote resource. */
function cleanStyle(value: string): string {
  return value
    .split(';')
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 1) return '';
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (property.startsWith('mso-')) return '';
      if (/url\s*\(|expression\s*\(/i.test(propertyValue)) return '';
      return `${property}:${propertyValue}`;
    })
    .filter(Boolean)
    .join(';');
}

function isAllowedLinkHref(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isAllowedImageSrc(value: string): boolean {
  if (/^cid:/i.test(value)) return true;
  if (/^data:image\//i.test(value)) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanAttributes(element: Element): void {
  const allowed = TAG_ATTRIBUTES[element.tagName.toLowerCase()];
  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase();
    if (!GLOBAL_ATTRIBUTES.has(name) && !allowed?.has(name)) {
      element.removeAttribute(attr.name);
      continue;
    }
    if (name === 'style') {
      const cleaned = cleanStyle(attr.value);
      if (cleaned) element.setAttribute('style', cleaned);
      else element.removeAttribute('style');
    }
  }
}

/** Removes junk, unwraps unknown wrappers, and enforces the attribute allowlist in place. */
function clean(parent: Element): void {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      parent.removeChild(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const element = child as Element;
    const tagName = element.tagName.toLowerCase();
    if (REMOVE_TAGS.has(tagName)) {
      parent.removeChild(element);
      continue;
    }

    // Recurse first, so an unwrapped wrapper's children have already been cleaned.
    clean(element);

    if (!ALLOWED_TAGS.has(tagName)) {
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
      continue;
    }

    cleanAttributes(element);
    if (tagName === 'a') {
      const href = element.getAttribute('href');
      if (href && !isAllowedLinkHref(href)) element.removeAttribute('href');
    }
    if (tagName === 'img') {
      const src = element.getAttribute('src');
      if (!src || !isAllowedImageSrc(src)) parent.removeChild(element);
    }
  }
}

/** Reduces pasted clipboard HTML to the email-safe subset the editor and server accept. */
export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  clean(doc.body);
  const result = doc.body.innerHTML.trim();
  // An image-only paste (e.g. a banner signature) has no text but is not empty.
  if (doc.body.querySelector('img')) return result;
  return /^(?:\s|&nbsp;)*$/i.test(result.replace(/<[^>]*>/g, '')) ? '' : result;
}
