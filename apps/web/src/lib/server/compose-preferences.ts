import {
  DEFAULT_COMPOSE_DEFAULTS,
  isComposeFontName,
  isComposeFontSize,
  normaliseComposeDefaults,
  type ComposeDefaults,
} from '@cmail/shared/compose-style';

interface StoredComposePreferences {
  font_family: string;
  font_size_pt: number;
}

/**
 * The font and size this person's new messages, replies and forwards start
 * in. No row (or a value from a future font list) means Outlook's default.
 */
export async function getComposeDefaults(db: D1Database, userId: string): Promise<ComposeDefaults> {
  try {
    const row = await db.prepare(
      'SELECT font_family, font_size_pt FROM compose_preferences WHERE user_id = ?',
    ).bind(userId).first<StoredComposePreferences>();
    return row ? normaliseComposeDefaults(row.font_family, row.font_size_pt) : { ...DEFAULT_COMPOSE_DEFAULTS };
  } catch {
    // Before the migration runs, compose still works with the default font.
    return { ...DEFAULT_COMPOSE_DEFAULTS };
  }
}

export type ComposeDefaultsInput =
  | { ok: true; defaults: ComposeDefaults }
  | { ok: false; error: string };

/** Form values are untrusted: only a font and size from the fixed lists are accepted. */
export function parseComposeDefaultsForm(form: FormData): ComposeDefaultsInput {
  const fontFamily = form.get('font_family');
  const fontSize = form.get('font_size_pt');
  if (typeof fontFamily !== 'string' || !isComposeFontName(fontFamily)) {
    return { ok: false, error: 'Choose a font from the list' };
  }
  if (typeof fontSize !== 'string' || !isComposeFontSize(fontSize)) {
    return { ok: false, error: 'Choose a font size from the list' };
  }
  return { ok: true, defaults: normaliseComposeDefaults(fontFamily, fontSize) };
}

export async function saveComposeDefaults(db: D1Database, userId: string, defaults: ComposeDefaults): Promise<void> {
  const { fontFamily, fontSizePt } = normaliseComposeDefaults(defaults.fontFamily, defaults.fontSizePt);
  await db.prepare(
    `INSERT INTO compose_preferences (user_id, font_family, font_size_pt, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       font_family = excluded.font_family, font_size_pt = excluded.font_size_pt,
       updated_at = excluded.updated_at`,
  ).bind(userId, fontFamily, fontSizePt).run();
}
