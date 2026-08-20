import { describe, expect, it } from 'vitest';
import { actions } from './+page.server';

const user = {
  id: 'user-1',
  email: 'robert.evans@cliomuseum.org',
  display_name: 'Robert Evans',
  role: 'manager' as const,
  status: 'active' as const,
  auth_provider: 'google' as const,
  created_at: '2026-08-17 00:00:00',
  updated_at: '2026-08-17 00:00:00',
  last_sign_in: null,
  last_auth_country: null,
};

/**
 * Both cases below are rejected purely by formData parsing, before the send
 * action makes its first D1 call (mailbox lookup / journal lookup) — so no
 * database or storage mock is needed to observe them.
 */
function sendRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new Request('https://mail.cliomuseum.org/mail/compose?/send', {
    method: 'POST',
    body: formData,
  });
}

describe('compose send: recipient cap and Bcc dedupe', () => {
  it('rejects when To + Cc + Bcc combined exceed the configured recipient cap', async () => {
    const result = await (actions.send as any)({
      request: sendRequest({
        from: 'robert.evans@cliomuseum.org',
        to: 'one@example.net',
        cc: 'two@example.net',
        bcc: 'three@example.net, four@example.net',
        subject: 'Cap regression',
        body: 'Hello',
        importance: 'normal',
        compose_token: '11111111-1111-4111-8111-111111111111',
      }),
      locals: { user, sessionId: 'session-1' },
      platform: { env: { MAX_RECIPIENTS_PER_MESSAGE: '3' } },
    });

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'Max 3 recipients per message' },
    });
  });

  it('silently drops a Bcc address already present in To or Cc before applying the cap', async () => {
    // Without dedupe this would be 3 distinct addresses against a cap of 2
    // and fail with the recipient-cap error instead.
    const result = await (actions.send as any)({
      request: sendRequest({
        from: 'robert.evans@cliomuseum.org',
        to: 'one@example.net',
        cc: 'two@example.net',
        bcc: 'ONE@example.net',
        subject: 'Dedupe regression',
        body: 'Hello',
        importance: 'normal',
        // Deliberately omitted so the send fails on the very next check
        // (compose_token) once dedupe has correctly cleared the cap check.
      }),
      locals: { user, sessionId: 'session-1' },
      platform: { env: { MAX_RECIPIENTS_PER_MESSAGE: '2' } },
    });

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'This compose form expired. Reload and try again.' },
    });
  });

  it('rejects an invalid Bcc address the same way as an invalid Cc address', async () => {
    const result = await (actions.send as any)({
      request: sendRequest({
        from: 'robert.evans@cliomuseum.org',
        to: 'one@example.net',
        // A real submission always includes cc (empty string when unused) —
        // EmailAutocomplete's bound input never omits the field entirely.
        cc: '',
        bcc: 'not-an-address',
        subject: 'Invalid Bcc regression',
        body: 'Hello',
        importance: 'normal',
        compose_token: '11111111-1111-4111-8111-111111111111',
      }),
      locals: { user, sessionId: 'session-1' },
      platform: { env: {} },
    });

    expect(result).toMatchObject({
      status: 400,
      data: { error: expect.stringContaining('Invalid email address') },
    });
  });
});
