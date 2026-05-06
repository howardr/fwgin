/**
 * Web Push (RFC 8030 / RFC 8291) sender, implemented entirely with Web Crypto so it runs
 * inside Cloudflare Workers without any Node-only dependencies.
 *
 * Two pieces of cryptography:
 *   1. VAPID JWT (ES256) authenticates the push origin.
 *   2. The payload is encrypted with the subscription's `p256dh` and `auth` keys using
 *      `aes128gcm` content-encoding (RFC 8188).
 *
 * This implementation supports just `aes128gcm` (the modern format that Chrome, Firefox,
 * and Safari all accept). It does NOT implement the older `aesgcm` content-encoding.
 */

export interface PushSubscription {
  endpoint: string;
  p256dh: string; // base64url
  auth: string; // base64url
}

export interface VapidConfig {
  publicKey: string; // base64url (raw P-256 65 bytes, starts 0x04)
  privateKey: string; // base64url (JWK 'd' for P-256)
  subject: string; // mailto: or https:// URL
}

function b64UrlEncode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function b64UrlDecode(s: string): Uint8Array {
  const padded = s.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

async function importVapidPrivateKey(privateKeyB64Url: string, publicKeyB64Url: string) {
  const pubRaw = b64UrlDecode(publicKeyB64Url); // 65 bytes uncompressed
  if (pubRaw.length !== 65 || pubRaw[0] !== 0x04) {
    throw new Error('Invalid VAPID public key (expected 65-byte uncompressed P-256)');
  }
  const x = b64UrlEncode(pubRaw.slice(1, 33));
  const y = b64UrlEncode(pubRaw.slice(33, 65));
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x,
      y,
      d: privateKeyB64Url,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function buildVapidAuthHeader(
  endpoint: string,
  vapid: VapidConfig,
): Promise<{ authorization: string; cryptoKey: string }> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  };
  const enc = new TextEncoder();
  const headerB64 = b64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64UrlEncode(enc.encode(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  const key = await importVapidPrivateKey(vapid.privateKey, vapid.publicKey);
  const sigDer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(unsigned),
  );
  // crypto.subtle.sign for ECDSA returns IEEE-P1363 raw concat (r || s), not DER. That's
  // exactly what JWS ES256 wants — perfect.
  const jwt = `${unsigned}.${b64UrlEncode(new Uint8Array(sigDer))}`;
  return {
    authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    cryptoKey: vapid.publicKey,
  };
}

// HKDF helper (HMAC-SHA-256) returning `length` bytes.
async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function ecdh(privateKey: CryptoKey, remotePublicRaw: Uint8Array): Promise<Uint8Array> {
  const remoteKey = await crypto.subtle.importKey(
    'raw',
    remotePublicRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // Cloudflare workers-types uses `$public` (TS keyword workaround); the runtime takes
  // the standard `public` property. Cast through unknown to satisfy both.
  const bits = await crypto.subtle.deriveBits(
    // biome-ignore lint/suspicious/noExplicitAny: Worker types use `$public`, runtime uses `public`.
    { name: 'ECDH', public: remoteKey } as any,
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypt payload using aes128gcm content-encoding.
 * Returns the body bytes as defined by RFC 8188.
 */
async function encryptAes128Gcm(
  payload: Uint8Array,
  recipientPublicKeyRaw: Uint8Array,
  authSecret: Uint8Array,
): Promise<{ body: Uint8Array; localPublicKeyRaw: Uint8Array }> {
  // Generate ephemeral local keypair.
  const localPair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const exportedRaw = (await crypto.subtle.exportKey('raw', localPair.publicKey)) as ArrayBuffer;
  const localPublicRaw = new Uint8Array(exportedRaw);
  if (localPublicRaw.length !== 65) throw new Error('local pub key wrong length');

  const sharedSecret = await ecdh(localPair.privateKey, recipientPublicKeyRaw);

  // PRK_key = HKDF(authSecret, sharedSecret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const enc = new TextEncoder();
  const keyInfo = concat(enc.encode('WebPush: info\x00'), recipientPublicKeyRaw, localPublicRaw);
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);

  // 16-byte salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm" || 0x00, 16)
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\x00'), 16);
  // NONCE = HKDF(salt, ikm, "Content-Encoding: nonce" || 0x00, 12)
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\x00'), 12);

  // RFC 8188 padding: payload || 0x02 || (zero pad). For a single record we use 0x02 as
  // the last-record delimiter.
  const padded = new Uint8Array(payload.length + 1);
  padded.set(payload, 0);
  padded[payload.length] = 0x02;

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, padded),
  );

  // RFC 8188 header:
  //   salt(16) || rs(4) || idlen(1) || keyid(idlen)
  // We use keyid = local public key (65 bytes uncompressed). rs = 4096.
  const idlen = localPublicRaw.length;
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + idlen);
  header.set(salt, 0);
  // rs as big-endian uint32
  header[16] = (rs >>> 24) & 0xff;
  header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = idlen;
  header.set(localPublicRaw, 21);

  return { body: concat(header, ct), localPublicKeyRaw: localPublicRaw };
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: unknown,
  vapid: VapidConfig,
): Promise<{ ok: boolean; status: number; body?: string }> {
  const recipientPublicKeyRaw = b64UrlDecode(subscription.p256dh);
  const authSecret = b64UrlDecode(subscription.auth);
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(JSON.stringify(payload));

  const { body } = await encryptAes128Gcm(payloadBytes, recipientPublicKeyRaw, authSecret);
  const auth = await buildVapidAuthHeader(subscription.endpoint, vapid);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization: auth.authorization,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '60',
    },
    body,
  });

  if (res.ok) return { ok: true, status: res.status };
  const text = await res.text().catch(() => '');
  return { ok: false, status: res.status, body: text };
}
