import type { Element, Root, RootContent } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { assessLinkRisk, type LinkRisk } from './link-risk';

const SAFE_STYLE_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|@import|-moz-binding|behavior\s*:))[^\u0000-\u001f\u007f<>{}\\]*$/i;
const SAFE_STYLE_PROPERTIES = new Set([
  'color', 'background-color',
  'font', 'font-family', 'font-size', 'font-style', 'font-weight',
  'letter-spacing', 'line-height', 'text-align', 'text-decoration', 'text-indent',
  'text-transform', 'white-space', 'word-break', 'overflow-wrap',
  'display', 'vertical-align',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-radius',
  'border-collapse', 'border-spacing',
]);

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);
const TAG_PATTERN = /<\s*(\/?)\s*([a-z][a-z0-9:-]*)(?:\s[^<>]*?)?\s*(\/?)>/gi;
const ENCODER = new TextEncoder();

const emailSchema = {
  tagNames: [
    'a', 'address', 'article', 'aside', 'b', 'blockquote', 'br', 'caption',
    'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt',
    'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark',
    'nav', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong',
    'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
    'tr', 'u', 'ul',
  ],
  attributes: {
    '*': ['dir', 'lang', 'style', 'title'],
    a: ['href', 'rel', 'target', 'title'],
    col: ['span', 'width'],
    colgroup: ['span', 'width'],
    img: ['alt', 'height', 'loading', 'referrerPolicy', 'src', 'title', 'width'],
    ol: ['reversed', 'start', 'type'],
    table: ['align', 'border', 'cellPadding', 'cellSpacing', 'height', 'width'],
    td: ['align', 'colSpan', 'height', 'rowSpan', 'vAlign', 'width'],
    th: ['align', 'colSpan', 'height', 'rowSpan', 'scope', 'vAlign', 'width'],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
    src: ['https', 'cid', 'data'],
  },
  strip: [
    'applet', 'audio', 'base', 'button', 'canvas', 'embed', 'form', 'frame',
    'frameset', 'iframe', 'input', 'link', 'math', 'meta', 'noscript',
    'object', 'option', 'script', 'select', 'style', 'svg', 'template',
    'textarea', 'video',
  ],
};

export interface EmailHtmlComplexityLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxElements: number;
  maxDepth: number;
}

export const DEFAULT_EMAIL_HTML_LIMITS: Readonly<EmailHtmlComplexityLimits> = Object.freeze({
  maxInputBytes: 512 * 1024,
  maxOutputBytes: 512 * 1024,
  maxElements: 10_000,
  maxDepth: 128,
});

export type BoundedEmailHtmlResult =
  | { ok: true; html: string; inputBytes: number; outputBytes: number }
  | { ok: false; reason: 'input_bytes' | 'elements' | 'depth' | 'invalid' | 'output_bytes' };

function sanitizeStyle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .split(';')
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 1) return '';
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (!SAFE_STYLE_PROPERTIES.has(property) || !SAFE_STYLE_VALUE.test(propertyValue)) return '';
      return `${property}:${propertyValue}`;
    })
    .filter(Boolean)
    .join(';');
}

function safeLink(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    return value;
  } catch {
    return '';
  }
}

function safeImage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_000_000) return '';
  if (/^cid:[^\s<>]+$/i.test(value)) return value;
  if (/^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return value;
  } catch {
    return '';
  }
}

/** Anchor text beyond this is prose, and prose makes no claim about a host. */
const MAX_ANCHOR_TEXT = 256;

export interface RiskyLink {
  /** The true destination, unchanged. */
  href: string;
  host: string;
  risk: LinkRisk;
}

interface LinkGuard {
  /**
   * Absolute URL of the warning page. When set, a flagged link is redirected
   * through it so the reader sees the real destination before leaving. Links
   * that are not flagged keep their original href, so ordinary mail behaves
   * exactly as it did and "copy link address" stays honest.
   */
  interstitialUrl: string;
  found: RiskyLink[];
}

/** Caps the query we build, so a hostile href cannot produce an absurd URL. */
const MAX_INTERSTITIAL_HREF = 2048;

function annotateLink(element: Element, href: string, guard: LinkGuard | null): void {
  const assessment = assessLinkRisk(href, anchorText(element));
  if (!assessment.risk) return;

  element.properties.dataCmailLinkRisk = assessment.risk;
  element.properties.dataCmailLinkHost = assessment.host;
  if (!guard) return;

  guard.found.push({ href, host: assessment.host, risk: assessment.risk });
  if (href.length > MAX_INTERSTITIAL_HREF) return;
  try {
    const warning = new URL(guard.interstitialUrl);
    warning.searchParams.set('u', href);
    warning.searchParams.set('r', assessment.risk);
    element.properties.href = warning.toString();
  } catch {
    // An unusable interstitial base leaves the original href in place. The
    // annotation still marks the link, so the reader is not left unwarned.
  }
}

/**
 * Visible text of an anchor, bounded. Only text nodes count — `alt` text is
 * deliberately excluded, because an image's alt attribute is not what the
 * reader sees and cannot mislead them about a destination.
 */
function anchorText(element: Element): string {
  let text = '';
  const pending: RootContent[] = [...element.children];
  while (pending.length && text.length <= MAX_ANCHOR_TEXT) {
    const node = pending.shift();
    if (!node) break;
    if (node.type === 'text') text += node.value;
    else if (node.type === 'element') pending.unshift(...node.children);
  }
  return text.slice(0, MAX_ANCHOR_TEXT);
}

