/**
 * GameDO — one Durable Object per game. Owns the live `GameState`, broadcasts redacted
 * views to connected WebSocket clients, and uses `alarm()` to enforce the per-turn timer.
 *
 * WebSocket sessions are accepted via `state.acceptWebSocket()` so the DO can hibernate
 * while clients stay connected. We store role information in tags:
 *
 *   - `user:<userId>`  — the user this WS belongs to (always present)
 *   - `player`         — seated player; receives PlayerView snapshots
 *   - `spectator`      — spectator; receives SpectatorView snapshots
 *   - `game:<gameId>`  — convenience tag for broadcast filtering
 */

import { DurableObject } from 'cloudflare:workers';
import {
  type Action,
  addPlayerToLobby,
  apply,
  newGameState,
  viewForPlayer,
  viewForSpectator,
} from '@fwgin/engine';
import {
  type Card,
  ClientMsg,
  type GameId,
  type GameState,
  type PlayerId,
  type ServerMsg,
} from '@fwgin/shared';
import type { Env } from '../env.js';

interface PersistedShape {
  state: GameState;
}

const STORAGE_KEY = 'state';

interface SessionMeta {
  userId: PlayerId;
  spectator: boolean;
}

export class GameDO extends DurableObject<Env> {
  private game: GameState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const persisted = await ctx.storage.get<PersistedShape>(STORAGE_KEY);
      this.game = persisted?.state ?? null;
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/init' && request.method === 'POST') return this.handleInit(request);
    if (path === '/join' && request.method === 'POST') return this.handleJoin(request);
    if (path === '/start' && request.method === 'POST') return this.handleStart();
    if (path === '/state' && request.method === 'GET') return this.handleState(request);
    if (path === '/ws' && request.method === 'GET') return this.handleWebSocket(request);

    return new Response('Not found', { status: 404 });
  }

  // -----------------------------------------------------------------------------------
  // HTTP handlers used by the Worker's REST routes.
  // -----------------------------------------------------------------------------------

  private async handleInit(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      gameId: GameId;
      hostId: PlayerId;
      hostName: string;
      config?: Partial<GameState['config']>;
      now: number;
    };
    if (this.game) {
      // Idempotent — already initialized.
      return new Response('OK', { status: 200 });
    }
    this.game = newGameState({
      id: body.gameId,
      hostId: body.hostId,
      hostName: body.hostName,
      config: body.config,
      now: body.now,
    });
    await this.persist();
    return new Response('OK', { status: 201 });
  }

  private async handleJoin(request: Request): Promise<Response> {
    if (!this.game) return new Response('Not initialized', { status: 400 });
    const body = (await request.json()) as { playerId: PlayerId; displayName: string };
    try {
      addPlayerToLobby(this.game, body.playerId, body.displayName);
    } catch (e) {
      return new Response((e as Error).message, { status: 400 });
    }
    await this.persist();
    this.broadcast();
    return new Response('OK', { status: 200 });
  }

  private async handleStart(): Promise<Response> {
    if (!this.game) return new Response('Not initialized', { status: 400 });
    const result = apply(this.game, { type: 'START_GAME', at: Date.now() });
    if (!result.result.ok) {
      return new Response(result.result.message, { status: 400 });
    }
    await this.scheduleAlarm();
    await this.persist();
    this.broadcast();
    return new Response('OK', { status: 200 });
  }

  private async handleState(request: Request): Promise<Response> {
    if (!this.game) return new Response('Not initialized', { status: 400 });
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') ?? '';
    const isPlayer = this.game.players.some((p) => p.id === userId);
    const view = isPlayer ? viewForPlayer(this.game, userId) : viewForSpectator(this.game);
    return new Response(JSON.stringify(view), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // -----------------------------------------------------------------------------------
  // WebSocket upgrade + lifecycle.
  // -----------------------------------------------------------------------------------

  private async handleWebSocket(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    if (!this.game) return new Response('Game not initialized', { status: 400 });

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') ?? '';
    if (!userId) return new Response('userId required', { status: 400 });

    const isPlayer = this.game.players.some((p) => p.id === userId);
    if (!isPlayer && !this.game.config.spectatorsAllowed) {
      return new Response('Spectators not allowed', { status: 403 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!client || !server) {
      return new Response('Failed to create websocket pair', { status: 500 });
    }
    const tags = [`user:${userId}`, `game:${this.game.id}`, isPlayer ? 'player' : 'spectator'];
    this.ctx.acceptWebSocket(server, tags);
    // Send initial state right away.
    const meta: SessionMeta = { userId, spectator: !isPlayer };
    this.sendStateTo(server, meta);
    this.sendTo(server, {
      type: 'hello_ack',
      youAre: isPlayer ? userId : null,
      spectator: !isPlayer,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.game) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendTo(ws, { type: 'error', code: 'bad_json', message: 'Invalid JSON' });
      return;
    }
    const result = ClientMsg.safeParse(parsed);
    if (!result.success) {
      this.sendTo(ws, { type: 'error', code: 'bad_msg', message: result.error.message });
      return;
    }
    const meta = this.metaFor(ws);
    if (!meta) return;

    if (result.data.type === 'hello') {
      this.sendStateTo(ws, meta);
      return;
    }
    if (result.data.type === 'chat') {
      const player = this.game.players.find((p) => p.id === meta.userId);
      this.broadcastMsg({
        type: 'chat',
        fromId: meta.userId,
        fromName: player?.displayName ?? 'Spectator',
        text: result.data.text,
        at: Date.now(),
      });
      return;
    }

    if (meta.spectator) {
      this.sendTo(ws, {
        type: 'error',
        code: 'spectator',
        message: 'Spectators cannot take game actions',
      });
      return;
    }

    // Translate the client message into an engine action.
    const action = toAction(result.data, meta.userId);
    if (!action) {
      this.sendTo(ws, {
        type: 'error',
        code: 'unknown',
        message: 'Unsupported action',
      });
      return;
    }

    const outcome = apply(this.game, action);
    if (!outcome.result.ok) {
      this.sendTo(ws, {
        type: 'error',
        code: outcome.result.code,
        message: outcome.result.message,
      });
      return;
    }

    await this.scheduleAlarm();
    await this.persist();
    this.broadcast();
  }

  override async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    // Hibernation will reload us next time. Nothing to do.
  }

  override async webSocketError(_ws: WebSocket, _err: unknown) {
    // No-op; the runtime will close us.
  }

  override async alarm() {
    return this.handleAlarm();
  }

  // -----------------------------------------------------------------------------------
  // Alarm — turn-timer expiry triggers AUTO_PLAY.
  // -----------------------------------------------------------------------------------

  private async handleAlarm() {
    if (!this.game) return;
    if (this.game.phase !== 'in_round' && this.game.phase !== 'awaiting_upcard') {
      return;
    }
    const now = Date.now();
    if (now < this.game.turnDeadline) {
      // Spurious / re-armed earlier than expected. Just re-schedule.
      await this.scheduleAlarm();
      return;
    }
    apply(this.game, { type: 'AUTO_PLAY', at: now });
    await this.scheduleAlarm();
    await this.persist();
    this.broadcast();
  }

  // -----------------------------------------------------------------------------------
  // Helpers.
  // -----------------------------------------------------------------------------------

  private async scheduleAlarm(): Promise<void> {
    if (!this.game) return;
    if (this.game.phase === 'in_round' || this.game.phase === 'awaiting_upcard') {
      await this.ctx.storage.setAlarm(this.game.turnDeadline);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async persist(): Promise<void> {
    if (!this.game) return;
    await this.ctx.storage.put<PersistedShape>(STORAGE_KEY, { state: this.game });
  }

  private metaFor(ws: WebSocket): SessionMeta | null {
    const tags = this.ctx.getTags(ws);
    let userId: string | null = null;
    let spectator = false;
    for (const t of tags) {
      if (t.startsWith('user:')) userId = t.slice(5);
      if (t === 'spectator') spectator = true;
    }
    if (!userId) return null;
    return { userId, spectator };
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket gone; the runtime will clean up.
    }
  }

  private sendStateTo(ws: WebSocket, meta: SessionMeta): void {
    if (!this.game) return;
    const view = meta.spectator
      ? viewForSpectator(this.game)
      : viewForPlayer(this.game, meta.userId);
    this.sendTo(ws, { type: 'state', view });
  }

  private broadcast(): void {
    if (!this.game) return;
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.metaFor(ws);
      if (!meta) continue;
      this.sendStateTo(ws, meta);
    }
  }

  private broadcastMsg(msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, msg);
    }
  }
}

