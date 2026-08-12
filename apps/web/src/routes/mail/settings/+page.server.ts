import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit } from '$lib/server/db';
import {
  getOrganisationSignature,
  getPersonalSignature,
  sanitizeSignature,
  savePersonalSignature,
  type StoredPersonalSignature,
} from '$lib/server/signatures';

function publicPersonalSignature(signature: StoredPersonalSignature | null) {
  if (!signature) return null;
  const content = sanitizeSignature(signature.html_body, signature.plain_text_body) || { html: '', plainText: '' };
  return {
    html: content.html,
    plainText: content.plainText,
    locked: signature.is_locked === 1,
    updatedAt: signature.updated_at,
  };
}

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) return { personalSignature: null, organisationSignature: { html: '', plainText: '', enabled: false, locked: true } };

  const [personal, organisation] = await Promise.all([
    getPersonalSignature(env.DB, locals.user.id),
    getOrganisationSignature(env.DB),
  ]);
  const organisationContent = organisation?.is_enabled === 1
    ? sanitizeSignature(organisation.html_body, organisation.plain_text_body) || { html: '', plainText: '' }
    : { html: '', plainText: '' };

  return {
    personalSignature: publicPersonalSignature(personal),
    organisationSignature: {
      html: organisationContent.html,
      plainText: organisationContent.plainText,
      enabled: organisation?.is_enabled === 1,
      locked: organisation?.is_locked !== 0,
    },
  };
};

export const actions: Actions = {
  savePersonal: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });

    const existing = await getPersonalSignature(env.DB, locals.user.id);
    if (existing?.is_locked === 1) {
      return fail(403, { error: 'Your personal signature is managed by an administrator' });
    }

    const form = await request.formData();
    const html = form.get('html');
    const plainText = form.get('plain_text');
    if (typeof html !== 'string' || html.length > 65_536) {
      return fail(400, { error: 'Signature HTML must be 64 KB or fewer' });
    }
    if (plainText !== null && (typeof plainText !== 'string' || plainText.length > 16_384)) {
      return fail(400, { error: 'Plain-text signature must be 16,384 characters or fewer' });
    }

    const saved = await savePersonalSignature(env.DB, {
      userId: locals.user.id,
      html,
      plainText: typeof plainText === 'string' ? plainText : undefined,
      isLocked: false,
      updatedBy: locals.user.id,
      onlyIfUnlocked: true,
    });
    if (!saved) {
      const current = await getPersonalSignature(env.DB, locals.user.id);
      if (current?.is_locked === 1) {
        return fail(403, { error: 'Your personal signature is managed by an administrator' });
      }
      return fail(400, { error: 'The signature is too complex or could not be safely processed' });
    }

    await audit(env.DB, {
      event_type: 'signature.update',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: locals.user.id,
      detail: 'Updated personal signature',
    });
    return { success: 'Personal signature saved' };
  },
};
