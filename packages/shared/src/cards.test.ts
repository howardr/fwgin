import { describe, expect, it } from 'vitest';
import { RANKS, SUITS, buildDeck, parseCard, rankOf, suitOf, wildRankForRound } from './cards.js';

describe('cards', () => {
  it('builds a 52-card deck with no duplicates', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it('parses cards correctly', () => {
    expect(parseCard('AS')).toEqual({ rank: 'A', suit: 'S' });
    expect(rankOf('TD')).toBe('T');
    expect(suitOf('7H')).toBe('H');
  });

  it('maps round to wild rank', () => {
    expect(wildRankForRound(1)).toBe('2');
    expect(wildRankForRound(2)).toBe('3');
    expect(wildRankForRound(9)).toBe('T');
    expect(wildRankForRound(10)).toBe('J');
    expect(wildRankForRound(12)).toBe('K');
    expect(wildRankForRound(13)).toBe('A');
  });

  it('throws on invalid round', () => {
    expect(() => wildRankForRound(0)).toThrow();
    expect(() => wildRankForRound(14)).toThrow();
    expect(() => wildRankForRound(1.5)).toThrow();
  });

  it('rank/suit constants are stable', () => {
    expect(RANKS).toHaveLength(13);
    expect(SUITS).toHaveLength(4);
  });
});
