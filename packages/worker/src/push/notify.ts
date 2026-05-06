/**
 * High-level helper to push "It's your turn" notifications. Reads the player's push
 * subscriptions from D1 and dispatches via {@link ./send.ts sendPushNotification}.
 *
 * Failures (404/410) cause the subscription row to be removed, so we don't keep retrying
 * dead endpoints.
 */

import type { Env } from '../env.js';
import { type PushSubscription, sendPushNotification } from './send.js';

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function notifyPlayerTurn(
  env: Env,
  userId: string,
  payload: { gameId: string; round: number; wildRank: string },
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const rows = (
    await env.DB.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(userId)
      .all<SubRow>()
  ).results;

  for (const row of rows) {
    const sub: PushSubscription = {
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    };
    try {
      const result = await sendPushNotification(
        sub,
        {
          title: "It's your turn",
          body: `Round ${payload.round} — wild is ${payload.wildRank}`,
          gameId: payload.gameId,
          url: `/#/games/${payload.gameId}`,
        },
        {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
        },
      );
      if (!result.ok && (result.status === 404 || result.status === 410)) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(row.id).run();
      }
    } catch (err) {
      console.error('Push send failed', err);
    }
  }
}
