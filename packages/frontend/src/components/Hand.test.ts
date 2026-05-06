import type { Card } from '@fwgin/shared';
import { describe, expect, it } from 'vitest';
import { computeDisplayHand, reorder } from './Hand.js';

describe('reorder', () => {
  it('moves an item later in the array', () => {
    expect(reorder(['A', 'B', 'C', 'D', 'E'], 0, 3)).toEqual(['B', 'C', 'A', 'D', 'E']);
  });

  it('moves an item earlier in the array', () => {
    expect(reorder(['A', 'B', 'C', 'D', 'E'], 4, 1)).toEqual(['A', 'E', 'B', 'C', 'D']);
  });

  it('moves an item to the end', () => {
    expect(reorder(['A', 'B', 'C'], 0, 3)).toEqual(['B', 'C', 'A']);
  });

  it('moves an item to the start', () => {
    expect(reorder(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B']);
  });

  it('returns the same array reference for no-op moves', () => {
    const arr = ['A', 'B', 'C'];
    // Gap before self = no-op.
    expect(reorder(arr, 1, 1)).toBe(arr);
    // Gap immediately after self = no-op.
    expect(reorder(arr, 1, 2)).toBe(arr);
  });

  it('handles a single-item array', () => {
    const arr = ['A'];
    expect(reorder(arr, 0, 0)).toBe(arr);
    expect(reorder(arr, 0, 1)).toBe(arr);
  });

  it('returns the same array on out-of-range from index', () => {
    const arr = ['A', 'B'];
    expect(reorder(arr, -1, 0)).toBe(arr);
    expect(reorder(arr, 5, 0)).toBe(arr);
  });
});

describe('computeDisplayHand', () => {
  it('default-sorts by suit then rank when customOrder is empty', () => {
    // Suit order is S, H, D, C; rank order ascends from A through K.
    const hand: Card[] = ['7H', '2S', 'AS', 'KC', '5D'];
    expect(computeDisplayHand(hand, [])).toEqual(['AS', '2S', '7H', '5D', 'KC']);
  });

  it('respects customOrder when all cards are present', () => {
    const hand: Card[] = ['AS', '7H', 'KC'];
    const customOrder: Card[] = ['KC', 'AS', '7H'];
    expect(computeDisplayHand(hand, customOrder)).toEqual(['KC', 'AS', '7H']);
  });

  it('drops cards from customOrder that are no longer in hand (e.g., discarded)', () => {
    const hand: Card[] = ['AS', 'KC']; // 7H was discarded
    const customOrder: Card[] = ['KC', 'AS', '7H'];
    expect(computeDisplayHand(hand, customOrder)).toEqual(['KC', 'AS']);
  });

  it('appends new cards (not yet in customOrder) at the right end', () => {
    const hand: Card[] = ['AS', '7H', 'KC', '3D']; // 3D is newly drawn
    const customOrder: Card[] = ['KC', 'AS', '7H'];
    expect(computeDisplayHand(hand, customOrder)).toEqual(['KC', 'AS', '7H', '3D']);
  });

  it('appends multiple new cards in default sorted order, preserving existing order', () => {
    // Player drew two cards in succession; both are appended sorted relative to each other.
    const hand: Card[] = ['KC', 'AS', '7H', '3D', '9S'];
    const customOrder: Card[] = ['KC', 'AS', '7H'];
    // 9S (suit S) sorts before 3D (suit D) under our suit order.
    expect(computeDisplayHand(hand, customOrder)).toEqual(['KC', 'AS', '7H', '9S', '3D']);
  });

  it('handles a fully-replaced hand by sorting it from scratch', () => {
    const hand: Card[] = ['7H', '2S'];
    // Custom order entries are all stale; nothing matches the hand.
    const customOrder: Card[] = ['KC', 'AS', '5D'];
    expect(computeDisplayHand(hand, customOrder)).toEqual(['2S', '7H']);
  });
});
