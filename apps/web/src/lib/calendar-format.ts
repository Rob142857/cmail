// Small, client-safe formatting helpers shared between the message-view
// invite card and the calendar agenda list. Kept out of $lib/server so
// Svelte components can import it directly.

export type Partstat = 'needs-action' | 'accepted' | 'declined' | 'tentative';

const PARTSTAT_LABELS: Record<Partstat, string> = {
  'needs-action': 'Awaiting response',
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
};

export function partstatLabel(value: string): string {
  return PARTSTAT_LABELS[value as Partstat] || PARTSTAT_LABELS['needs-action'];
}

/** One of the app's existing `.badge-*` classes (see app.css) for a partstat. */
export function partstatBadgeClass(value: string): string {
  if (value === 'accepted') return 'badge-success';
  if (value === 'declined') return 'badge-danger';
  if (value === 'tentative') return 'badge-warning';
  return 'badge';
}
