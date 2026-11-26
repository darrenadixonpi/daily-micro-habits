import QuickCrypto from 'react-native-quick-crypto';
import { createNodeStyleCryptoPrimitives, type NodeStyleCrypto } from './crypto_primitives';

/** CryptoPrimitives backed by react-native-quick-crypto (native OpenSSL via JSI). */
export const appCryptoPrimitives = createNodeStyleCryptoPrimitives(QuickCrypto as unknown as NodeStyleCrypto);
