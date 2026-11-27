import type { ContentItem } from '../content/content_types';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import type { AppScheduler } from '../srs/fsrs_scheduler';
import { ensureSrsCard } from './card_creation';
import { cardIdFor } from './card_ids';
import { recordCompletion } from './task_completion_repository';

/**
 * A4 tolerant match (spec Section 2): case- and punctuation-insensitive, accents optional
 * by setting, and an edit distance up to 15% of the phrase length counts as close and passes.
 */
export type MatchResult = 'exact' | 'close' | 'fail';

export interface PhraseMatch {
  readonly result: MatchResult;
  readonly distance: number;
  /** Edit distance divided by the length of the normalized target. */
  readonly normalizedDistance: number;
}

export const CLOSE_MATCH_SHARE = 0.15;

export function normalizePhrase(text: string, accentsOptional: boolean): string {
  let value = text.normalize('NFC').toLocaleLowerCase();
  if (accentsOptional) value = value.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
  return value
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let previous = Array.from({ length: right.length + 1 }, (_, j) => j);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

export function matchPhrase(typed: string, target: string, accentsOptional: boolean): PhraseMatch {
  const a = normalizePhrase(typed, accentsOptional);
  const b = normalizePhrase(target, accentsOptional);
  const distance = editDistance(a, b);
  const length = Math.max(1, [...b].length);
  const normalizedDistance = distance / length;
  if (a === '') return { result: 'fail', distance, normalizedDistance };
  if (distance === 0) return { result: 'exact', distance, normalizedDistance };
  return { result: distance <= Math.floor(CLOSE_MATCH_SHARE * length) ? 'close' : 'fail', distance, normalizedDistance };
}

export interface A4Attempt {
  readonly typed: string;
  readonly result: MatchResult;
  readonly distance: number;
  readonly normalized_distance: number;
}

export interface A4Response {
  readonly attempts: readonly A4Attempt[];
  /** First attempt's result: the basis of the production-accuracy metric (spec Section 10). */
  readonly first_result: MatchResult;
  readonly first_normalized_distance: number;
  readonly revealed_before_pass: boolean;
}

/** Records a passing attempt (with the ones before it) and creates the production card. */
export function completeA4(
  executor: SqlExecutor,
  scheduler: AppScheduler,
  input: {
    readonly date: string;
    readonly item: ContentItem<'A4'>;
    readonly attempts: readonly A4Attempt[];
    readonly revealedBeforePass: boolean;
    readonly now: Date;
    readonly dueAt: Date;
  },
): void {
  const first = input.attempts[0];
  const last = input.attempts[input.attempts.length - 1];
  if (!first || !last || last.result === 'fail') throw new Error('A4 completes only on a passing attempt');
  runInTransaction(executor, () => {
    recordCompletion(executor, {
      date: input.date,
      module: 'A4',
      contentItemId: input.item.row.id,
      response: {
        attempts: input.attempts,
        first_result: first.result,
        first_normalized_distance: first.normalized_distance,
        revealed_before_pass: input.revealedBeforePass,
      } satisfies A4Response,
      now: input.now,
    });
    ensureSrsCard(executor, scheduler, {
      cardId: cardIdFor.a4(input.item.row.id),
      contentItemId: input.item.row.id,
      cardType: 'production',
      language: input.item.row.language,
      now: input.now,
      dueAt: input.dueAt,
    });
  });
}
