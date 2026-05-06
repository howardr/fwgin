/**
 * Game reducer: applies a validated {@link Action} to a {@link GameState}, mutating it.
 *
 * All mutations happen in-place for simplicity (the Durable Object will own the lone copy
 * and persist it after each apply). Callers must clone first if they need persistence of
 * pre-action state.
 *
 * Validation rules live alongside the reducer: every public `apply*` returns a result
 * object with either `ok: true` or `ok: false, code, message`. The DO surfaces those error
 * messages to the offending client without ever advancing state.
 */

import {
  type Card,
  type GameEvent,
  type GameState,
  type Meld,
  type MeldId,
  type Player,
  type PlayerId,
  extensionsFor,
  rankOf,
  validateMeld,
} from '@fwgin/shared';
import type { Action, ActionResult } from './actions.js';
import {
  currentPlayer,
  dealRound,
  endRoundScoring,
  nextSeat,
  reshuffleDiscardIntoStock,
} from './round.js';

export interface ApplyOutcome {
  result: ActionResult;
  events: GameEvent[];
}

function ok(): ActionResult {
  return { ok: true };
}
function err(code: string, message: string): ActionResult {
  return { ok: false, code, message };
}

function logEvent(state: GameState, ev: GameEvent): GameEvent {
  state.log.push(ev);
  state.updatedAt = ev.at;
  return ev;
}

function trimEvents(state: GameState): void {
  if (state.log.length > 5000) {
    state.log = state.log.slice(state.log.length - 5000);
  }
}

function nextMeldId(state: GameState): MeldId {
  state.meldCounter += 1;
  return `m${state.meldCounter}`;
}

function findPlayer(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

function isCurrentPlayer(state: GameState, id: PlayerId): boolean {
  return currentPlayer(state)?.id === id;
}

function hasOwnMeldThisRound(state: GameState, playerId: PlayerId): boolean {
  return state.meldsOnTable.some((m) => m.ownerId === playerId && m.round === state.round);
}

/** Remove a card from a player's hand. Returns false if not present. */
function takeFromHand(state: GameState, playerId: PlayerId, card: Card): boolean {
  const hand = state.hands[playerId];
  if (!hand) return false;
  const idx = hand.indexOf(card);
  if (idx === -1) return false;
  hand.splice(idx, 1);
  return true;
}

/** Add a card to a player's hand. */
function putInHand(state: GameState, playerId: PlayerId, card: Card): void {
  const hand = state.hands[playerId];
  if (!hand) state.hands[playerId] = [card];
  else hand.push(card);
}

/** Advance to the next player's turn and reset the timer deadline. */
function advanceTurn(state: GameState, now: number): void {
  state.turnSeat = nextSeat(state, state.turnSeat);
  state.turnDeadline = now + state.config.turnTimerMs;
}

/** Top discard, or undefined if pile is empty. */
function topDiscard(state: GameState): Card | undefined {
  return state.discard[state.discard.length - 1];
}

// =========================================================================================
// Public API: apply an action.
// =========================================================================================

export function apply(state: GameState, action: Action): ApplyOutcome {
  const beforeLogLen = state.log.length;
  const result = dispatch(state, action);
  const events = state.log.slice(beforeLogLen);
  trimEvents(state);
  return { result, events };
}

function dispatch(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'START_GAME':
      return startGame(state, action.at);
    case 'ACCEPT_UPCARD':
      return acceptUpcard(state, action.playerId, action.at);
    case 'DECLINE_UPCARD':
      return declineUpcard(state, action.playerId, action.at);
    case 'STEAL_WILD':
      return stealWild(state, action.playerId, action.meldId, action.surrender, action.at);
    case 'DRAW_STOCK':
      return drawStock(state, action.playerId, action.at);
    case 'DRAW_DISCARD':
      return drawDiscard(state, action.playerId, action.at);
    case 'LAY_MELD':
      return layMeld(
        state,
        action.playerId,
        action.cards,
        action.wildSlot,
        action.wildRepresents,
        action.at,
      );
    case 'EXTEND_MELD':
      return extendMeld(
        state,
        action.playerId,
        action.meldId,
        action.cards,
        action.wildSlot,
        action.wildRepresents,
        action.at,
      );
    case 'DISCARD':
      return discard(state, action.playerId, action.card, action.at);
    case 'AUTO_PLAY':
      return autoPlay(state, action.at);
  }
}

// =========================================================================================
// START_GAME — deals round 1.
// =========================================================================================

