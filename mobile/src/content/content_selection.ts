import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import type { SettingValue } from '../settings/settings_definitions';
import { readInternalValue } from '../settings/settings_repository';
import { addDays } from '../time/logical_day';
import { assignedItem, getContentItem, parseContentRow } from './content_repository';
import {
  A3_DEPTHS,
  a5BundledId,
  a5WikimediaId,
  CEFR_LEVELS,
  dateKeyOf,
  type ContentItem,
  type ContentItemRow,
} from './content_types';

/**
 * Daily content assignment (spec Section 2, selection rules). Each enabled learning module
 * gets one item per logical day; the item is marked served on the day it is assigned, so it
 * never returns as new material. A1 words are also reserved 14 days ahead so each morning
 * notification can name its word; reservations that no longer match the settings, or whose
 * day passed without the app being opened, go back to the pool.
 */
export interface SelectionSettings {
  readonly enabled: readonly string[];
  readonly a1Tier: string;
  readonly a3Domains: readonly string[];
  readonly a3Depth: string;
  readonly a4Language: string;
  readonly a4Level: string;
}

export interface DailyAssignment {
  readonly date: string;
  readonly A1: ContentItem<'A1'> | null;
  readonly A3: ContentItem<'A3'> | null;
  readonly A4: ContentItem<'A4'> | null;
  readonly A5: ContentItem<'A5'> | null;
}

export const A1_RESERVATION_DAYS = 14;

const list = (value: SettingValue | undefined): string[] => (Array.isArray(value) ? [...(value as readonly string[])] : []);

export function selectionSettingsFrom(settings: ReadonlyMap<string, SettingValue>): SelectionSettings {
  return {
    enabled: list(settings.get('modules.enabled')),
    a1Tier: String(settings.get('a1.tier') ?? '2'),
    a3Domains: [...list(settings.get('a3.core_domains')), ...list(settings.get('a3.optional_domains'))],
    a3Depth: String(settings.get('a3.depth') ?? 'intermediate'),
    a4Language: String(settings.get('a4.target_language') ?? 'es-419'),
    a4Level: String(settings.get('a4.level') ?? 'A2'),
  };
}

function pickA1(executor: SqlExecutor, tier: string): ContentItemRow | undefined {
  return executor.get<ContentItemRow>(
    `SELECT * FROM content_item
     WHERE module = 'A1' AND status = 'unserved' AND assigned_on IS NULL AND parent_id IS NULL AND tier_or_level = ?
     ORDER BY source = 'generated', id LIMIT 1`,
    [tier],
  );
}

/** Tag preferences from More like this (+1) and Not interested (−1). */
export function readTagWeights(executor: SqlExecutor): Record<string, number> {
  const value = readInternalValue(executor, 'a3_tag_weights');
  return value && typeof value === 'object' ? (value as Record<string, number>) : {};
}

function depthScore(depth: string | null, wanted: string): number {
  const a = A3_DEPTHS.indexOf((depth ?? '') as (typeof A3_DEPTHS)[number]);
  const b = A3_DEPTHS.indexOf(wanted as (typeof A3_DEPTHS)[number]);
  if (a < 0 || b < 0) return 0;
  return 2 - Math.min(2, Math.abs(a - b));
}

/**
 * A3: rotate through the enabled domains (least recently served first); within the domain,
 * prefer the configured depth and the user's tag preferences. Concepts whose tags were
 * marked Not interested enough to score ≤ −2 are used only when nothing else is left.
 */
function pickA3(executor: SqlExecutor, settings: SelectionSettings): ContentItemRow | undefined {
  if (settings.a3Domains.length === 0) return undefined;
  const placeholders = settings.a3Domains.map(() => '?').join(', ');
  const candidates = executor.all<ContentItemRow>(
    `SELECT * FROM content_item
     WHERE module = 'A3' AND status = 'unserved' AND assigned_on IS NULL AND parent_id IS NULL AND domain IN (${placeholders})
     ORDER BY source = 'generated', id`,
    [...settings.a3Domains],
  );
  if (candidates.length === 0) return undefined;
  const lastServed = new Map(
    executor
      .all<{ domain: string; last: string }>(
        "SELECT domain, max(served_on) AS last FROM content_item WHERE module = 'A3' AND status = 'served' AND parent_id IS NULL GROUP BY domain",
      )
      .map((row) => [row.domain, row.last]),
  );
  const weights = readTagWeights(executor);
  const tagScore = (row: ContentItemRow) =>
    ((JSON.parse(row.payload_json) as { tags?: string[] }).tags ?? []).reduce((sum, tag) => sum + (weights[tag] ?? 0), 0);
  const domainOrder = settings.a3Domains
    .filter((domain) => candidates.some((row) => row.domain === domain))
    .sort((a, b) => (lastServed.get(a) ?? '').localeCompare(lastServed.get(b) ?? '') || settings.a3Domains.indexOf(a) - settings.a3Domains.indexOf(b));
  for (const domain of domainOrder) {
    const inDomain = candidates.filter((row) => row.domain === domain && tagScore(row) > -2);
    if (inDomain.length === 0) continue;
    return [...inDomain].sort((a, b) =>
      depthScore(b.tier_or_level, settings.a3Depth) + tagScore(b) - (depthScore(a.tier_or_level, settings.a3Depth) + tagScore(a)),
    )[0];
  }
  return candidates[0];
}

