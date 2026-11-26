import {
  CURRENT_SCHEMA_VERSION,
  DATA_TABLES_IN_DEPENDENCY_ORDER,
  PRIMARY_KEY_BY_TABLE,
  type DataTableName,
} from '../db/database_schema';
import { readSchemaVersion } from '../db/run_migrations';
import type { CryptoPrimitives } from '../platform/crypto_primitives';
import { runInTransaction, type SqlExecutor, type SqlValue } from '../platform/sql_executor';
import {
  openWithPassphrase,
  sealWithPassphrase,
  type PassphraseEnvelope,
} from '../security/passphrase_encryption';
import { utf8Decode, utf8Encode } from '../util/byte_encoding';

/**
 * Backup format (spec Section 9): a JSON document of every data table, sealed with the
 * passphrase into a `.mhbak` file. Restore validates the schema version before writing.
 */
export const BACKUP_FILE_EXTENSION = '.mhbak';

type Row = Record<string, SqlValue>;

export interface BackupDocument {
  readonly format: 'dmh-backup-1';
  readonly schema_version: number;
  readonly created_at: string;
  readonly app_version: string;
  readonly tables: Record<DataTableName, Row[]>;
  readonly checksums: Record<DataTableName, string>;
}

export interface BackupFile {
  readonly format: 'dmh-mhbak-1';
  readonly schema_version: number;
  readonly created_at: string;
  readonly envelope: PassphraseEnvelope;
}

export function backupFileName(localDate: string): string {
  return `microhabits_backup_${localDate}${BACKUP_FILE_EXTENSION}`;
}

function readTableRows(executor: SqlExecutor, table: DataTableName): Row[] {
  return executor.all<Row>(`SELECT * FROM ${table} ORDER BY ${PRIMARY_KEY_BY_TABLE[table]}`);
}

/** Canonical JSON (sorted keys) so the checksum does not depend on column order. */
function canonicalJson(rows: readonly Row[]): string {
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key] ?? null]))),
  );
}

export function computeTableChecksums(executor: SqlExecutor, crypto: CryptoPrimitives): Record<DataTableName, string> {
  const checksums = {} as Record<DataTableName, string>;
  for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
    checksums[table] = crypto.sha256Hex(utf8Encode(canonicalJson(readTableRows(executor, table))));
  }
  return checksums;
}

export function buildBackupDocument(
  executor: SqlExecutor,
  crypto: CryptoPrimitives,
  appVersion: string,
  now: Date = new Date(),
): BackupDocument {
  const tables = {} as Record<DataTableName, Row[]>;
  for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
    const rows = readTableRows(executor, table);
    if (rows.some((row) => Object.values(row).some((value) => value instanceof Uint8Array))) {
      throw new Error(`Table ${table} contains binary values, which the backup format does not support`);
    }
    tables[table] = rows;
  }
  return {
    format: 'dmh-backup-1',
    schema_version: readSchemaVersion(executor),
    created_at: now.toISOString(),
    app_version: appVersion,
    tables,
    checksums: computeTableChecksums(executor, crypto),
  };
}

export async function encryptBackup(
  crypto: CryptoPrimitives,
  passphrase: string,
  document: BackupDocument,
  iterations?: number,
): Promise<string> {
  const envelope = await sealWithPassphrase(
    crypto, passphrase, 'dmh-backup', utf8Encode(JSON.stringify(document)), iterations,
  );
  const file: BackupFile = {
    format: 'dmh-mhbak-1',
    schema_version: document.schema_version,
    created_at: document.created_at,
    envelope,
  };
  return JSON.stringify(file);
}

export async function decryptBackup(crypto: CryptoPrimitives, passphrase: string, fileText: string): Promise<BackupDocument> {
  const file = JSON.parse(fileText) as BackupFile;
  if (file.format !== 'dmh-mhbak-1') throw new Error(`Not a Micro-Habits backup file (${String(file.format)})`);
  const plaintext = await openWithPassphrase(crypto, passphrase, 'dmh-backup', file.envelope);
  const document = JSON.parse(utf8Decode(plaintext)) as BackupDocument;
  if (document.format !== 'dmh-backup-1') throw new Error('Unknown backup document format');
  return document;
}

export interface RestoreReport {
  readonly rowsByTable: Record<DataTableName, number>;
  readonly checksumsMatch: boolean;
}

/**
 * Replaces every data table with the backup's rows in one transaction, then rebuilds
 * the journal search index. The target database must already be migrated to the
 * backup's schema version.
 */
export function restoreBackupDocument(
  executor: SqlExecutor,
  crypto: CryptoPrimitives,
  document: BackupDocument,
): RestoreReport {
  const targetVersion = readSchemaVersion(executor);
  if (document.schema_version !== targetVersion || targetVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Backup schema version ${document.schema_version} does not match database version ${targetVersion}`,
    );
  }
  const rowsByTable = {} as Record<DataTableName, number>;
  runInTransaction(executor, () => {
    executor.exec('PRAGMA defer_foreign_keys = ON');
    for (const table of [...DATA_TABLES_IN_DEPENDENCY_ORDER].reverse()) executor.run(`DELETE FROM ${table}`);
    for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
      const rows = document.tables[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        executor.run(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((column) => row[column] ?? null),
        );
      }
      rowsByTable[table] = rows.length;
    }
    executor.exec("INSERT INTO journal_fts (journal_fts) VALUES ('rebuild')");
  });
  const restored = computeTableChecksums(executor, crypto);
  const checksumsMatch = DATA_TABLES_IN_DEPENDENCY_ORDER.every((table) => restored[table] === document.checksums[table]);
  return { rowsByTable, checksumsMatch };
}
