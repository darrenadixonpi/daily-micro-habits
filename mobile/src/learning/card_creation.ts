import type { SqlExecutor } from '../platform/sql_executor';
import type { AppScheduler } from '../srs/fsrs_scheduler';
import { createSrsCard, type CardType } from '../srs/review_service';

/**
 * Creates a review card unless it already exists (spec Section 5: a source module creates a
 * card in state New, due tomorrow). Returns true when a card was created.
 */
export function ensureSrsCard(
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
): boolean {
  if (executor.get('SELECT 1 AS present FROM srs_card WHERE id = ?', [input.cardId])) return false;
  createSrsCard(executor, scheduler, input);
  return true;
}
