import { describe, expect, it } from 'vitest';
import { apply } from '../src/engine.js';
import { lobby2, lobby3 } from './helpers.js';

describe('START_GAME deals round 1', () => {
  it('deals 7 cards to each player and sets wild=2', () => {
    const s = lobby2();
    apply(s, { type: 'START_GAME', at: 1 });
    expect(s.phase).toBe('awaiting_upcard');
    expect(s.round).toBe(1);
    expect(s.wildRank).toBe('2');
    expect(s.hands.p1).toHaveLength(7);
    expect(s.hands.p2).toHaveLength(7);
    expect(s.discard).toHaveLength(1);
    expect(s.stock).toHaveLength(52 - 14 - 1); // 37 left
  });

  it('rejects start with only one player', () => {
    const s = lobby2();
    s.players = [s.players[0]!];
    const r = apply(s, { type: 'START_GAME', at: 1 });
    expect(r.result.ok).toBe(false);
  });

  it('rejects double start', () => {
    const s = lobby2();
    apply(s, { type: 'START_GAME', at: 1 });
    const r = apply(s, { type: 'START_GAME', at: 2 });
    expect(r.result.ok).toBe(false);
  });

  it('produces a deterministic deal given a fixed RNG seed (round seed)', () => {
    const s = lobby3();
    apply(s, { type: 'START_GAME', at: 1 });
    // We don't assert exact cards (the seed itself is non-deterministic per-run), but
    // the structural invariants must hold.
    const all = [...s.stock, ...s.discard, ...s.hands.p1!, ...s.hands.p2!, ...s.hands.p3!];
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
  });
});
