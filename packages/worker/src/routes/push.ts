/**
 * /api/push/subscribe — store/remove a Web Push subscription for the current user.
 *
 * Phase 5 will add the actual VAPID-signed push delivery. This file only persists the
 * subscription for now.
 */

import { z } from 'zod';
import type { AuthContext } from '../auth.js';
import type { Env } from '../env.js';
import { errorResponse, jsonResponse } from '../http.js';

const Subscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function handlePushSubscribe(
  req: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = Subscription.safeParse(body);
  if (!parsed.success) {
    return errorResponse('bad_subscription', parsed.error.message, 400, ctx.setCookie);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(
      id,
      ctx.user.id,
      parsed.data.endpoint,
      parsed.data.keys.p256dh,
      parsed.data.keys.auth,
      Date.now(),
    )
    .run();
  return jsonResponse({ id }, { status: 201 }, ctx.setCookie);
}

export async function handlePushUnsubscribe(
  req: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) {
    return errorResponse('bad_request', 'endpoint required', 400, ctx.setCookie);
  }
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2')
    .bind(ctx.user.id, body.endpoint)
    .run();
  return jsonResponse({ removed: true }, {}, ctx.setCookie);
}
