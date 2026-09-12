/** SQL predicate for mailbox-visible messages, including draft ownership. */
export function messageOwnershipPredicate(alias: 'm' | 'messages' = 'm'): string {
  return `((${alias}.folder <> 'drafts' AND ${alias}.draft_owner_id IS NULL) OR ${alias}.draft_owner_id = ?)`;
}
