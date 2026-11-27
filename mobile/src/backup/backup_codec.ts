import {
  CURRENT_SCHEMA_VERSION,
  DATA_TABLES_IN_DEPENDENCY_ORDER,
  PRIMARY_KEY_BY_TABLE,
  type DataTableName,
} from '../db/database_schema';
import { readSchemaVersion, runMigrations } from '../db/run_migrations';
import type { CryptoPrimitives } from '../platform/crypto_primitives';
import { runInTransaction, type SqlExecutor, type SqlValue } from '../platform/sql_executor';
import {
  openWithPassphrase,
  sealWithDerivedKey,
  sealWithPassphrase,
  type DerivedKeyMaterial,
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

function readTableRows(executor: SqlExecutor, table: DataTableName, columns?: readonly string[]): Row[] {
  const list = columns && columns.length > 0 ? columns.join(', ') : '*';
  return executor.all<Row>(`SELECT ${list} FROM ${table} ORDER BY ${PRIMARY_KEY_BY_TABLE[table]}`);
}

/** Canonical JSON (sorted keys) so the checksum does not depend on column order. */
function canonicalJson(rows: readonly Row[]): string {
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key] ?? null]))),
  );
}

/**
 * SHA-256 of each table's rows in canonical JSON. `columnsByTable` restricts a table to the
 * columns a backup from an older schema had, so its checksums still verify after an upgrade.
 */
export function computeTableChecksums(
  executor: SqlExecutor,
  crypto: CryptoPrimitives,
  columnsByTable?: Partial<Record<DataTableName, readonly string[]>>,
): Record<DataTableName, string> {
  const checksums = {} as Record<DataTableName, string>;
  for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
    checksums[table] = crypto.sha256Hex(utf8Encode(canonicalJson(readTableRows(executor, table, columnsByTable?.[table]))));
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
  return backupFileText(document, envelope);
}

/** Encrypts with the stored backup key (no passphrase prompt); decryptable with the passphrase. */
export function encryptBackupWithKey(crypto: CryptoPrimitives, material: DerivedKeyMaterial, document: BackupDocument): string {
  const envelope = sealWithDerivedKey(crypto, material, 'dmh-backup', utf8Encode(JSON.stringify(document)));
  return backupFileText(document, envelope);
}

function backupFileText(document: BackupDocument, envelope: PassphraseEnvelope): string {
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
  readonly fromSchemaVersion: number;
  /** True when the backup came from an older schema; added columns took their defaults. */
  readonly upgraded: boolean;
}

/** Checks the backup can be restored into this app's schema before anything is written. */
export function checkBackupCompatibility(document: BackupDocument): void {
  if (document.format !== 'dmh-backup-1') throw new Error('Unknown backup document format');
  if (!Number.isInteger(document.schema_version) || document.schema_version < 1 || document.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Backup schema version ${document.schema_version} is not supported by this app (schema ${CURRENT_SCHEMA_VERSION})`);
  }
  for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
    if (!Array.isArray(document.tables?.[table])) throw new Error(`Backup has no ${table} table`);
    if (typeof document.checksums?.[table] !== 'string') throw new Error(`Backup has no checksum for ${table}`);
  }
}

function backupColumns(document: BackupDocument): Partial<Record<DataTableName, string[]>> {
  const columns: Partial<Record<DataTableName, string[]>> = {};
  for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
    const first = document.tables[table][0];
    if (first) columns[table] = Object.keys(first);
  }
  return columns;
}

/**
 * Replaces every data table with the backup's rows in one transaction, then rebuilds the
 * journal search index. The target database must be at this app's schema version. A backup
 * from an older schema restores too: migrations are additive, so its rows are inserted with
 * the columns they have and newer columns take their defaults; its checksums are then
 * verified over those columns only.
 */
export function restoreBackupDocument(
  executor: SqlExecutor,
  crypto: CryptoPrimitives,
  document: BackupDocument,
): RestoreReport {
  checkBackupCompatibility(document);
  const targetVersion = readSchemaVersion(executor);
  if (targetVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Database schema version ${targetVersion} is not this app's version ${CURRENT_SCHEMA_VERSION}`);
  }
  const columnsInBackup = backupColumns(document);
  for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
    const known = new Set(executor.all<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name));
    const unknown = (columnsInBackup[table] ?? []).filter((column) => !known.has(column));
    if (unknown.length > 0) throw new Error(`Backup column ${table}.${unknown[0]} does not exist in this app's schema`);
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
  const upgraded = document.schema_version < CURRENT_SCHEMA_VERSION;
  const restored = computeTableChecksums(executor, crypto, upgraded ? columnsInBackup : undefined);
  const checksumsMatch = DATA_TABLES_IN_DEPENDENCY_ORDER.every((table) => restored[table] === document.checksums[table]);
  return { rowsByTable, checksumsMatch, fromSchemaVersion: document.schema_version, upgraded };
}

/**
 * Verify only: restores the backup into a scratch database (migrated to this app's
 * schema) and reports rows and checksums, without touching the real data.
 */
export function verifyBackupDocument(
  openScratch: () => { readonly executor: SqlExecutor; dispose(): void },
  crypto: CryptoPrimitives,
  document: BackupDocument,
): RestoreReport {
  checkBackupCompatibility(document);
  const scratch = openScratch();
  try {
    runMigrations(scratch.executor);
    return restoreBackupDocument(scratch.executor, crypto, document);
  } finally {
    scratch.dispose();
  }
}

/** A plain JSON export (Settings → Export) carries the same document, unencrypted. */
export function parseExportText(text: string): BackupDocument {
  const document = JSON.parse(text) as BackupDocument;
  checkBackupCompatibility(document);
  return document;
}

/** Whether a file's text is an encrypted .mhbak (needs the passphrase) or a plain JSON export. */
export function backupTextKind(text: string): 'encrypted' | 'export' | 'unknown' {
  try {
    const parsed = JSON.parse(text) as { format?: string };
    if (parsed.format === 'dmh-mhbak-1') return 'encrypted';
    if (parsed.format === 'dmh-backup-1') return 'export';
  } catch {
    // Not JSON.
  }
  return 'unknown';
}
