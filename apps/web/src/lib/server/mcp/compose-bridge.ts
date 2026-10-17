// Drafting and sending through MCP deliberately reuse the web app's own
// compose form actions (routes/mail/compose/+page.server.ts) in-process,
// rather than a second copy of the send pipeline. The action re-checks the
// user's mailbox assignment and send permission, the outbound journal,
// storage quota, per-user send/work/draft rate limits, recipient limits,
// attachment rules and signatures exactly as it does for the browser.
//
// The MCP layer adds its own checks first (scope, grant mailboxes, per-grant
// send rate); this bridge only translates arguments into the form fields the
// action already accepts and its result back into plain data.
import { isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import type { User } from '@cmail/shared/types';
import { actions as composeActions } from '../../../routes/mail/compose/+page.server';

export interface ComposeFields {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text authored by the agent. */
  body: string;
  /** Sanitised quoted HTML kept from an existing draft (never agent-supplied). */
  quotedHtml?: string;
  replySourceId?: string;
}

export type BridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

type ComposeAction = (event: RequestEvent) => Promise<unknown>;

function form(fields: ComposeFields, extra: Record<string, string>): FormData {
  const data = new FormData();
  data.set('from', fields.from);
  data.set('to', fields.to.join(', '));
  data.set('cc', fields.cc.join(', '));
  data.set('bcc', fields.bcc.join(', '));
  data.set('subject', fields.subject);
  data.set('body', fields.body);
  data.set('importance', 'normal');
  if (fields.quotedHtml) data.set('quoted_html', fields.quotedHtml);
  if (fields.replySourceId) data.set('reply_source_id', fields.replySourceId);
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

async function invoke(
  action: ComposeAction,
  data: FormData,
  user: User,
  platform: App.Platform,
  origin: string,
): Promise<{ kind: 'data'; data: Record<string, unknown> } | { kind: 'redirect'; location: string } | { kind: 'failure'; status: number; error: string }> {
  const request = new Request(`${origin}/mail/compose`, { method: 'POST', body: data });
  const event = {
    request,
    locals: { user, sessionId: null },
    platform,
    url: new URL(request.url),
  } as unknown as RequestEvent;
  try {
    const result = await action(event);
    if (isActionFailure(result)) {
      const payload = (result.data || {}) as { error?: unknown };
      return { kind: 'failure', status: result.status, error: typeof payload.error === 'string' ? payload.error : 'The request was refused' };
    }
    return { kind: 'data', data: (result || {}) as Record<string, unknown> };
  } catch (caught) {
    if (isRedirect(caught)) return { kind: 'redirect', location: caught.location };
    if (isHttpError(caught)) {
      const body = caught.body as { message?: unknown };
      return { kind: 'failure', status: caught.status, error: typeof body?.message === 'string' ? body.message : 'The request was refused' };
    }
    throw caught;
  }
}

export interface SavedDraft {
  draftId: string;
  draftVersion: number;
}

export async function saveDraft(
  fields: ComposeFields,
  existing: { draftId: string; draftVersion: number } | null,
  user: User,
  platform: App.Platform,
  origin: string,
): Promise<BridgeResult<SavedDraft>> {
  const extra: Record<string, string> = existing
    ? { draft_id: existing.draftId, draft_version: String(existing.draftVersion) }
    : { draft_create_token: crypto.randomUUID() };
  const outcome = await invoke(composeActions.save as ComposeAction, form(fields, extra), user, platform, origin);
  if (outcome.kind === 'failure') return { ok: false, status: outcome.status, error: outcome.error };
  if (outcome.kind === 'redirect') return { ok: false, status: 500, error: 'Unexpected redirect while saving the draft' };
  const draftId = outcome.data.savedDraftId;
  const draftVersion = outcome.data.draftVersion;
  if (typeof draftId !== 'string' || typeof draftVersion !== 'number') {
    return { ok: false, status: 500, error: 'The draft save returned no draft id' };
  }
  return { ok: true, value: { draftId, draftVersion } };
}

export interface SendOutcome {
  partialDelivery: boolean;
}

export async function sendCompose(
  fields: ComposeFields,
  draft: { draftId: string; draftVersion: number } | null,
  composeToken: string,
  user: User,
  platform: App.Platform,
  origin: string,
): Promise<BridgeResult<SendOutcome>> {
  const extra: Record<string, string> = { compose_token: composeToken };
  if (draft) {
    extra.draft_id = draft.draftId;
    extra.draft_version = String(draft.draftVersion);
  }
  const outcome = await invoke(composeActions.send as ComposeAction, form(fields, extra), user, platform, origin);
  if (outcome.kind === 'failure') return { ok: false, status: outcome.status, error: outcome.error };
  if (outcome.kind === 'redirect' && outcome.location.startsWith('/mail?folder=sent')) {
    return { ok: true, value: { partialDelivery: outcome.location.includes('delivery=partial') } };
  }
  return { ok: false, status: 500, error: 'The send finished in an unexpected state. Check the Sent folder before retrying.' };
}
