/**
 * fwgin Worker entry point.
 *
 * Serves the bundled React SPA via the `ASSETS` binding for everything that does NOT
 * match an `/api/*` path. Routes API calls to the appropriate handler. WebSocket upgrades
 * for game sessions are forwarded to the per-game Durable Object.
 */

import { authenticate } from './auth.js';
import type { Env } from './env.js';
import { errorResponse, jsonResponse } from './http.js';
import {
  handleCreateGame,
  handleGetGame,
  handleJoinGame,
  handleListMyGames,
  handleStartGame,
} from './routes/games.js';
import { handleMeGet, handleMePost } from './routes/me.js';
import { handlePushSubscribe, handlePushUnsubscribe } from './routes/push.js';

export { GameDO } from './do/GameDO.js';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Static assets — everything that's not /api/*.
    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // Authenticate (creates an anonymous session if none).
    const auth = await authenticate(request, env);

    try {
      // /api/me
      if (path === '/api/me' && request.method === 'GET') {
        return handleMeGet(request, env, auth);
      }
      if (path === '/api/me' && request.method === 'POST') {
        return handleMePost(request, env, auth);
      }

      // /api/games
      if (path === '/api/games' && request.method === 'POST') {
        return handleCreateGame(request, env, auth);
      }
      if (path === '/api/games/mine' && request.method === 'GET') {
        return handleListMyGames(request, env, auth);
      }

      const gameMatch = path.match(/^\/api\/games\/([a-z0-9]+)(\/.*)?$/);
      if (gameMatch) {
        const gameId = gameMatch[1]!;
        const rest = gameMatch[2] ?? '';
        if (rest === '' && request.method === 'GET') {
          return handleGetGame(request, env, auth, gameId);
        }
        if (rest === '/join' && request.method === 'POST') {
          return handleJoinGame(request, env, auth, gameId);
        }
        if (rest === '/start' && request.method === 'POST') {
          return handleStartGame(request, env, auth, gameId);
        }
        if (rest === '/ws' && request.method === 'GET') {
          if (request.headers.get('upgrade') !== 'websocket') {
            return errorResponse('expected_ws', 'WebSocket upgrade required', 426, auth.setCookie);
          }
          // Forward to the DO.
          const stub = env.GAME.get(env.GAME.idFromName(gameId));
          const url = new URL(`https://do.local/ws?userId=${encodeURIComponent(auth.user.id)}`);
          return stub.fetch(url.toString(), {
            headers: request.headers,
          });
        }
      }

      // /api/push/subscribe
      if (path === '/api/push/subscribe' && request.method === 'POST') {
        return handlePushSubscribe(request, env, auth);
      }
      if (path === '/api/push/subscribe' && request.method === 'DELETE') {
        return handlePushUnsubscribe(request, env, auth);
      }

      return errorResponse('not_found', 'Not found', 404, auth.setCookie);
    } catch (err) {
      console.error('Unhandled error', err);
      return errorResponse(
        'server_error',
        (err as Error).message ?? 'Server error',
        500,
        auth.setCookie,
      );
    }
  },
};

// Re-export for type checking conveniences.
export type { Env };
