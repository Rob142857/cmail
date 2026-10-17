import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit } from '$lib/server/db';
import { hasSignedLatestPolicy } from '$lib/server/mcp/access';
import { verifiedClientHost } from '$lib/server/mcp/clients';
import {
  DEFAULT_CONSENT_SCOPES,
  SCOPE_DESCRIPTIONS,
  isMcpEnabled,
  mcpIssuer,
  mcpResource,
} from '$lib/server/mcp/config';
import {
  AuthorizePageError,
  AuthorizeRedirectError,
  answerAuthorizationRequest,
  consentMailboxes,
  errorRedirect,
  loadAuthorizationRequest,
  storeAuthorizationRequest,
  validateAuthorizationRequest,
} from '$lib/server/mcp/oauth';
import { MCP_AUTHORIZE_COOKIE, MCP_RESUME_PATH, mcpAuthorizeCookieOptions } from '$lib/server/mcp/resume';
import { redirectDisplay } from '$lib/server/mcp/redirect-uri';
import { consumeRateLimit } from '$lib/server/rate-limit';

type View =
  | { view: 'error'; message: string }
  | { view: 'signin'; clientName: string }
  | { view: 'disabled'; clientName: string; requestId: string }
  | {
      view: 'consent';
      requestId: string;
      client: { name: string; verifiedHost: string | null; uri: string };
      returnTo: string;
      scopes: Array<{ id: string; label: string; detail: string; risk: string; checked: boolean }>;
      mailboxes: Array<{ id: string; address: string; name: string; type: string; permission: string; checked: boolean }>;
      userEmail: string;
    };

export const load: PageServerLoad = async ({ url, locals, platform, cookies, request, setHeaders }) => {
  setHeaders({ 'Cache-Control': 'no-store', Vary: 'Cookie' });
  const env = platform?.env;
  const envRecord = env as unknown as Record<string, unknown> | undefined;
  const issuer = envRecord ? mcpIssuer(envRecord) : null;
  const resource = envRecord ? mcpResource(envRecord) : null;
  if (!env || !issuer || !resource) {
    return { view: 'error', message: 'AI app connections are not configured on this mail service.' } satisfies View;
  }
  const secure = url.protocol === 'https:';

  if (url.searchParams.has('client_id')) {
    // While the organisation switch is off, a new request is refused before
    // any client lookup, so no client metadata document is ever fetched.
    if (!(await isMcpEnabled(env.DB))) {
      return { view: 'error', message: 'AI app connections are turned off for this organisation. A manager can turn them on in Management › Settings.' } satisfies View;
    }
    // A fresh request from an AI app. Validate, park it in D1, then continue
    // on a clean URL so the code challenge and state leave the address bar.
    const ip = (request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 64);
    const rate = await consumeRateLimit(env.DB, 'oauth_authorize', ip, 60, 10 * 60);
    if (!rate.allowed) return { view: 'error', message: 'Too many sign-in requests. Wait a few minutes and try again.' } satisfies View;
    let validated;
    try {
      validated = await validateAuthorizationRequest(env.DB, url.searchParams, issuer, resource);
    } catch (caught) {
      if (caught instanceof AuthorizeRedirectError) throw redirect(303, caught.redirectTo);
      if (caught instanceof AuthorizePageError) return { view: 'error', message: caught.message } satisfies View;
      throw caught;
    }
    const requestId = await storeAuthorizationRequest(env.DB, validated);
    cookies.set(MCP_AUTHORIZE_COOKIE, requestId, mcpAuthorizeCookieOptions(secure));
    throw redirect(303, MCP_RESUME_PATH);
  }

  const pending = await loadAuthorizationRequest(env.DB, cookies.get(MCP_AUTHORIZE_COOKIE));
  if (!pending) {
    cookies.delete(MCP_AUTHORIZE_COOKIE, { path: '/' });
    return { view: 'error', message: 'This connection request has expired or was already answered. Start again from your AI app.' } satisfies View;
  }

  if (!(await isMcpEnabled(env.DB))) {
    return { view: 'disabled', clientName: pending.client.client_name, requestId: pending.id } satisfies View;
  }
  if (!locals.user || locals.user.status !== 'active') {
    return { view: 'signin', clientName: pending.client.client_name } satisfies View;
  }
  if (!(await hasSignedLatestPolicy(env.DB, locals.user.id))) throw redirect(303, '/policy');

  const mailboxes = await consentMailboxes(env.DB, locals.user.id);
  return {
    view: 'consent',
    requestId: pending.id,
    client: {
      name: pending.client.client_name,
      verifiedHost: verifiedClientHost(pending.client),
      uri: pending.client.client_uri,
    },
    returnTo: redirectDisplay(pending.redirectUri),
    scopes: pending.requestedScopes.map((scope) => ({
      id: scope,
      ...SCOPE_DESCRIPTIONS[scope],
      checked: DEFAULT_CONSENT_SCOPES.includes(scope),
    })),
    mailboxes: mailboxes.map((mailbox) => ({
      id: mailbox.id,
      address: mailbox.address,
      name: mailbox.display_name,
      type: mailbox.type,
      permission: mailbox.permissions,
      checked: mailbox.type === 'personal',
    })),
    userEmail: locals.user.email,
  } satisfies View;
};

