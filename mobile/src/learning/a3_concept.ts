import { getContentItem } from '../content/content_repository';
import type { ContentItem } from '../content/content_types';
import { readTagWeights } from '../content/content_selection';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { writeInternalValue } from '../settings/settings_repository';
import type { AppScheduler } from '../srs/fsrs_scheduler';
import { ensureSrsCard } from './card_creation';
import { cardIdFor } from './card_ids';
import { completionFor, recordCompletion } from './task_completion_repository';

export interface A3RecallResponse {
  readonly choice: string;
  readonly correct: boolean;
}

/**
 * Delayed recall (spec Section 2): the session opens with the question of the most recent
 * concept read on an earlier day, unless it was already answered or later excluded. On the
 * first day there is none, so the step is skipped automatically.
 */
export function pendingRecall(executor: SqlExecutor, today: string): ContentItem<'A3'> | null {
  const last = executor.get<{ content_item_id: string }>(
    "SELECT content_item_id FROM task_completion WHERE module = 'A3' AND date < ? AND content_item_id IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1",
    [today],
  );
  if (!last) return null;
  const answered = executor.get(
    "SELECT 1 AS present FROM task_completion WHERE module = 'A3R' AND content_item_id = ?",
    [last.content_item_id],
  );
  if (answered) return null;
  const item = getContentItem<'A3'>(executor, last.content_item_id);
  return item && item.row.status !== 'excluded' ? item : null;
}

/** Records the recall answer; the question becomes a review card after its first answer. */
export function answerRecall(
  executor: SqlExecutor,
  scheduler: AppScheduler,
  input: { readonly date: string; readonly item: ContentItem<'A3'>; readonly choice: string; readonly now: Date; readonly dueAt: Date },
): A3RecallResponse {
  const correct = input.choice === input.item.payload.question.correct_option_id;
  runInTransaction(executor, () => {
    recordCompletion(executor, {
      date: input.date,
      module: 'A3R',
      contentItemId: input.item.row.id,
      response: { choice: input.choice, correct } satisfies A3RecallResponse,
      now: input.now,
    });
    ensureSrsCard(executor, scheduler, {
      cardId: cardIdFor.a3(input.item.row.id),
      contentItemId: input.item.row.id,
      cardType: 'recognition',
      language: null,
      now: input.now,
      dueAt: input.dueAt,
    });
  });
  return { choice: input.choice, correct };
}

/** "Concept opened to the end": recorded when the reader reaches the end of the explainer. */
export function markConceptRead(executor: SqlExecutor, input: { readonly date: string; readonly item: ContentItem<'A3'>; readonly now: Date }): void {
  if (completionFor(executor, input.date, 'A3', input.item.row.id)) return;
  recordCompletion(executor, { date: input.date, module: 'A3', contentItemId: input.item.row.id, response: { read: true }, now: input.now });
}

export function conceptReadOn(executor: SqlExecutor, date: string, itemId: string): boolean {
  return completionFor(executor, date, 'A3', itemId) !== undefined;
}

/** More like this (+1) / Not interested (−1) on each of the concept's tags, clamped to ±3. */
export function adjustTagWeights(executor: SqlExecutor, tags: readonly string[], delta: 1 | -1, now: Date): Record<string, number> {
  const weights = { ...readTagWeights(executor) };
  for (const tag of tags) weights[tag] = Math.max(-3, Math.min(3, (weights[tag] ?? 0) + delta));
  writeInternalValue(executor, 'a3_tag_weights', weights, now);
  return weights;
}
