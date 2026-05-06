/**
 * Core type definitions shared between server and client.
 *
 * The full {@link GameState} lives only on the server (Durable Object). Clients receive a
 * redacted {@link PlayerView} or {@link SpectatorView} depending on their role.
 */

import type { Card, Rank } from './cards.js';

export type PlayerId = string;
export type GameId = string;
export type MeldId = string;

export type AcesMode = 'low' | 'high' | 'either';

export type GamePhase = 'lobby' | 'in_round' | 'round_over' | 'game_over' | 'abandoned';

export interface GameConfig {
  /** Maximum players this game can hold (2-6). */
  maxPlayers: 2 | 3 | 4 | 5 | 6;
  /** Per-turn timer in milliseconds. Default 24h. */
  turnTimerMs: number;
  /** How many discards are visible to everyone. 1 = top only (classic). */
  discardVisibility: number;
  acesMode: AcesMode;
  /**
   * If true, players may extend opponents' melds during play, but only after they have
   * already laid at least one of their own melds in the current round.
   */
  layoffsOnOpponents: boolean;
  spectatorsAllowed: boolean;
}

export interface Player {
  id: PlayerId;
  displayName: string;
  seat: number;
}

export type MeldKind = 'set' | 'run';

/**
 * One meld on the table.
 *
 * - `cards` is in canonical order (sorted by rank for sets; sequential for runs).
 * - `wildSlot` (if present) is the index in `cards` where the wild sits, and `wildRepresents`
 *   is the natural card the wild stands for. Only one wild per meld is permitted.
 */
export interface Meld {
  id: MeldId;
  ownerId: PlayerId;
  kind: MeldKind;
  cards: Card[];
  wildSlot?: number;
  wildRepresents?: Card;
  /** Round this meld was laid. Reset when a new round starts. */
  round: number;
}

/** A single event in the append-only game log. */
export type GameEvent =
  | { type: 'game_started'; at: number }
  | { type: 'round_started'; round: number; wildRank: Rank; dealerId: PlayerId; at: number }
  | {
      type: 'wild_stolen';
      byPlayerId: PlayerId;
      meldId: MeldId;
      surrendered: Card;
      wild: Card;
      at: number;
    }
  | { type: 'drew_stock'; playerId: PlayerId; at: number }
  | { type: 'drew_discard'; playerId: PlayerId; card: Card; at: number }
  | {
      type: 'meld_laid';
      playerId: PlayerId;
      meldId: MeldId;
      cards: Card[];
      wildRepresents?: Card;
      at: number;
    }
  | { type: 'meld_extended'; playerId: PlayerId; meldId: MeldId; cards: Card[]; at: number }
  | { type: 'discarded'; playerId: PlayerId; card: Card; at: number }
  | { type: 'stock_reshuffled'; at: number }
  | { type: 'auto_played'; playerId: PlayerId; drewFromStock: Card; discarded: Card; at: number }
  | { type: 'round_ended'; winnerId: PlayerId; scores: Record<PlayerId, number>; at: number }
  | {
      type: 'game_ended';
      winnerIds: PlayerId[];
      finalScores: Record<PlayerId, number>;
      at: number;
    };

/**
 * Full server-side game state. Never sent to clients verbatim — pass through `viewForPlayer`
 * or `viewForSpectator` first.
 */
export interface GameState {
  id: GameId;
  config: GameConfig;
  players: Player[];
  hostId: PlayerId;
  phase: GamePhase;
  round: number;
  wildRank: Rank | null;
  dealerSeat: number;
  /** Seat whose turn it currently is. */
  turnSeat: number;
  /** Epoch ms when the current turn's timer expires. */
  turnDeadline: number;
  stock: Card[];
  /** Discard pile, top is the *last* element. */
  discard: Card[];
  hands: Record<PlayerId, Card[]>;
  meldsOnTable: Meld[];
  /** Cumulative scores per round. `scores[playerId][i]` = points scored in round i+1. */
  scores: Record<PlayerId, number[]>;
  log: GameEvent[];
  /** Hex seed currently driving deterministic shuffles. */
  rngSeed: string;
  /** Internal counter for assigning meld ids. */
  meldCounter: number;
  /** Most recent action time (epoch ms), used for inactivity tracking. */
  updatedAt: number;
  createdAt: number;
}

/**
 * Per-player info exposed in views. `online` reflects whether the player currently has at
 * least one open WebSocket connection to the game's Durable Object — the engine itself
 * doesn't know about WS lifecycles, so the DO injects this field before broadcasting.
 */
export type PlayerInView = Player & { handCount: number; online: boolean };

/** What a seated player is allowed to see. */
export interface PlayerView {
  kind: 'player';
  id: GameId;
  config: GameConfig;
  players: PlayerInView[];
  hostId: PlayerId;
  phase: GamePhase;
  round: number;
  wildRank: Rank | null;
  dealerSeat: number;
  turnSeat: number;
  turnDeadline: number;
  /** Number of cards remaining in the stock. */
  stockCount: number;
  /** Visible discards, top is last. Length is at most `config.discardVisibility`. */
  discard: Card[];
  /** Total discard pile size (for the UI even when only top is visible). */
  discardTotal: number;
  yourId: PlayerId;
  yourHand: Card[];
  meldsOnTable: Meld[];
  scores: Record<PlayerId, number[]>;
  recentEvents: GameEvent[];
  updatedAt: number;
}

export interface SpectatorView extends Omit<PlayerView, 'kind' | 'yourId' | 'yourHand'> {
  kind: 'spectator';
}

export type ViewForClient = PlayerView | SpectatorView;
