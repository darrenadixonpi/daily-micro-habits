import type { CryptoPrimitives } from '../platform/crypto_primitives';
import type { SqlExecutor } from '../platform/sql_executor';
import type { DerivedKeyMaterial } from '../security/passphrase_encryption';
import { BACKUP_FILE_EXTENSION, backupFileName, buildBackupDocument, encryptBackupWithKey } from './backup_codec';

/** Where backup files live: the app's Documents folder on the phone, a temp folder in tests. */
export interface BackupFileStore {
  listNames(): string[];
  writeText(name: string, text: string): void;
  readText(name: string): Promise<string>;
  remove(name: string): void;
}

const BACKUP_NAME = /^microhabits_backup_\d{4}-\d{2}-\d{2}\.mhbak$/;

export function listBackupNames(store: BackupFileStore): string[] {
  return store.listNames().filter((name) => BACKUP_NAME.test(name)).sort();
}

export interface DailyBackupResult {
  readonly fileName: string;
  readonly bytes: number;
  readonly pruned: readonly string[];
}

/**
 * Writes microhabits_backup_<date>.mhbak (spec Section 9) and keeps the newest
 * `retention` files. Names sort chronologically, so pruning removes the oldest.
 */
export function writeDailyBackup(
  executor: SqlExecutor,
  crypto: CryptoPrimitives,
  store: BackupFileStore,
  input: {
    readonly keyMaterial: DerivedKeyMaterial;
    readonly date: string;
    readonly appVersion: string;
    readonly retention: number;
    readonly now: Date;
  },
): DailyBackupResult {
  const document = buildBackupDocument(executor, crypto, input.appVersion, input.now);
  const text = encryptBackupWithKey(crypto, input.keyMaterial, document);
  const fileName = backupFileName(input.date);
  store.writeText(fileName, text);
  const names = listBackupNames(store);
  const pruned = names.slice(0, Math.max(0, names.length - input.retention));
  for (const name of pruned) store.remove(name);
  return { fileName, bytes: text.length, pruned };
}

export { BACKUP_FILE_EXTENSION };
