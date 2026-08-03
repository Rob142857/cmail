import { describe, expect, it } from 'vitest';
import { generateInviteEmail } from './invite-email';

const baseInvite = {
  email: 'person@example.com',
  displayName: 'Example Person',
  appName: 'cmail',
  appUrl: 'https://mail.example.com',
  senderName: 'Workspace manager',
  enrollmentToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
};

describe('generateInviteEmail', () => {
  it('only includes sign-in links for configured identity providers', () => {
    const invite = generateInviteEmail({
      ...baseInvite,
      authProviders: ['google'],
    });

    expect(invite.html).toContain('https://mail.example.com/enroll/google#token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ');
    expect(invite.text).toContain('Google: https://mail.example.com/enroll/google#token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ');
    expect(invite.html).not.toContain('/enroll/microsoft');
    expect(invite.text).not.toContain('Microsoft:');
  });

  it('deduplicates providers and escapes organisation content in HTML', () => {
    const invite = generateInviteEmail({
      ...baseInvite,
      authProviders: ['microsoft', 'microsoft'],
      orgName: '<Example & Co>',
    });

    expect(invite.html).toContain('&lt;Example &amp; Co&gt;');
    expect(invite.html.match(/\/enroll\/microsoft#token=/g)).toHaveLength(1);
    expect(invite.text).toContain('only the newest link works');
  });
});
