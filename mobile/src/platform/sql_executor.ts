/**
 * Engine-neutral, synchronous SQL interface.
 *
 * The app implements it over expo-sqlite (SQLCipher) and the tests implement it over
 * Node's built-in node:sqlite, so the same data-layer code and the same diagnostic
 * cases run on the iPhone (Hermes) and in CI (Node).
 */
export type SqlValue = string | number | null | Uint8Array;

export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertRowId: number;
}

export interface SqlExecutor {
  /** Executes one or more statements without parameters. */
  exec(sql: string): void;
  /** Executes one statement with positional parameters. */
  run(sql: string, params?: readonly SqlValue[]): SqlRunResult;
  /** Returns all rows of a query. */
  all<Row>(sql: string, params?: readonly SqlValue[]): Row[];
  /** Returns the first row of a query, or undefined. */
  get<Row>(sql: string, params?: readonly SqlValue[]): Row | undefined;
  /** Closes the connection. */
  close(): void;
}

let savepointCounter = 0;

/**
 * Runs `work` inside a SAVEPOINT. Savepoints nest, behave identically in both engines,
 * and roll back every write made by `work` if it throws.
 */
export function runInTransaction<Result>(executor: SqlExecutor, work: () => Result): Result {
  savepointCounter += 1;
  const name = `dmh_tx_${savepointCounter}`;
  executor.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    executor.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    executor.exec(`ROLLBACK TO ${name}`);
    executor.exec(`RELEASE ${name}`);
    throw error;
  }
}
