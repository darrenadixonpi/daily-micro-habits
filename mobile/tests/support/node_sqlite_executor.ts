import { DatabaseSync } from 'node:sqlite';
import type { SqlExecutor, SqlValue } from '../../src/platform/sql_executor';

/**
 * SqlExecutor over Node's built-in SQLite (no SQLCipher), used by the tests and the
 * FSRS vector generator. In-memory unless a file path is given.
 */
export function openNodeDatabase(path = ':memory:'): SqlExecutor {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys = ON;');
  const params = (values: readonly SqlValue[] | undefined) => (values ?? []) as SqlValue[];
  return {
    exec(sql) {
      database.exec(sql);
    },
    run(sql, values) {
      const result = database.prepare(sql).run(...params(values));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    all<Row>(sql: string, values?: readonly SqlValue[]): Row[] {
      return database.prepare(sql).all(...params(values)).map((row) => ({ ...row }) as Row);
    },
    get<Row>(sql: string, values?: readonly SqlValue[]): Row | undefined {
      const row = database.prepare(sql).get(...params(values));
      return row === undefined ? undefined : ({ ...row } as Row);
    },
    close() {
      database.close();
    },
  };
}
