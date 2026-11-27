import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import type { ContentItem, ContentItemRow, LearningModuleId, PayloadByModule } from './content_types';

/** Reads and changes content_item rows; payloads are parsed once here. */
export function parseContentRow<M extends LearningModuleId>(row: ContentItemRow): ContentItem<M> {
  return { row, payload: JSON.parse(row.payload_json) as PayloadByModule[M] };
}

export function getContentItem<M extends LearningModuleId = LearningModuleId>(
  executor: SqlExecutor,
  id: string,
): ContentItem<M> | undefined {
  const row = executor.get<ContentItemRow>('SELECT * FROM content_item WHERE id = ?', [id]);
  return row ? parseContentRow<M>(row) : undefined;
}

/** The item assigned to a logical day for a module, if any; excluded items no longer count. */
export function assignedItem<M extends LearningModuleId>(
  executor: SqlExecutor,
  module: M,
  date: string,
): ContentItem<M> | undefined {
  const row = executor.get<ContentItemRow>(
    "SELECT * FROM content_item WHERE module = ? AND assigned_on = ? AND parent_id IS NULL AND status != 'excluded' ORDER BY id LIMIT 1",
    [module, date],
  );
  return row ? parseContentRow<M>(row) : undefined;
}

/** Generated Simpler / Go deeper variants of a concept, oldest first. */
export function variantsOf(executor: SqlExecutor, parentId: string): ContentItem<'A3'>[] {
  return executor
    .all<ContentItemRow>("SELECT * FROM content_item WHERE parent_id = ? AND status != 'excluded' ORDER BY id", [parentId])
    .map((row) => parseContentRow<'A3'>(row));
}

/**
 * Report error (spec Section 6): the item is excluded from future serving, the reason is
 * kept, and its review cards are suspended so wrong material leaves spaced repetition.
 */
export function excludeContentItem(executor: SqlExecutor, id: string, reason: string): { readonly cardsSuspended: number } {
  return runInTransaction(executor, () => {
    executor.run("UPDATE content_item SET status = 'excluded', excluded_reason = ? WHERE id = ?", [reason.slice(0, 500), id]);
    const result = executor.run('UPDATE srs_card SET suspended = 1 WHERE content_item_id = ? AND suspended = 0', [id]);
    return { cardsSuspended: result.changes };
  });
}

export function countUnserved(
  executor: SqlExecutor,
  module: LearningModuleId,
  filter: { readonly tierOrLevel?: string; readonly language?: string; readonly domain?: string } = {},
): number {
  const clauses = ["module = ?", "status = 'unserved'", 'assigned_on IS NULL', 'parent_id IS NULL'];
  const params: string[] = [module];
  if (filter.tierOrLevel !== undefined) {
    clauses.push('tier_or_level = ?');
    params.push(filter.tierOrLevel);
  }
  if (filter.language !== undefined) {
    clauses.push('language = ?');
    params.push(filter.language);
  }
  if (filter.domain !== undefined) {
    clauses.push('domain = ?');
    params.push(filter.domain);
  }
  return executor.get<{ n: number }>(`SELECT count(*) AS n FROM content_item WHERE ${clauses.join(' AND ')}`, params)?.n ?? 0;
}

/** A1 tiers that have at least one word (decision G3: only these are offered in Settings). */
export function a1TiersWithContent(executor: SqlExecutor): string[] {
  return executor
    .all<{ tier: string }>(
      "SELECT DISTINCT tier_or_level AS tier FROM content_item WHERE module = 'A1' AND status != 'excluded' AND tier_or_level IS NOT NULL ORDER BY tier",
    )
    .map((row) => row.tier);
}

/** Titles already served for a module, newest first: the only history a generation request may carry (spec Section 9). */
export function servedTitles(executor: SqlExecutor, module: LearningModuleId, limit = 150): string[] {
  const rows = executor.all<ContentItemRow>(
    "SELECT * FROM content_item WHERE module = ? AND status != 'unserved' AND parent_id IS NULL ORDER BY served_on DESC, id DESC LIMIT ?",
    [module, limit],
  );
  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    return String(payload.headword ?? payload.title ?? payload.phrase ?? row.id);
  });
}
