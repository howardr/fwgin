/**
 * Integration test: drive the GameDO directly through its internal HTTP surface using
 * the workers test pool. This exercises the actual DO + storage runtime, not just the
 * pure engine.
 */

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    GAME: DurableObjectNamespace;
  }
}

async function call(
  stub: DurableObjectStub,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return stub.fetch(`https://do.local${path}`, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

/** Open a WebSocket against the DO's `/ws` route and `accept()` it for receiving. */
async function openWs(stub: DurableObjectStub, userId: string): Promise<WebSocket> {
  const resp = await stub.fetch(`https://do.local/ws?userId=${encodeURIComponent(userId)}`, {
    headers: { Upgrade: 'websocket' },
  });
  if (resp.status !== 101 || !resp.webSocket) {
    throw new Error(`WS upgrade failed: status=${resp.status}`);
  }
  resp.webSocket.accept();
  return resp.webSocket;
}

interface TestPlayerView {
  players: { id: string; online: boolean; seat: number }[];
  turnSeat?: number;
  yourHand?: string[];
  discard?: string[];
  discardTotal?: number;
}

interface TestErrorFrame {
  type: 'error';
  code: string;
  message: string;
}

/** Buffer state + error frames from a websocket so tests can pull them off in order. */
function buffer(ws: WebSocket): {
  next(): Promise<TestPlayerView>;
  nextError(): Promise<TestErrorFrame>;
  close(): void;
} {
  const queue: TestPlayerView[] = [];
  const waiters: ((v: TestPlayerView) => void)[] = [];
  const errorQueue: TestErrorFrame[] = [];
  const errorWaiters: ((v: TestErrorFrame) => void)[] = [];
  const onMsg = (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const m = parsed as { type?: string; view?: TestPlayerView; code?: string; message?: string };
    if (m.type === 'state' && m.view) {
      const w = waiters.shift();
      if (w) w(m.view);
      else queue.push(m.view);
    } else if (m.type === 'error') {
      const frame: TestErrorFrame = {
        type: 'error',
        code: m.code ?? '',
        message: m.message ?? '',
      };
      const w = errorWaiters.shift();
      if (w) w(frame);
      else errorQueue.push(frame);
    }
  };
  ws.addEventListener('message', onMsg);
  return {
    next() {
      const head = queue.shift();
      if (head) return Promise.resolve(head);
      return new Promise<TestPlayerView>((resolve) => waiters.push(resolve));
    },
    nextError() {
      const head = errorQueue.shift();
      if (head) return Promise.resolve(head);
      return new Promise<TestErrorFrame>((resolve) => errorWaiters.push(resolve));
    },
    close() {
      ws.removeEventListener('message', onMsg);
    },
  };
}

/** Pump the next state snapshot until predicate is satisfied (or fail after N tries). */
async function nextStateMatching(
  buf: ReturnType<typeof buffer>,
  predicate: (v: TestPlayerView) => boolean,
  maxStates = 5,
): Promise<TestPlayerView> {
  for (let i = 0; i < maxStates; i++) {
    const v = await buf.next();
    if (predicate(v)) return v;
  }
  throw new Error('Predicate not satisfied within max state messages');
}

describe('GameDO HTTP surface', () => {
  it('initializes, accepts a join, and starts a game', async () => {
    const stub = env.GAME.get(env.GAME.idFromName('game-test-1'));
    const r1 = await call(stub, '/init', {
      method: 'POST',
      body: {
        gameId: 'game-test-1',
        hostId: 'u1',
        hostName: 'Alice',
        config: { maxPlayers: 2 },
        now: Date.now(),
      },
    });
    expect([200, 201]).toContain(r1.status);

    const r2 = await call(stub, '/join', {
      method: 'POST',
      body: { playerId: 'u2', displayName: 'Bob' },
    });
    expect(r2.status).toBe(200);

    const r3 = await call(stub, '/start', { method: 'POST' });
    expect(r3.status).toBe(200);

    const r4 = await stub.fetch('https://do.local/state?userId=u1');
    expect(r4.ok).toBe(true);
    const view = (await r4.json()) as { phase: string; round: number };
    expect(view.phase).toBe('in_round');
    expect(view.round).toBe(1);
  });

  it('returns 400 for /join before /init', async () => {
    const stub = env.GAME.get(env.GAME.idFromName('game-test-2'));
    const r = await call(stub, '/join', {
      method: 'POST',
      body: { playerId: 'u1', displayName: 'Alone' },
    });
    expect(r.status).toBe(400);
  });
});

describe('GameDO presence', () => {
  it('reflects WS connections in the broadcast view', async () => {
    const stub = env.GAME.get(env.GAME.idFromName('game-presence-1'));
    await call(stub, '/init', {
      method: 'POST',
      body: {
        gameId: 'game-presence-1',
        hostId: 'u1',
        hostName: 'Alice',
        config: { maxPlayers: 2 },
        now: Date.now(),
      },
    });
    await call(stub, '/join', {
      method: 'POST',
      body: { playerId: 'u2', displayName: 'Bob' },
    });

    // u1 connects: their initial state should show u1 online, u2 offline.
    const ws1 = await openWs(stub, 'u1');
    const buf1 = buffer(ws1);
    const initial = await buf1.next();
    expect(initial.players.find((p) => p.id === 'u1')?.online).toBe(true);
    expect(initial.players.find((p) => p.id === 'u2')?.online).toBe(false);

    // u2 connects: ws1 should be broadcast a fresh view that shows u2 online.
    const ws2 = await openWs(stub, 'u2');
    const afterU2Joined = await nextStateMatching(
      buf1,
      (v) => v.players.find((p) => p.id === 'u2')?.online === true,
    );
    expect(afterU2Joined.players.find((p) => p.id === 'u1')?.online).toBe(true);

    // u2 disconnects: ws1 should see u2 go offline.
    ws2.close(1000, 'test');
    const afterU2Left = await nextStateMatching(
      buf1,
      (v) => v.players.find((p) => p.id === 'u2')?.online === false,
    );
    expect(afterU2Left.players.find((p) => p.id === 'u1')?.online).toBe(true);

    buf1.close();
    ws1.close(1000, 'test');
  });
});

describe('GameDO opening turn (first player has 8 cards)', () => {
  it('lets the first player discard immediately over WS (connect after /start)', async () => {
    const stub = env.GAME.get(env.GAME.idFromName('game-opening-1'));
    await call(stub, '/init', {
      method: 'POST',
      body: {
        gameId: 'game-opening-1',
        hostId: 'u1',
        hostName: 'Alice',
        config: { maxPlayers: 2 },
        now: Date.now(),
      },
    });
    await call(stub, '/join', {
      method: 'POST',
      body: { playerId: 'u2', displayName: 'Bob' },
    });
    const r3 = await call(stub, '/start', { method: 'POST' });
    expect(r3.status).toBe(200);

    // u2 (the non-dealer / first to play) connects and is dealt 8 cards.
    const ws2 = await openWs(stub, 'u2');
    const buf2 = buffer(ws2);
    const initial = await buf2.next();
    expect(initial.turnSeat).toBe(initial.players.find((p) => p.id === 'u2')?.seat);
    expect(initial.yourHand).toBeDefined();
    expect(initial.yourHand!.length).toBe(8);
    expect(initial.discard).toEqual([]);
    expect(initial.discardTotal).toBe(0);

    // Pick a card to dump and send a `discard` action.
    const dump = initial.yourHand![0]!;
    ws2.send(JSON.stringify({ type: 'discard', card: dump }));

    // The DO must accept this without producing an `error` frame, and the next
    // broadcast view should show the card moved from hand to discard pile and
    // the turn advanced.
    const errorPromise = buf2.nextError().then(
      (e) => {
        throw new Error(`unexpected error frame: ${e.code} ${e.message}`);
      },
      () => undefined,
    );
    const next = await nextStateMatching(
      buf2,
      (v) => (v.discard?.length ?? 0) === 1 || (v.yourHand?.length ?? 0) === 7,
      5,
    );
    expect(next.yourHand!.length).toBe(7);
    expect(next.yourHand).not.toContain(dump);
    expect(next.discard).toEqual([dump]);
    expect(next.discardTotal).toBe(1);
    // Turn advanced to u1 (the dealer).
    expect(next.turnSeat).toBe(initial.players.find((p) => p.id === 'u1')?.seat);

    // Race: ensure no error frame snuck in concurrently. Give it a tick.
    await Promise.race([errorPromise, new Promise((r) => setTimeout(r, 10))]);

    buf2.close();
    ws2.close(1000, 'test');
  });

  it('lets the first player discard immediately when WS opened during lobby', async () => {
    // Mirror the real-world flow: both players join the lobby and open WSs *before*
    // the host hits Start. After Start, the live WSs receive the dealt view and the
    // first-to-play (u2) tries to discard via the same long-lived WS.
    const stub = env.GAME.get(env.GAME.idFromName('game-opening-2'));
    await call(stub, '/init', {
      method: 'POST',
      body: {
        gameId: 'game-opening-2',
        hostId: 'u1',
        hostName: 'Alice',
        config: { maxPlayers: 2 },
        now: Date.now(),
      },
    });
    await call(stub, '/join', {
      method: 'POST',
      body: { playerId: 'u2', displayName: 'Bob' },
    });

    // u2 connects during the lobby phase.
    const ws2 = await openWs(stub, 'u2');
    const buf2 = buffer(ws2);
    const lobbyView = await buf2.next();
    // (Pre-start view: no hand yet, phase is lobby — yourHand is [].)
    expect(lobbyView.yourHand ?? []).toEqual([]);

    // Host starts the game. The DO broadcasts the dealt state to the existing WSs.
    const r3 = await call(stub, '/start', { method: 'POST' });
    expect(r3.status).toBe(200);

    const dealt = await nextStateMatching(buf2, (v) => (v.yourHand?.length ?? 0) === 8);
    expect(dealt.yourHand!.length).toBe(8);
    expect(dealt.turnSeat).toBe(dealt.players.find((p) => p.id === 'u2')?.seat);

    // u2 discards from their existing WS connection.
    const dump = dealt.yourHand![0]!;
    ws2.send(JSON.stringify({ type: 'discard', card: dump }));
    const errorPromise = buf2.nextError().then(
      (e) => {
        throw new Error(`unexpected error frame: ${e.code} ${e.message}`);
      },
      () => undefined,
    );
    const next = await nextStateMatching(buf2, (v) => (v.yourHand?.length ?? 0) === 7);
    expect(next.discard).toEqual([dump]);
    expect(next.turnSeat).toBe(next.players.find((p) => p.id === 'u1')?.seat);
    await Promise.race([errorPromise, new Promise((r) => setTimeout(r, 10))]);

    buf2.close();
    ws2.close(1000, 'test');
  });
});
