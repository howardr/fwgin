import { describe, expect, it } from 'vitest';
import { buildDeck } from './cards.js';
import { newSeed, rngFromSeed, shuffle } from './rng.js';

describe('rng', () => {
  it('is deterministic given the same seed', () => {
    const a = shuffle(buildDeck(), rngFromSeed('deadbeef'));
    const b = shuffle(buildDeck(), rngFromSeed('deadbeef'));
    expect(a).toEqual(b);
  });

  it('produces different orders for different seeds', () => {
    const a = shuffle(buildDeck(), rngFromSeed('aaaa'));
    const b = shuffle(buildDeck(), rngFromSeed('bbbb'));
    expect(a).not.toEqual(b);
  });

  it('preserves all cards', () => {
    const deck = shuffle(buildDeck(), rngFromSeed('feed'));
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it('newSeed produces unique 16-char hex strings', () => {
    const a = newSeed();
    const b = newSeed();
    expect(a).toHaveLength(16);
    expect(b).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});
