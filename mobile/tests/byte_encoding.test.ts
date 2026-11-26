import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  utf8Decode,
  utf8Encode,
} from '../src/util/byte_encoding';

test('UTF-8 codec matches Node for mixed scripts and emoji', () => {
  const samples = ['', 'ascii', 'ñandú é ü', '日本語のテキスト', 'emoji 🧪🧬', 'ustedes: ¿Cómo están?'];
  for (const sample of samples) {
    assert.deepEqual(Buffer.from(utf8Encode(sample)), Buffer.from(sample, 'utf8'));
    assert.equal(utf8Decode(utf8Encode(sample)), sample);
  }
});

test('Base64 and hex round-trip and match Node', () => {
  for (let length = 0; length < 40; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
    assert.deepEqual(hexToBytes(bytesToHex(bytes)), bytes);
  }
});
