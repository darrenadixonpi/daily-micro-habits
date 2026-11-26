import type { BackupFileStore } from '../backup/daily_backup';
import type { CryptoPrimitives } from '../platform/crypto_primitives';
import type { SqlExecutor } from '../platform/sql_executor';
import type { ReferenceVectorFile } from '../srs/fsrs_reference_cases';
import type { AppScheduler } from '../srs/fsrs_scheduler';

/**
 * What a diagnostic case may use. The app supplies expo-sqlite (SQLCipher),
 * react-native-quick-crypto and expo-file-system; the Node tests supply node:sqlite,
 * node:crypto and node:fs. The cases themselves are identical in both.
 */
export interface DiagnosticEnvironment {
  readonly engineLabel: string;
  readonly crypto: CryptoPrimitives;
  /** True when scratch databases are SQLCipher-encrypted (the phone); false under Node. */
  readonly supportsEncryption: boolean;
  /** Opens a scratch database file; keyHex null opens it without a key. */
  openScratchDatabase(name: string, keyHex: string | null): SqlExecutor;
  deleteScratchDatabase(name: string): void;
  createScheduler(desiredRetention: number): Promise<AppScheduler>;
  readonly referenceVectors: ReferenceVectorFile;
  /** Writes text to a scratch file, reads it back, deletes it, and returns what was read. */
  writeAndReadBackFile(name: string, text: string): Promise<string>;
  /** An empty scratch folder for backup files; dispose() removes it. */
  createScratchBackupStore(): BackupFileStore & { dispose(): void };
  /**
   * On the phone: the OS's pending notification IDs and the IDs the main database's
   * ledger expects to be pending. Absent under Node.
   */
  inspectLiveNotifications?(): Promise<{ readonly pending: readonly string[]; readonly tracked: readonly string[] } | null>;
}

export type DiagnosticStatus = 'passed' | 'failed' | 'skipped';

export interface DiagnosticResult {
  readonly id: string;
  readonly title: string;
  readonly status: DiagnosticStatus;
  readonly detail: string;
  readonly durationMs: number;
}

export interface DiagnosticCase {
  readonly id: string;
  readonly title: string;
  /** Returns a detail line on success; throws (or returns a skip) otherwise. */
  run(environment: DiagnosticEnvironment): Promise<string | { readonly skipped: string }>;
}

export class DiagnosticFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticFailure';
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DiagnosticFailure(message);
}
