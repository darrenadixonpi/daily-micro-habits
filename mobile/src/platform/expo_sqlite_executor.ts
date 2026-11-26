import * as SQLite from 'expo-sqlite';
import type { SqlExecutor, SqlValue } from './sql_executor';

/**
 * Opens (or creates) a SQLCipher-encrypted database in the app's default SQLite
 * directory and returns it as a SqlExecutor.
 *
 * @param databaseName file name, e.g. "microhabits.db"
 * @param keyHex 64 hex characters (256-bit raw key), or null to open without a key
 *               (used only by the encryption diagnostic to prove the file is unreadable).
 */
export function openExpoDatabase(databaseName: string, keyHex: string | null): SqlExecutor {
  const database = SQLite.openDatabaseSync(databaseName);
  if (keyHex !== null) {
    if (!/^[0-9a-f]{64}$/.test(keyHex)) {
      database.closeSync();
      throw new Error('Database key must be 64 lowercase hex characters');
    }
    // SQLCipher raw-key syntax; must be the first statement on the connection.
    database.execSync(`PRAGMA key = "x'${keyHex}'";`);
  }
  database.execSync('PRAGMA foreign_keys = ON;');
  return wrapExpoDatabase(database);
}

export function deleteExpoDatabase(databaseName: string): void {
  SQLite.deleteDatabaseSync(databaseName);
}

function bind(params: readonly SqlValue[] | undefined): SQLite.SQLiteBindValue[] {
  return params ? (params as SQLite.SQLiteBindValue[]) : [];
}

function wrapExpoDatabase(database: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    exec(sql) {
      database.execSync(sql);
    },
    run(sql, params) {
      const result = database.runSync(sql, bind(params));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    all<Row>(sql: string, params?: readonly SqlValue[]): Row[] {
      return database.getAllSync<Row>(sql, bind(params));
    },
    get<Row>(sql: string, params?: readonly SqlValue[]): Row | undefined {
      return database.getFirstSync<Row>(sql, bind(params)) ?? undefined;
    },
    close() {
      database.closeSync();
    },
  };
}
