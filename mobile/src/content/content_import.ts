import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { readInternalValue, writeInternalValue } from '../settings/settings_repository';
import type { BundledContentSet } from './bundled_content';
import { a5BundledId, type LearningModuleId } from './content_types';

/**
 * Imports the bundled content set into content_item (spec Section 7): on first launch and
 * whenever an app update ships different content. Items are keyed by their stable ID, so
 * served history, assignments and exclusions are preserved; a changed payload of a bundled
 * item is updated in place. Items no longer in the bundle are left alone (cards may use them).
 */
export interface ContentImportReport {
  readonly fingerprint: string;
  readonly skipped: boolean;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly byModule: Readonly<Record<LearningModuleId, number>>;
}

interface ImportRow {
  readonly id: string;
  readonly module: LearningModuleId;
  readonly language: string | null;
  readonly tierOrLevel: string | null;
  readonly domain: string | null;
  readonly payloadJson: string;
}

export function bundledRows(content: BundledContentSet): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const word of content.a1) {
    rows.push({ id: word.id, module: 'A1', language: 'en', tierOrLevel: String(word.tier), domain: null, payloadJson: JSON.stringify(word) });
  }
  for (const concept of content.a3) {
    rows.push({ id: concept.id, module: 'A3', language: 'en', tierOrLevel: concept.depth, domain: concept.domain, payloadJson: JSON.stringify(concept) });
  }
  for (const set of content.a4) {
    for (const phrase of set.items) {
      rows.push({ id: phrase.id, module: 'A4', language: set.language, tierOrLevel: phrase.cefr, domain: null, payloadJson: JSON.stringify(phrase) });
    }
  }
  for (const day of content.a5) {
    rows.push({ id: a5BundledId(day.date_key), module: 'A5', language: 'en', tierOrLevel: null, domain: null, payloadJson: JSON.stringify(day) });
  }
  return rows;
}

/** FNV-1a over every row; changes whenever any bundled item changes. */
export function contentFingerprint(rows: readonly ImportRow[]): string {
  let hash = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const row of rows) {
    feed(row.id);
    feed(row.payloadJson);
  }
  return `${rows.length}-${hash.toString(16).padStart(8, '0')}`;
}

export function importBundledContent(
  executor: SqlExecutor,
  content: BundledContentSet,
  now: Date,
  options: { readonly force?: boolean } = {},
): ContentImportReport {
  const rows = bundledRows(content);
  const fingerprint = contentFingerprint(rows);
  const byModule = { A1: 0, A3: 0, A4: 0, A5: 0 } as Record<LearningModuleId, number>;
  for (const row of rows) byModule[row.module] += 1;
  if (!options.force && readInternalValue(executor, 'content_bundle_fingerprint') === fingerprint) {
    return { fingerprint, skipped: true, inserted: 0, updated: 0, unchanged: rows.length, byModule };
  }
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  runInTransaction(executor, () => {
    for (const row of rows) {
      const existing = executor.get<{ payload_json: string; source: string }>(
        'SELECT payload_json, source FROM content_item WHERE id = ?',
        [row.id],
      );
      if (!existing) {
        executor.run(
          `INSERT INTO content_item (id, module, language, tier_or_level, domain, payload_json, source, status, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, 'bundled', 'unserved', ?)`,
          [row.id, row.module, row.language, row.tierOrLevel, row.domain, row.payloadJson, now.toISOString()],
        );
        inserted += 1;
      } else if (existing.payload_json !== row.payloadJson) {
        executor.run(
          'UPDATE content_item SET payload_json = ?, language = ?, tier_or_level = ?, domain = ? WHERE id = ?',
          [row.payloadJson, row.language, row.tierOrLevel, row.domain, row.id],
        );
        updated += 1;
      } else {
        unchanged += 1;
      }
    }
    writeInternalValue(executor, 'content_bundle_fingerprint', fingerprint, now);
  });
  return { fingerprint, skipped: false, inserted, updated, unchanged, byModule };
}
