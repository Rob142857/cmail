import type { Element, ElementContent, Root, RootContent } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { checkEmailHtmlComplexity, type EmailHtmlComplexityLimits } from './sanitize-email';

/**
 * Authored (compose) HTML is far narrower than received email: the editor only
 * produces paragraphs, line breaks, simple inline marks, links, lists and
 * quotes. Anything else is unwrapped to its text, and active or embedding
 * content (scripts, styles, frames, forms, media and every image) is dropped
 * with its contents. No attribute survives except a checked link target and
 * an ordered list's start number, so event handlers, inline styles, classes
 * and data attributes can never reach a recipient or the Sent copy.
 */
const composeSchema = {
  tagNames: [
    'a', 'b', 'blockquote', 'br', 'div', 'em', 'i', 'li', 'ol', 'p', 's',
    'span', 'strong', 'u', 'ul',
  ],
  attributes: {
    a: ['href'],
    ol: ['start'],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
  },
  strip: [
    'applet', 'audio', 'base', 'button', 'canvas', 'embed', 'form', 'frame',
    'frameset', 'head', 'iframe', 'img', 'input', 'link', 'math', 'meta',
    'noscript', 'object', 'option', 'picture', 'script', 'select', 'source',
    'style', 'svg', 'template', 'textarea', 'title', 'video',
  ],
  clobber: [],
  clobberPrefix: '',
};

export const COMPOSE_HTML_LIMITS: Readonly<EmailHtmlComplexityLimits> = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxElements: 20_000,
  maxDepth: 64,
});

export type ComposeHtmlResult =
  | { ok: true; html: string; text: string }
  | { ok: false; reason: 'input_bytes' | 'elements' | 'depth' | 'invalid' | 'output_bytes' };

const ENCODER = new TextEncoder();
const parser = unified().use(rehypeParse, { fragment: true });
const sanitizer = unified().use(rehypeSanitize, composeSchema);
const stringifier = unified().use(rehypeStringify);

function safeHref(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    return value;
  } catch {
    return '';
  }
}

function safeStart(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 100_000 ? number : null;
}

/** Iterative walk: enforces depth/element limits and re-checks kept attributes. */
function hardenTree(root: Root, limits: EmailHtmlComplexityLimits): 'elements' | 'depth' | null {
  let elements = 0;
  const pending: Array<{ node: Root | RootContent; depth: number }> = [{ node: root, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const { node } = current;
    const depth = node.type === 'element' ? current.depth + 1 : current.depth;
    if (node.type === 'element') {
      elements += 1;
      if (elements > limits.maxElements) return 'elements';
      if (depth > limits.maxDepth) return 'depth';
      if (node.tagName === 'a') {
        const href = safeHref(node.properties.href);
        node.properties = href ? { href } : {};
      } else if (node.tagName === 'ol') {
        const start = safeStart(node.properties.start);
        node.properties = start !== null && start !== 1 ? { start } : {};
      } else {
        node.properties = {};
      }
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], depth });
      }
    }
  }
  return null;
}

function isBlankNode(node: RootContent): boolean {
  if (node.type === 'text') return !node.value.trim();
  if (node.type !== 'element') return true;
  if (node.tagName !== 'p' && node.tagName !== 'div' && node.tagName !== 'br') return false;
  return node.children.every((child) => isBlankNode(child as RootContent));
}

/** The editor always keeps an empty paragraph after a list or quote; drop it. */
function trimEmptyEdgeParagraphs(root: Root): void {
  while (root.children.length && isBlankNode(root.children[root.children.length - 1])) root.children.pop();
  while (root.children.length && isBlankNode(root.children[0])) root.children.shift();
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'caption', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'main', 'nav', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr',
]);
const PARAGRAPH_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Stands in for list indentation until the final pass, so tidy() keeps it. */
const INDENT = '\uE000';
/** Block boundaries: one line break, or a blank line for paragraphs. */
const LINE = '\ue001';
const PARAGRAPH = '\ue002';
const MARKERS = /[\uE000-\ue002]/g;

/**
 * Collapses each run of explicit breaks and block markers into at most one
 * blank line, so adjacent blocks never stack extra empty lines.
 */
function tidy(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]*[\n\ue001\ue002][\n\ue001\ue002 \t]*/g, (run) => {
      const breaks = (run.match(/\n/g) || []).length;
      const wanted = run.includes(PARAGRAPH) ? 2 : run.includes(LINE) ? 1 : 0;
      return '\n'.repeat(Math.min(2, Math.max(breaks, wanted)));
    })
    .replace(/^\n+|\n+$/g, '');
}

