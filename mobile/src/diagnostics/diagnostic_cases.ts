import {
  buildBackupDocument,
  decryptBackup,
  encryptBackup,
  restoreBackupDocument,
} from '../backup/backup_codec';
import {
  CURRENT_SCHEMA_VERSION,
  DATA_TABLES_IN_DEPENDENCY_ORDER,
  EXPECTED_COLUMNS,
} from '../db/database_schema';
import { runMigrations } from '../db/run_migrations';
import type { SqlExecutor } from '../platform/sql_executor';
import { unwrapDatabaseKey, wrapDatabaseKey, WrongPassphraseError } from '../security/passphrase_encryption';
import { compareReferenceCases, computeAllReferenceCases } from '../srs/fsrs_reference_cases';
import { Rating } from '../srs/fsrs_scheduler';
import { createSrsCard, loadSrsCard, recordReview } from '../srs/review_service';
import { bytesEqual, bytesToHex } from '../util/byte_encoding';
import { M2_DIAGNOSTIC_CASES } from './diagnostic_cases_m2';
import { check, type DiagnosticCase, type DiagnosticEnvironment } from './diagnostic_environment';
import { insertSampleRows, SAMPLE_JOURNAL_SEARCH_TERM } from './sample_data';

const TEST_PASSPHRASE = 'm1-diagnostic-passphrase';

/** Opens a migrated scratch database (encrypted with a fresh random key where supported), runs `work`, deletes it. */
async function withScratchDatabase<Result>(
  environment: DiagnosticEnvironment,
  name: string,
  work: (executor: SqlExecutor) => Result | Promise<Result>,
): Promise<Result> {
  const keyHex = environment.supportsEncryption ? bytesToHex(environment.crypto.randomBytes(32)) : null;
  safeDelete(environment, name);
  const executor = environment.openScratchDatabase(name, keyHex);
  try {
    runMigrations(executor);
    return await work(executor);
  } finally {
    executor.close();
    safeDelete(environment, name);
  }
}

function safeDelete(environment: DiagnosticEnvironment, name: string): void {
  try {
    environment.deleteScratchDatabase(name);
  } catch {
    // The file did not exist.
  }
}

function count(executor: SqlExecutor, sql: string, params: (string | number)[] = []): number {
  return executor.get<{ n: number }>(sql, params)?.n ?? -1;
}

const t1FsrsReferenceVectors: DiagnosticCase = {
  id: 'T1',
  title: 'FSRS matches the Node reference',
  async run(environment) {
    const actual = await computeAllReferenceCases(environment.createScheduler);
    const comparison = compareReferenceCases(environment.referenceVectors.cases, actual);
    check(comparison.matched, comparison.firstMismatch ?? 'mismatch');
    return `${comparison.stepsCompared} review steps identical (max |Δ| ${comparison.maxAbsoluteDifference.toExponential(1)}); ` +
      `ts-fsrs ${environment.referenceVectors.tsFsrsVersion}, ${environment.referenceVectors.modelVersion}`;
  },
};

const t2Migrations: DiagnosticCase = {
  id: 'T2',
  title: 'Migrations build the 12-table schema',
  async run(environment) {
    const name = 'diag_t2_migrations.db';
    const keyHex = environment.supportsEncryption ? bytesToHex(environment.crypto.randomBytes(32)) : null;
    safeDelete(environment, name);
    const executor = environment.openScratchDatabase(name, keyHex);
    try {
      const first = runMigrations(executor);
      check(first.fromVersion === 0 && first.toVersion === CURRENT_SCHEMA_VERSION, `migrated ${first.fromVersion}→${first.toVersion}`);
      const second = runMigrations(executor);
      check(second.applied.length === 0, 'second run applied migrations again');
      for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
        const columns = executor.all<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name);
        check(
          JSON.stringify(columns) === JSON.stringify(EXPECTED_COLUMNS[table]),
          `${table} columns ${columns.join(',')}`,
        );
      }
      check(count(executor, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'journal_fts'") === 1, 'journal_fts missing');
      check(executor.all('PRAGMA foreign_key_check').length === 0, 'foreign key check failed');
      const integrity = executor.get<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check;
      check(integrity === 'ok', `integrity_check: ${integrity}`);
      return `schema version ${second.toVersion}; ${DATA_TABLES_IN_DEPENDENCY_ORDER.length + 1} tables incl. journal_fts; re-run is a no-op`;
    } finally {
      executor.close();
      safeDelete(environment, name);
    }
  },
};

