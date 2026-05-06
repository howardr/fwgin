#!/usr/bin/env node
/**
 * Generate a VAPID (P-256 ECDSA) keypair for Web Push.
 * Prints the public key (safe to ship as a Worker var) and the private key
 * (must be set as a Worker secret: `wrangler secret put VAPID_PRIVATE_KEY`).
 *
 * Usage: pnpm gen:vapid
 */

import { webcrypto } from 'node:crypto';

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, 'binary')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function main() {
  const { subtle } = webcrypto;
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  // Public key as raw uncompressed (65 bytes, starts with 0x04).
  const rawPublic = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  // Private key in JWK so we can extract `d`.
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('Failed to export private key');

  const publicKey = toBase64Url(rawPublic);
  const privateKey = jwk.d; // already base64url

  console.log('VAPID keypair generated.\n');
  console.log('Public key (set in wrangler.toml [vars]):');
  console.log(`  VAPID_PUBLIC_KEY = "${publicKey}"\n`);
  console.log('Private key (set as a Worker secret):');
  console.log(`  echo '${privateKey}' | wrangler secret put VAPID_PRIVATE_KEY\n`);
  console.log("Don't commit the private key.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
