import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit } from '$lib/server/db';
import {
  getOrganisationSignature,
  sanitizeSignature,
  saveOrganisationSignature,
  savePersonalSignature,
} from '$lib/server/signatures';

interface UserSignatureRow {
  id: string;
  email: string;
  display_name: string;
  html_body: string | null;
  plain_text_body: string | null;
  is_locked: number | null;
  updated_at: string | null;
}

function checked(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

function validSignatureFields(form: FormData): { html: string; plainText?: string } | null {
  const html = form.get('html');
  const plainText = form.get('plain_text');
  if (typeof html !== 'string' || html.length > 65_536) return null;
  if (plainText !== null && (typeof plainText !== 'string' || plainText.length > 16_384)) return null;
  return { html, plainText: typeof plainText === 'string' ? plainText : undefined };
}

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { users: [], organisationSignature: { html: '', plainText: '', enabled: false, locked: true } };

  const [users, organisation] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.email, u.display_name,
              ps.html_body, ps.plain_text_body, ps.is_locked, ps.updated_at
         FROM users u
         LEFT JOIN personal_signatures ps ON ps.user_id = u.id
        WHERE u.status IN ('active', 'pending')
        ORDER BY u.display_name COLLATE NOCASE, u.email COLLATE NOCASE, u.id`,
    ).all<UserSignatureRow>(),
    getOrganisationSignature(env.DB),
  ]);
  // Retain the content in the manager editor when disabled so re-enabling does
  // not accidentally replace the stored organisation notice with an empty one.
  const organisationContent = organisation
    ? sanitizeSignature(organisation.html_body, organisation.plain_text_body) || { html: '', plainText: '' }
    : { html: '', plainText: '' };

  return {
    users: (users.results || []).map((user) => {
      const content = user.html_body === null
        ? null
        : sanitizeSignature(user.html_body, user.plain_text_body || '') || { html: '', plainText: '' };
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        personalSignature: content && {
          html: content.html,
          plainText: content.plainText,
          locked: user.is_locked === 1,
          updatedAt: user.updated_at,
        },
      };
    }),
    organisationSignature: {
      html: organisationContent.html,
      plainText: organisationContent.plainText,
      enabled: organisation?.is_enabled === 1,
      locked: organisation?.is_locked !== 0,
    },
  };
};

export const actions: Actions = {
  updateUserSignature: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!locals.user || locals.user.role !== 'manager') return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const userId = form.get('user_id');
    const fields = validSignatureFields(form);
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) return fail(400, { error: 'Choose a valid user' });
    if (!fields) return fail(400, { error: 'Signature HTML must be 64 KB or fewer and plain text 16,384 characters or fewer' });
    const user = await env.DB.prepare(
      `SELECT id FROM users WHERE id = ? AND status IN ('active', 'pending')`,
    ).bind(userId).first<{ id: string }>();
    if (!user) return fail(404, { error: 'User not found' });

    const locked = checked(form.get('is_locked'));
    const saved = await savePersonalSignature(env.DB, {
      userId,
      html: fields.html,
      plainText: fields.plainText,
      isLocked: locked,
      updatedBy: locals.user.id,
    });
    if (!saved) return fail(400, { error: 'This signature is too complex to save safely' });
    await audit(env.DB, {
      event_type: locked ? 'signature.lock' : 'signature.update',
      actor_id: locals.user.id,
      actor_role: 'manager',
      target: userId,
      detail: locked ? 'Updated and locked personal signature' : 'Updated personal signature',
    });
    return { success: 'User signature updated' };
  },

  updateOrganisationSignature: async ({ request, locals, platform }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service unavailable' });
    if (!locals.user || locals.user.role !== 'manager') return fail(403, { error: 'Manager role required' });

    const form = await request.formData();
    const fields = validSignatureFields(form);
    if (!fields) return fail(400, { error: 'Signature HTML must be 64 KB or fewer and plain text 16,384 characters or fewer' });
    const saved = await saveOrganisationSignature(env.DB, {
      html: fields.html,
      plainText: fields.plainText,
      enabled: checked(form.get('enabled')),
      updatedBy: locals.user.id,
    });
    if (!saved) return fail(400, { error: 'This signature is too complex to save safely' });
    await audit(env.DB, {
      event_type: 'signature.update',
      actor_id: locals.user.id,
      actor_role: 'manager',
      target: 'sig-default',
      detail: checked(form.get('enabled')) ? 'Updated organisation signature' : 'Disabled organisation signature',
    });
    return { success: 'Organisation signature updated' };
  },
};
