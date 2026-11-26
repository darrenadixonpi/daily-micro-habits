/**
 * The cryptographic operations the app needs, behind one interface.
 *
 * Both implementations come from `createNodeStyleCryptoPrimitives`: the app passes
 * react-native-quick-crypto (native OpenSSL, Node-compatible API) and the tests pass
 * Node's own `node:crypto`, so the same code is exercised in CI and on the phone.
 */
export interface CryptoPrimitives {
  randomBytes(length: number): Uint8Array;
  /** PBKDF2-HMAC-SHA256, run off the JS thread where the engine supports it. */
  pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, keyLength: number): Promise<Uint8Array>;
  aes256GcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): AesGcmSealed;
  /** Throws if the tag does not authenticate (wrong key or tampered data). */
  aes256GcmDecrypt(key: Uint8Array, iv: Uint8Array, sealed: AesGcmSealed, aad: Uint8Array): Uint8Array;
  sha256Hex(data: Uint8Array): string;
}

export interface AesGcmSealed {
  readonly ciphertext: Uint8Array;
  readonly tag: Uint8Array;
}

/** The subset of Node's crypto API used here; satisfied by node:crypto and react-native-quick-crypto. */
export interface NodeStyleCrypto {
  randomBytes(size: number): Uint8Array;
  pbkdf2(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    keylen: number,
    digest: string,
    callback: (error: Error | null, derivedKey: Uint8Array) => void,
  ): void;
  createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, options?: { authTagLength: number }): NodeStyleCipher;
  createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, options?: { authTagLength: number }): NodeStyleDecipher;
  createHash(algorithm: string): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}

interface NodeStyleCipher {
  setAAD(aad: Uint8Array): unknown;
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
  getAuthTag(): Uint8Array;
}

interface NodeStyleDecipher {
  setAAD(aad: Uint8Array): unknown;
  setAuthTag(tag: Uint8Array): unknown;
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
}

const GCM_TAG_LENGTH = 16;

function toPlainBytes(view: Uint8Array): Uint8Array {
  // Copies Buffer subclasses into plain Uint8Arrays so results compare equal across engines.
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function createNodeStyleCryptoPrimitives(crypto: NodeStyleCrypto): CryptoPrimitives {
  return {
    randomBytes(length) {
      return toPlainBytes(crypto.randomBytes(length));
    },
    pbkdf2Sha256(password, salt, iterations, keyLength) {
      return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', (error, derivedKey) => {
          if (error) reject(error);
          else resolve(toPlainBytes(derivedKey));
        });
      });
    },
    aes256GcmEncrypt(key, iv, plaintext, aad) {
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LENGTH });
      cipher.setAAD(aad);
      const ciphertext = concat(toPlainBytes(cipher.update(plaintext)), toPlainBytes(cipher.final()));
      return { ciphertext, tag: toPlainBytes(cipher.getAuthTag()) };
    },
    aes256GcmDecrypt(key, iv, sealed, aad) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LENGTH });
      decipher.setAAD(aad);
      decipher.setAuthTag(sealed.tag);
      return concat(toPlainBytes(decipher.update(sealed.ciphertext)), toPlainBytes(decipher.final()));
    },
    sha256Hex(data) {
      return crypto.createHash('sha256').update(data).digest('hex');
    },
  };
}
