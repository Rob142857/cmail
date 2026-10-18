/**
 * The only inline styles authored (compose) HTML may carry, plus the
 * Outlook-style defaults new messages start with.
 *
 * Everything here rebuilds a style from parsed, range-checked values: no part
 * of an input declaration is ever copied to the output. Font families come
 * from a fixed list, colours are re-emitted as #rrggbb, and sizes and indents
 * are bounded numbers, so url(), expression(), escapes, comments, position and
 * behaviour (or any other property) can never reach a recipient.
 */

export interface ComposeFont {
  /** What the font menu shows and what preferences store. */
  name: string;
  /** Email-safe stack with fallbacks for devices without the first font. */
  stack: string;
}

// Multi-word names are left unquoted (valid CSS), so a stack sits inside a
// double-quoted style attribute without any escaping.
export const COMPOSE_FONTS: readonly ComposeFont[] = Object.freeze([
  { name: 'Aptos', stack: 'Aptos, Calibri, Arial, sans-serif' },
  { name: 'Calibri', stack: 'Calibri, Arial, sans-serif' },
  { name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { name: 'Times New Roman', stack: 'Times New Roman, Times, serif' },
  { name: 'Georgia', stack: 'Georgia, Times New Roman, serif' },
  { name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { name: 'Courier New', stack: 'Courier New, Courier, monospace' },
]);

export const COMPOSE_FONT_SIZES_PT: readonly number[] = Object.freeze([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36]);

/** Exchange/Outlook's current default for new mail. */
export const DEFAULT_COMPOSE_FONT = 'Aptos';
export const DEFAULT_COMPOSE_FONT_SIZE_PT = 12;
export const DEFAULT_COMPOSE_TEXT_COLOR = '#000000';

/** One indent step, as the editor applies it, and the most steps allowed. */
export const COMPOSE_INDENT_STEP_PX = 40;
export const COMPOSE_MAX_INDENT_LEVEL = 8;

export interface ComposeDefaults {
  fontFamily: string;
  fontSizePt: number;
}

export const DEFAULT_COMPOSE_DEFAULTS: Readonly<ComposeDefaults> = Object.freeze({
  fontFamily: DEFAULT_COMPOSE_FONT,
  fontSizePt: DEFAULT_COMPOSE_FONT_SIZE_PT,
});

/** Tags allowed to carry a style attribute in compose HTML. */
export const COMPOSE_STYLE_TAGS: ReadonlySet<string> = new Set(['span', 'p', 'li', 'blockquote', 'div']);

const FONT_BY_NAME = new Map(COMPOSE_FONTS.map((font) => [font.name.toLowerCase(), font]));
const SIZE_SET = new Set(COMPOSE_FONT_SIZES_PT);

export function composeFontByName(name: unknown): ComposeFont | null {
  return typeof name === 'string' ? FONT_BY_NAME.get(name.trim().toLowerCase()) ?? null : null;
}

/** Validates stored or submitted defaults; anything unknown falls back to Outlook's. */
export function normaliseComposeDefaults(fontFamily: unknown, fontSizePt: unknown): ComposeDefaults {
  const font = composeFontByName(fontFamily);
  const size = typeof fontSizePt === 'number' ? fontSizePt : Number(fontSizePt);
  return {
    fontFamily: font ? font.name : DEFAULT_COMPOSE_FONT,
    fontSizePt: Number.isInteger(size) && SIZE_SET.has(size) ? size : DEFAULT_COMPOSE_FONT_SIZE_PT,
  };
}

export function isComposeFontName(value: unknown): boolean {
  return composeFontByName(value) !== null;
}

export function isComposeFontSize(value: unknown): boolean {
  const size = typeof value === 'number' ? value : Number(value);
  return typeof value !== 'boolean' && value !== '' && Number.isInteger(size) && SIZE_SET.has(size);
}

/** The container style recipients' clients inherit from. */
export function composeDefaultsStyle(defaults: ComposeDefaults): string {
  const { fontFamily, fontSizePt } = normaliseComposeDefaults(defaults.fontFamily, defaults.fontSizePt);
  const font = composeFontByName(fontFamily) ?? COMPOSE_FONTS[0];
  return `font-family: ${font.stack}; font-size: ${fontSizePt}pt; color: ${DEFAULT_COMPOSE_TEXT_COLOR}`;
}

/**
 * Wraps sanitized outgoing HTML in a container with the sender's default font
 * and size, so Outlook, Gmail and Apple Mail inherit the same starting point.
 */
export function wrapWithComposeDefaults(html: string, defaults: ComposeDefaults): string {
  if (!html) return html;
  return `<div style="${composeDefaultsStyle(defaults)}">${html}</div>`;
}

/** The first family in a CSS font-family list, matched against the fixed list. */
export function normaliseFontFamily(value: string): string | null {
  const first = value.split(',')[0]?.trim().replace(/^(['"])(.*)\1$/, '$2').trim() ?? '';
  if (!/^[a-z0-9 ]{1,40}$/i.test(first)) return null;
  return composeFontByName(first)?.stack ?? null;
}

function trimNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** pt from 6 to 72, or px from 8 to 96. */
export function normaliseFontSize(value: string): string | null {
  const match = /^(\d{1,3}(?:\.\d{1,3})?)(pt|px)$/i.exec(value.trim());
  if (!match) return null;
  const size = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'pt' ? size < 6 || size > 72 : size < 8 || size > 96) return null;
  return `${trimNumber(size)}${unit}`;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/** #rgb, #rrggbb or rgb(r, g, b), re-emitted as lowercase #rrggbb. */
export function normaliseColor(value: string): string | null {
  const input = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(input);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(input)) return input;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(input);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map(hex2).join('')}`;
}

/** 0 to 320px, 0 to 240pt or 0 to 20em. */
export function normaliseIndent(value: string): string | null {
  const match = /^(\d{1,3}(?:\.\d{1,3})?)(px|pt|em)$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const limit = unit === 'px' ? COMPOSE_INDENT_STEP_PX * COMPOSE_MAX_INDENT_LEVEL : unit === 'pt' ? 240 : 20;
  if (amount > limit) return null;
  return amount === 0 ? null : `${trimNumber(amount)}${unit}`;
}

const TEXT_ALIGN = new Set(['left', 'center', 'right']);
const FONT_STYLE = new Set(['italic', 'normal']);
const FONT_WEIGHT = new Set(['bold', 'normal', 'bolder', 'lighter']);

function normaliseTextDecoration(value: string): string | null {
  const parts = value.trim().toLowerCase().split(/\s+/);
  if (!parts.length || parts.length > 2) return null;
  if (parts.some((part) => part !== 'underline' && part !== 'line-through')) return null;
  return [...new Set(parts)].join(' ');
}

function normaliseFontWeight(value: string): string | null {
  const input = value.trim().toLowerCase();
  if (FONT_WEIGHT.has(input)) return input;
  return /^[1-9]00$/.test(input) ? input : null;
}

type Normaliser = (value: string) => string | null;

const PROPERTIES: Record<string, Normaliser> = {
  'font-family': normaliseFontFamily,
  'font-size': normaliseFontSize,
  color: normaliseColor,
  'background-color': normaliseColor,
  'text-align': (value) => (TEXT_ALIGN.has(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null),
  'text-decoration': normaliseTextDecoration,
  'font-weight': normaliseFontWeight,
  'font-style': (value) => (FONT_STYLE.has(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null),
  'margin-left': normaliseIndent,
};

/** Characters that only appear in escapes, comments, at-rules or markup. */
const UNSAFE_STYLE = /[\\<>{}@\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\/\*|url\s*\(|expression|javascript:|behaviou?r|binding/i;

/**
 * Filters a style attribute for compose HTML. Returns a rebuilt declaration
 * list, or '' when nothing allowed is left (or the tag can't carry styles).
 * A style that contains escapes, comments or any resource-loading syntax is
 * dropped whole rather than parsed around.
 */
export function filterComposeStyle(tagName: string, style: unknown): string {
  if (!COMPOSE_STYLE_TAGS.has(tagName) || typeof style !== 'string' || !style) return '';
  if (style.length > 2048 || UNSAFE_STYLE.test(style)) return '';
  const kept = new Map<string, string>();
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const normalise = PROPERTIES[property];
    if (!normalise) continue;
    const raw = declaration.slice(separator + 1).replace(/\s*!important\s*$/i, '');
    const value = normalise(raw);
    // Later declarations win, as they would in CSS.
    if (value) kept.set(property, value);
    else kept.delete(property);
  }
  return [...kept].map(([property, value]) => `${property}: ${value}`).join('; ');
}