function toAction(
  msg: Exclude<import('@fwgin/shared').ClientMsg, { type: 'hello' } | { type: 'chat' }>,
  userId: PlayerId,
): Action | null {
  const at = Date.now();
  // Card values are validated by the Zod schema (`/^[A23456789TJQKA][SHDC]$/`) but the
  // resulting type is `string`. Cast to Card on the action boundary; engine validators
  // re-check correctness against the actual game state.
  const asCard = (s: string) => s as Card;
  const asCards = (arr: string[]) => arr.map(asCard);
  switch (msg.type) {
    case 'accept_upcard':
      return { type: 'ACCEPT_UPCARD', playerId: userId, at };
    case 'decline_upcard':
      return { type: 'DECLINE_UPCARD', playerId: userId, at };
    case 'steal_wild':
      return {
        type: 'STEAL_WILD',
        playerId: userId,
        meldId: msg.meldId,
        surrender: asCard(msg.surrender),
        at,
      };
    case 'draw_stock':
      return { type: 'DRAW_STOCK', playerId: userId, at };
    case 'draw_discard':
      return { type: 'DRAW_DISCARD', playerId: userId, at };
    case 'lay_meld':
      return {
        type: 'LAY_MELD',
        playerId: userId,
        cards: asCards(msg.cards),
        wildSlot: msg.wildSlot,
        wildRepresents: msg.wildRepresents ? asCard(msg.wildRepresents) : undefined,
        at,
      };
    case 'extend_meld':
      return {
        type: 'EXTEND_MELD',
        playerId: userId,
        meldId: msg.meldId,
        cards: asCards(msg.cards),
        wildSlot: msg.wildSlot,
        wildRepresents: msg.wildRepresents ? asCard(msg.wildRepresents) : undefined,
        at,
      };
    case 'discard':
      return {
        type: 'DISCARD',
        playerId: userId,
        card: asCard(msg.card),
        at,
      };
    default:
      return null;
  }
}
