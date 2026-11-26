import { Directory, File } from 'expo-file-system';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { MAIN_DATABASE_NAME } from '../db/database_schema';
import { readSchemaVersion } from '../db/run_migrations';
import { deleteExpoDatabase, openExpoDatabase } from '../platform/expo_sqlite_executor';

/**
 * Decision E5: keep the database (and the wrapped-key file) out of the Files app.
 * expo-sqlite's default folder is Documents/SQLite, which UIFileSharingEnabled exposes;
 * Library/ is private to the app and still preserved across updates and re-signs.
 */
export function hiddenDataDirectory(): string | null {
  const match = /^(.*)\/Documents\/SQLite\/?$/.exec(defaultDatabaseDirectory ?? '');
  return match ? `${match[1]}/Library/MicroHabitsData` : null;
}

function fileAt(directoryPath: string, name: string): File {
  return new File(`file://${directoryPath}/${name}`);
}

export interface DatabaseLocation {
  readonly directory: string;
  readonly hidden: boolean;
  readonly movedThisLaunch: boolean;
  readonly note: string | null;
}

/**
 * Returns the folder to open the main database from, moving an existing database out of
 * Documents/SQLite once. The copy is verified (same schema version and settings row
 * count, readable with the key) before the original is deleted.
 */
export function resolveDatabaseLocation(keyHex: string): DatabaseLocation {
  const legacyDirectory = defaultDatabaseDirectory ?? '';
  const target = hiddenDataDirectory();
  if (!target) {
    return { directory: legacyDirectory, hidden: false, movedThisLaunch: false, note: 'Default folder layout not recognised; database left in Documents/SQLite' };
  }
  const targetFile = fileAt(target, MAIN_DATABASE_NAME);
  const legacyFile = fileAt(legacyDirectory, MAIN_DATABASE_NAME);
  if (targetFile.exists) {
    return {
      directory: target,
      hidden: true,
      movedThisLaunch: false,
      note: legacyFile.exists ? 'An older copy remains in Documents/SQLite' : null,
    };
  }
  if (!legacyFile.exists) return { directory: target, hidden: true, movedThisLaunch: false, note: null };

  const folder = new Directory(`file://${target}`);
  if (!folder.exists) folder.create({ intermediates: true });
  const original = openExpoDatabase(MAIN_DATABASE_NAME, keyHex, legacyDirectory);
  const expected = summary(original);
  original.close();
  legacyFile.copySync(targetFile);
  const copy = openExpoDatabase(MAIN_DATABASE_NAME, keyHex, target);
  const actual = summary(copy);
  copy.close();
  if (actual !== expected) {
    targetFile.delete();
    return { directory: legacyDirectory, hidden: false, movedThisLaunch: false, note: `Move check failed (${actual} vs ${expected}); kept in Documents/SQLite` };
  }
  deleteExpoDatabase(MAIN_DATABASE_NAME, legacyDirectory);
  return { directory: target, hidden: true, movedThisLaunch: true, note: null };
}

function summary(executor: ReturnType<typeof openExpoDatabase>): string {
  const version = readSchemaVersion(executor);
  const settingsRows = executor.get<{ n: number }>('SELECT count(*) AS n FROM settings')?.n ?? -1;
  return `v${version}/settings:${settingsRows}`;
}
