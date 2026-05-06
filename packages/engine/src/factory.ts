/**
 * Factory helpers for constructing fresh {@link GameState} objects.
 */

import type { GameConfig, GameId, GameState, Player, PlayerId } from '@fwgin/shared';

export const DEFAULT_CONFIG: GameConfig = {
  maxPlayers: 4,
  turnTimerMs: 24 * 60 * 60 * 1000,
  discardVisibility: 1,
  acesMode: 'high',
  layoffsOnOpponents: true,
  spectatorsAllowed: true,
};

export interface NewGameInput {
  id: GameId;
  hostId: PlayerId;
  hostName: string;
  config?: Partial<GameConfig>;
  now: number;
}

export function newGameState(input: NewGameInput): GameState {
  const now = input.now;
  const config: GameConfig = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
  const host: Player = {
    id: input.hostId,
    displayName: input.hostName,
    seat: 0,
  };
  return {
    id: input.id,
    config,
    players: [host],
    hostId: input.hostId,
    phase: 'lobby',
    round: 0,
    wildRank: null,
    dealerSeat: 0,
    turnSeat: 0,
    turnDeadline: 0,
    stock: [],
    discard: [],
    hands: {},
    meldsOnTable: [],
    scores: { [input.hostId]: [] },
    log: [],
    rngSeed: '',
    meldCounter: 0,
    updatedAt: now,
    createdAt: now,
  };
}

/** Add a player to a lobby. Throws if the lobby is full or game has started. */
export function addPlayerToLobby(state: GameState, playerId: PlayerId, displayName: string): void {
  if (state.phase !== 'lobby') throw new Error('Cannot join: game already started');
  if (state.players.find((p) => p.id === playerId)) return; // idempotent
  if (state.players.length >= state.config.maxPlayers) throw new Error('Lobby is full');
  const seat = nextFreeSeat(state);
  state.players.push({ id: playerId, displayName, seat });
  if (!state.scores[playerId]) state.scores[playerId] = [];
}

function nextFreeSeat(state: GameState): number {
  const used = new Set(state.players.map((p) => p.seat));
  for (let i = 0; i < 6; i++) if (!used.has(i)) return i;
  throw new Error('No free seat');
}
