import a1Tier2 from '../../../content/a1_words_tier2.json';
import a3AiMl from '../../../content/a3_concepts_ai_ml.json';
import a3Biology from '../../../content/a3_concepts_biology.json';
import a3Biomedicine from '../../../content/a3_concepts_biomedicine.json';
import a3Chemistry from '../../../content/a3_concepts_chemistry.json';
import a3DrugDiscovery from '../../../content/a3_concepts_drug_discovery.json';
import a3Physics from '../../../content/a3_concepts_physics.json';
import a4Spanish from '../../../content/a4_phrases_es-419.json';
import a5OnThisDay from '../../../content/a5_on_this_day.json';
import type { A1Word, A3Concept, A4Phrase, A5Day } from './content_types';

/**
 * The reviewed content set in /content (spec Section 6), bundled into the app. Metro reaches
 * the folder through watchFolders (metro.config.js); the Node tests import it directly.
 * Adding a file means adding it here; check_ui_conventions does not cover this, the
 * content-import test does (every /content file must be listed).
 */
export interface BundledContentSet {
  readonly a1: readonly A1Word[];
  readonly a3: readonly A3Concept[];
  readonly a4: readonly { readonly language: string; readonly items: readonly A4Phrase[] }[];
  readonly a5: readonly A5Day[];
}

export const BUNDLED_FILE_NAMES = [
  'a1_words_tier2.json',
  'a3_concepts_ai_ml.json',
  'a3_concepts_biology.json',
  'a3_concepts_biomedicine.json',
  'a3_concepts_chemistry.json',
  'a3_concepts_drug_discovery.json',
  'a3_concepts_physics.json',
  'a4_phrases_es-419.json',
  'a5_on_this_day.json',
] as const;

export const BUNDLED_CONTENT: BundledContentSet = {
  a1: [...(a1Tier2.items as unknown as A1Word[])],
  a3: [a3AiMl, a3Biology, a3Biomedicine, a3Chemistry, a3DrugDiscovery, a3Physics].flatMap(
    (file) => file.items as unknown as A3Concept[],
  ),
  a4: [{ language: a4Spanish.language, items: a4Spanish.items as unknown as A4Phrase[] }],
  a5: a5OnThisDay.items as unknown as A5Day[],
};