function hardenElement(element: Element, guard: LinkGuard | null): void {
  const properties = element.properties;
  const style = sanitizeStyle(properties.style);
  if (style) properties.style = style;
  else delete properties.style;

  if (element.tagName === 'a') {
    const href = safeLink(properties.href);
    if (href) properties.href = href;
    else delete properties.href;
    properties.target = '_blank';
    properties.rel = ['noopener', 'noreferrer', 'nofollow'];
    // Stale annotations from an earlier pass are never trusted; the schema
    // strips them on re-sanitize, and this removes any that survive parsing.
    delete properties.dataCmailLinkRisk;
    delete properties.dataCmailLinkHost;
    if (href) annotateLink(element, href, guard);
  }

  if (element.tagName === 'img') {
    const src = safeImage(properties.src);
    if (src) properties.src = src;
    else delete properties.src;
    properties.loading = 'lazy';
    properties.referrerPolicy = 'no-referrer';
  }
}

const parser = unified().use(rehypeParse, { fragment: true });
const sanitizer = unified().use(rehypeSanitize, emailSchema);
const stringifier = unified().use(rehypeStringify);

function positiveLimit(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function resolvedLimits(overrides: Partial<EmailHtmlComplexityLimits>): EmailHtmlComplexityLimits {
  return {
    maxInputBytes: positiveLimit(overrides.maxInputBytes ?? 0, DEFAULT_EMAIL_HTML_LIMITS.maxInputBytes),
    maxOutputBytes: positiveLimit(overrides.maxOutputBytes ?? 0, DEFAULT_EMAIL_HTML_LIMITS.maxOutputBytes),
    maxElements: positiveLimit(overrides.maxElements ?? 0, DEFAULT_EMAIL_HTML_LIMITS.maxElements),
    maxDepth: positiveLimit(overrides.maxDepth ?? 0, DEFAULT_EMAIL_HTML_LIMITS.maxDepth),
  };
}

function inspectComplexity(value: string, limits: EmailHtmlComplexityLimits): BoundedEmailHtmlResult | null {
  const inputBytes = ENCODER.encode(value).byteLength;
  if (inputBytes > limits.maxInputBytes) return { ok: false, reason: 'input_bytes' };

  let elements = 0;
  const openTags: string[] = [];
  TAG_PATTERN.lastIndex = 0;
  for (let match = TAG_PATTERN.exec(value); match; match = TAG_PATTERN.exec(value)) {
    const closing = match[1] === '/';
    const tagName = match[2].toLowerCase();
    const selfClosing = match[3] === '/' || VOID_ELEMENTS.has(tagName);
    if (closing) {
      // Ignore unmatched closers. A closer for an open ancestor implicitly
      // closes everything above it, matching the conservative HTML shape.
      const openIndex = openTags.lastIndexOf(tagName);
      if (openIndex >= 0) openTags.length = openIndex;
      continue;
    }

    elements += 1;
    if (elements > limits.maxElements) return { ok: false, reason: 'elements' };
    if (!selfClosing) {
      openTags.push(tagName);
      if (openTags.length > limits.maxDepth) return { ok: false, reason: 'depth' };
    }
  }

  return null;
}

function sanitizeTree(value: string): Root {
  const parsed = parser.parse(value) as Root;
  return sanitizer.runSync(parsed) as Root;
}

/** Iterative traversal prevents hostile depth from overflowing our own stack. */
function inspectAndHardenTree(
  root: Root,
  limits: EmailHtmlComplexityLimits | null,
  guard: LinkGuard | null = null,
): BoundedEmailHtmlResult | null {
  let elements = 0;
  const pending: Array<{ node: Root | RootContent; depth: number }> = [{ node: root, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const { node } = current;
    const depth = node.type === 'element' ? current.depth + 1 : current.depth;
    if (node.type === 'element') {
      elements += 1;
      if (limits && elements > limits.maxElements) return { ok: false, reason: 'elements' };
      if (limits && depth > limits.maxDepth) return { ok: false, reason: 'depth' };
      hardenElement(node, guard);
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], depth });
      }
    }
  }
  return null;
}

function stringifyTree(root: Root): string {
  return String(stringifier.stringify(root));
}

/** Reduces untrusted email HTML to a presentation-only subset. */
export function sanitizeEmailHtml(value: string): string {
  const tree = sanitizeTree(value);
  inspectAndHardenTree(tree, null);
  return stringifyTree(tree);
}

/**
 * Sanitizes, and additionally routes links that look like phishing through a
 * warning page. Returns the findings so a caller can summarise them above the
 * message — a reader who is told the message contains a disguised link before
 * they start reading is in a much better position than one who is warned only
 * after clicking.
 */
export function sanitizeEmailHtmlWithLinkGuard(
  value: string,
  interstitialUrl: string,
): { html: string; riskyLinks: RiskyLink[] } {
  const guard: LinkGuard = { interstitialUrl, found: [] };
  const tree = sanitizeTree(value);
  inspectAndHardenTree(tree, null, guard);
  return { html: stringifyTree(tree), riskyLinks: guard.found };
}

/** Checks cheap byte/tag/depth ceilings before invoking the HTML parser. */
export function sanitizeBoundedEmailHtml(
  value: string,
  overrides: Partial<EmailHtmlComplexityLimits> = {},
): BoundedEmailHtmlResult {
  const html = typeof value === 'string' ? value : '';
  const limits = resolvedLimits(overrides);
  const rejected = inspectComplexity(html, limits);
  if (rejected) return rejected;

  let sanitized: string;
  try {
    const tree = sanitizeTree(html);
    const treeRejected = inspectAndHardenTree(tree, limits);
    if (treeRejected) return treeRejected;
    sanitized = stringifyTree(tree);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  const outputBytes = ENCODER.encode(sanitized).byteLength;
  if (outputBytes > limits.maxOutputBytes) return { ok: false, reason: 'output_bytes' };
  return {
    ok: true,
    html: sanitized,
    inputBytes: ENCODER.encode(html).byteLength,
    outputBytes,
  };
}
