/**
 * Build a {@link PlayerView} or {@link SpectatorView} from a full {@link GameState}.
 * These views carry only the information that role is allowed to see.
 */

import type { GameState, PlayerId, PlayerView, SpectatorView, ViewForClient } from '@fwgin/shared';

export function viewForPlayer(state: GameState, playerId: PlayerId): PlayerView {
  return {
    kind: 'player',
    id: state.id,
    config: state.config,
    players: state.players.map((p) => ({
      ...p,
      handCount: (state.hands[p.id] ?? []).length,
    })),
    hostId: state.hostId,
    phase: state.phase,
    round: state.round,
    wildRank: state.wildRank,
    dealerSeat: state.dealerSeat,
    turnSeat: state.turnSeat,
    turnDeadline: state.turnDeadline,
    stockCount: state.stock.length,
    discard: visibleDiscards(state),
    discardTotal: state.discard.length,
    yourId: playerId,
    yourHand: [...(state.hands[playerId] ?? [])],
    meldsOnTable: state.meldsOnTable.map((m) => ({ ...m, cards: [...m.cards] })),
    scores: deepCopyScores(state.scores),
    recentEvents: state.log.slice(-50),
    updatedAt: state.updatedAt,
  };
}

export function viewForSpectator(state: GameState): SpectatorView {
  return {
    kind: 'spectator',
    id: state.id,
    config: state.config,
    players: state.players.map((p) => ({
      ...p,
      handCount: (state.hands[p.id] ?? []).length,
    })),
    hostId: state.hostId,
    phase: state.phase,
    round: state.round,
    wildRank: state.wildRank,
    dealerSeat: state.dealerSeat,
    turnSeat: state.turnSeat,
    turnDeadline: state.turnDeadline,
    stockCount: state.stock.length,
    discard: visibleDiscards(state),
    discardTotal: state.discard.length,
    meldsOnTable: state.meldsOnTable.map((m) => ({ ...m, cards: [...m.cards] })),
    scores: deepCopyScores(state.scores),
    recentEvents: state.log.slice(-50),
    updatedAt: state.updatedAt,
  };
}

export function viewFor(
  state: GameState,
  who: { kind: 'player'; id: PlayerId } | { kind: 'spectator' },
): ViewForClient {
  return who.kind === 'player' ? viewForPlayer(state, who.id) : viewForSpectator(state);
}

function visibleDiscards(state: GameState) {
  const n = Math.max(1, state.config.discardVisibility);
  if (n >= state.discard.length) return [...state.discard];
  return state.discard.slice(state.discard.length - n);
}

function deepCopyScores(s: Record<PlayerId, number[]>): Record<PlayerId, number[]> {
  const out: Record<PlayerId, number[]> = {};
  for (const k of Object.keys(s)) out[k] = [...(s[k] ?? [])];
  return out;
}
