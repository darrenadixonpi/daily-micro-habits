import { Directory, File, Paths } from 'expo-file-system';
import type { SqlExecutor } from '../platform/sql_executor';
import { deleteExpoDatabase } from '../platform/expo_sqlite_executor';
import { readInternalValue, writeInternalValue } from '../settings/settings_repository';

const M0_DATABASE_NAME = 'dmh_m0.db';
const M0_BACKUP_FILE = /^m0_backup_\d{4}-\d{2}-\d{2}\.json$/;

/**
 * One-time removal of the M0 pipeline-test data (test entries only): the dmh_m0.db
 * database and m0_backup_*.json files in Documents. The Keychain key is kept; it now
 * encrypts the real database. Returns the names removed on this launch.
 */
export function removeM0TestData(executor: SqlExecutor): string[] {
  if (readInternalValue(executor, 'm0_test_data_removed_at') !== undefined) return [];
  const removed: string[] = [];
  try {
    deleteExpoDatabase(M0_DATABASE_NAME);
    removed.push(M0_DATABASE_NAME);
  } catch {
    // Not present.
  }
  try {
    for (const entry of new Directory(Paths.document).list()) {
      if (entry instanceof File && M0_BACKUP_FILE.test(entry.name)) {
        entry.delete();
        removed.push(entry.name);
      }
    }
  } catch {
    // Documents folder not listable; nothing to remove.
  }
  writeInternalValue(executor, 'm0_test_data_removed_at', { at: new Date().toISOString(), removed });
  return removed;
}
