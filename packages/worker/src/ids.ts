/**
 * ID generators. We use Crockford-base32 strings of varying lengths:
 *   - User IDs: 16 chars
 *   - Game IDs: 8 chars (used in URLs and as invite codes)
 *
 * Crockford avoids ambiguous chars (0/O, 1/I/L). We use the lowercase variant for URLs.
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

function randomBase32(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! & 31];
  }
  return out;
}

export function newUserId(): string {
  return `u_${randomBase32(16)}`;
}

export function newGameId(): string {
  return randomBase32(8);
}

export function newSessionToken(): string {
  // 256 bits of entropy, base64url.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(buf);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
