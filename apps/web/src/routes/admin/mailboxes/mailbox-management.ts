import type { Mailbox, MailboxAssignment } from '@cmail/shared/types';

export const MAILBOX_PERMISSIONS = ['read', 'send-as', 'full'] as const satisfies readonly MailboxAssignment['permissions'][];
export const MAILBOX_STATUSES = ['active', 'disabled'] as const satisfies readonly Mailbox['status'][];
export const MAILBOX_TYPES = ['shared', 'personal'] as const satisfies readonly Mailbox['type'][];

export function parseMailboxTypeFilter(value: string | null): Mailbox['type'] | '' {
  return value && (MAILBOX_TYPES as readonly string[]).includes(value)
    ? value as Mailbox['type']
    : '';
}

export function parseMailboxStatusFilter(value: string | null): Mailbox['status'] | '' {
  return value && (MAILBOX_STATUSES as readonly string[]).includes(value)
    ? value as Mailbox['status']
    : '';
}

export function mailboxPermissionLabel(permission: MailboxAssignment['permissions']): string {
  if (permission === 'read') return 'Read access';
  if (permission === 'send-as') return 'Send as';
  return 'Full access';
}

export function mailboxPermissionDescription(permission: MailboxAssignment['permissions']): string {
  if (permission === 'read') return 'Open messages and mark them read or unread.';
  if (permission === 'send-as') return 'Includes Read access and sending from this address.';
  return 'Includes Send as plus shared folder, star, archive, Trash, restore, and permanent-delete control.';
}
