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
  type ViewForClient,
} from '@fwgin/shared';
import type { Env } from '../env.js';
import { notifyPlayerTurn } from '../push/notify.js';

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
    const before = this.snapshotTurn();
    const result = apply(this.game, { type: 'START_GAME', at: Date.now() });
    if (!result.result.ok) {
      return new Response(result.result.message, { status: 400 });
    }
    await this.afterAction(before);
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
    // Broadcast presence to everyone else so they see this player came online.
    // Only meaningful for seated players. The new socket has already received its own
    // initial state above, so we skip it as a recipient. The new socket *is* counted
    // when computing presence (it appears in getWebSockets() now that it's accepted).
    if (isPlayer) this.broadcast({ skipRecipient: server });
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

    const before = this.snapshotTurn();
    const outcome = apply(this.game, action);
    if (!outcome.result.ok) {
      this.sendTo(ws, {
        type: 'error',
        code: outcome.result.code,
        message: outcome.result.message,
      });
      return;
    }
    await this.afterAction(before);
  }

  override async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    // Notify the rest of the table that this user may have just gone offline. We exclude
    // the closing socket from the broadcast and let `getOnlineUserIds()` (which reads
    // `getWebSockets()`) recompute presence from the live session map. If the same user
    // still has another open socket (e.g. a second tab), they remain online.
    this.broadcastPresenceIfPlayer(ws);
  }

  override async webSocketError(ws: WebSocket, _err: unknown) {
    // Same treatment as a clean close — the runtime will tear down the socket and the
    // remaining sessions should learn about it.
    this.broadcastPresenceIfPlayer(ws);
  }

  override async alarm() {
    return this.handleAlarm();
  }

  // -----------------------------------------------------------------------------------
  // Alarm — turn-timer expiry triggers AUTO_PLAY.
  // -----------------------------------------------------------------------------------

  private async handleAlarm() {
    if (!this.game) return;
    if (this.game.phase !== 'in_round') {
      return;
    }
    const now = Date.now();
    if (now < this.game.turnDeadline) {
      // Spurious / re-armed earlier than expected. Just re-schedule.
      await this.scheduleAlarm();
      return;
    }
    const before = this.snapshotTurn();
    apply(this.game, { type: 'AUTO_PLAY', at: now });
    await this.afterAction(before);
  }

  // -----------------------------------------------------------------------------------
  // Helpers.
  // -----------------------------------------------------------------------------------

  private async scheduleAlarm(): Promise<void> {
    if (!this.game) return;
    if (this.game.phase === 'in_round') {
      await this.ctx.storage.setAlarm(this.game.turnDeadline);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async persist(): Promise<void> {
    if (!this.game) return;
    await this.ctx.storage.put<PersistedShape>(STORAGE_KEY, { state: this.game });
  }

  /** Snapshot of turn-relevant state taken BEFORE applying an action. */
  private snapshotTurn(): { phase: string; seat: number; round: number } {
    if (!this.game) return { phase: 'lobby', seat: -1, round: 0 };
    return {
      phase: this.game.phase,
      seat: this.game.turnSeat,
      round: this.game.round,
    };
  }

  /**
   * Common post-action work: persist, schedule alarm, broadcast, and (if the active
   * player changed) fire a Web Push to the new player.
   */
  private async afterAction(before: { phase: string; seat: number; round: number }): Promise<void> {
    if (!this.game) return;
    await this.scheduleAlarm();
    await this.persist();
    this.broadcast();

    const after = this.snapshotTurn();
    const turnChanged =
      after.seat !== before.seat || after.round !== before.round || after.phase !== before.phase;
    if (turnChanged && this.game.phase === 'in_round') {
      const player = this.game.players.find((p) => p.seat === this.game!.turnSeat);
      if (player) {
        // Fire-and-forget; don't block the action on push delivery.
        this.ctx.waitUntil(
          notifyPlayerTurn(this.env, player.id, {
            gameId: this.game.id,
            round: this.game.round,
            wildRank: String(this.game.wildRank ?? ''),
          }),
        );
      }
    }
  }

  private metaFor(ws: WebSocket): SessionMeta | null {
    const tags = this.ctx.getTags(ws);
    let userId: string | null = null;
    for (const t of tags) {
      if (t.startsWith('user:')) userId = t.slice(5);
    }
    if (!userId) return null;
    // Determine spectator status from the *current* game state — a user who
    // connected as a spectator before joining the lobby gets promoted to a player
    // on their next broadcast without needing to reconnect.
    const isPlayer = this.game?.players.some((p) => p.id === userId) ?? false;
    return { userId, spectator: !isPlayer };
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket gone; the runtime will clean up.
    }
  }

  /**
   * Build a view for the given session and overlay the current online-presence map. The
   * engine view-builders default `online` to false; we know who is actually connected by
   * inspecting `getWebSockets()`, so we patch it here.
   *
   * `treatAsOffline`, when provided, is omitted from the presence map. We use this during
   * `webSocketClose`/`webSocketError`, where the closing socket may still be returned by
   * `getWebSockets()` until the runtime reaps it but should be treated as gone.
   */
  private buildView(meta: SessionMeta, treatAsOffline?: WebSocket): ViewForClient {
    if (!this.game) throw new Error('No game state');
    const view = meta.spectator
      ? viewForSpectator(this.game)
      : viewForPlayer(this.game, meta.userId);
    const online = this.getOnlineUserIds(treatAsOffline);
    return {
      ...view,
      players: view.players.map((p) => ({ ...p, online: online.has(p.id) })),
    };
  }

  private sendStateTo(ws: WebSocket, meta: SessionMeta, treatAsOffline?: WebSocket): void {
    if (!this.game) return;
    this.sendTo(ws, { type: 'state', view: this.buildView(meta, treatAsOffline) });
  }

  /**
   * Send a fresh view to every connected session. Two optional knobs:
   * - `skipRecipient` — don't send the broadcast to this specific socket (typically the
   *   one that just received a more direct state update).
   * - `treatAsOffline` — exclude this socket when computing presence. Use this on close
   *   so the disconnecting user shows as offline immediately, even if the runtime hasn't
   *   yet removed the socket from `getWebSockets()`.
   */
  private broadcast(opts: { skipRecipient?: WebSocket; treatAsOffline?: WebSocket } = {}): void {
    if (!this.game) return;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === opts.skipRecipient) continue;
      const meta = this.metaFor(ws);
      if (!meta) continue;
      this.sendStateTo(ws, meta, opts.treatAsOffline);
    }
  }

  /** Iterate live WS sessions and return the set of currently-connected userIds. */
  private getOnlineUserIds(treatAsOffline?: WebSocket): Set<PlayerId> {
    const ids = new Set<PlayerId>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === treatAsOffline) continue;
      const tags = this.ctx.getTags(ws);
      for (const t of tags) {
        if (t.startsWith('user:')) ids.add(t.slice(5));
      }
    }
    return ids;
  }

  /**
   * Helper invoked from `webSocketClose`/`webSocketError`. Only seated players' presence
   * is visible in the player list, so spectator disconnects don't need to wake the rest
   * of the table.
   */
  private broadcastPresenceIfPlayer(ws: WebSocket): void {
    const meta = this.metaFor(ws);
    if (!meta || meta.spectator) return;
    this.broadcast({ skipRecipient: ws, treatAsOffline: ws });
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
