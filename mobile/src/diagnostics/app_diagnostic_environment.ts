import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { trackedPendingIds } from '../notifications/notification_ledger';
import { createAppBackupFileStore } from '../platform/app_backup_file_store';
import { appCryptoPrimitives } from '../platform/app_crypto_primitives';
import { expoNotifier } from '../platform/expo_notifier';
import { deleteExpoDatabase, openExpoDatabase } from '../platform/expo_sqlite_executor';
import type { SqlExecutor } from '../platform/sql_executor';
import type { ReferenceVectorFile } from '../srs/fsrs_reference_cases';
import referenceVectors from '../srs/fsrs_reference_vectors.json';
import { createAppScheduler } from '../srs/fsrs_scheduler';
import type { DiagnosticEnvironment } from './diagnostic_environment';

/**
 * Diagnostic environment on the phone: SQLCipher scratch databases, native crypto, the
 * app's cache folder, and (when the main database is open) a read-only comparison of
 * iOS's pending notifications with the notification ledger.
 */
export function createAppDiagnosticEnvironment(mainExecutor: SqlExecutor | null): DiagnosticEnvironment {
  return {
    engineLabel: `Hermes on iOS ${String(Platform.Version)}`,
    crypto: appCryptoPrimitives,
    supportsEncryption: true,
    openScratchDatabase: (name, keyHex) => openExpoDatabase(name, keyHex),
    deleteScratchDatabase: (name) => deleteExpoDatabase(name),
    createScheduler: createAppScheduler,
    referenceVectors: referenceVectors as unknown as ReferenceVectorFile,
    async writeAndReadBackFile(name, text) {
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.writeSync(text);
      const read = await file.text();
      file.delete();
      return read;
    },
    createScratchBackupStore() {
      const directory = new Directory(Paths.cache, `diag_backups_${Date.now()}`);
      const store = createAppBackupFileStore(directory);
      return {
        ...store,
        dispose() {
          if (directory.exists) directory.delete();
        },
      };
    },
    async inspectLiveNotifications() {
      if (!mainExecutor) return null;
      return { pending: await expoNotifier.pendingIds(), tracked: trackedPendingIds(mainExecutor, new Date()) };
    },
  };
}
