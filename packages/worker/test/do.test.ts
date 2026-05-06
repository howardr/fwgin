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
