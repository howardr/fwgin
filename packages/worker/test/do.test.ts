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
}

/** Buffer messages from a websocket so the test can pull them off in order. */
function buffer(ws: WebSocket): {
  next(): Promise<TestPlayerView>;
  close(): void;
} {
  const queue: TestPlayerView[] = [];
  const waiters: ((v: TestPlayerView) => void)[] = [];
  const onMsg = (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const m = parsed as { type?: string; view?: TestPlayerView };
    if (m.type === 'state' && m.view) {
      const w = waiters.shift();
      if (w) w(m.view);
      else queue.push(m.view);
    }
  };
  ws.addEventListener('message', onMsg);
  return {
    next() {
      const head = queue.shift();
      if (head) return Promise.resolve(head);
      return new Promise<TestPlayerView>((resolve) => waiters.push(resolve));
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
    expect(view.phase).toBe('awaiting_upcard');
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
