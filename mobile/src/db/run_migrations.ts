import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './database_schema';

export interface MigrationReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly string[];
}

export function readSchemaVersion(executor: SqlExecutor): number {
  return executor.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

/**
 * Applies every pending migration, each in its own transaction together with the
 * user_version bump, so a crash leaves the database at a consistent version.
 * Refuses to open a database written by a newer app version. `targetVersion` lets
 * diagnostic T13 stop at an older version to test an upgrade with data in place.
 */
export function runMigrations(executor: SqlExecutor, targetVersion: number = CURRENT_SCHEMA_VERSION): MigrationReport {
  const fromVersion = readSchemaVersion(executor);
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than this app supports (${CURRENT_SCHEMA_VERSION})`,
    );
  }
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= fromVersion || migration.version > targetVersion) continue;
    runInTransaction(executor, () => {
      executor.exec(migration.sql);
      executor.exec(`PRAGMA user_version = ${migration.version}`);
    });
    applied.push(migration.name);
  }
  return { fromVersion, toVersion: readSchemaVersion(executor), applied };
}
