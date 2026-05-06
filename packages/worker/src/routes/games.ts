/**
 * /api/games — lobby management.
 *
 * The Worker handles authentication and the `games`/`game_players` rows in D1. The actual
 * game state lives in the per-game Durable Object; the Worker forwards lifecycle calls
 * (init, join, start) to the DO via `fetch()`.
 */

import { z } from 'zod';
import type { AuthContext } from '../auth.js';
import type { Env } from '../env.js';
import { errorResponse, jsonResponse } from '../http.js';
import { newGameId } from '../ids.js';

const ConfigSchema = z
  .object({
    maxPlayers: z
      .union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
      .default(4),
    turnTimerMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1000)
      .default(24 * 60 * 60 * 1000),
    discardVisibility: z.number().int().min(1).max(52).default(1),
    acesMode: z.enum(['low', 'high', 'either']).default('high'),
    layoffsOnOpponents: z.boolean().default(true),
    spectatorsAllowed: z.boolean().default(true),
  })
  .partial();

export async function handleCreateGame(
  req: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('bad_config', parsed.error.message, 400, ctx.setCookie);
  }
  const config = parsed.data;
  const gameId = newGameId();
  const inviteCode = gameId; // single shareable identifier for v1
  const now = Date.now();

  // Persist the lobby row first.
  await env.DB.prepare(
    'INSERT INTO games (id, host_user_id, status, config_json, invite_code, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(gameId, ctx.user.id, 'lobby', JSON.stringify(config), inviteCode, now)
    .run();
  await env.DB.prepare(
    'INSERT INTO game_players (game_id, user_id, seat, display_name, joined_at) VALUES (?1, ?2, 0, ?3, ?4)',
  )
    .bind(gameId, ctx.user.id, ctx.user.displayName, now)
    .run();

  // Initialize the DO with the host info.
  const stub = env.GAME.get(env.GAME.idFromName(gameId));
  await stub.fetch(internalUrl('/init'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameId,
      hostId: ctx.user.id,
      hostName: ctx.user.displayName,
      config,
      now,
    }),
  });

  return jsonResponse(
    { id: gameId, inviteCode, hostId: ctx.user.id },
    { status: 201 },
    ctx.setCookie,
  );
}

export async function handleGetGame(
  _req: Request,
  env: Env,
  ctx: AuthContext,
  gameId: string,
): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, host_user_id AS hostId, status, config_json, invite_code AS inviteCode, created_at AS createdAt FROM games WHERE id = ?1',
  )
    .bind(gameId)
    .first<{
      id: string;
      hostId: string;
      status: string;
      config_json: string;
      inviteCode: string;
      createdAt: number;
    }>();
  if (!row) return errorResponse('not_found', 'Game not found', 404, ctx.setCookie);

  const players = await env.DB.prepare(
    'SELECT user_id AS id, seat, display_name AS displayName, joined_at AS joinedAt FROM game_players WHERE game_id = ?1 ORDER BY seat',
  )
    .bind(gameId)
    .all<{ id: string; seat: number; displayName: string; joinedAt: number }>();

  // The REST endpoint has no view of live WebSocket sessions, so presence defaults to
  // false here. The frontend's WS live-merge fills in real values within a few hundred
  // milliseconds of the lobby loading.
  const playersWithPresence = players.results.map((p) => ({ ...p, online: false }));

  return jsonResponse(
    {
      id: row.id,
      hostId: row.hostId,
      status: row.status,
      config: JSON.parse(row.config_json),
      inviteCode: row.inviteCode,
      createdAt: row.createdAt,
      players: playersWithPresence,
      youAre: playersWithPresence.find((p) => p.id === ctx.user.id)
        ? { kind: 'player', id: ctx.user.id }
        : { kind: 'spectator' },
    },
    {},
    ctx.setCookie,
  );
}

