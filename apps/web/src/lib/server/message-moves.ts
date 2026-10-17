/**
 * Which folders a message may be moved into, keyed by destination, listing
 * the allowed source folders. Shared by the message APIs and MCP tools so
 * every path enforces the same rules (for example, Sent can only go to Trash
 * and Drafts can never be moved this way).
 */
export const MOVE_FOLDERS = ['inbox', 'archive', 'spam', 'trash'] as const;
export type MoveFolder = (typeof MOVE_FOLDERS)[number];

export const MOVE_SOURCES: Record<MoveFolder, readonly string[]> = {
  inbox: ['archive', 'spam'],
  archive: ['inbox'],
  spam: ['inbox', 'archive'],
  trash: ['inbox', 'sent', 'archive', 'spam'],
};

export function isMoveFolder(value: string): value is MoveFolder {
  return (MOVE_FOLDERS as readonly string[]).includes(value);
}
