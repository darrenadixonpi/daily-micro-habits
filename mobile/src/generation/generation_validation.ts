import type { A1Word, A3Concept, A4Phrase } from '../content/content_types';
import { A3_DEPTHS, CEFR_LEVELS } from '../content/content_types';
import { sentenceUsesWord } from '../learning/a1_word';
import { NON_LATIN_LANGUAGES } from './generation_prompts';

/**
 * Validation of generated items (spec Section 6, generation pipeline, step 2). Items that
 * fail are discarded with a reason; passing items are stored with source = generated.
 */
export interface ValidationOutcome<T> {
  readonly accepted: readonly T[];
  readonly rejected: readonly { readonly index: number; readonly reason: string }[];
}

/** Finds the JSON value in a reply that should contain only JSON (tolerates stray fences or prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
    if (start < 0 || end <= start) throw new Error('Reply contains no JSON');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) return (value as { items: unknown[] }).items;
  if (value && typeof value === 'object') return [value];
  throw new Error('Reply is not a JSON array');
}

const text = (value: unknown, min = 1, max = 2000): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;
const tags = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= 5 && value.every((tag) => typeof tag === 'string' && /^[a-z0-9_]{2,40}$/.test(tag));
const wordCount = (value: string) => (value.match(/\S+/g) ?? []).length;
const norm = (value: string) => value.trim().toLocaleLowerCase();

function validateEach<T>(items: unknown[], check: (item: Record<string, unknown>) => string | null, build: (item: Record<string, unknown>) => T): ValidationOutcome<T> {
  const accepted: T[] = [];
  const rejected: { index: number; reason: string }[] = [];
  items.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      rejected.push({ index, reason: 'not an object' });
      return;
    }
    const reason = check(raw as Record<string, unknown>);
    if (reason) rejected.push({ index, reason });
    else accepted.push(build(raw as Record<string, unknown>));
  });
  return { accepted, rejected };
}

export function validateA1Batch(reply: unknown, input: { readonly tier: string; readonly existing: readonly string[] }): ValidationOutcome<Omit<A1Word, 'id'>> {
  const seen = new Set(input.existing.map(norm));
  return validateEach(
    asArray(reply),
    (item) => {
      if (!text(item.headword, 2, 40) || /\s{2,}/.test(item.headword)) return 'headword missing';
      if (seen.has(norm(item.headword))) return `duplicate headword ${item.headword}`;
      if (!text(item.part_of_speech, 2, 30)) return 'part_of_speech missing';
      if (!text(item.ipa, 3, 80)) return 'ipa missing';
      if (!text(item.definition, 10, 400)) return 'definition missing';
      if (!text(item.etymology, 5, 400)) return 'etymology missing';
      if (!text(item.example_sentence, 10, 300)) return 'example_sentence missing';
      if (!Array.isArray(item.inflections) || !item.inflections.every((form) => text(form, 1, 40))) return 'inflections missing';
      const forms = item.inflections as string[];
      if (!forms.map(norm).includes(norm(item.headword))) return 'inflections do not include the headword';
      if (!sentenceUsesWord(item.example_sentence, forms)) return 'example sentence does not use the word';
      if (String(item.tier) !== input.tier) return `tier ${String(item.tier)} is not ${input.tier}`;
      if (!tags(item.tags)) return 'tags invalid';
      seen.add(norm(item.headword));
      return null;
    },
    (item) => ({
      headword: String(item.headword).trim(),
      part_of_speech: String(item.part_of_speech),
      ipa: String(item.ipa),
      definition: String(item.definition),
      etymology: String(item.etymology),
      example_sentence: String(item.example_sentence),
      inflections: (item.inflections as string[]).map((form) => form.trim()),
      tier: Number(input.tier),
      tags: item.tags as string[],
    }),
  );
}

function questionProblem(question: unknown): string | null {
  if (!question || typeof question !== 'object') return 'question missing';
  const q = question as Record<string, unknown>;
  if (!text(q.prompt, 10, 300)) return 'question prompt missing';
  if (!Array.isArray(q.options) || q.options.length !== 4) return 'question needs 4 options';
  const ids = (q.options as Record<string, unknown>[]).map((option) => option?.id);
  if (new Set(ids).size !== 4 || !ids.every((id) => typeof id === 'string' && /^[a-d]$/.test(id))) return 'option ids must be a–d';
  if (!(q.options as Record<string, unknown>[]).every((option) => text(option.text, 1, 200))) return 'option text missing';
  const correct = ids.filter((id) => id === q.correct_option_id);
  if (correct.length !== 1) return 'question needs exactly one correct option';
  if (!text(q.explanation, 10, 600)) return 'explanation missing';
  return null;
}

export function validateA3Batch(
  reply: unknown,
  input: { readonly domain: string; readonly explainerWords: number; readonly existing: readonly string[] },
): ValidationOutcome<Omit<A3Concept, 'id'>> {
  const seen = new Set(input.existing.map(norm));
  return validateEach(
    asArray(reply),
    (item) => {
      if (!text(item.title, 3, 120)) return 'title missing';
      if (seen.has(norm(item.title))) return `duplicate title ${item.title}`;
      if (item.domain !== input.domain) return `domain ${String(item.domain)} is not ${input.domain}`;
      if (!A3_DEPTHS.includes(item.depth as (typeof A3_DEPTHS)[number])) return 'depth invalid';
      if (!text(item.explainer, 50, 5000)) return 'explainer missing';
      const words = wordCount(item.explainer);
      if (words < input.explainerWords * 0.6 || words > input.explainerWords * 1.6) return `explainer has ${words} words`;
      if (item.formula !== null && item.formula !== undefined && !text(item.formula, 1, 300)) return 'formula invalid';
      if (item.source !== null && item.source !== undefined) {
        const source = item.source as Record<string, unknown>;
        if (!text(source.title, 3, 200) || !text(source.url, 9, 500) || !String(source.url).startsWith('https://')) return 'source invalid';
      }
      const problem = questionProblem(item.question);
      if (problem) return problem;
      if (!tags(item.tags)) return 'tags invalid';
      seen.add(norm(item.title));
      return null;
    },
    (item) => ({
      title: String(item.title).trim(),
      domain: input.domain,
      depth: String(item.depth),
      explainer: String(item.explainer).trim(),
      formula: typeof item.formula === 'string' ? item.formula : null,
      source: item.source ? (item.source as { title: string; url: string }) : null,
      question: item.question as A3Concept['question'],
      tags: item.tags as string[],
    }),
  );
}

const VOSOTROS = /\b(vosotros|vosotras|vuestro|vuestra|vuestros|vuestras|os)\b|\b\w+(áis|éis)\b/i;

export function validateA4Batch(
  reply: unknown,
  input: { readonly language: string; readonly level: string; readonly existing: readonly string[] },
): ValidationOutcome<Omit<A4Phrase, 'id'>> {
  const seen = new Set(input.existing.map(norm));
  return validateEach(
    asArray(reply),
    (item) => {
      if (!text(item.phrase, 2, 120)) return 'phrase missing';
      if (seen.has(norm(item.phrase))) return `duplicate phrase ${item.phrase}`;
      if (!text(item.literal_translation, 2, 200)) return 'literal_translation missing';
      if (!text(item.idiomatic_translation, 2, 200)) return 'idiomatic_translation missing';
      if (!text(item.usage_note, 5, 400)) return 'usage_note missing';
      if (!['formal', 'informal', 'neutral'].includes(String(item.register))) return 'register invalid';
      if (!CEFR_LEVELS.includes(item.cefr as (typeof CEFR_LEVELS)[number]) || item.cefr !== input.level) return `cefr ${String(item.cefr)} is not ${input.level}`;
      if (NON_LATIN_LANGUAGES.has(input.language)) {
        if (!text(item.transliteration, 1, 200)) return 'transliteration required for a non-Latin script';
      } else if (item.transliteration !== null && item.transliteration !== undefined && !text(item.transliteration, 0, 200)) {
        return 'transliteration invalid';
      }
      if (input.language === 'es-419' && VOSOTROS.test(item.phrase)) return 'vosotros form in es-419';
      if (!tags(item.tags)) return 'tags invalid';
      seen.add(norm(item.phrase));
      return null;
    },
    (item) => ({
      phrase: String(item.phrase).trim(),
      literal_translation: String(item.literal_translation),
      idiomatic_translation: String(item.idiomatic_translation),
      usage_note: String(item.usage_note),
      register: String(item.register),
      cefr: input.level,
      transliteration: NON_LATIN_LANGUAGES.has(input.language) ? String(item.transliteration) : null,
      tags: item.tags as string[],
    }),
  );
}
