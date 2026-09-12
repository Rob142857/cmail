import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { messageOwnershipPredicate } from './message-access';

function visible(folder: string, owner: string | null, userId: string): boolean {
  const db = new DatabaseSync(':memory:');
  try {
    // Exercise the actual SQL used by the routes, including SQLite NULL logic.
    return !!db.prepare(`SELECT 1 FROM (SELECT ? AS folder, ? AS draft_owner_id) m WHERE ${messageOwnershipPredicate('m')}`)
      .get(folder, owner, userId);
  } finally { db.close(); }
}

describe('mailbox message ownership policy', () => {
  const userId = 'user-1';

  it.each([
    ['own draft', { folder: 'drafts', draft_owner_id: userId }, true],
    ['foreign draft', { folder: 'drafts', draft_owner_id: 'user-2' }, false],
    ['unowned legacy draft', { folder: 'drafts', draft_owner_id: null }, false],
    ['foreign trashed draft', { folder: 'trash', draft_owner_id: 'user-2' }, false],
    ['normal unowned inbox', { folder: 'inbox', draft_owner_id: null }, true],
  ] as const)('%s has expected visibility', (_label, record, expected) => {
    expect(visible(record.folder, record.draft_owner_id, userId)).toBe(expected);
  });

  it('keeps ownership when an owned draft is moved to another folder', () => {
    const moved = { folder: 'trash', draft_owner_id: userId };
    expect(visible(moved.folder, moved.draft_owner_id, userId)).toBe(true);
    expect(visible(moved.folder, moved.draft_owner_id, 'user-2')).toBe(false);
  });

  it('emits the fail-closed SQL shape for both query aliases', () => {
    expect(messageOwnershipPredicate('m')).toBe(
      "((m.folder <> 'drafts' AND m.draft_owner_id IS NULL) OR m.draft_owner_id = ?)",
    );
    expect(messageOwnershipPredicate('messages')).toBe(
      "((messages.folder <> 'drafts' AND messages.draft_owner_id IS NULL) OR messages.draft_owner_id = ?)",
    );
  });
});
