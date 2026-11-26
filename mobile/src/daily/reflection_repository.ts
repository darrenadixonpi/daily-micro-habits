import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { addDays } from '../time/logical_day';

/** D1 priorities, D2 statuses and D3 journal entries (spec Section 2). */
export const PRIORITY_MAX_LENGTH = 120;
export const PRIORITY_MAX_COUNT = 3;

export type PriorityStatus = 'open' | 'done' | 'partial' | 'not_done';

export interface Priority {
  readonly id: number;
  readonly date: string;
  readonly position: number;
  readonly text: string;
  readonly status: PriorityStatus;
  readonly note: string | null;
  readonly carried_from_id: number | null;
}

export interface PriorityDraft {
  readonly text: string;
  readonly carriedFromId: number | null;
}

export function listPriorities(executor: SqlExecutor, date: string): Priority[] {
  return executor.all<Priority>('SELECT * FROM priority WHERE date = ? ORDER BY position', [date]);
}

/**
 * Yesterday's items marked partial or not done that are not yet carried into `date`;
 * offered as one-tap prefills.
 */
export function carryOverCandidates(executor: SqlExecutor, date: string): Priority[] {
  return executor.all<Priority>(
    `SELECT * FROM priority p
     WHERE p.date = ? AND p.status IN ('partial', 'not_done')
       AND NOT EXISTS (SELECT 1 FROM priority q WHERE q.date = ? AND q.carried_from_id = p.id)
     ORDER BY p.position`,
    [addDays(date, -1), date],
  );
}

/** Replaces the day's priorities with 1–3 drafts, keeping statuses of items whose text is unchanged. */
export function savePriorities(executor: SqlExecutor, date: string, drafts: readonly PriorityDraft[]): Priority[] {
  const cleaned = drafts
    .map((draft) => ({ ...draft, text: draft.text.trim() }))
    .filter((draft) => draft.text.length > 0);
  if (cleaned.length === 0) throw new Error('Enter at least one priority');
  if (cleaned.length > PRIORITY_MAX_COUNT) throw new Error(`At most ${PRIORITY_MAX_COUNT} priorities`);
  const tooLong = cleaned.find((draft) => draft.text.length > PRIORITY_MAX_LENGTH);
  if (tooLong) throw new Error(`Priorities are limited to ${PRIORITY_MAX_LENGTH} characters`);
  return runInTransaction(executor, () => {
    const existing = listPriorities(executor, date);
    executor.run('DELETE FROM priority WHERE date = ?', [date]);
    cleaned.forEach((draft, index) => {
      const previous = existing.find((item) => item.text === draft.text);
      executor.run(
        `INSERT INTO priority (date, position, text, status, note, carried_from_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [date, index + 1, draft.text, previous?.status ?? 'open', previous?.note ?? null, draft.carriedFromId],
      );
    });
    return listPriorities(executor, date);
  });
}

export function setPriorityStatus(executor: SqlExecutor, id: number, status: PriorityStatus, note: string | null): void {
  const trimmed = note?.trim() ?? '';
  executor.run('UPDATE priority SET status = ?, note = ? WHERE id = ?', [status, trimmed === '' ? null : trimmed, id]);
}

export interface JournalEntry {
  readonly id: number;
  readonly date: string;
  readonly body_md: string;
  readonly mood: number | null;
  readonly prompt_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_edited_at: string | null;
}

export function getJournalEntry(executor: SqlExecutor, date: string): JournalEntry | undefined {
  return executor.get<JournalEntry>('SELECT * FROM journal_entry WHERE date = ? ORDER BY id LIMIT 1', [date]);
}

export function listJournalEntries(executor: SqlExecutor, limit = 60): JournalEntry[] {
  return executor.all<JournalEntry>('SELECT * FROM journal_entry ORDER BY date DESC LIMIT ?', [limit]);
}

/**
 * Saves the single entry for a logical day. Same-day edits are free; editing a past
 * day's entry also stamps last_edited_at (spec Section 2, D3).
 */
export function saveJournalEntry(
  executor: SqlExecutor,
  input: {
    readonly date: string;
    readonly today: string;
    readonly body: string;
    readonly mood: number | null;
    readonly promptId: string | null;
    readonly now: Date;
  },
): JournalEntry {
  if (input.mood !== null && !(Number.isInteger(input.mood) && input.mood >= 1 && input.mood <= 5)) {
    throw new Error('Mood must be 1–5');
  }
  const nowIso = input.now.toISOString();
  const existing = getJournalEntry(executor, input.date);
  if (existing) {
    if (existing.body_md !== input.body || existing.mood !== input.mood || existing.prompt_id !== input.promptId) {
      executor.run(
        `UPDATE journal_entry SET body_md = ?, mood = ?, prompt_id = ?, updated_at = ?,
           last_edited_at = CASE WHEN ? < ? THEN ? ELSE last_edited_at END
         WHERE id = ?`,
        [input.body, input.mood, input.promptId, nowIso, input.date, input.today, nowIso, existing.id],
      );
    }
  } else {
    executor.run(
      `INSERT INTO journal_entry (date, body_md, mood, prompt_id, created_at, updated_at, last_edited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.date, input.body, input.mood, input.promptId, nowIso, nowIso, input.date < input.today ? nowIso : null],
    );
  }
  return getJournalEntry(executor, input.date) as JournalEntry;
}

/** Full-text search; each word of the query must appear (prefix match on the last word). */
export function searchJournal(executor: SqlExecutor, query: string, limit = 50): JournalEntry[] {
  const words = query.match(/[A-Za-z0-9\u00C0-\uFFFF]+/g) ?? [];
  if (words.length === 0) return [];
  const match = words
    .map((word, index) => `"${word.replace(/"/g, '')}"${index === words.length - 1 ? '*' : ''}`)
    .join(' ');
  return executor.all<JournalEntry>(
    `SELECT e.* FROM journal_fts f JOIN journal_entry e ON e.id = f.rowid
     WHERE journal_fts MATCH ? ORDER BY e.date DESC LIMIT ?`,
    [match, limit],
  );
}

/** D3 completion: the entry contains at least one word (spec: "one line to several paragraphs"). */
export function journalEntryCounts(body: string): boolean {
  return /[A-Za-zÀ-￿]{2,}/.test(body);
}
