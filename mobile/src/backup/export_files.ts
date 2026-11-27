import type { CryptoPrimitives } from '../platform/crypto_primitives';
import type { SqlExecutor } from '../platform/sql_executor';
import { formatLongDate } from '../ui/date_format';
import { buildBackupDocument } from './backup_codec';

/**
 * Manual export (spec Section 9): a JSON dump of every data table (the same document a
 * backup holds, unencrypted, so it can be read anywhere) plus the journal as Markdown,
 * one file per month. Importing the JSON (Restore screen) is the export–import round trip
 * of the M4 gate.
 */
export interface ExportFile {
  readonly name: string;
  readonly text: string;
  readonly kind: 'json' | 'journal';
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface JournalRow {
  readonly date: string;
  readonly body_md: string;
  readonly mood: number | null;
  readonly last_edited_at: string | null;
}

export function journalMarkdownByMonth(executor: SqlExecutor): ExportFile[] {
  const entries = executor.all<JournalRow>('SELECT date, body_md, mood, last_edited_at FROM journal_entry ORDER BY date, id');
  const byMonth = new Map<string, JournalRow[]>();
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), entry]);
  }
  return [...byMonth.entries()].map(([month, rows]) => {
    const [year, monthNumber] = month.split('-');
    const lines = [`# Journal — ${MONTH_NAMES[Number(monthNumber) - 1]} ${year}`, ''];
    for (const row of rows) {
      lines.push(`## ${formatLongDate(row.date)}, ${row.date.slice(0, 4)}`, '');
      lines.push(row.body_md.trim(), '');
      const meta = [row.mood !== null ? `Mood ${row.mood}/5` : null, row.last_edited_at ? `edited ${row.last_edited_at.slice(0, 10)}` : null].filter(Boolean);
      if (meta.length > 0) lines.push(`*${meta.join(' · ')}*`, '');
    }
    return { name: `microhabits_journal_${month}.md`, text: lines.join('\n'), kind: 'journal' as const };
  });
}

export function buildExportFiles(
  executor: SqlExecutor,
  crypto: CryptoPrimitives,
  input: { readonly appVersion: string; readonly localDate: string; readonly now: Date },
): ExportFile[] {
  const document = buildBackupDocument(executor, crypto, input.appVersion, input.now);
  return [
    { name: `microhabits_export_${input.localDate}.json`, text: JSON.stringify(document, null, 1), kind: 'json' },
    ...journalMarkdownByMonth(executor),
  ];
}
