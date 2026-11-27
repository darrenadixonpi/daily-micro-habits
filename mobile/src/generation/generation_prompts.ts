import type { A3Concept } from '../content/content_types';

/**
 * Prompts for the generation pipeline (spec Section 6). Each request asks for a fixed JSON
 * shape and carries only module parameters and titles already in the pool (spec Section 9:
 * never journal text, priorities or review history).
 */
export const BATCH_SIZE = 7;

export const SYSTEM_PROMPT =
  'You write short, accurate learning content for a personal daily-habits app. ' +
  'Write definitions, explainers and summaries in your own words; do not copy dictionaries or encyclopaedias. ' +
  'Reply with JSON only: no Markdown fences, no commentary.';

export const LANGUAGE_NAMES: Record<string, string> = {
  'es-419': 'Spanish, Latin American (es-419)',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  'pt-BR': 'Portuguese, Brazil',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-Hans': 'Chinese, Simplified',
};

export const NON_LATIN_LANGUAGES = new Set(['ja', 'ko', 'zh-Hans']);

export const A3_DOMAIN_NAMES: Record<string, string> = {
  ai_ml: 'AI & machine learning',
  chemistry: 'chemistry',
  physics: 'physics',
  biology: 'biology',
  biomedicine: 'biomedicine',
  drug_discovery: 'drug development & discovery',
  statistics_data_science: 'statistics & data science',
  mathematics: 'mathematics',
};

export const EXPLAINER_WORDS: Record<string, number> = { short: 150, standard: 250, long: 400 };

const TIER_NAMES: Record<string, string> = {
  '1': 'tier 1 (common words an educated adult may still misuse)',
  '2': 'tier 2 (advanced vocabulary: precise words used in quality journalism and professional writing)',
  '3': 'tier 3 (rare words: literary, archaic or highly specialised)',
};

const avoidList = (titles: readonly string[]) =>
  titles.length > 0 ? `Do not use any of these (already in the app): ${titles.slice(0, 200).join('; ')}.` : '';

export function a1RefillPrompt(tier: string, existing: readonly string[]): string {
  return [
    `Write ${BATCH_SIZE} English vocabulary entries at ${TIER_NAMES[tier] ?? `tier ${tier}`}.`,
    avoidList(existing),
    'Return a JSON array; each element has exactly these keys:',
    '"headword" (lowercase base form), "part_of_speech", "ipa" (General American, between slashes),',
    '"definition" (one sentence, your own words), "etymology" (one sentence),',
    '"example_sentence" (uses the headword or one of its inflections),',
    '"inflections" (array of every accepted form, including the headword itself),',
    `"tier" (the number ${tier}), "tags" (1–3 lowercase snake_case topic tags).`,
  ].filter(Boolean).join('\n');
}

export function a3RefillPrompt(input: {
  readonly domain: string;
  readonly depth: string;
  readonly explainerLength: string;
  readonly includeFormulas: boolean;
  readonly existing: readonly string[];
}): string {
  const words = EXPLAINER_WORDS[input.explainerLength] ?? 250;
  return [
    `Write ${BATCH_SIZE} science-and-technology concepts in the domain "${A3_DOMAIN_NAMES[input.domain] ?? input.domain}" at ${input.depth} depth.`,
    avoidList(input.existing),
    'Return a JSON array; each element has exactly these keys:',
    `"title", "domain" (the string "${input.domain}"), "depth" (the string "${input.depth}"),`,
    `"explainer" (about ${words} words, plain prose, factually accurate),`,
    input.includeFormulas
      ? '"formula" (one key formula in LaTeX, or null when the concept has none),'
      : '"formula" (null),',
    '"source" ({"title", "url"} of a reputable page that covers the concept, https only),',
    '"question" ({"prompt", "options": four objects {"id": "a"|"b"|"c"|"d", "text"}, "correct_option_id", "explanation"}; exactly one option is correct),',
    '"tags" (1–3 lowercase snake_case tags).',
  ].join('\n');
}

export function a3VariantPrompt(concept: A3Concept, kind: 'simpler' | 'deeper', explainerLength: string): string {
  const words = EXPLAINER_WORDS[explainerLength] ?? 250;
  const instruction =
    kind === 'simpler'
      ? 'Rewrite it for a reader new to the field: plain words, one everyday analogy, no jargon left unexplained.'
      : 'Go one level deeper: the mechanism, a quantitative detail, and one current open question or application.';
  return [
    `Concept: "${concept.title}" (${A3_DOMAIN_NAMES[concept.domain] ?? concept.domain}).`,
    `Current explainer: ${concept.explainer}`,
    instruction,
    'Return one JSON object with exactly these keys:',
    `"title", "domain" (the string "${concept.domain}"), "depth", "explainer" (about ${words} words), "formula" (LaTeX or null),`,
    '"source" ({"title", "url"}, https, or null), "question" ({"prompt", "options": four {"id": "a"|"b"|"c"|"d", "text"}, "correct_option_id", "explanation"}), "tags".',
  ].join('\n');
}

export function a4RefillPrompt(language: string, level: string, existing: readonly string[]): string {
  const name = LANGUAGE_NAMES[language] ?? language;
  const variety =
    language === 'es-419'
      ? 'Use pan-Latin-American usage (Mexican where varieties differ); use ustedes, never vosotros forms.'
      : '';
  const script = NON_LATIN_LANGUAGES.has(language)
    ? '"transliteration" (romanization of the phrase: Hepburn, Revised Romanization or Hanyu Pinyin with tone marks),'
    : '"transliteration" (null),';
  return [
    `Write ${BATCH_SIZE} useful everyday phrases in ${name} at CEFR level ${level}. ${variety}`,
    avoidList(existing),
    'Return a JSON array; each element has exactly these keys:',
    '"phrase" (in the target language, with correct accents and punctuation), "literal_translation" (English, word by word),',
    '"idiomatic_translation" (natural English), "usage_note" (one or two sentences on when to use it),',
    '"register" ("formal", "informal" or "neutral"),',
    `"cefr" (the string "${level}"),`,
    script,
    '"tags" (1–3 lowercase snake_case tags).',
  ].join('\n');
}
