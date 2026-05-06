/**
 * Deadwood scoring for cards left in a player's hand at round end.
 *
 *  - A = 1 if `acesMode === 'low'`, otherwise 13
 *  - 2..9 = face value (parsed from the rank character)
 *  - T, J, Q, K = 10
 *  - The current wild rank, if held, scores 25
 */

import { type Card, type Rank, rankOf } from './cards.js';
import type { AcesMode } from './types.js';

export function cardValue(card: Card, wildRank: Rank, acesMode: AcesMode): number {
  const r = rankOf(card);
  if (r === wildRank) return 25;
  if (r === 'A') return acesMode === 'low' ? 1 : 13;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  // r is one of '2'..'9'.
  return Number.parseInt(r, 10);
}

export function handValue(hand: Card[], wildRank: Rank, acesMode: AcesMode): number {
  let total = 0;
  for (const c of hand) total += cardValue(c, wildRank, acesMode);
  return total;
}
