import type { SqlExecutor } from '../platform/sql_executor';

/**
 * A2 queue (spec Section 2): every unsuspended card due before the end of the logical day,
 * oldest due first, from A1, A3, A4 and saved A5 events. A4 cards of a language other
 * than the current target are paused, not deleted. The daily cap limits how many distinct
 * cards are reviewed; a card graded Again (relearning, due again within minutes) stays in
 * the queue so it comes back later in the same session, and does not use up the cap again.
 */
export interface QueuedCard {
  readonly id: string;
  readonly content_item_id: string;
  readonly card_type: 'recognition' | 'production';
  readonly language: string | null;
  readonly due: string;
  readonly state: number;
}

export interface ReviewDayContext {
  readonly dayStart: Date;
  readonly dayEnd: Date;
  readonly cap: number;
  readonly a4Language: string;
}

export interface ReviewProgress {
  readonly queue: readonly QueuedCard[];
  /** Distinct cards reviewed in this logical day. */
  readonly reviewedCards: number;
  /** Review events in this logical day (Again repeats count). */
  readonly reviews: number;
  readonly capReached: boolean;
  /** Due today but beyond the cap. */
  readonly deferred: number;
}

export type A2State = 'complete' | 'incomplete' | 'not_applicable';

export function dueCards(executor: SqlExecutor, context: Pick<ReviewDayContext, 'dayEnd' | 'a4Language'>): QueuedCard[] {
  return executor.all<QueuedCard>(
    `SELECT id, content_item_id, card_type, language, due, state FROM srs_card
     WHERE suspended = 0 AND due < ? AND (language IS NULL OR language = ?)
     ORDER BY due, id`,
    [context.dayEnd.toISOString(), context.a4Language],
  );
}

export function reviewProgress(executor: SqlExecutor, context: ReviewDayContext): ReviewProgress {
  const range = [context.dayStart.toISOString(), context.dayEnd.toISOString()];
  const reviewed = new Set(
    executor
      .all<{ card_id: string }>('SELECT DISTINCT card_id FROM srs_review_log WHERE reviewed_at >= ? AND reviewed_at < ?', range)
      .map((row) => row.card_id),
  );
  const reviews = executor.get<{ n: number }>('SELECT count(*) AS n FROM srs_review_log WHERE reviewed_at >= ? AND reviewed_at < ?', range)?.n ?? 0;
  const due = dueCards(executor, context);
  let slots = Math.max(0, context.cap - reviewed.size);
  const queue: QueuedCard[] = [];
  let deferred = 0;
  for (const card of due) {
    if (reviewed.has(card.id)) {
      queue.push(card);
    } else if (slots > 0) {
      queue.push(card);
      slots -= 1;
    } else {
      deferred += 1;
    }
  }
  return { queue, reviewedCards: reviewed.size, reviews, capReached: reviewed.size >= context.cap, deferred };
}

/** Completion: queue empty or daily cap reached; with nothing due and nothing reviewed, A2 does not apply that day. */
export function a2State(progress: ReviewProgress): A2State {
  if (progress.reviews === 0) return progress.queue.length === 0 ? 'not_applicable' : 'incomplete';
  return progress.queue.length === 0 || progress.capReached ? 'complete' : 'incomplete';
}
