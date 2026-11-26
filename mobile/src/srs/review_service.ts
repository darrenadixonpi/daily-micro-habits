import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import {
  deserializeSchedulerObject,
  serializeSchedulerObject,
  type AppScheduler,
  type SchedulerCard,
  type SchedulerGrade,
} from './fsrs_scheduler';

export type CardType = 'recognition' | 'production';

interface SrsCardRow {
  readonly id: string;
  readonly scheduler_card_json: string;
  readonly suspended: number;
}

const DAY_MS = 86_400_000;

/**
 * Creates a New card for a content item. Per spec Section 5 a new card is due
 * tomorrow; `dueAt` is passed in by the caller so the rule stays in one place.
 */
export function createSrsCard(
  executor: SqlExecutor,
  scheduler: AppScheduler,
  input: {
    readonly cardId: string;
    readonly contentItemId: string;
    readonly cardType: CardType;
    readonly language: string | null;
    readonly now: Date;
    readonly dueAt: Date;
  },
): SchedulerCard {
  const card = { ...scheduler.newCard({ now: input.now, cardId: input.cardId }), dueAt: input.dueAt } as SchedulerCard;
  executor.run(
    `INSERT INTO srs_card (id, content_item_id, card_type, language, due, stability, difficulty, scheduled_days,
       learning_step, reps, lapses, state, schedule_status, last_review, suspended, scheduler_card_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      input.cardId, input.contentItemId, input.cardType, input.language, ...cardColumnValues(card),
      serializeSchedulerObject(card), input.now.toISOString(),
    ],
  );
  return card;
}

export function loadSrsCard(executor: SqlExecutor, cardId: string): SchedulerCard {
  const row = executor.get<SrsCardRow>('SELECT id, scheduler_card_json, suspended FROM srs_card WHERE id = ?', [
    cardId,
  ]);
  if (!row) throw new Error(`No srs_card with id ${cardId}`);
  return deserializeSchedulerObject<SchedulerCard>(row.scheduler_card_json);
}

/** Test hook for diagnostic T4: throw after the card update but before the log insert. */
export type ReviewFaultInjection = 'none' | 'fail_after_card_update';

/**
 * Records one review: the updated card and its review-log row are written in one
 * transaction, so a failure cannot leave a card updated without its log (spec Section 5).
 */
export function recordReview(
  executor: SqlExecutor,
  scheduler: AppScheduler,
  input: {
    readonly cardId: string;
    readonly grade: SchedulerGrade;
    readonly now: Date;
    readonly responseMs: number | null;
    readonly faultInjection?: ReviewFaultInjection;
  },
): SchedulerCard {
  return runInTransaction(executor, () => {
    const before = loadSrsCard(executor, input.cardId);
    const result = scheduler.review({ card: before, grade: input.grade, now: input.now });
    const after = result.card as SchedulerCard;
    executor.run(
      `UPDATE srs_card SET due = ?, stability = ?, difficulty = ?, scheduled_days = ?, learning_step = ?, reps = ?,
         lapses = ?, state = ?, schedule_status = ?, last_review = ?, scheduler_card_json = ? WHERE id = ?`,
      [...cardColumnValues(after), serializeSchedulerObject(after), input.cardId],
    );
    if (input.faultInjection === 'fail_after_card_update') {
      throw new Error('Injected fault after card update');
    }
    const elapsedDays = before.lastReviewAt
      ? Math.max(0, (input.now.getTime() - before.lastReviewAt.getTime()) / DAY_MS)
      : 0;
    executor.run(
      `INSERT INTO srs_review_log (card_id, grade, reviewed_at, elapsed_days, scheduled_days, response_ms,
         state_before, revlog_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.cardId, input.grade, input.now.toISOString(), elapsedDays, after.scheduledDays, input.responseMs,
        before.state, serializeSchedulerObject(result.revlog),
      ],
    );
    return after;
  });
}

/** Values for: due, stability, difficulty, scheduled_days, learning_step, reps, lapses, state, schedule_status, last_review. */
function cardColumnValues(card: SchedulerCard): (string | number | null)[] {
  return [
    card.dueAt.toISOString(), card.stability, card.difficulty, card.scheduledDays, card.learningStep, card.reps,
    card.lapses, card.state, card.scheduleStatus, card.lastReviewAt ? card.lastReviewAt.toISOString() : null,
  ];
}
