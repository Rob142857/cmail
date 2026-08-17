import { sanitizeBoundedEmailHtml } from '@cmail/shared/sanitize-email';
import type { Root, RootContent } from 'hast';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';

const SIGNATURE_LIMITS = {
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 64 * 1024,
  maxElements: 1_000,
  maxDepth: 32,
} as const;
const MAX_PLAIN_TEXT_LENGTH = 16_384;
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'p', 'pre', 'section', 'tr',
]);
const signatureParser = unified().use(rehypeParse, { fragment: true });

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

function appendVisibleText(node: RootContent, output: string[]): void {
  if (node.type === 'text') {
    output.push(node.value);
    return;
  }
  if (node.type !== 'element') return;
  if (node.tagName === 'br') output.push('\n');
  // A void element such as img has no children, so it contributes nothing
  // here; the plain-text fallback never contains image markup or alt text.
  for (const child of node.children) appendVisibleText(child, output);
  if (BLOCK_ELEMENTS.has(node.tagName)) output.push('\n');
}

function deriveSignatureText(html: string): string {
  const tree = signatureParser.parse(html) as Root;
  const output: string[] = [];
  for (const node of tree.children) appendVisibleText(node, output);
  // Entity references are decoded once by the HTML parser. A tree walk
  // avoids recursive unescaping and never treats decoded text as markup.
  return output.join('').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizePlainText(value: string): string {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, MAX_PLAIN_TEXT_LENGTH)
    .trim();
}

/** Applies the parser-backed email sanitizer with signature-specific limits. */
export function sanitizeSignature(html: string, plainText = ''): SanitizedSignature | null {
  const result = sanitizeBoundedEmailHtml(html, SIGNATURE_LIMITS);
  if (!result.ok) return null;
  // Images are permitted: the shared sanitizer already restricts `src` to
  // https/cid/data:image and forces loading="lazy" and no-referrer, which is
  // enough to keep a signature logo without disclosing the reader to it.
  return {
    html: result.html,
    plainText: sanitizePlainText(plainText) || sanitizePlainText(deriveSignatureText(result.html)),
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