function startGame(state: GameState, at: number): ActionResult {
  if (state.phase !== 'lobby') return err('bad_phase', 'Game has already started');
  if (state.players.length < 2) return err('too_few', 'Need at least 2 players');

  // Pick a random dealer for round 1: lowest seat for determinism in tests; tweak later.
  const sortedSeats = [...state.players].map((p) => p.seat).sort((a, b) => a - b);
  state.dealerSeat = sortedSeats[0]!;

  // Initialize per-player score arrays.
  for (const p of state.players) {
    if (!state.scores[p.id]) state.scores[p.id] = [];
  }

  logEvent(state, { type: 'game_started', at });
  dealRound(state, 1, at);
  return ok();
}

// =========================================================================================
// Upcard offer — round opener.
// =========================================================================================

function acceptUpcard(state: GameState, playerId: PlayerId, at: number): ActionResult {
  if (state.phase !== 'awaiting_upcard') return err('bad_phase', 'Not in upcard phase');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  const card = topDiscard(state);
  if (!card) return err('empty_discard', 'No upcard available');
  state.discard.pop();
  putInHand(state, playerId, card);
  logEvent(state, { type: 'upcard_accepted', byPlayerId: playerId, card, at });
  // Player must now discard to complete the upcard turn. The accept counts as their
  // draw for this turn so meld/discard are now legal.
  state.phase = 'in_round';
  ensureTurnState(state).drewThisTurn = true;
  ensureTurnState(state).drewSource = 'discard';
  ensureTurnState(state).drewCard = card;
  state.updatedAt = at;
  return ok();
}

function declineUpcard(state: GameState, playerId: PlayerId, at: number): ActionResult {
  if (state.phase !== 'awaiting_upcard') return err('bad_phase', 'Not in upcard phase');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  logEvent(state, { type: 'upcard_declined', byPlayerId: playerId, at });

  // Count declines in the current round only (since the most recent round_started event).
  let declinesThisRound = 0;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const ev = state.log[i]!;
    if (ev.type === 'round_started') break;
    if (ev.type === 'upcard_declined') declinesThisRound++;
  }
  // Offer goes only to non-dealer first, then dealer. After 2 declines, non-dealer
  // draws from stock to begin play.
  if (declinesThisRound >= 2) {
    state.turnSeat = nextSeat(state, state.dealerSeat);
    state.phase = 'in_round';
    state.updatedAt = at;
    return ok();
  }
  // Pass the offer to the dealer (turnSeat was at non-dealer when the round opened).
  state.turnSeat = state.dealerSeat;
  state.updatedAt = at;
  return ok();
}

// =========================================================================================
// STEAL_WILD — before the draw step on your turn.
// =========================================================================================

function stealWild(
  state: GameState,
  playerId: PlayerId,
  meldId: MeldId,
  surrender: Card,
  at: number,
): ActionResult {
  if (state.phase !== 'in_round') return err('bad_phase', 'Not in active play');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  // A steal must happen before draw, i.e. the player has not yet drawn this turn. We use
  // the convention: hand size for current player == HAND_SIZE_AT_START_OF_TURN. We track
  // implicitly by saying: steal is legal as long as the player hasn't taken the draw step,
  // which we identify by whether the *previous* event for this player this turn was an
  // ACCEPT_UPCARD/DRAW_*. In practice, the safest enforceable rule: steal is illegal once
  // a draw event has been logged this turn (we check via a turn-scope event scan).
  if (drawHappenedThisTurn(state, playerId)) {
    return err('after_draw', 'Steal must occur before drawing');
  }

  const meld = state.meldsOnTable.find((m) => m.id === meldId);
  if (!meld) return err('no_such_meld', 'Meld not found');
  if (meld.wildSlot === undefined || !meld.wildRepresents) {
    return err('no_wild', 'Meld has no wild to steal');
  }
  if (meld.wildRepresents !== surrender) {
    return err('wrong_surrender', `That meld's wild represents ${meld.wildRepresents}`);
  }
  const hand = state.hands[playerId] ?? [];
  if (!hand.includes(surrender)) {
    return err('no_such_card', `You do not hold ${surrender}`);
  }

  // Perform swap.
  const wildCard = meld.cards[meld.wildSlot]!;
  takeFromHand(state, playerId, surrender);
  meld.cards[meld.wildSlot] = surrender;
  meld.wildSlot = undefined;
  meld.wildRepresents = undefined;
  putInHand(state, playerId, wildCard);

  logEvent(state, {
    type: 'wild_stolen',
    byPlayerId: playerId,
    meldId,
    surrendered: surrender,
    wild: wildCard,
    at,
  });
  return ok();
}

