// Browser-side helpers for the compose editor's plain-text toggle and link
// prompt. They are a convenience only: the server re-sanitizes every rich-text
// body with its own allowlist and derives the text/plain part itself.

export type ComposeBodyFormat = 'text' | 'html';

/** Minimal shape of a TipTap/ProseMirror JSON document node. */
export interface RichNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** Plain text to editor HTML: blank lines split paragraphs, single newlines become <br>. */
export function plainTextToRichHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');
}

function linkTarget(node: RichNode): string {
  const link = node.marks?.find((mark) => mark.type === 'link');
  const href = link?.attrs?.href;
  return typeof href === 'string' ? href : '';
}

function inlineText(nodes: RichNode[] = []): string {
  let output = '';
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    if (node.type === 'hardBreak') {
      output += '\n';
      index += 1;
      continue;
    }
    if (node.type !== 'text') {
      output += inlineText(node.content);
      index += 1;
      continue;
    }
    // Adjacent text runs with different marks can share one link.
    const href = linkTarget(node);
    let run = node.text || '';
    index += 1;
    while (href && index < nodes.length && nodes[index].type === 'text' && linkTarget(nodes[index]) === href) {
      run += nodes[index].text || '';
      index += 1;
    }
    const target = href.replace(/^mailto:/i, '');
    output += href && run.trim() !== target && run.trim() !== href ? `${run} (${target})` : run;
  }
  return output;
}

function indent(lines: string[], width: number): string[] {
  return lines.map((line, index) => (index === 0 || !line ? line : `${' '.repeat(width)}${line}`));
}

function blockText(node: RichNode): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(node.content);
    case 'blockquote':
      return blocksText(node.content)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      const start = Number(node.attrs?.start);
      let number = Number.isSafeInteger(start) ? start : 1;
      return (node.content || []).map((item) => {
        const marker = ordered ? `${number++}. ` : '- ';
        const lines = blocksText(item.content, '\n').split('\n');
        lines[0] = `${marker}${lines[0]}`;
        return indent(lines, marker.length).join('\n');
      }).join('\n');
    }
    default:
      return node.content ? blocksText(node.content) : node.text || '';
  }
}

function blocksText(nodes: RichNode[] = [], separator = '\n\n'): string {
  return nodes.map(blockText).join(separator);
}

/** Editor JSON to the plain text a user sees after switching to plain-text mode. */
export function richDocToPlainText(doc: RichNode | null | undefined): string {
  if (!doc) return '';
  return blocksText(doc.content).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Normalises what someone types into the link prompt. Bare domains get
 * https://, bare addresses get mailto:, and anything other than http(s) or
 * mailto (javascript:, data:, file: and the like) is refused.
 */
export function normaliseLinkInput(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 2048 || /[\s<>"]/.test(input)) return null;
  let candidate = input;
  if (/^[^@/:]+@[^@/:]+\.[^@/:]+$/.test(input)) candidate = `mailto:${input}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) candidate = `https://${input}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return candidate;
  } catch {
    return null;
  }
}
