import * as SecureStore from 'expo-secure-store';
import { appCryptoPrimitives } from '../platform/app_crypto_primitives';
import { bytesToHex } from '../util/byte_encoding';

/**
 * Keychain item holding the 256-bit database key as 64 hex characters.
 * The name is unchanged since M0, so the key created by the M0 test build is reused.
 */
export const DATABASE_KEY_ITEM = 'dmh_db_key_v1';

export interface DatabaseKey {
  readonly keyHex: string;
  readonly createdNow: boolean;
}

export async function getOrCreateDatabaseKey(): Promise<DatabaseKey> {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_ITEM);
  if (existing) return { keyHex: existing, createdNow: false };
  const keyHex = bytesToHex(appCryptoPrimitives.randomBytes(32));
  await SecureStore.setItemAsync(DATABASE_KEY_ITEM, keyHex, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return { keyHex, createdNow: true };
}
