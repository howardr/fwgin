/**
 * Engine action types. These are *intent-level* actions issued by a player (or the server
 * itself for system actions like auto-play). Each is validated and applied by the reducer
 * in {@link ./engine.ts engine.ts}.
 */

import type { Card, MeldId, PlayerId } from '@fwgin/shared';

export type Action =
  | { type: 'START_GAME'; at: number }
  | { type: 'ACCEPT_UPCARD'; playerId: PlayerId; at: number }
  | { type: 'DECLINE_UPCARD'; playerId: PlayerId; at: number }
  | { type: 'STEAL_WILD'; playerId: PlayerId; meldId: MeldId; surrender: Card; at: number }
  | { type: 'DRAW_STOCK'; playerId: PlayerId; at: number }
  | { type: 'DRAW_DISCARD'; playerId: PlayerId; at: number }
  | {
      type: 'LAY_MELD';
      playerId: PlayerId;
      cards: Card[];
      wildSlot?: number;
      wildRepresents?: Card;
      at: number;
    }
  | {
      type: 'EXTEND_MELD';
      playerId: PlayerId;
      meldId: MeldId;
      cards: Card[];
      wildSlot?: number;
      wildRepresents?: Card;
      at: number;
    }
  | { type: 'DISCARD'; playerId: PlayerId; card: Card; at: number }
  | { type: 'AUTO_PLAY'; at: number };

export type ActionResult = { ok: true } | { ok: false; code: string; message: string };
