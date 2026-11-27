/**
 * Payload shapes of the four learning-content modules, as stored in content_item.payload_json.
 * They mirror the JSON schemas in /schemas (bundled content) and are also what the generation
 * pipeline must produce (src/generation/generation_validation.ts).
 */
export type LearningModuleId = 'A1' | 'A3' | 'A4' | 'A5';

export interface SourceLink {
  readonly title: string;
  readonly url: string;
}

export interface A1Word {
  readonly id: string;
  readonly headword: string;
  readonly part_of_speech: string;
  readonly ipa: string;
  readonly definition: string;
  readonly etymology: string;
  readonly example_sentence: string;
  readonly inflections: readonly string[];
  readonly tier: number;
  readonly tags: readonly string[];
}

export interface A3Option {
  readonly id: string;
  readonly text: string;
}

export interface A3Question {
  readonly prompt: string;
  readonly options: readonly A3Option[];
  readonly correct_option_id: string;
  readonly explanation: string;
}

export interface A3Concept {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly depth: string;
  readonly explainer: string;
  readonly formula: string | null;
  readonly source: SourceLink | null;
  readonly question: A3Question;
  readonly tags: readonly string[];
  /** Generated Simpler / Go deeper variants only. */
  readonly variant?: 'simpler' | 'deeper';
}

export interface A4Phrase {
  readonly id: string;
  readonly phrase: string;
  readonly literal_translation: string;
  readonly idiomatic_translation: string;
  readonly usage_note: string;
  readonly register: string;
  readonly cefr: string;
  readonly transliteration: string | null;
  readonly tags: readonly string[];
}

export interface A5Event {
  readonly year: number;
  readonly category: string;
  readonly summary: string;
  readonly source: SourceLink;
}

export interface A5Day {
  readonly date_key: string;
  readonly events: readonly A5Event[];
  /** Set for items fetched from Wikipedia's On this day feed (CC BY-SA attribution). */
  readonly attribution?: string;
}

export interface PayloadByModule {
  readonly A1: A1Word;
  readonly A3: A3Concept;
  readonly A4: A4Phrase;
  readonly A5: A5Day;
}

export type ContentSource = 'bundled' | 'generated' | 'wikimedia';
export type ContentStatus = 'unserved' | 'served' | 'excluded';

export interface ContentItemRow {
  readonly id: string;
  readonly module: LearningModuleId;
  readonly language: string | null;
  readonly tier_or_level: string | null;
  readonly domain: string | null;
  readonly payload_json: string;
  readonly source: ContentSource;
  readonly status: ContentStatus;
  readonly served_on: string | null;
  readonly assigned_on: string | null;
  readonly parent_id: string | null;
  readonly excluded_reason: string | null;
}

export interface ContentItem<M extends LearningModuleId = LearningModuleId> {
  readonly row: ContentItemRow;
  readonly payload: PayloadByModule[M];
}

/** CEFR levels in order; A4 serves at or below the chosen level (decision G4). */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export const A3_DEPTHS = ['introductory', 'intermediate', 'advanced'] as const;

/** Content ID of an A5 day: bundled, or fetched from Wikipedia when no bundled entry exists (decision G6). */
export const a5BundledId = (dateKey: string) => `a5-${dateKey}`;
export const a5WikimediaId = (dateKey: string) => `a5wm-${dateKey}`;

/** MM-DD of a local ISO date. */
export const dateKeyOf = (isoDate: string) => isoDate.slice(5, 10);
