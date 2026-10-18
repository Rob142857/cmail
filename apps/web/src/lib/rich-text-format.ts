// Palettes and small pure helpers for the compose formatting bar. Nothing here
// imports the editor, so it is cheap to load and easy to test. The server
// re-sanitizes every body with the allowlist in packages/shared/src/compose-style.ts.

import {
  COMPOSE_FONTS,
  COMPOSE_INDENT_STEP_PX,
  COMPOSE_MAX_INDENT_LEVEL,
  composeFontByName,
} from '@cmail/shared/compose-style';

export interface Swatch {
  name: string;
  value: string;
}

/** Outlook's "Standard colours" row, plus black, greys and white. */
export const TEXT_COLORS: readonly Swatch[] = Object.freeze([
  { name: 'Black', value: '#000000' },
  { name: 'Dark grey', value: '#404040' },
  { name: 'Grey', value: '#7f7f7f' },
  { name: 'Light grey', value: '#bfbfbf' },
  { name: 'White', value: '#ffffff' },
  { name: 'Dark red', value: '#c00000' },
  { name: 'Red', value: '#ff0000' },
  { name: 'Orange', value: '#ffc000' },
  { name: 'Yellow', value: '#ffff00' },
  { name: 'Light green', value: '#92d050' },
  { name: 'Green', value: '#00b050' },
  { name: 'Light blue', value: '#00b0f0' },
  { name: 'Blue', value: '#0070c0' },
  { name: 'Dark blue', value: '#002060' },
  { name: 'Purple', value: '#7030a0' },
]);

/** Word and Outlook's highlighter colours. */
export const HIGHLIGHT_COLORS: readonly Swatch[] = Object.freeze([
  { name: 'Yellow', value: '#ffff00' },
  { name: 'Bright green', value: '#00ff00' },
  { name: 'Turquoise', value: '#00ffff' },
  { name: 'Pink', value: '#ff00ff' },
  { name: 'Blue', value: '#0000ff' },
  { name: 'Red', value: '#ff0000' },
  { name: 'Dark blue', value: '#000080' },
  { name: 'Teal', value: '#008080' },
  { name: 'Green', value: '#008000' },
  { name: 'Violet', value: '#800080' },
  { name: 'Dark red', value: '#800000' },
  { name: 'Dark yellow', value: '#808000' },
  { name: 'Grey 50%', value: '#808080' },
  { name: 'Grey 25%', value: '#c0c0c0' },
  { name: 'Black', value: '#000000' },
]);

/** The stack the editor stores for a font picked from the menu. */
export function fontStack(name: string): string {
  return composeFontByName(name)?.stack ?? COMPOSE_FONTS[0].stack;
}

/** Menu name for a stored font-family value; '' when it isn't one of ours. */
export function fontNameFromFamily(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const first = value.split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2');
  return composeFontByName(first)?.name ?? '';
}

/** Size in pt for a stored font-size ("12pt", "16px"); null when unknown. */
export function fontSizePt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)(pt|px)$/i.exec(value.trim());
  if (!match) return null;
  const size = Number(match[1]);
  return match[2].toLowerCase() === 'pt' ? size : Math.round(size * 0.75 * 2) / 2;
}

/** Indent level (0-8) from a margin-left in px, pt or em. */
export function indentLevelFromMargin(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = /^(\d+(?:\.\d+)?)(px|pt|em)$/i.exec(value.trim());
  if (!match) return 0;
  const unit = match[2].toLowerCase();
  const px = Number(match[1]) * (unit === 'pt' ? 4 / 3 : unit === 'em' ? 16 : 1);
  return Math.max(0, Math.min(COMPOSE_MAX_INDENT_LEVEL, Math.round(px / COMPOSE_INDENT_STEP_PX)));
}

export function indentMargin(level: number): string | null {
  const clamped = Math.max(0, Math.min(COMPOSE_MAX_INDENT_LEVEL, Math.round(level)));
  return clamped ? `${clamped * COMPOSE_INDENT_STEP_PX}px` : null;
}

/** Ctrl on Windows, Linux, Android and ChromeOS; ⌘ on Apple devices. */
export function shortcutLabel(keys: string, apple = false): string {
  return apple ? keys.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧') : keys;
}
