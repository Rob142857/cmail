import { describe, expect, it } from 'vitest';
import {
  mailboxPermissionDescription,
  mailboxPermissionLabel,
  parseMailboxStatusFilter,
  parseMailboxTypeFilter,
} from './mailbox-management';

describe('mailbox management vocabulary', () => {
  it('maps stored permissions to familiar, truthful labels', () => {
    expect(mailboxPermissionLabel('read')).toBe('Read access');
    expect(mailboxPermissionLabel('send-as')).toBe('Send as');
    expect(mailboxPermissionLabel('full')).toBe('Full access');
  });

  it('states the bundled permission hierarchy', () => {
    expect(mailboxPermissionDescription('send-as')).toContain('Includes Read access');
    expect(mailboxPermissionDescription('full')).toContain('Includes Send as');
    expect(mailboxPermissionDescription('read')).not.toContain('sending');
  });
});

describe('mailbox inventory filters', () => {
  it('accepts only supported mailbox types', () => {
    expect(parseMailboxTypeFilter('shared')).toBe('shared');
    expect(parseMailboxTypeFilter('personal')).toBe('personal');
    expect(parseMailboxTypeFilter('room')).toBe('');
    expect(parseMailboxTypeFilter(null)).toBe('');
  });

  it('accepts only supported mailbox statuses', () => {
    expect(parseMailboxStatusFilter('active')).toBe('active');
    expect(parseMailboxStatusFilter('disabled')).toBe('disabled');
    expect(parseMailboxStatusFilter('deleted')).toBe('');
    expect(parseMailboxStatusFilter(null)).toBe('');
  });
});
