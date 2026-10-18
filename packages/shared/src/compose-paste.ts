import type { Element, ElementContent, Root, RootContent } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { COMPOSE_HTML_LIMITS, sanitizeComposeHtml } from './compose-html';
import { checkEmailHtmlComplexity } from './sanitize-email';

/**
 * Clipboard HTML (Word, Outlook, web pages) to compose HTML.
 *
 * Office clipboard HTML carries class-based styling, `mso-` properties,
 * conditional comments and lists drawn as indented paragraphs with a typed
 * bullet. This pass turns the useful parts into plain markup the editor
 * understands (real lists, headings as bold paragraphs, highlight and named
 * colours as hex), then hands the result to the same allowlist sanitizer the
 * server uses, so what lands in the editor is what can be sent.
 *
 * It is a convenience only: the server re-sanitizes every body it receives.
 */

const parser = unified().use(rehypeParse, { fragment: true });
const stringifier = unified().use(rehypeStringify);

/** CSS colour keywords Word and Outlook write, as hex. */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff',
  magenta: '#ff00ff', maroon: '#800000', navy: '#000080', olive: '#808000', purple: '#800080',
  teal: '#008080', silver: '#c0c0c0', gray: '#808080', grey: '#808080', orange: '#ffa500',
  windowtext: '#000000',
};

/** Word's highlight names (mso-highlight) to the colours Word paints. */
const WORD_HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00', brightgreen: '#00ff00', lime: '#00ff00', turquoise: '#00ffff', aqua: '#00ffff',
  pink: '#ff00ff', fuchsia: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkblue: '#000080',
  navy: '#000080', teal: '#008080', green: '#008000', violet: '#800080', purple: '#800080',
  darkred: '#800000', maroon: '#800000', darkyellow: '#808000', olive: '#808000',
  darkgray: '#808080', gray: '#808080', lightgray: '#c0c0c0', silver: '#c0c0c0', black: '#000000',
};

/** Block containers the compose schema has no node for: kept as paragraphs. */
const AS_PARAGRAPH = new Set([
  'address', 'article', 'aside', 'caption', 'dd', 'details', 'dt', 'figcaption', 'figure',
  'footer', 'header', 'main', 'nav', 'pre', 'section', 'summary', 'tr',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Legacy <font size> 1-7 in pt. */
const FONT_TAG_SIZES = ['', '8pt', '10pt', '12pt', '14pt', '18pt', '24pt', '36pt'];

function styleOf(element: Element): string {
  const style = element.properties.style;
  return typeof style === 'string' ? style : '';
}

function textOf(node: ElementContent | RootContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function colorValue(value: string): string {
  const input = value.trim().toLowerCase().replace(/\s*!important$/, '');
  return NAMED_COLORS[input] ?? input;
}

/**
 * Rewrites the declarations paste can rescue (named colours, Word highlight,
 * a background shorthand holding only a colour) and drops `mso-` noise. The
 * sanitizer still decides what survives.
 */
function rewriteStyle(style: string): string {
  const declarations: string[] = [];
  let highlight = '';
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property === 'mso-highlight') {
      highlight = WORD_HIGHLIGHTS[value.toLowerCase().replace(/\s+/g, '')] ?? '';
      continue;
    }
    if (property.startsWith('mso-')) continue;
    if (property === 'color' || property === 'background-color') {
      declarations.push(`${property}:${colorValue(value)}`);
    } else if (property === 'background') {
      // Only a lone colour is a highlight; images and gradients are dropped.
      if (/^[#a-z0-9(),.\s]+$/i.test(value) && !/\s/.test(value.replace(/\(.*\)/, '').trim())) {
        declarations.push(`background-color:${colorValue(value)}`);
      }
    } else {
      declarations.push(`${property}:${value}`);
    }
  }
  if (highlight) declarations.push(`background-color:${highlight}`);
  return declarations.join(';');
}

interface WordListItem {
  element: Element;
  level: number;
  ordered: boolean;
}

/** Word draws each list item as a paragraph with `mso-list: l0 level1 lfo1`. */
function wordListInfo(node: ElementContent | RootContent): WordListItem | null {
  if (node.type !== 'element') return null;
  const match = /mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(styleOf(node));
  if (!match) return null;
  let ordered = false;
  const removeMarker = (parent: Element): boolean => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index];
      if (child.type !== 'element') continue;
      if (/mso-list\s*:\s*ignore/i.test(styleOf(child))) {
        // "1.", "a)", "iv." are numbered; "·", "o", "§" and the like are bullets.
        ordered = /^\s*(?:\d{1,3}|[a-z]{1,2}|[ivxlc]{1,6})[.)]/i.test(textOf(child));
        parent.children.splice(index, 1);
        return true;
      }
      if (removeMarker(child)) return true;
    }
    return false;
  };
  removeMarker(node);
  return { element: node, level: Math.min(Math.max(Number(match[1]) || 1, 1), 8), ordered };
}

