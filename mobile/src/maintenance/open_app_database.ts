import { MAIN_DATABASE_NAME } from '../db/database_schema';
import { runMigrations, type MigrationReport } from '../db/run_migrations';
import { openExpoDatabase } from '../platform/expo_sqlite_executor';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { getOrCreateDatabaseKey } from '../security/database_key_store';
import { readInternalValue, writeInternalValue } from '../settings/settings_repository';
import { resolveDatabaseLocation, type DatabaseLocation } from './database_location';
import { removeM0TestData } from './remove_m0_test_data';

export interface AppDatabase {
  readonly executor: SqlExecutor;
  /** Needed to wrap the key when the recovery passphrase is set; never displayed. */
  readonly keyHex: string;
  readonly keyCreatedNow: boolean;
  readonly location: DatabaseLocation;
  readonly cipherVersion: string | null;
  readonly migration: MigrationReport;
  readonly firstLaunchAt: string;
  readonly launchCount: number;
  readonly m0TestDataRemoved: readonly string[];
}

/** Opens the encrypted main database from its private folder, migrates it, and records the launch. */
export async function openAppDatabase(): Promise<AppDatabase> {
  const key = await getOrCreateDatabaseKey();
  const location = resolveDatabaseLocation(key.keyHex);
  const executor = openExpoDatabase(MAIN_DATABASE_NAME, key.keyHex, location.directory);
  const cipherVersion = executor.get<{ cipher_version: string }>('PRAGMA cipher_version')?.cipher_version ?? null;
  const migration = runMigrations(executor);
  const { firstLaunchAt, launchCount } = runInTransaction(executor, () => {
    const now = new Date();
    let first = readInternalValue(executor, 'first_launch_at');
    if (typeof first !== 'string') {
      first = now.toISOString();
      writeInternalValue(executor, 'first_launch_at', first, now);
    }
    const previous = readInternalValue(executor, 'launch_count');
    const count = (typeof previous === 'number' ? previous : 0) + 1;
    writeInternalValue(executor, 'launch_count', count, now);
    return { firstLaunchAt: first as string, launchCount: count };
  });
  const m0TestDataRemoved = removeM0TestData(executor);
  return {
    executor,
    keyHex: key.keyHex,
    keyCreatedNow: key.createdNow,
    location,
    cipherVersion,
    migration,
    firstLaunchAt,
    launchCount,
    m0TestDataRemoved,
  };
}