function drawHappenedThisTurn(state: GameState, _playerId: PlayerId): boolean {
  // Find the most recent action that ended a turn (a DISCARD or AUTO_PLAY); after that we
  // scan for a draw belonging to *this* turn. Simpler: we track per-turn flags on the
  // state (added below).
  return state._turnState?.drewThisTurn ?? false;
}

// =========================================================================================
// DRAW_STOCK / DRAW_DISCARD — once per turn.
// =========================================================================================

function drawStock(state: GameState, playerId: PlayerId, at: number): ActionResult {
  if (state.phase !== 'in_round') return err('bad_phase', 'Not in active play');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  if (drawHappenedThisTurn(state, playerId)) return err('already_drew', 'Already drew this turn');

  if (state.stock.length === 0) {
    reshuffleDiscardIntoStock(state, at);
    if (state.stock.length === 0) {
      // Truly out of cards. Treat as a no-op draw and advance? For now, force a
      // round end with the current hands (no winner -> highest deadwood split). To keep
      // it simple, end the round and award 0s.
      finishRoundDraw(state, at);
      return ok();
    }
  }
  const card = state.stock.pop()!;
  putInHand(state, playerId, card);
  ensureTurnState(state).drewThisTurn = true;
  ensureTurnState(state).drewSource = 'stock';
  ensureTurnState(state).drewCard = card;
  logEvent(state, { type: 'drew_stock', playerId, at });
  return ok();
}

function drawDiscard(state: GameState, playerId: PlayerId, at: number): ActionResult {
  if (state.phase !== 'in_round') return err('bad_phase', 'Not in active play');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  if (drawHappenedThisTurn(state, playerId)) return err('already_drew', 'Already drew this turn');
  const card = topDiscard(state);
  if (!card) return err('empty_discard', 'Discard is empty');
  state.discard.pop();
  putInHand(state, playerId, card);
  ensureTurnState(state).drewThisTurn = true;
  ensureTurnState(state).drewSource = 'discard';
  ensureTurnState(state).drewCard = card;
  logEvent(state, { type: 'drew_discard', playerId, card, at });
  return ok();
}

// =========================================================================================
// LAY_MELD / EXTEND_MELD.
// =========================================================================================

function layMeld(
  state: GameState,
  playerId: PlayerId,
  cards: Card[],
  wildSlot: number | undefined,
  wildRepresents: Card | undefined,
  at: number,
): ActionResult {
  if (state.phase !== 'in_round') return err('bad_phase', 'Not in active play');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  if (!drawHappenedThisTurn(state, playerId))
    return err('not_drawn', 'You must draw before laying melds');

  const wild = state.wildRank!;
  const validation = validateMeld(
    { kind: inferKind(cards), cards, wildSlot, wildRepresents },
    wild,
    state.config.acesMode,
  );
  if (!validation.ok) return err('bad_meld', validation.reason);

  // Verify all cards are in the player's hand.
  const hand = state.hands[playerId] ?? [];
  const handCopy = [...hand];
  for (const c of cards) {
    const idx = handCopy.indexOf(c);
    if (idx === -1) return err('not_in_hand', `${c} is not in your hand`);
    handCopy.splice(idx, 1);
  }

  // Move the cards.
  for (const c of cards) takeFromHand(state, playerId, c);

  const id = nextMeldId(state);
  const meld: Meld = {
    id,
    ownerId: playerId,
    kind: validation.kind,
    cards,
    wildSlot,
    wildRepresents,
    round: state.round,
  };
  state.meldsOnTable.push(meld);
  logEvent(state, {
    type: 'meld_laid',
    playerId,
    meldId: id,
    cards,
    wildRepresents,
    at,
  });
  return ok();
}

function inferKind(cards: Card[]): 'set' | 'run' {
  // A best-effort guess — validateMeld will compute the real answer based on effective
  // cards. We only pick something so the validator can route.
  const ranks = new Set(cards.map(rankOf));
  return ranks.size <= 2 ? 'set' : 'run';
}

