import { getContentItem } from '../content/content_repository';
import type { A1Word, A3Concept, A4Phrase, A5Day } from '../content/content_types';
import type { SqlExecutor } from '../platform/sql_executor';
import { formatMonthDay } from '../ui/date_format';
import type { A1Response } from './a1_word';
import { parseCardId } from './card_ids';
import { latestResponse } from './task_completion_repository';

/**
 * What a review card shows: the prompt side, the answer side, and for production cards
 * (A4) the phrase the user must type before the reveal.
 */
export interface CardFace {
  readonly module: 'A1' | 'A3' | 'A4' | 'A5';
  readonly kind: 'recognition' | 'production';
  readonly label: string;
  readonly prompt: string;
  readonly promptDetail: string | null;
  readonly choices: readonly { readonly id: string; readonly text: string }[];
  readonly answer: string;
  readonly answerDetail: string | null;
  /** A1: the user's own sentence, shown with the answer as a memory cue. */
  readonly cue: string | null;
  readonly production: { readonly target: string; readonly language: string } | null;
  readonly generated: boolean;
}

export function describeCard(executor: SqlExecutor, cardId: string): CardFace | null {
  const parsed = parseCardId(cardId);
  if (!parsed) return null;
  const item = getContentItem(executor, parsed.itemId);
  if (!item) return null;
  const generated = item.row.source === 'generated';
  switch (parsed.module) {
    case 'A1': {
      const word = item.payload as A1Word;
      const response = latestResponse<A1Response>(executor, 'A1', item.row.id);
      return {
        module: 'A1', kind: 'recognition', label: 'A1 Word', generated,
        prompt: word.headword, promptDetail: `${word.part_of_speech} · ${word.ipa}`, choices: [],
        answer: word.definition, answerDetail: word.example_sentence, cue: response?.sentence ?? null, production: null,
      };
    }
    case 'A3': {
      const concept = item.payload as A3Concept;
      const correct = concept.question.options.find((option) => option.id === concept.question.correct_option_id);
      return {
        module: 'A3', kind: 'recognition', label: `A3 Concept · ${concept.title}`, generated,
        prompt: concept.question.prompt, promptDetail: null, choices: concept.question.options,
        answer: correct?.text ?? '', answerDetail: concept.question.explanation, cue: null, production: null,
      };
    }
    case 'A4': {
      const phrase = item.payload as A4Phrase;
      return {
        module: 'A4', kind: 'production', label: `A4 Phrase · ${phrase.cefr}`, generated,
        prompt: phrase.idiomatic_translation, promptDetail: `Register: ${phrase.register}`, choices: [],
        answer: phrase.phrase, answerDetail: [phrase.transliteration, `Literally: ${phrase.literal_translation}`, phrase.usage_note].filter(Boolean).join('\n'),
        cue: null, production: { target: phrase.phrase, language: item.row.language ?? 'es-419' },
      };
    }
    case 'A5': {
      const day = item.payload as A5Day;
      const event = day.events[parsed.eventIndex ?? 0];
      if (!event) return null;
      const date = formatMonthDay(day.date_key);
      return {
        module: 'A5', kind: 'recognition', label: 'A5 On this day', generated,
        prompt: `What happened on ${date}, ${event.year}?`, promptDetail: null, choices: [],
        answer: event.summary, answerDetail: event.source.url, cue: null, production: null,
      };
    }
  }
}
