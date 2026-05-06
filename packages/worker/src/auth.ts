/**
 * Anonymous-handle auth: every visitor gets a long-lived session cookie tied to a row in
 * `users`. The cookie value is a high-entropy random token; we store its SHA-256 hash in
 * the `sessions` table along with the associated user id and expiry.
 *
 * No password / email — players are simply identified by their session.
 */

import type { Env } from './env.js';
import { newSessionToken, newUserId, sha256Hex } from './ids.js';

const COOKIE_NAME = '__Host-fwgin_session';
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export interface AuthedUser {
  id: string;
  displayName: string;
}

export interface AuthContext {
  user: AuthedUser;
  /** A `Set-Cookie` header value if a fresh cookie should be sent on the response. */
  setCookie?: string;
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie');
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = rest.join('=');
  }
  return out;
}

export function buildSetCookie(token: string): string {
  // __Host- prefix requires Path=/ and Secure (and no Domain).
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function authenticate(req: Request, env: Env): Promise<AuthContext> {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (token) {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      'SELECT u.id AS id, u.display_name AS displayName FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2',
    )
      .bind(hash, Date.now())
      .first<{ id: string; displayName: string }>();
    if (row) {
      // Touch last_seen lazily.
      await env.DB.prepare('UPDATE users SET last_seen_at = ?1 WHERE id = ?2')
        .bind(Date.now(), row.id)
        .run();
      return { user: row };
    }
  }
  // No valid session — create a fresh anonymous user + session.
  const user = await createAnonymousUser(env);
  const newToken = newSessionToken();
  const newHash = await sha256Hex(newToken);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(newHash, user.id, Date.now() + SESSION_TTL_MS)
    .run();
  return { user, setCookie: buildSetCookie(newToken) };
}

async function createAnonymousUser(env: Env): Promise<AuthedUser> {
  const id = newUserId();
  const displayName = `Player ${id.slice(2, 6)}`;
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO users (id, display_name, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)',
  )
    .bind(id, displayName, now)
    .run();
  return { id, displayName };
}

export async function updateDisplayName(env: Env, userId: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error('Display name cannot be empty');
  await env.DB.prepare('UPDATE users SET display_name = ?1 WHERE id = ?2')
    .bind(trimmed, userId)
    .run();
}