const t3Encryption: DiagnosticCase = {
  id: 'T3',
  title: 'Database file is unreadable without its key',
  async run(environment) {
    if (!environment.supportsEncryption) return { skipped: `no SQLCipher in ${environment.engineLabel}` };
    const name = 'diag_t3_encryption.db';
    const keyHex = bytesToHex(environment.crypto.randomBytes(32));
    const wrongKeyHex = bytesToHex(environment.crypto.randomBytes(32));
    safeDelete(environment, name);
    try {
      const writer = environment.openScratchDatabase(name, keyHex);
      const cipherVersion = writer.get<{ cipher_version: string }>('PRAGMA cipher_version')?.cipher_version;
      writer.exec("CREATE TABLE secret (v TEXT); INSERT INTO secret VALUES ('ciphertext-check');");
      writer.close();
      check(cipherVersion, 'PRAGMA cipher_version returned nothing (SQLCipher not linked)');

      for (const [label, attemptKey] of [['no key', null], ['a wrong key', wrongKeyHex]] as const) {
        let readable = true;
        let attempt: SqlExecutor | null = null;
        try {
          attempt = environment.openScratchDatabase(name, attemptKey);
          attempt.get('SELECT count(*) AS n FROM sqlite_master');
        } catch {
          readable = false;
        } finally {
          try {
            attempt?.close();
          } catch {
            // Closing a connection that failed to read may throw.
          }
        }
        check(!readable, `database was readable with ${label}`);
      }
      const reader = environment.openScratchDatabase(name, keyHex);
      const value = reader.get<{ v: string }>('SELECT v FROM secret')?.v;
      reader.close();
      check(value === 'ciphertext-check', 'correct key did not read the row back');
      return `SQLCipher ${cipherVersion}; no key and wrong key both rejected; correct key reads`;
    } finally {
      safeDelete(environment, name);
    }
  },
};

const t4ReviewAtomicity: DiagnosticCase = {
  id: 'T4',
  title: 'A failed review write changes nothing',
  async run(environment) {
    const scheduler = await environment.createScheduler(0.9);
    return withScratchDatabase(environment, 'diag_t4_atomicity.db', (executor) => {
      const now = new Date(Date.UTC(2026, 10, 26, 18, 0, 0));
      executor.run(
        `INSERT INTO content_item (id, module, payload_json, source) VALUES ('a1-t2-0001', 'A1', '{}', 'bundled')`,
      );
      createSrsCard(executor, scheduler, {
        cardId: 'card-t4', contentItemId: 'a1-t2-0001', cardType: 'recognition', language: 'en', now, dueAt: now,
      });
      const snapshot = () => executor.get<Record<string, unknown>>('SELECT * FROM srs_card WHERE id = ?', ['card-t4']);
      const before = JSON.stringify(snapshot());
      let threw = false;
      try {
        recordReview(executor, scheduler, {
          cardId: 'card-t4', grade: Rating.Good, now, responseMs: 1000, faultInjection: 'fail_after_card_update',
        });
      } catch {
        threw = true;
      }
      check(threw, 'fault injection did not throw');
      check(JSON.stringify(snapshot()) === before, 'card row changed despite the failed review');
      check(count(executor, 'SELECT count(*) AS n FROM srs_review_log') === 0, 'a review-log row was written');
      const after = recordReview(executor, scheduler, { cardId: 'card-t4', grade: Rating.Good, now, responseMs: 1000 });
      check(after.reps === 1, `reps ${after.reps} after one review`);
      check(loadSrsCard(executor, 'card-t4').reps === 1, 'stored card not updated');
      check(count(executor, 'SELECT count(*) AS n FROM srs_review_log') === 1, 'review log not written');
      return 'rolled back card + log together; the next review committed both';
    });
  },
};

