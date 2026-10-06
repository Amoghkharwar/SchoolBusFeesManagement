/**
 * The one place a worker's salary badge is decided, so the list, its filters
 * and the worker screen can never disagree about the same person.
 *
 * The badge is read off the amounts, not trusted from `status` alone: nothing
 * owed on an ended month means nothing is due, whatever the status says. An
 * older server computed status over every month, so a fully paid worker with
 * the current month still running came back "partial". A month still running
 * is "in progress", never "partial" and never "cleared".
 */

/** Less than a rupee left counts as paid — must match _SETTLED_BELOW in
 *  backend/server.py. Salary is typed in whole rupees, so paying the rupees
 *  shown always settles a month, even one whose total carries old paise. */
export const SETTLED_BELOW = 1;

/** An amount still owed, with paise-only leftovers read as nothing. */
export const owed = (n?: number | null): number => (n && n >= SETTLED_BELOW ? n : 0);

export interface WorkerStatusInput {
  period_count: number;
  status: 'pending' | 'partial' | 'completed';
  matured_pending: number;
  total_pending?: number;
  upcoming_pending?: number;
}

export type WorkerBadgeKind = 'none' | 'due' | 'partial' | 'progress' | 'cleared';

export function workerBadgeKind(w: WorkerStatusInput): WorkerBadgeKind {
  if (!w.period_count) return 'none';
  if (owed(w.matured_pending)) return w.status === 'partial' ? 'partial' : 'due';
  const upcoming = w.upcoming_pending ?? Math.max((w.total_pending || 0) - w.matured_pending, 0);
  return owed(upcoming) ? 'progress' : 'cleared';
}

export function workerBadge(
  w: WorkerStatusInput,
  palette: { error: string; warning: string; success: string; muted: string },
): { label: string; color: string } {
  switch (workerBadgeKind(w)) {
    case 'none':
      return { label: 'No Months', color: palette.muted };
    case 'due':
      return { label: 'Salary Due', color: palette.error };
    case 'partial':
      return { label: 'Partly Paid', color: palette.warning };
    case 'progress':
      return { label: 'In Progress', color: palette.muted };
    default:
      return { label: 'Cleared', color: palette.success };
  }
}
