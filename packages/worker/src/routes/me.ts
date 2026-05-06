/**
 * /api/me — read or update the current user's profile.
 */

import { type AuthContext, updateDisplayName } from '../auth.js';
import type { Env } from '../env.js';
import { jsonResponse } from '../http.js';

export async function handleMeGet(_req: Request, _env: Env, ctx: AuthContext): Promise<Response> {
  return jsonResponse({ id: ctx.user.id, displayName: ctx.user.displayName }, {}, ctx.setCookie);
}

export async function handleMePost(req: Request, env: Env, ctx: AuthContext): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { displayName?: string };
  if (typeof body.displayName !== 'string' || !body.displayName.trim()) {
    return jsonResponse({ error: 'displayName required' }, { status: 400 }, ctx.setCookie);
  }
  await updateDisplayName(env, ctx.user.id, body.displayName);
  return jsonResponse(
    { id: ctx.user.id, displayName: body.displayName.trim().slice(0, 40) },
    {},
    ctx.setCookie,
  );
}