function extendMeld(
  state: GameState,
  playerId: PlayerId,
  meldId: MeldId,
  cards: Card[],
  wildSlot: number | undefined,
  wildRepresents: Card | undefined,
  at: number,
): ActionResult {
  if (state.phase !== 'in_round') return err('bad_phase', 'Not in active play');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  if (!drawHappenedThisTurn(state, playerId))
    return err('not_drawn', 'You must draw before extending melds');

  const meld = state.meldsOnTable.find((m) => m.id === meldId);
  if (!meld) return err('no_such_meld', 'Meld not found');

  const wild = state.wildRank!;
  const onOpponent = meld.ownerId !== playerId;
  if (onOpponent) {
    if (!state.config.layoffsOnOpponents) {
      return err('opponent_layoff_disabled', 'Layoffs onto opponents are disabled');
    }
    if (!hasOwnMeldThisRound(state, playerId)) {
      return err(
        'need_own_meld',
        'You must have laid your own meld this round before extending an opponent',
      );
    }
  }

  // Verify cards are in hand.
  const hand = state.hands[playerId] ?? [];
  const handCopy = [...hand];
  for (const c of cards) {
    const idx = handCopy.indexOf(c);
    if (idx === -1) return err('not_in_hand', `${c} is not in your hand`);
    handCopy.splice(idx, 1);
  }

  // Build proposed new meld and validate.
  // Wild handling: if the extension introduces a wild, attach it. If the existing meld
  // already has a wild and the extension also has a wild, reject (one wild per meld).
  const existingHasWild = meld.wildSlot !== undefined;
  const extensionHasWild = wildSlot !== undefined;
  if (existingHasWild && extensionHasWild) {
    return err('two_wilds', 'A meld may contain at most one wild');
  }

  // Construct candidate combined card list.
  const combined = [...meld.cards, ...cards];
  let newWildSlot = meld.wildSlot;
  let newWildRepresents = meld.wildRepresents;
  if (extensionHasWild) {
    if (wildSlot! < 0 || wildSlot! >= cards.length) {
      return err('bad_wild_slot', 'wildSlot out of range for extension');
    }
    if (rankOf(cards[wildSlot!]!) !== wild) {
      return err('bad_wild', 'Card at wildSlot is not the wild rank');
    }
    if (!wildRepresents) return err('bad_wild', 'wildRepresents required');
    newWildSlot = meld.cards.length + wildSlot!;
    newWildRepresents = wildRepresents;
  }

  const validation = validateMeld(
    { kind: meld.kind, cards: combined, wildSlot: newWildSlot, wildRepresents: newWildRepresents },
    wild,
    state.config.acesMode,
  );
  if (!validation.ok) return err('bad_extension', validation.reason);

  // Also confirm that the new cards are actually valid extensions: they must each belong
  // to the meld's extension set if no wild was added; if a wild was added, the validator
  // above is sufficient.
  if (!extensionHasWild) {
    const allowed = new Set(extensionsFor(meld, wild, state.config.acesMode));
    for (const c of cards) {
      if (!allowed.has(c) && rankOf(c) !== wild) {
        // Note: extending with a wild is handled separately above. Adding a non-wild
        // card not in `allowed` is illegal.
        return err('bad_extension', `${c} cannot extend this meld`);
      }
      // If c is a wild without wildSlot, that's a misuse.
      if (rankOf(c) === wild && !extensionHasWild) {
        return err('bad_extension', 'To add a wild to a meld, supply wildSlot/wildRepresents');
      }
    }
  }

  // Move cards.
  for (const c of cards) takeFromHand(state, playerId, c);
  meld.cards = combined;
  meld.wildSlot = newWildSlot;
  meld.wildRepresents = newWildRepresents;

  logEvent(state, {
    type: 'meld_extended',
    playerId,
    meldId,
    cards,
    at,
  });
  return ok();
}

// =========================================================================================
// DISCARD — ends the turn; checks for going-out.
// =========================================================================================

function discard(state: GameState, playerId: PlayerId, card: Card, at: number): ActionResult {
  if (state.phase !== 'in_round') return err('bad_phase', 'Not in active play');
  if (!isCurrentPlayer(state, playerId)) return err('not_your_turn', 'It is not your turn');
  if (!drawHappenedThisTurn(state, playerId))
    return err('not_drawn', 'You must draw before discarding');
  if (!takeFromHand(state, playerId, card))
    return err('not_in_hand', `${card} is not in your hand`);
  state.discard.push(card);
  logEvent(state, { type: 'discarded', playerId, card, at });

  // Check going out: hand empty AND at least one own meld this round (otherwise the player
  // just discarded all their cards via plays — but per rules, going out requires all cards
  // melded and a final discard).
  const hand = state.hands[playerId] ?? [];
  if (hand.length === 0 && hasOwnMeldThisRound(state, playerId)) {
    finishRound(state, playerId, at);
    return ok();
  }

  // End of normal turn.
  clearTurnState(state);
  advanceTurn(state, at);
  return ok();
}

// =========================================================================================
// AUTO_PLAY — server-driven on turn timer expiry.
// =========================================================================================

