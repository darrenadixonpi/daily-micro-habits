import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { appCryptoPrimitives } from '../platform/app_crypto_primitives';
import { deleteExpoDatabase, openExpoDatabase } from '../platform/expo_sqlite_executor';
import type { ReferenceVectorFile } from '../srs/fsrs_reference_cases';
import referenceVectors from '../srs/fsrs_reference_vectors.json';
import { createAppScheduler } from '../srs/fsrs_scheduler';
import type { DiagnosticEnvironment } from './diagnostic_environment';

/** Diagnostic environment on the phone: SQLCipher scratch databases, native crypto, the app's cache folder. */
export const appDiagnosticEnvironment: DiagnosticEnvironment = {
  engineLabel: `Hermes on iOS ${String(Platform.Version)}`,
  crypto: appCryptoPrimitives,
  supportsEncryption: true,
  openScratchDatabase: openExpoDatabase,
  deleteScratchDatabase: deleteExpoDatabase,
  createScheduler: createAppScheduler,
  referenceVectors: referenceVectors as unknown as ReferenceVectorFile,
  async writeAndReadBackFile(name, text) {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    const read = await file.text();
    file.delete();
    return read;
  },
};
