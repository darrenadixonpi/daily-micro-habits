import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { appCryptoPrimitives } from '../platform/app_crypto_primitives';
import { bytesEqual, hexToBytes } from '../util/byte_encoding';
import {
  derivePassphraseKey,
  unwrapDatabaseKey,
  wrapDatabaseKey,
  type DerivedKeyMaterial,
  type PassphraseEnvelope,
} from './passphrase_encryption';

/**
 * Recovery passphrase (spec Section 9). Setting it:
 * 1. wraps the database key into microhabits.keywrap.json beside the database, and
 * 2. derives the backup key and keeps it in the Keychain (decision E2), so daily
 *    backups are written without asking. The passphrase itself is never stored.
 */
export const MIN_PASSPHRASE_LENGTH = 10;
export const WRAPPED_KEY_FILE_NAME = 'microhabits.keywrap.json';
const BACKUP_KEY_ITEM = 'dmh_backup_key_v1';

function wrappedKeyFile(dataDirectory: string): File {
  return new File(`file://${dataDirectory}/${WRAPPED_KEY_FILE_NAME}`);
}

export function validateNewPassphrase(passphrase: string, confirmation: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) return `Use at least ${MIN_PASSPHRASE_LENGTH} characters`;
  if (passphrase.trim() !== passphrase) return 'Remove spaces at the start or end';
  if (passphrase !== confirmation) return 'The two entries differ';
  return null;
}

export async function setRecoveryPassphrase(passphrase: string, databaseKeyHex: string, dataDirectory: string): Promise<void> {
  const envelope = await wrapDatabaseKey(appCryptoPrimitives, passphrase, hexToBytes(databaseKeyHex));
  const backupKey = await derivePassphraseKey(appCryptoPrimitives, passphrase);
  const file = wrappedKeyFile(dataDirectory);
  if (file.exists) file.delete();
  file.create();
  file.writeSync(JSON.stringify(envelope));
  await SecureStore.setItemAsync(BACKUP_KEY_ITEM, JSON.stringify(backupKey), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function readBackupKey(): Promise<DerivedKeyMaterial | null> {
  const json = await SecureStore.getItemAsync(BACKUP_KEY_ITEM);
  return json ? (JSON.parse(json) as DerivedKeyMaterial) : null;
}

export function hasWrappedKeyFile(dataDirectory: string): boolean {
  return wrappedKeyFile(dataDirectory).exists;
}

/** True when the passphrase unwraps the sidecar file to the database key in the Keychain. */
export async function verifyRecoveryPassphrase(passphrase: string, databaseKeyHex: string, dataDirectory: string): Promise<boolean> {
  const file = wrappedKeyFile(dataDirectory);
  if (!file.exists) return false;
  try {
    const envelope = JSON.parse(file.textSync()) as PassphraseEnvelope;
    const key = await unwrapDatabaseKey(appCryptoPrimitives, passphrase, envelope);
    return bytesEqual(key, hexToBytes(databaseKeyHex));
  } catch {
    return false;
  }
}