function buildList(items: WordListItem[]): Element {
  const make = (ordered: boolean): Element => ({ type: 'element', tagName: ordered ? 'ol' : 'ul', properties: {}, children: [] });
  const root = make(items[0].ordered);
  const stack: Element[] = [root];
  for (const item of items) {
    // Go up to this item's level, then down, opening lists inside the last item.
    while (stack.length > item.level) stack.pop();
    while (stack.length < item.level) {
      const parent = stack[stack.length - 1];
      let last = parent.children[parent.children.length - 1] as Element | undefined;
      if (!last) {
        last = { type: 'element', tagName: 'li', properties: {}, children: [] };
        parent.children.push(last);
      }
      const nested = make(item.ordered);
      last.children.push(nested);
      stack.push(nested);
    }
    const paragraph: Element = { type: 'element', tagName: 'p', properties: {}, children: item.element.children };
    stack[stack.length - 1].children.push({ type: 'element', tagName: 'li', properties: {}, children: [paragraph] });
  }
  return root;
}

function isBlankText(node: ElementContent | RootContent): boolean {
  return node.type === 'comment' || (node.type === 'text' && !node.value.trim());
}

/** Replaces each run of Word list paragraphs in `parent` with real lists. */
function convertWordLists(parent: Root | Element): void {
  const output: Array<ElementContent | RootContent> = [];
  let run: WordListItem[] = [];
  let pendingGap: Array<ElementContent | RootContent> = [];
  const flush = () => {
    if (run.length) output.push(buildList(run));
    run = [];
    output.push(...pendingGap);
    pendingGap = [];
  };
  for (const child of parent.children) {
    const info = wordListInfo(child);
    if (info) {
      pendingGap = [];
      run.push(info);
    } else if (run.length && isBlankText(child)) {
      pendingGap.push(child);
    } else {
      flush();
      output.push(child);
    }
  }
  flush();
  parent.children = output as typeof parent.children;
}

function convertElement(element: Element): void {
  const tag = element.tagName;
  const style = styleOf(element);
  if (style) element.properties = { ...element.properties, style: rewriteStyle(style) };

  if (HEADINGS.has(tag)) {
    element.tagName = 'p';
    element.children = [{ type: 'element', tagName: 'strong', properties: {}, children: element.children }];
  } else if (AS_PARAGRAPH.has(tag)) {
    element.tagName = 'p';
  } else if (tag === 'td' || tag === 'th') {
    element.tagName = 'span';
    element.children.push({ type: 'text', value: ' ' });
  } else if (tag === 'del' || tag === 'strike') {
    element.tagName = 's';
  } else if (tag === 'ins') {
    element.tagName = 'u';
  } else if (tag === 'mark') {
    element.tagName = 'span';
    if (!/background/i.test(style)) element.properties = { style: 'background-color:#ffff00' };
  } else if (tag === 'font') {
    const declarations: string[] = [];
    const face = element.properties.face;
    const color = element.properties.color;
    const size = Number(element.properties.size);
    if (typeof face === 'string') declarations.push(`font-family:${face}`);
    else if (Array.isArray(face)) declarations.push(`font-family:${(face as unknown[]).map(String).join(",")}`);
    if (typeof color === 'string') declarations.push(`color:${colorValue(color)}`);
    if (Number.isInteger(size) && FONT_TAG_SIZES[size]) declarations.push(`font-size:${FONT_TAG_SIZES[size]}`);
    element.tagName = 'span';
    element.properties = { style: declarations.join(';') };
  }
}

/** Iterative so deep clipboard trees can't exhaust the stack. */
function convertTree(root: Root): void {
  const pending: Array<Root | Element> = [root];
  while (pending.length) {
    const parent = pending.pop();
    if (!parent) break;
    convertWordLists(parent);
    for (const child of parent.children) {
      if (child.type !== 'element') continue;
      convertElement(child);
      pending.push(child);
    }
  }
}

/** Clipboard HTML to compose HTML; '' when nothing usable is left. */
export function cleanComposePaste(html: string): string {
  if (typeof html !== 'string' || !html) return '';
  if (checkEmailHtmlComplexity(html, COMPOSE_HTML_LIMITS)) return '';
  let tree: Root;
  try {
    tree = parser.parse(html) as Root;
  } catch {
    return '';
  }
  convertTree(tree);
  const result = sanitizeComposeHtml(String(stringifier.stringify(tree)));
  return result.ok ? result.html : '';
}
