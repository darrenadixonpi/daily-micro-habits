import type { ContentItem } from '../content/content_types';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import type { AppScheduler } from '../srs/fsrs_scheduler';
import { ensureSrsCard } from './card_creation';
import { cardIdFor } from './card_ids';
import { recordCompletion } from './task_completion_repository';

export const A1_SENTENCE_MAX_LENGTH = 300;

export interface A1Response {
  readonly sentence: string;
}

/**
 * A1 completion rule (spec Section 2): the sentence contains the headword or one of its
 * accepted inflections, case-insensitively, as a whole word (so "unobviated" does not
 * count for "obviate"). Letters include accented ones; apostrophes and hyphens join words.
 */
export function sentenceUsesWord(sentence: string, forms: readonly string[]): boolean {
  const words = sentence.toLocaleLowerCase('en-US').normalize('NFC').split(/[^\p{L}\p{M}'’-]+/u);
  const wanted = new Set(forms.map((form) => form.toLocaleLowerCase('en-US').normalize('NFC')));
  return words.some((word) => wanted.has(word.replace(/^['’-]+|['’-]+$/g, '')));
}

/** Records the sentence and creates the word → definition card (the sentence is its memory cue). */
export function completeA1(
  executor: SqlExecutor,
  scheduler: AppScheduler,
  input: { readonly date: string; readonly item: ContentItem<'A1'>; readonly sentence: string; readonly now: Date; readonly dueAt: Date },
): void {
  const sentence = input.sentence.trim().slice(0, A1_SENTENCE_MAX_LENGTH);
  const forms = [input.item.payload.headword, ...input.item.payload.inflections];
  if (!sentenceUsesWord(sentence, forms)) {
    throw new Error(`Use "${input.item.payload.headword}" or one of its forms (${input.item.payload.inflections.join(', ')}).`);
  }
  runInTransaction(executor, () => {
    recordCompletion(executor, {
      date: input.date,
      module: 'A1',
      contentItemId: input.item.row.id,
      response: { sentence } satisfies A1Response,
      now: input.now,
    });
    ensureSrsCard(executor, scheduler, {
      cardId: cardIdFor.a1(input.item.row.id),
      contentItemId: input.item.row.id,
      cardType: 'recognition',
      language: null,
      now: input.now,
      dueAt: input.dueAt,
    });
  });
}
