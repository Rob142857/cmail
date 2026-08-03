import type { Element, Root, RootContent } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

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

function hardenElement(element: Element): void {
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
  }

  if (element.tagName === 'img') {
    const src = safeImage(properties.src);
    if (src) properties.src = src;
    else delete properties.src;
    properties.loading = 'lazy';
    properties.referrerPolicy = 'no-referrer';
  }
}

function hardenTree(node: Root | RootContent): void {
  if (node.type === 'element') hardenElement(node);
  if ('children' in node) {
    for (const child of node.children) hardenTree(child);
  }
}

function hardenEmailHtml() {
  return (tree: Root): void => hardenTree(tree);
}

const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, emailSchema)
  .use(hardenEmailHtml)
  .use(rehypeStringify);

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
  let depth = 0;
  TAG_PATTERN.lastIndex = 0;
  for (let match = TAG_PATTERN.exec(value); match; match = TAG_PATTERN.exec(value)) {
    const closing = match[1] === '/';
    const tagName = match[2].toLowerCase();
    const selfClosing = match[3] === '/' || VOID_ELEMENTS.has(tagName);
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    elements += 1;
    if (elements > limits.maxElements) return { ok: false, reason: 'elements' };
    if (!selfClosing) {
      depth += 1;
      if (depth > limits.maxDepth) return { ok: false, reason: 'depth' };
    }
  }

  return null;
}

/** Reduces untrusted email HTML to a presentation-only subset. */
export function sanitizeEmailHtml(value: string): string {
  return String(processor.processSync(value));
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
    sanitized = sanitizeEmailHtml(html);
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
