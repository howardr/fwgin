/**
 * Round dealing and end-of-round scoring helpers.
 */

import {
  type Card,
  type GameState,
  type PlayerId,
  buildDeck,
  handValue,
  newSeed,
  rngFromSeed,
  shuffle,
  wildRankForRound,
} from '@fwgin/shared';

const HAND_SIZE = 7;

/**
 * Deal a fresh round into the supplied state mutably. Resets per-round fields:
 *   - hands, stock, discard, meldsOnTable, wildRank
 *   - phase becomes 'awaiting_upcard'
 *   - dealerSeat advances (caller passes the new dealerSeat for round 1)
 *   - turnSeat is set to the player after the dealer (offered the upcard first)
 *
 * Generates a fresh seed for the round and stores it on `state.rngSeed`.
 */
export function dealRound(state: GameState, round: number, now: number): void {
  if (state.players.length < 2) {
    throw new Error('Need at least 2 players to deal');
  }
  const seed = newSeed();
  const rng = rngFromSeed(seed);
  const deck = shuffle(buildDeck(), rng);

  // Reset round-specific fields.
  state.round = round;
  state.wildRank = wildRankForRound(round);
  state.rngSeed = seed;
  state.meldsOnTable = [];
  state.hands = {};
  state.stock = [];
  state.discard = [];
  state.phase = 'awaiting_upcard';

  // Deal HAND_SIZE cards per player around the table.
  const order = playerSeatOrder(state, state.dealerSeat);
  for (const p of order) state.hands[p.id] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    for (const p of order) {
      state.hands[p.id]!.push(deck.pop()!);
    }
  }

  // Top of stock -> upcard onto discard.
  state.discard.push(deck.pop()!);
  state.stock = deck;

  // First chance at the upcard goes to the player after the dealer.
  state.turnSeat = nextSeat(state, state.dealerSeat);
  state.turnDeadline = now + state.config.turnTimerMs;
  state.updatedAt = now;

  state.log.push({
    type: 'round_started',
    round,
    wildRank: state.wildRank,
    dealerId: state.players.find((p) => p.seat === state.dealerSeat)!.id,
    at: now,
  });
}

/** Compute end-of-round scores given the winner has 0 cards remaining. */
export function endRoundScoring(state: GameState, winnerId: PlayerId): Record<PlayerId, number> {
  const wild = state.wildRank!;
  const out: Record<PlayerId, number> = {};
  for (const p of state.players) {
    if (p.id === winnerId) {
      out[p.id] = 0;
    } else {
      out[p.id] = handValue(state.hands[p.id] ?? [], wild, state.config.acesMode);
    }
  }
  return out;
}

/** Return players in seat order starting at `startSeat` (inclusive), wrapping. */
export function playerSeatOrder(state: GameState, startSeat: number) {
  const sorted = [...state.players].sort((a, b) => a.seat - b.seat);
  const start = sorted.findIndex((p) => p.seat === startSeat);
  if (start === -1) throw new Error(`No player at seat ${startSeat}`);
  return [...sorted.slice(start + 1), ...sorted.slice(0, start + 1)];
}

/** Next seat (wrapping) after the given seat among current players. */
export function nextSeat(state: GameState, seat: number): number {
  const sorted = [...state.players].sort((a, b) => a.seat - b.seat);
  const idx = sorted.findIndex((p) => p.seat === seat);
  if (idx === -1) throw new Error(`No player at seat ${seat}`);
  return sorted[(idx + 1) % sorted.length]!.seat;
}

/** The player whose turn it is right now. */
export function currentPlayer(state: GameState) {
  return state.players.find((p) => p.seat === state.turnSeat)!;
}

/** Player at a given seat. */
export function playerAtSeat(state: GameState, seat: number) {
  return state.players.find((p) => p.seat === seat);
}

/** Reshuffle the discard back into the stock, leaving the top discard in place. */
export function reshuffleDiscardIntoStock(state: GameState, now: number): void {
  if (state.stock.length > 0) return;
  if (state.discard.length <= 1) {
    // Truly nothing to reshuffle. Engine should detect this and end the round in a draw.
    return;
  }
  const top = state.discard.pop()!;
  const remainder: Card[] = [...state.discard];
  state.discard = [top];
  // Use a fresh seed so the reshuffle order can't be derived from the round seed alone.
  const seed = newSeed();
  const rng = rngFromSeed(seed);
  state.stock = shuffle(remainder, rng);
  state.log.push({ type: 'stock_reshuffled', at: now });
  state.updatedAt = now;
}
