import type { ContentItem } from '../content/content_types';
import type { SqlExecutor } from '../platform/sql_executor';
import type { AppScheduler } from '../srs/fsrs_scheduler';
import { ensureSrsCard } from './card_creation';
import { cardIdFor } from './card_ids';
import { completionFor, recordCompletion } from './task_completion_repository';

/** A5 is read-only; opening the entry completes it (spec Section 2). */
export function markA5Opened(executor: SqlExecutor, input: { readonly date: string; readonly item: ContentItem<'A5'>; readonly now: Date }): void {
  if (completionFor(executor, input.date, 'A5', input.item.row.id)) return;
  recordCompletion(executor, { date: input.date, module: 'A5', contentItemId: input.item.row.id, response: { opened: true }, now: input.now });
}

/** Optional Save as card: one recognition card per saved event. Returns false if already saved. */
export function saveA5EventCard(
  executor: SqlExecutor,
  scheduler: AppScheduler,
  input: { readonly item: ContentItem<'A5'>; readonly eventIndex: number; readonly now: Date; readonly dueAt: Date },
): boolean {
  if (!input.item.payload.events[input.eventIndex]) throw new Error(`No event ${input.eventIndex}`);
  return ensureSrsCard(executor, scheduler, {
    cardId: cardIdFor.a5(input.item.row.id, input.eventIndex),
    contentItemId: input.item.row.id,
    cardType: 'recognition',
    language: null,
    now: input.now,
    dueAt: input.dueAt,
  });
}

export function savedA5Events(executor: SqlExecutor, itemId: string): number[] {
  return executor
    .all<{ id: string }>('SELECT id FROM srs_card WHERE content_item_id = ?', [itemId])
    .map((row) => Number(row.id.split(':')[2]))
    .filter((index) => Number.isInteger(index));
}