export const actions: Actions = {
  decide: async ({ request, locals, platform, cookies }) => {
    const env = platform?.env;
    const envRecord = env as unknown as Record<string, unknown> | undefined;
    const issuer = envRecord ? mcpIssuer(envRecord) : null;
    if (!env || !issuer) return fail(503, { error: 'AI app connections are not configured on this mail service.' });

    const form = await request.formData();
    const requestId = form.get('request_id');
    // The form value must match this browser's cookie: a request id alone,
    // seen elsewhere, cannot be answered from another browser.
    if (typeof requestId !== 'string' || requestId !== cookies.get(MCP_AUTHORIZE_COOKIE)) {
      return fail(400, { error: 'This connection request has expired. Start again from your AI app.' });
    }
    const approve = form.get('decision') === 'approve';
    const enabled = await isMcpEnabled(env.DB);

    if (!approve || !enabled) {
      const pending = await loadAuthorizationRequest(env.DB, requestId);
      if (!pending) return fail(404, { error: 'This connection request has expired. Start again from your AI app.' });
      await env.DB.prepare('DELETE FROM mcp_auth_requests WHERE id = ?').bind(requestId).run();
      cookies.delete(MCP_AUTHORIZE_COOKIE, { path: '/' });
      if (locals.user) {
        await audit(env.DB, {
          event_type: 'mcp.consent_denied',
          actor_id: locals.user.id,
          actor_role: locals.user.role,
          detail: `Declined AI app "${pending.client.client_name.slice(0, 80)}"`,
        });
      }
      return {
        done: true,
        approved: false,
        clientName: pending.client.client_name,
        redirectTo: errorRedirect(issuer, pending.redirectUri, pending.state, 'access_denied',
          enabled ? 'The user denied the request' : 'AI agent connections are turned off for this organisation'),
      };
    }

    if (!locals.user || locals.user.status !== 'active') return fail(401, { error: 'Sign in again to continue.' });
    if (!(await hasSignedLatestPolicy(env.DB, locals.user.id))) throw redirect(303, '/policy');

    const outcome = await answerAuthorizationRequest(env.DB, issuer, requestId, locals.user, {
      approve: true,
      scopes: form.getAll('scope').filter((value): value is string => typeof value === 'string').slice(0, 10),
      mailboxIds: form.getAll('mailbox').filter((value): value is string => typeof value === 'string').slice(0, 200),
    });
    if (!outcome.ok) {
      if (outcome.status === 404) cookies.delete(MCP_AUTHORIZE_COOKIE, { path: '/' });
      return fail(outcome.status, { error: outcome.message });
    }
    cookies.delete(MCP_AUTHORIZE_COOKIE, { path: '/' });
    await audit(env.DB, {
      event_type: 'mcp.grant_created',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: outcome.grantId,
      detail: `Connected AI app "${outcome.client.client_name.slice(0, 80)}" with ${outcome.scopes.join(' ')}`,
      session_id: locals.sessionId,
    });
    return { done: true, approved: true, clientName: outcome.client.client_name, redirectTo: outcome.redirectTo };
  },
};
