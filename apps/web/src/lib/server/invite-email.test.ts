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
  it('renders a single Google activation link and no Microsoft link', () => {
    const invite = generateInviteEmail({
      ...baseInvite,
      provider: 'google',
    });

    const expectedLink = 'https://mail.example.com/enroll/google#token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
    expect(invite.html).toContain(expectedLink);
    expect(invite.html).toContain('Activate your mailbox');
    expect(invite.html).toContain("You'll sign in with the Google account this invitation was sent to.");
    expect(invite.html.match(/\/enroll\/google#token=/g)).toHaveLength(1);
    expect(invite.html).not.toContain('/enroll/microsoft');

    expect(invite.text).toContain(`Activate your mailbox: ${expectedLink}`);
    expect(invite.text).toContain("You'll sign in with the Google account this invitation was sent to.");
    expect(invite.text).not.toContain('/enroll/microsoft');
  });

  it('renders a single Microsoft activation link with the Microsoft sentence and no Google link', () => {
    const invite = generateInviteEmail({
      ...baseInvite,
      provider: 'microsoft',
      orgName: '<Example & Co>',
    });

    const expectedLink = 'https://mail.example.com/enroll/microsoft#token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
    expect(invite.html).toContain(expectedLink);
    expect(invite.html).toContain('Activate your mailbox');
    expect(invite.html).toContain(
      "You'll sign in with the Microsoft account this invitation was sent to (work, school, or personal).",
    );
    expect(invite.html.match(/\/enroll\/microsoft#token=/g)).toHaveLength(1);
    expect(invite.html).not.toContain('/enroll/google');
    expect(invite.html).toContain('&lt;Example &amp; Co&gt;');

    expect(invite.text).toContain(`Activate your mailbox: ${expectedLink}`);
    expect(invite.text).not.toContain('/enroll/google');
    expect(invite.text).toContain('only the newest link works');
  });

  it('renders exactly one call-to-action button', () => {
    const invite = generateInviteEmail({ ...baseInvite, provider: 'google' });
    expect(invite.html.match(/class="btn"/g)).toHaveLength(1);
  });
});
