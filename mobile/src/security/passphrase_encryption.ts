import type { CryptoPrimitives } from '../platform/crypto_primitives';
import { base64ToBytes, bytesToBase64, utf8Encode } from '../util/byte_encoding';

/**
 * Passphrase-based encryption shared by database-key wrapping and backup files
 * (spec Section 9): PBKDF2-HMAC-SHA256 (600,000 iterations, random 16-byte salt)
 * derives a 256-bit key; AES-256-GCM (random 12-byte IV, 16-byte tag) seals the data.
 * The envelope's purpose string is authenticated as AAD, so a wrapped key cannot be
 * passed off as a backup or vice versa.
 */
export const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export type EnvelopePurpose = 'dmh-wrapped-database-key' | 'dmh-backup';

export interface PassphraseEnvelope {
  readonly format: 'dmh-passphrase-envelope-1';
  readonly purpose: EnvelopePurpose;
  readonly kdf: { readonly name: 'PBKDF2-HMAC-SHA256'; readonly iterations: number; readonly salt_b64: string };
  readonly cipher: { readonly name: 'AES-256-GCM'; readonly iv_b64: string; readonly tag_b64: string };
  readonly ciphertext_b64: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('The passphrase is wrong or the data was modified');
    this.name = 'WrongPassphraseError';
  }
}

export async function sealWithPassphrase(
  crypto: CryptoPrimitives,
  passphrase: string,
  purpose: EnvelopePurpose,
  plaintext: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<PassphraseEnvelope> {
  if (passphrase.length === 0) throw new Error('Passphrase must not be empty');
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = await crypto.pbkdf2Sha256(utf8Encode(passphrase), salt, iterations, KEY_LENGTH);
  const sealed = crypto.aes256GcmEncrypt(key, iv, plaintext, utf8Encode(purpose));
  return {
    format: 'dmh-passphrase-envelope-1',
    purpose,
    kdf: { name: 'PBKDF2-HMAC-SHA256', iterations, salt_b64: bytesToBase64(salt) },
    cipher: { name: 'AES-256-GCM', iv_b64: bytesToBase64(iv), tag_b64: bytesToBase64(sealed.tag) },
    ciphertext_b64: bytesToBase64(sealed.ciphertext),
  };
}

export async function openWithPassphrase(
  crypto: CryptoPrimitives,
  passphrase: string,
  expectedPurpose: EnvelopePurpose,
  envelope: PassphraseEnvelope,
): Promise<Uint8Array> {
  if (envelope.format !== 'dmh-passphrase-envelope-1') throw new Error(`Unknown envelope format: ${envelope.format}`);
  if (envelope.purpose !== expectedPurpose) {
    throw new Error(`Envelope purpose is ${envelope.purpose}, expected ${expectedPurpose}`);
  }
  const key = await crypto.pbkdf2Sha256(
    utf8Encode(passphrase),
    base64ToBytes(envelope.kdf.salt_b64),
    envelope.kdf.iterations,
    KEY_LENGTH,
  );
  try {
    return crypto.aes256GcmDecrypt(
      key,
      base64ToBytes(envelope.cipher.iv_b64),
      { ciphertext: base64ToBytes(envelope.ciphertext_b64), tag: base64ToBytes(envelope.cipher.tag_b64) },
      utf8Encode(envelope.purpose),
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Wraps the 32-byte database key for the sidecar file (recovery if the Keychain item is lost). */
export function wrapDatabaseKey(
  crypto: CryptoPrimitives,
  passphrase: string,
  databaseKey: Uint8Array,
  iterations?: number,
): Promise<PassphraseEnvelope> {
  if (databaseKey.length !== KEY_LENGTH) throw new Error('Database key must be 32 bytes');
  return sealWithPassphrase(crypto, passphrase, 'dmh-wrapped-database-key', databaseKey, iterations);
}

export function unwrapDatabaseKey(
  crypto: CryptoPrimitives,
  passphrase: string,
  envelope: PassphraseEnvelope,
): Promise<Uint8Array> {
  return openWithPassphrase(crypto, passphrase, 'dmh-wrapped-database-key', envelope);
}
