import { sanitizeBoundedEmailHtml } from '@cmail/shared/sanitize-email';

const SIGNATURE_LIMITS = {
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 64 * 1024,
  maxElements: 1_000,
  maxDepth: 32,
} as const;
const MAX_PLAIN_TEXT_LENGTH = 16_384;

export interface StoredPersonalSignature {
  user_id: string;
  html_body: string;
  plain_text_body: string;
  is_locked: number;
  updated_at: string;
  updated_by: string | null;
}

export interface StoredOrganisationSignature {
  id: string;
  html_body: string;
  plain_text_body: string;
  is_locked: number;
  is_enabled: number;
}

export interface SanitizedSignature {
  html: string;
  plainText: string;
}

export interface EffectiveSignature {
  html: string;
  text: string;
  personalHtml: string;
  personalText: string;
  organisationHtml: string;
  organisationText: string;
  personalLocked: boolean;
}

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(?:address|article|blockquote|div|h[1-6]|li|p|pre|section|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizePlainText(value: string): string {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, MAX_PLAIN_TEXT_LENGTH)
    .trim();
}

function removeSignatureImages(html: string): string {
  // Email signatures are sent to every recipient. Even a one-pixel remote
  // image can disclose the recipient's IP address and open time, so this
  // stricter layer removes all images after the general email sanitizer.
  return html.replace(/<img\b[^>]*>/gi, '');
}

/** Applies the parser-backed email sanitizer with signature-specific limits. */
export function sanitizeSignature(html: string, plainText = ''): SanitizedSignature | null {
  const result = sanitizeBoundedEmailHtml(html, SIGNATURE_LIMITS);
  if (!result.ok) return null;
  const safeHtml = removeSignatureImages(result.html).trim();
  return {
    html: safeHtml,
    plainText: sanitizePlainText(plainText) || plainTextFromHtml(safeHtml),
  };
}

function sanitizedStoredSignature(signature: { html_body: string; plain_text_body: string } | null): SanitizedSignature {
  return sanitizeSignature(signature?.html_body || '', signature?.plain_text_body || '') || { html: '', plainText: '' };
}

function signatureBlock(layer: 'personal' | 'organisation', html: string): string {
  return html ? `<div data-cmail-signature="${layer}">${html}</div>` : '';
}

/** Adds one separator between authored content and the first generated layer. */
export function appendSignatureToAuthoredHtml(authoredHtml: string, signatureHtml: string): string {
  if (!signatureHtml) return authoredHtml;
  return `${authoredHtml}${authoredHtml ? '<br>' : ''}${signatureHtml}`;
}

export async function getPersonalSignature(db: D1Database, userId: string): Promise<StoredPersonalSignature | null> {
  return db.prepare(
    `SELECT user_id, html_body, plain_text_body, is_locked, updated_at, updated_by
       FROM personal_signatures WHERE user_id = ?`,
  ).bind(userId).first<StoredPersonalSignature>();
}

export async function getOrganisationSignature(
  db: D1Database,
  mailboxAddress = '',
): Promise<StoredOrganisationSignature | null> {
  if (!mailboxAddress) {
    return db.prepare(
      `SELECT id, html_body, plain_text_body, is_locked, is_enabled
         FROM signature_templates WHERE applies_to = '*' LIMIT 1`,
    ).first<StoredOrganisationSignature>();
  }
  return db.prepare(
    `SELECT id, html_body, plain_text_body, is_locked, is_enabled
       FROM signature_templates
      WHERE applies_to = '*' OR applies_to = ?
      ORDER BY CASE WHEN applies_to = ? THEN 0 ELSE 1 END LIMIT 1`,
  ).bind(mailboxAddress, mailboxAddress).first<StoredOrganisationSignature>();
}

/** Personal content is deliberately first, so an organisation notice remains last. */
export async function getEffectiveSignature(
  db: D1Database,
  userId: string,
  mailboxAddress: string,
): Promise<EffectiveSignature> {
  const [personal, organisation] = await Promise.all([
    getPersonalSignature(db, userId),
    getOrganisationSignature(db, mailboxAddress),
  ]);
  const personalContent = sanitizedStoredSignature(personal);
  const organisationContent = organisation?.is_enabled === 1
    ? sanitizedStoredSignature(organisation)
    : { html: '', plainText: '' };
  return {
    personalHtml: personalContent.html,
    personalText: personalContent.plainText,
    organisationHtml: organisationContent.html,
    organisationText: organisationContent.plainText,
    // Each trusted, generated wrapper is block-level, so raw inline fragments
    // cannot run into one another in clients that ignore authored styles.
    html: [
      signatureBlock('personal', personalContent.html),
      signatureBlock('organisation', organisationContent.html),
    ].filter(Boolean).join(''),
    text: [personalContent.plainText, organisationContent.plainText].filter(Boolean).join('\n\n'),
    personalLocked: personal?.is_locked === 1,
  };
}

export async function savePersonalSignature(
  db: D1Database,
  input: {
    userId: string;
    html: string;
    plainText?: string;
    isLocked: boolean;
    updatedBy: string;
    /** User self-service must never overwrite a lock applied concurrently. */
    onlyIfUnlocked?: boolean;
  },
): Promise<SanitizedSignature | null> {
  const signature = sanitizeSignature(input.html, input.plainText || '');
  if (!signature) return null;
  const result = await db.prepare(
    `INSERT INTO personal_signatures
       (user_id, html_body, plain_text_body, is_locked, updated_at, updated_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(user_id) DO UPDATE SET
       html_body = excluded.html_body, plain_text_body = excluded.plain_text_body,
       is_locked = excluded.is_locked, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by
     WHERE ? = 0 OR personal_signatures.is_locked = 0`,
  ).bind(
    input.userId,
    signature.html,
    signature.plainText,
    input.isLocked ? 1 : 0,
    input.updatedBy,
    input.onlyIfUnlocked ? 1 : 0,
  ).run();
  if (input.onlyIfUnlocked && Number(result.meta?.changes || 0) === 0) return null;
  return signature;
}

export async function saveOrganisationSignature(
  db: D1Database,
  input: { html: string; plainText?: string; enabled: boolean; updatedBy: string },
): Promise<SanitizedSignature | null> {
  const signature = sanitizeSignature(input.html, input.plainText || '');
  if (!signature) return null;
  await db.prepare(
    `INSERT INTO signature_templates
       (id, name, applies_to, html_body, plain_text_body, is_locked, is_enabled, updated_at, updated_by)
     VALUES ('sig-default', 'Organisation signature', '*', ?, ?, 1, ?, datetime('now'), ?)
     ON CONFLICT(id) DO UPDATE SET
       html_body = excluded.html_body, plain_text_body = excluded.plain_text_body,
       is_enabled = excluded.is_enabled, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).bind(signature.html, signature.plainText, input.enabled ? 1 : 0, input.updatedBy).run();
  return signature;
}
