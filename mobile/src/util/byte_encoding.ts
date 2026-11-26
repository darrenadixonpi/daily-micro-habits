/** Hex, Base64 and UTF-8 conversions without Buffer, so they behave the same on Hermes and Node. */

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = Object.fromEntries(
  Array.from(BASE64_ALPHABET, (character, index) => [character, index]),
);

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new Error('Invalid base64 string');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of clean) {
    buffer = (buffer << 6) | (BASE64_LOOKUP[character] as number);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out;
}

// UTF-8 is implemented here rather than with TextEncoder/TextDecoder because
// TextDecoder availability differs between Hermes releases.
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  const codePoints: number[] = [];
  let i = 0;
  const continuation = (offset: number): number => {
    const byte = bytes[i + offset];
    if (byte === undefined || (byte & 0xc0) !== 0x80) throw new Error('Invalid UTF-8');
    return byte & 63;
  };
  while (i < bytes.length) {
    const lead = bytes[i] as number;
    if (lead < 0x80) {
      codePoints.push(lead);
      i += 1;
    } else if ((lead & 0xe0) === 0xc0) {
      codePoints.push(((lead & 31) << 6) | continuation(1));
      i += 2;
    } else if ((lead & 0xf0) === 0xe0) {
      codePoints.push(((lead & 15) << 12) | (continuation(1) << 6) | continuation(2));
      i += 3;
    } else if ((lead & 0xf8) === 0xf0) {
      codePoints.push(((lead & 7) << 18) | (continuation(1) << 12) | (continuation(2) << 6) | continuation(3));
      i += 4;
    } else {
      throw new Error('Invalid UTF-8');
    }
  }
  let out = '';
  for (let start = 0; start < codePoints.length; start += 4096) {
    out += String.fromCodePoint(...codePoints.slice(start, start + 4096));
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0;
}