function autoPlay(state: GameState, at: number): ActionResult {
  if (state.phase !== 'in_round' && state.phase !== 'awaiting_upcard') {
    return err('bad_phase', 'Not in a play phase');
  }
  const player = currentPlayer(state);
  if (!player) return err('no_player', 'No current player');

  if (state.phase === 'awaiting_upcard') {
    // Default: decline.
    return declineUpcard(state, player.id, at);
  }

  // Active play: draw stock, then discard the same card.
  if (state.stock.length === 0) reshuffleDiscardIntoStock(state, at);
  if (state.stock.length === 0) {
    // Truly empty — end round as a draw.
    finishRoundDraw(state, at);
    return ok();
  }
  const card = state.stock.pop()!;
  // No need to put-then-pop; just discard directly and log auto_played.
  state.discard.push(card);
  logEvent(state, {
    type: 'auto_played',
    playerId: player.id,
    drewFromStock: card,
    discarded: card,
    at,
  });
  clearTurnState(state);
  advanceTurn(state, at);
  return ok();
}

// =========================================================================================
// Round/game termination helpers.
// =========================================================================================

function finishRound(state: GameState, winnerId: PlayerId, at: number): void {
  const scores = endRoundScoring(state, winnerId);
  for (const p of state.players) {
    state.scores[p.id]?.push(scores[p.id] ?? 0);
  }
  logEvent(state, { type: 'round_ended', winnerId, scores, at });

  if (state.round >= 13) {
    finishGame(state, at);
    return;
  }

  // Advance dealer and start the next round.
  state.dealerSeat = nextSeat(state, state.dealerSeat);
  state.phase = 'round_over';
  // The DO will trigger startNextRound(at) after a brief pause; but for engine determinism
  // we go directly into the next deal here.
  dealRound(state, state.round + 1, at);
}

function finishRoundDraw(state: GameState, at: number): void {
  // Treat as nobody won this round; everyone scores their hand.
  const out: Record<PlayerId, number> = {};
  const wild = state.wildRank!;
  for (const p of state.players) {
    out[p.id] = (state.hands[p.id] ?? []).reduce((acc, c) => {
      // Inline value because we don't want a circular import.
      const r = rankOf(c);
      if (r === wild) return acc + 25;
      if (r === 'A') return acc + (state.config.acesMode === 'low' ? 1 : 13);
      if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return acc + 10;
      return acc + Number.parseInt(r, 10);
    }, 0);
    state.scores[p.id]?.push(out[p.id]!);
  }
  logEvent(state, { type: 'round_ended', winnerId: '' as PlayerId, scores: out, at });
  if (state.round >= 13) {
    finishGame(state, at);
    return;
  }
  state.dealerSeat = nextSeat(state, state.dealerSeat);
  state.phase = 'round_over';
  dealRound(state, state.round + 1, at);
}

function finishGame(state: GameState, at: number): void {
  const totals: Record<PlayerId, number> = {};
  let min = Number.POSITIVE_INFINITY;
  for (const p of state.players) {
    const total = (state.scores[p.id] ?? []).reduce((a, b) => a + b, 0);
    totals[p.id] = total;
    if (total < min) min = total;
  }
  let winners = state.players.filter((p) => totals[p.id] === min).map((p) => p.id);
  if (winners.length > 1) {
    // Tiebreak: fewest non-zero rounds.
    const nonZero: Record<PlayerId, number> = {};
    for (const id of winners) {
      nonZero[id] = (state.scores[id] ?? []).filter((s) => s > 0).length;
    }
    const minNZ = Math.min(...winners.map((id) => nonZero[id]!));
    winners = winners.filter((id) => nonZero[id] === minNZ);
  }
  state.phase = 'game_over';
  logEvent(state, { type: 'game_ended', winnerIds: winners, finalScores: totals, at });
}

// =========================================================================================
// Turn-scope tracking (whether a draw has occurred this turn).
// We attach a small ephemeral object to GameState for convenience; it is not persisted in
// long-term storage but is included in the snapshot the DO writes (small enough; cheap).
// =========================================================================================

declare module '@fwgin/shared' {
  interface GameState {
    _turnState?: TurnState;
  }
}

interface TurnState {
  drewThisTurn: boolean;
  drewSource?: 'stock' | 'discard';
  drewCard?: Card;
}

function ensureTurnState(state: GameState): TurnState {
  if (!state._turnState) {
    state._turnState = { drewThisTurn: false };
  }
  return state._turnState;
}

function clearTurnState(state: GameState): void {
  state._turnState = { drewThisTurn: false };
}

// Re-export for tests.
export { findPlayer, currentPlayer };