const t5KeyWrapping: DiagnosticCase = {
  id: 'T5',
  title: 'Passphrase wraps and unwraps the database key',
  async run(environment) {
    const databaseKey = environment.crypto.randomBytes(32);
    const started = Date.now();
    const envelope = await wrapDatabaseKey(environment.crypto, TEST_PASSPHRASE, databaseKey);
    const deriveMs = Date.now() - started;
    const unwrapped = await unwrapDatabaseKey(environment.crypto, TEST_PASSPHRASE, envelope);
    check(bytesEqual(unwrapped, databaseKey), 'unwrapped key differs');
    let wrongRejected = false;
    try {
      await unwrapDatabaseKey(environment.crypto, `${TEST_PASSPHRASE}-wrong`, envelope);
    } catch (error) {
      wrongRejected = error instanceof WrongPassphraseError;
    }
    check(wrongRejected, 'wrong passphrase was not rejected');
    return `PBKDF2 ${envelope.kdf.iterations.toLocaleString('en-US')} iterations + AES-256-GCM in ${deriveMs} ms; wrong passphrase rejected`;
  },
};

const t6BackupRoundTrip: DiagnosticCase = {
  id: 'T6',
  title: 'Encrypted backup restores identically',
  async run(environment) {
    const scheduler = await environment.createScheduler(0.9);
    const fileText = await withScratchDatabase(environment, 'diag_t6_source.db', async (source) => {
      insertSampleRows(source, scheduler);
      const document = buildBackupDocument(source, environment.crypto, 'diagnostic');
      const encrypted = await encryptBackup(environment.crypto, TEST_PASSPHRASE, document);
      check(!encrypted.includes(SAMPLE_JOURNAL_SEARCH_TERM), 'backup file contains plaintext');
      return environment.writeAndReadBackFile('diag_t6_backup.mhbak', encrypted);
    });
    let wrongRejected = false;
    try {
      await decryptBackup(environment.crypto, `${TEST_PASSPHRASE}-wrong`, fileText);
    } catch (error) {
      wrongRejected = error instanceof WrongPassphraseError;
    }
    check(wrongRejected, 'wrong passphrase was not rejected');
    const document = await decryptBackup(environment.crypto, TEST_PASSPHRASE, fileText);
    return withScratchDatabase(environment, 'diag_t6_target.db', (target) => {
      const report = restoreBackupDocument(target, environment.crypto, document);
      check(report.checksumsMatch, 'restored table checksums differ from the backup');
      const empty = DATA_TABLES_IN_DEPENDENCY_ORDER.filter((table) => report.rowsByTable[table] === 0);
      check(empty.length === 0, `sample data missing for ${empty.join(', ')}`);
      const hits = count(target, 'SELECT count(*) AS n FROM journal_fts WHERE journal_fts MATCH ?', [SAMPLE_JOURNAL_SEARCH_TERM]);
      check(hits === 1, `journal search after restore found ${hits}`);
      const rows = Object.values(report.rowsByTable).reduce((sum, n) => sum + n, 0);
      return `${rows} rows in ${DATA_TABLES_IN_DEPENDENCY_ORDER.length} tables; checksums match; ${fileText.length.toLocaleString('en-US')} B file`;
    });
  },
};

const t7JournalSearch: DiagnosticCase = {
  id: 'T7',
  title: 'Journal full-text search tracks edits',
  async run(environment) {
    return withScratchDatabase(environment, 'diag_t7_search.db', (executor) => {
      const now = new Date().toISOString();
      const insert = (body: string) =>
        executor.run(
          "INSERT INTO journal_entry (date, body_md, created_at, updated_at) VALUES ('2026-11-26', ?, ?, ?)",
          [body, now, now],
        ).lastInsertRowId;
      const search = (term: string) =>
        count(executor, 'SELECT count(*) AS n FROM journal_fts WHERE journal_fts MATCH ?', [term]);
      const first = insert('Morning walk along the river; thought about enzymes.');
      insert('Evening review: finished the migration tests.');
      check(search('enzymes') === 1 && search('migration') === 1, 'inserted entries not found');
      executor.run('UPDATE journal_entry SET body_md = ? WHERE id = ?', ['Morning walk; thought about catalysts.', first]);
      check(search('enzymes') === 0 && search('catalysts') === 1, 'index not updated after edit');
      executor.run('DELETE FROM journal_entry WHERE id = ?', [first]);
      check(search('catalysts') === 0, 'index not updated after delete');
      return 'insert, edit and delete all reflected in FTS5 search';
    });
  },
};

export const DIAGNOSTIC_CASES: readonly DiagnosticCase[] = [
  t1FsrsReferenceVectors,
  t2Migrations,
  t3Encryption,
  t4ReviewAtomicity,
  t5KeyWrapping,
  t6BackupRoundTrip,
  t7JournalSearch,
  ...M2_DIAGNOSTIC_CASES,
];