/** A4: the target language at or below the chosen CEFR level, the chosen level first (decision G4). */
function pickA4(executor: SqlExecutor, settings: SelectionSettings): ContentItemRow | undefined {
  const levelIndex = CEFR_LEVELS.indexOf(settings.a4Level as (typeof CEFR_LEVELS)[number]);
  const allowed = CEFR_LEVELS.slice(0, Math.max(0, levelIndex) + 1);
  const candidates = executor.all<ContentItemRow>(
    `SELECT * FROM content_item
     WHERE module = 'A4' AND status = 'unserved' AND assigned_on IS NULL AND parent_id IS NULL AND language = ?
       AND tier_or_level IN (${allowed.map(() => '?').join(', ')})
     ORDER BY source = 'generated', id`,
    [settings.a4Language, ...allowed],
  );
  const rank = (row: ContentItemRow) => {
    const index = CEFR_LEVELS.indexOf(row.tier_or_level as (typeof CEFR_LEVELS)[number]);
    return index === levelIndex ? 100 : index;
  };
  return [...candidates].sort((a, b) => rank(b) - rank(a))[0];
}

function serve(executor: SqlExecutor, id: string, date: string): void {
  executor.run("UPDATE content_item SET status = 'served', served_on = ?, assigned_on = ? WHERE id = ?", [date, date, id]);
}

export function a5ItemFor(executor: SqlExecutor, date: string): ContentItem<'A5'> | undefined {
  for (const id of [a5BundledId(dateKeyOf(date)), a5WikimediaId(dateKeyOf(date))]) {
    const item = getContentItem<'A5'>(executor, id);
    if (item && item.row.status !== 'excluded') return item;
  }
  return undefined;
}

export function assignDailyContent(
  executor: SqlExecutor,
  input: { readonly today: string; readonly settings: SelectionSettings; readonly reserveDays?: number },
): DailyAssignment {
  const { today, settings } = input;
  const reserveDays = input.reserveDays ?? A1_RESERVATION_DAYS;
  const enabled = (module: string) => settings.enabled.includes(module);
  return runInTransaction(executor, () => {
    executor.run(
      "UPDATE content_item SET assigned_on = NULL WHERE status = 'unserved' AND assigned_on IS NOT NULL AND assigned_on < ?",
      [today],
    );
    executor.run(
      "UPDATE content_item SET assigned_on = NULL WHERE module = 'A1' AND status = 'unserved' AND assigned_on >= ? AND tier_or_level != ?",
      [today, settings.a1Tier],
    );

    const ensureToday = (module: 'A1' | 'A3' | 'A4', pick: () => ContentItemRow | undefined): void => {
      // An item reported as an error today is no longer assigned, so a replacement is picked.
      const existing = assignedItem(executor, module, today);
      if (existing) {
        if (existing.row.status === 'unserved') serve(executor, existing.row.id, today);
        return;
      }
      const row = pick();
      if (row) serve(executor, row.id, today);
    };

    if (enabled('A1')) {
      ensureToday('A1', () => pickA1(executor, settings.a1Tier));
      for (let offset = 1; offset < reserveDays; offset += 1) {
        const date = addDays(today, offset);
        if (assignedItem(executor, 'A1', date)) continue;
        const row = pickA1(executor, settings.a1Tier);
        if (!row) break;
        executor.run('UPDATE content_item SET assigned_on = ? WHERE id = ?', [date, row.id]);
      }
    }
    if (enabled('A3')) ensureToday('A3', () => pickA3(executor, settings));
    if (enabled('A4')) ensureToday('A4', () => pickA4(executor, settings));
    if (enabled('A5')) {
      const item = a5ItemFor(executor, today);
      if (item && item.row.assigned_on !== today) serve(executor, item.row.id, today);
    }

    const current = <M extends 'A1' | 'A3' | 'A4'>(module: M): ContentItem<M> | null => {
      if (!enabled(module)) return null;
      const item = assignedItem(executor, module, today);
      return item && item.row.status === 'served' ? item : null;
    };
    const a5 = enabled('A5') ? a5ItemFor(executor, today) : undefined;
    return {
      date: today,
      A1: current('A1'),
      A3: current('A3'),
      A4: current('A4'),
      A5: a5 && a5.row.assigned_on === today ? a5 : null,
    };
  });
}

/** Read-only: the A1 word reserved or assigned for a day (for notification text). */
export function a1WordFor(executor: SqlExecutor, date: string): string | null {
  const row = executor.get<ContentItemRow>(
    "SELECT * FROM content_item WHERE module = 'A1' AND assigned_on = ? AND status != 'excluded' LIMIT 1",
    [date],
  );
  return row ? parseContentRow<'A1'>(row).payload.headword : null;
}
