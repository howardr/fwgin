import {
  type Card,
  type GameConfig,
  type GameState,
  type PlayerId,
  buildDeck,
} from '@fwgin/shared';
import { addPlayerToLobby, newGameState } from '../src/factory.js';

/**
 * Build a 2-player lobby with deterministic ids, ready for START_GAME.
 */
export function lobby2(config?: Partial<GameConfig>, now = 1_000_000): GameState {
  const s = newGameState({
    id: 'g1',
    hostId: 'p1',
    hostName: 'Alice',
    config,
    now,
  });
  addPlayerToLobby(s, 'p2', 'Bob');
  return s;
}

export function lobby3(config?: Partial<GameConfig>, now = 1_000_000): GameState {
  const s = newGameState({ id: 'g1', hostId: 'p1', hostName: 'Alice', config, now });
  addPlayerToLobby(s, 'p2', 'Bob');
  addPlayerToLobby(s, 'p3', 'Carol');
  return s;
}

/** Replace the dealt hands and deck with a controlled setup, useful for unit tests. */
export function rigState(
  s: GameState,
  hands: Record<PlayerId, Card[]>,
  stockTop: Card[],
  discardTop: Card,
): void {
  // Replace hands
  s.hands = JSON.parse(JSON.stringify(hands));
  // The stock is consumed from the *end*, so the "top" should be at the end.
  // Caller passes stockTop in the order they want it drawn (first element drawn first),
  // so we reverse for storage.
  const all = new Set<Card>(buildDeck());
  for (const v of Object.values(hands)) for (const c of v) all.delete(c);
  for (const c of stockTop) all.delete(c);
  all.delete(discardTop);
  s.stock = [...all, ...[...stockTop].reverse()]; // last-in is drawn first
  s.discard = [discardTop];
  // Rigging implies a controlled, fresh turn. The real deal sets `_turnState` for the
  // first player; tests typically want to take a normal draw/discard cycle on the
  // current turnSeat, so reset the turn-state to "not yet drawn".
  s._turnState = { drewThisTurn: false };
}