export async function handleJoinGame(
  _req: Request,
  env: Env,
  ctx: AuthContext,
  gameId: string,
): Promise<Response> {
  const game = await env.DB.prepare(
    'SELECT status, host_user_id AS hostId, config_json FROM games WHERE id = ?1',
  )
    .bind(gameId)
    .first<{ status: string; hostId: string; config_json: string }>();
  if (!game) return errorResponse('not_found', 'Game not found', 404, ctx.setCookie);
  if (game.status !== 'lobby') {
    return errorResponse('not_joinable', 'Game has already started', 409, ctx.setCookie);
  }

  // Already a player? Idempotent join.
  const existing = await env.DB.prepare(
    'SELECT seat FROM game_players WHERE game_id = ?1 AND user_id = ?2',
  )
    .bind(gameId, ctx.user.id)
    .first<{ seat: number }>();
  if (existing) {
    return jsonResponse({ joined: true, seat: existing.seat }, {}, ctx.setCookie);
  }

  // Determine the next seat.
  const seats = await env.DB.prepare(
    'SELECT seat FROM game_players WHERE game_id = ?1 ORDER BY seat',
  )
    .bind(gameId)
    .all<{ seat: number }>();
  const used = new Set(seats.results.map((r) => r.seat));
  const config = JSON.parse(game.config_json) as { maxPlayers?: number };
  const maxPlayers = config.maxPlayers ?? 4;
  if (seats.results.length >= maxPlayers) {
    return errorResponse('full', 'Game is full', 409, ctx.setCookie);
  }
  let seat = 0;
  while (used.has(seat)) seat++;

  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO game_players (game_id, user_id, seat, display_name, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(gameId, ctx.user.id, seat, ctx.user.displayName, now)
    .run();

  // Forward to DO.
  const stub = env.GAME.get(env.GAME.idFromName(gameId));
  await stub.fetch(internalUrl('/join'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: ctx.user.id, displayName: ctx.user.displayName }),
  });

  return jsonResponse({ joined: true, seat }, {}, ctx.setCookie);
}

export async function handleStartGame(
  _req: Request,
  env: Env,
  ctx: AuthContext,
  gameId: string,
): Promise<Response> {
  const game = await env.DB.prepare(
    'SELECT host_user_id AS hostId, status FROM games WHERE id = ?1',
  )
    .bind(gameId)
    .first<{ hostId: string; status: string }>();
  if (!game) return errorResponse('not_found', 'Game not found', 404, ctx.setCookie);
  if (game.hostId !== ctx.user.id) {
    return errorResponse('not_host', 'Only the host can start the game', 403, ctx.setCookie);
  }
  if (game.status !== 'lobby') {
    return errorResponse('bad_status', 'Game is not in lobby', 409, ctx.setCookie);
  }

  const stub = env.GAME.get(env.GAME.idFromName(gameId));
  const resp = await stub.fetch(internalUrl('/start'), { method: 'POST' });
  if (!resp.ok) {
    const text = await resp.text();
    return errorResponse('start_failed', text, 400, ctx.setCookie);
  }
  await env.DB.prepare('UPDATE games SET status = ?1, started_at = ?2 WHERE id = ?3')
    .bind('in_progress', Date.now(), gameId)
    .run();
  return jsonResponse({ started: true }, {}, ctx.setCookie);
}

export async function handleListMyGames(
  _req: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.status, g.created_at AS createdAt, g.host_user_id AS hostId,
            g.invite_code AS inviteCode
       FROM games g
       JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.user_id = ?1
      ORDER BY g.created_at DESC
      LIMIT 50`,
  )
    .bind(ctx.user.id)
    .all<{ id: string; status: string; createdAt: number; hostId: string; inviteCode: string }>();
  return jsonResponse({ games: rows.results }, {}, ctx.setCookie);
}

export function internalUrl(path: string): string {
  // Durable Object stubs accept any URL; we only use the pathname inside the DO.
  return `https://do.local${path}`;
}