function finish(value: string): string {
  return tidy(value).replaceAll(INDENT, ' ').replace(/[ \t]+$/gm, '');
}

function renderNodes(nodes: Array<RootContent | ElementContent>): string {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') output += node.value.replace(/[\t\n\r\f ]+/g, ' ').replace(MARKERS, '');
    else if (node.type === 'element') output += renderElement(node);
  }
  return output;
}

function renderList(element: Element): string {
  const ordered = element.tagName === 'ol';
  let number = safeStart(element.properties.start) ?? 1;
  const items: string[] = [];
  for (const child of element.children) {
    if (child.type !== 'element') {
      if (child.type === 'text' && child.value.trim()) items.push(child.value.trim());
      continue;
    }
    const body = child.tagName === 'li' ? child.children : [child];
    const lines = tidy(renderNodes(body)).replace(/\n{2,}/g, '\n').split('\n');
    const marker = ordered ? `${number}. ` : '- ';
    number += 1;
    items.push(lines.map((line, index) => {
      if (index === 0) return `${marker}${line}`;
      return line ? `${INDENT.repeat(marker.length)}${line}` : line;
    }).join('\n'));
  }
  return `${PARAGRAPH}${items.join('\n')}${PARAGRAPH}`;
}

function renderElement(element: Element): string {
  const tag = element.tagName;
  if (tag === 'br') return '\n';
  if (tag === 'hr') return `${PARAGRAPH}----------${PARAGRAPH}`;
  if (tag === 'ul' || tag === 'ol') return renderList(element);
  if (tag === 'blockquote') {
    const quoted = tidy(renderNodes(element.children))
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n');
    return `${PARAGRAPH}${quoted}${PARAGRAPH}`;
  }
  if (tag === 'a') {
    const text = renderNodes(element.children);
    const href = typeof element.properties.href === 'string' ? element.properties.href : '';
    const target = href.replace(/^mailto:/i, '');
    const visible = text.trim();
    if (!href) return text;
    if (!visible) return target;
    return visible === target || visible === href ? text : `${text} (${target})`;
  }
  if (tag === 'td' || tag === 'th') return `${renderNodes(element.children)}\t`;
  if (tag === 'li') return `${LINE}${renderNodes(element.children)}${LINE}`;
  if (PARAGRAPH_TAGS.has(tag)) return `${PARAGRAPH}${renderNodes(element.children)}${PARAGRAPH}`;
  if (BLOCK_TAGS.has(tag)) return `${LINE}${renderNodes(element.children)}${LINE}`;
  return renderNodes(element.children);
}

/**
 * Readable text/plain alternative for an HTML body: paragraphs become blank
 * lines, list items get "-" or "1." markers, quotes get "> " prefixes and links
 * keep their destination in brackets. Input is parsed, never regex-stripped,
 * so entities decode exactly once and markup-like text stays text.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const tree = parser.parse(html) as Root;
  return finish(renderNodes(tree.children));
}

/**
 * Sanitizes editor HTML to the compose allowlist and derives its plain-text
 * alternative from the sanitized tree. Fails closed on oversized or overly
 * complex input instead of truncating the message.
 */
export function sanitizeComposeHtml(
  value: string,
  overrides: Partial<EmailHtmlComplexityLimits> = {},
): ComposeHtmlResult {
  const html = typeof value === 'string' ? value : '';
  const limits = { ...COMPOSE_HTML_LIMITS, ...overrides };
  const rejected = checkEmailHtmlComplexity(html, limits);
  if (rejected) return rejected;

  let tree: Root;
  try {
    tree = sanitizer.runSync(parser.parse(html) as Root) as Root;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const treeRejected = hardenTree(tree, limits);
  if (treeRejected) return { ok: false, reason: treeRejected };
  trimEmptyEdgeParagraphs(tree);

  const text = finish(renderNodes(tree.children));
  // An editor that holds only empty paragraphs has no content to send.
  const sanitized = text.trim() ? String(stringifier.stringify(tree)) : '';
  if (ENCODER.encode(sanitized).byteLength > limits.maxOutputBytes) return { ok: false, reason: 'output_bytes' };
  return { ok: true, html: sanitized, text };
}
