import type { SqlExecutor } from '../platform/sql_executor';

/**
 * task_completion rows written by the learning modules. Unlike D1–D3 and A2, whose rows
 * are derived from other tables at every status update (day_status.recordDayStatus), A1,
 * A3, A4 and A5 record what the user did (sentence, answer, typed phrase), so their rows
 * are written here, once, when the task is done. A3's delayed-recall answer uses the
 * pseudo-module A3R so it can be counted separately (spec Section 10, A3 delayed recall).
 */
export type RecordedModule = 'A1' | 'A3' | 'A3R' | 'A4' | 'A5';

export interface CompletionRow {
  readonly id: number;
  readonly date: string;
  readonly module: string;
  readonly content_item_id: string | null;
  readonly completed_at: string;
  readonly response_json: string | null;
}

export function completionFor(executor: SqlExecutor, date: string, module: RecordedModule, contentItemId?: string): CompletionRow | undefined {
  return contentItemId === undefined
    ? executor.get<CompletionRow>('SELECT * FROM task_completion WHERE date = ? AND module = ? ORDER BY id LIMIT 1', [date, module])
    : executor.get<CompletionRow>(
        'SELECT * FROM task_completion WHERE date = ? AND module = ? AND content_item_id = ? ORDER BY id LIMIT 1',
        [date, module, contentItemId],
      );
}

/** Inserts the day's completion, or replaces its response if the task was already done today. */
export function recordCompletion(
  executor: SqlExecutor,
  input: { readonly date: string; readonly module: RecordedModule; readonly contentItemId: string; readonly response: unknown; readonly now: Date },
): CompletionRow {
  executor.run('INSERT OR IGNORE INTO daily_session (date) VALUES (?)', [input.date]);
  const existing = completionFor(executor, input.date, input.module, input.contentItemId);
  const json = JSON.stringify(input.response);
  if (existing) {
    executor.run('UPDATE task_completion SET response_json = ? WHERE id = ?', [json, existing.id]);
  } else {
    executor.run(
      'INSERT INTO task_completion (date, module, content_item_id, completed_at, response_json) VALUES (?, ?, ?, ?, ?)',
      [input.date, input.module, input.contentItemId, input.now.toISOString(), json],
    );
  }
  const row = completionFor(executor, input.date, input.module, input.contentItemId);
  if (!row) throw new Error(`Completion for ${input.module} was not recorded`);
  return row;
}

/** The most recent response recorded for a content item, parsed. */
export function latestResponse<T>(executor: SqlExecutor, module: RecordedModule, contentItemId: string): T | undefined {
  const row = executor.get<CompletionRow>(
    'SELECT * FROM task_completion WHERE module = ? AND content_item_id = ? ORDER BY date DESC, id DESC LIMIT 1',
    [module, contentItemId],
  );
  return row?.response_json ? (JSON.parse(row.response_json) as T) : undefined;
}
