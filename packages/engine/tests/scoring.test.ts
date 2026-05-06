import { describe, expect, it } from 'vitest';
import { apply } from '../src/engine.js';
import { lobby2 } from './helpers.js';

describe('Round-end scoring', () => {
  it('winner scores 0; loser scores their deadwood', () => {
    const s = lobby2({ acesMode: 'high' });
    apply(s, { type: 'START_GAME', at: 1 });
    // Decline upcards.
    apply(s, { type: 'DECLINE_UPCARD', playerId: 'p2', at: 2 });
    apply(s, { type: 'DECLINE_UPCARD', playerId: 'p1', at: 3 });
    // Force p2 to win with a hand-rig.
    s.hands = {
      p1: ['KH', 'KD', 'KC', 'QS', 'JC', 'TS', '5H'],
      p2: ['7S', '7H', '7D', '4S', '4H', '4D', '4C'],
    };
    s.stock = [...s.stock, '9C']; // top card drawn
    s.discard = ['6H'];
    s._turnState = { drewThisTurn: false };
    s.turnSeat = 1;
    apply(s, { type: 'DRAW_STOCK', playerId: 'p2', at: 100 });
    apply(s, { type: 'LAY_MELD', playerId: 'p2', cards: ['7S', '7H', '7D'], at: 101 });
    apply(s, {
      type: 'LAY_MELD',
      playerId: 'p2',
      cards: ['4S', '4H', '4D', '4C'],
      at: 102,
    });
    apply(s, { type: 'DISCARD', playerId: 'p2', card: '9C', at: 103 });

    expect(s.scores.p2![0]).toBe(0);
    // p1 deadwood: K(10)+K(10)+K(10)+Q(10)+J(10)+T(10)+5(5) = 65
    expect(s.scores.p1![0]).toBe(65);
  });
});
