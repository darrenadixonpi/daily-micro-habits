import type { SqlExecutor } from '../platform/sql_executor';

/**
 * A2 queue (spec Section 2). A session has two parts:
 *
 * 1. First pass: every unsuspended card due before the end of the logical day that has not
 *    been reviewed yet today, oldest due first, up to the daily cap (distinct cards). A4
 *    cards of a language other than the current target are paused, not deleted.
 * 2. Learning repeats: cards already reviewed today that FSRS put in a short learning step
 *    (1 or 10 minutes). They come back only once that step has actually passed, after the
 *    first pass, and they are optional: A2 is complete when the first pass is empty or the
 *    cap is reached. (v0.3.0 showed them immediately, so the session never ended.)
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
  /** What the session shows now: the first pass, then learning repeats whose step has passed. */
  readonly queue: readonly QueuedCard[];
  /** Cards due today not yet reviewed today, within the cap. */
  readonly firstPass: readonly QueuedCard[];
  /** Cards reviewed today that are due again later today (learning steps not yet passed). */
  readonly learningLater: readonly QueuedCard[];
  /** Distinct cards reviewed in this logical day. */
  readonly reviewedCards: number;
  /** Review events in this logical day (repeats count). */
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

export function reviewProgress(executor: SqlExecutor, context: ReviewDayContext, now: Date = new Date()): ReviewProgress {
  const range = [context.dayStart.toISOString(), context.dayEnd.toISOString()];
  const reviewed = new Set(
    executor
      .all<{ card_id: string }>('SELECT DISTINCT card_id FROM srs_review_log WHERE reviewed_at >= ? AND reviewed_at < ?', range)
      .map((row) => row.card_id),
  );
  const reviews = executor.get<{ n: number }>('SELECT count(*) AS n FROM srs_review_log WHERE reviewed_at >= ? AND reviewed_at < ?', range)?.n ?? 0;
  let slots = Math.max(0, context.cap - reviewed.size);
  const firstPass: QueuedCard[] = [];
  const learningNow: QueuedCard[] = [];
  const learningLater: QueuedCard[] = [];
  let deferred = 0;
  const nowIso = now.toISOString();
  for (const card of dueCards(executor, context)) {
    if (reviewed.has(card.id)) {
      (card.due <= nowIso ? learningNow : learningLater).push(card);
    } else if (slots > 0) {
      firstPass.push(card);
      slots -= 1;
    } else {
      deferred += 1;
    }
  }
  return {
    queue: [...firstPass, ...learningNow],
    firstPass,
    learningLater,
    reviewedCards: reviewed.size,
    reviews,
    capReached: reviewed.size >= context.cap,
    deferred,
  };
}

/**
 * Completion (spec Section 1: every due card graded): the first pass is empty or the daily
 * cap is reached. With nothing due and nothing reviewed, A2 does not apply that day.
 * Learning repeats never block completion.
 */
export function a2State(progress: ReviewProgress): A2State {
  if (progress.reviews === 0) return progress.firstPass.length === 0 ? 'not_applicable' : 'incomplete';
  return progress.firstPass.length === 0 || progress.capReached ? 'complete' : 'incomplete';
}
