/**
 * Meld validation: sets, runs, and wild-card handling.
 *
 * A meld is either:
 *   - a *set*: 3+ cards of the same rank, possibly including one wild standing in for a
 *     declared specific suit of that rank, or
 *   - a *run*: 3+ consecutive same-suit cards, possibly including one wild standing in for
 *     the implicit missing rank in the run.
 *
 * Wraparound (K-A-2) is never legal. Aces high/low/either is configurable.
 *
 * Each meld may contain at most one wild. We disallow multi-wild melds for clarity.
 */

import {
  type Card,
  RANKS,
  type Rank,
  type Suit,
  parseCard,
  rankIndex,
  rankOf,
  suitOf,
} from './cards.js';
import type { AcesMode, MeldKind } from './types.js';

export interface MeldShape {
  kind: MeldKind;
  cards: Card[];
  /** Index in `cards` where the wild sits, if any. */
  wildSlot?: number;
  /** The natural card the wild stands in for (e.g. "7H"). Required if `wildSlot` is set. */
  wildRepresents?: Card;
}

export type MeldValidation = { ok: true; kind: MeldKind } | { ok: false; reason: string };

/**
 * Validate a candidate meld. The caller is responsible for ensuring the cards are actually
 * in the player's hand or layoff source.
 *
 * @param wildRank - the round's wild rank (e.g. "7" in round 6)
 * @param acesMode - 'low' | 'high' | 'either'
 */
export function validateMeld(shape: MeldShape, wildRank: Rank, acesMode: AcesMode): MeldValidation {
  const { cards, wildSlot, wildRepresents } = shape;

  if (!Array.isArray(cards) || cards.length < 3) {
    return { ok: false, reason: 'A meld must contain at least 3 cards' };
  }

  // No duplicate physical cards.
  const seen = new Set<Card>();
  for (const c of cards) {
    if (seen.has(c)) {
      return { ok: false, reason: `Duplicate card in meld: ${c}` };
    }
    seen.add(c);
  }

  // Wild slot consistency.
  const wildCount = countWilds(cards, wildRank);
  if (wildCount > 1) {
    return { ok: false, reason: 'A meld may contain at most one wild' };
  }
  if (wildSlot !== undefined) {
    if (wildSlot < 0 || wildSlot >= cards.length) {
      return { ok: false, reason: 'wildSlot out of range' };
    }
    if (rankOf(cards[wildSlot]!) !== wildRank) {
      return { ok: false, reason: 'Card at wildSlot is not the wild rank' };
    }
    if (!wildRepresents) {
      return { ok: false, reason: 'wildRepresents is required when a wild is present' };
    }
    if (rankOf(wildRepresents) === wildRank) {
      return { ok: false, reason: 'Wild cannot represent another wild' };
    }
    // The represented card must not duplicate a natural card already in the meld.
    for (let i = 0; i < cards.length; i++) {
      if (i !== wildSlot && cards[i] === wildRepresents) {
        return { ok: false, reason: 'Wild cannot represent a card already in the meld' };
      }
    }
  }
  if (wildCount === 1 && wildSlot === undefined) {
    return { ok: false, reason: 'Meld contains a wild but wildSlot is not set' };
  }
  if (wildCount === 0 && wildSlot !== undefined) {
    return { ok: false, reason: 'wildSlot set but no wild in cards' };
  }

  // Try to validate as a set or run based on the natural cards.
  // The "effective" cards substitute the wild's representation for the wild card.
  const effective: Card[] = cards.map((c, i) => (i === wildSlot ? wildRepresents! : c));

  // Determine kind from the effective cards.
  const ranks = effective.map(rankOf);
  const allSameRank = ranks.every((r) => r === ranks[0]);

  if (allSameRank) {
    // Set: each card must be a different suit, all same rank.
    const suits = new Set(effective.map(suitOf));
    if (suits.size !== effective.length) {
      return { ok: false, reason: 'A set must have all different suits' };
    }
    if (effective.length > 4) {
      return { ok: false, reason: 'A set cannot contain more than 4 cards' };
    }
    return { ok: true, kind: 'set' };
  }

  // Run: same suit, consecutive ranks.
  const suits = new Set(effective.map(suitOf));
  if (suits.size !== 1) {
    return { ok: false, reason: 'A run must be all the same suit' };
  }
  // For aces-either, an A may sit at either end of a run but never wrap. Try each
  // candidate ace-positioning, sorting per-iteration since A's normalized rank changes.
  const candidates: ('low' | 'high')[] = acesMode === 'either' ? ['high', 'low'] : [acesMode];
  for (const mode of candidates) {
    const sortedRanks = [...effective.map(rankOf)].sort(
      (a, b) => normRank(a, mode) - normRank(b, mode),
    );
    let dup = false;
    for (let i = 1; i < sortedRanks.length; i++) {
      if (sortedRanks[i] === sortedRanks[i - 1]) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    if (isConsecutive(sortedRanks, mode)) {
      return { ok: true, kind: 'run' };
    }
  }
  return { ok: false, reason: 'Run must be consecutive same-suit cards (no wraparound)' };
}

function countWilds(cards: Card[], wildRank: Rank): number {
  let n = 0;
  for (const c of cards) if (rankOf(c) === wildRank) n++;
  return n;
}

/** Map a rank to its numeric position within a run. Aces are 0 (low) or 13 (high). */
function normRank(r: Rank, mode: AcesMode): number {
  if (r === 'A') return mode === 'low' ? 0 : 13;
  // 2..K -> 1..12, but we compute via rankIndex (A=0,2=1,...,K=12); subtract 0 for non-aces.
  return rankIndex(r);
}

function isConsecutive(ranksSorted: Rank[], mode: 'low' | 'high'): boolean {
  if (ranksSorted.length === 0) return false;
  let prev = normRank(ranksSorted[0]!, mode);
  for (let i = 1; i < ranksSorted.length; i++) {
    const cur = normRank(ranksSorted[i]!, mode);
    if (cur !== prev + 1) return false;
    prev = cur;
  }
  return true;
}

/**
 * Determine the natural card a wild represents in a *run*, given the run's other cards
 * and the wild's index. Useful when the player doesn't bother declaring (we infer it).
 *
 * Returns null if ambiguous or impossible.
 */
export function inferWildInRun(cards: Card[], wildSlot: number, mode: AcesMode): Card | null {
  // Determine the suit (must be unanimous among non-wilds).
  const suits = new Set<Suit>();
  for (let i = 0; i < cards.length; i++) {
    if (i !== wildSlot) suits.add(suitOf(cards[i]!));
  }
  if (suits.size !== 1) return null;
  const suit = [...suits][0]!;

  const candidates: ('low' | 'high')[] = mode === 'either' ? ['high', 'low'] : [mode];
  for (const m of candidates) {
    // Compute target rank by sequencing using known positions.
    // We sort indices by their (mode-aware) rank, treating wildSlot as unknown.
    const knownRanks: { idx: number; norm: number }[] = [];
    for (let i = 0; i < cards.length; i++) {
      if (i === wildSlot) continue;
      knownRanks.push({ idx: i, norm: normRank(rankOf(cards[i]!), m) });
    }
    knownRanks.sort((a, b) => a.norm - b.norm);
    // Determine if there's exactly one missing slot in a consecutive run including wildSlot.
    // We'll compute the full expected sequence min..min+len-1 and find the gap.
    if (knownRanks.length === 0) return null;
    const min = knownRanks[0]!.norm;
    const max = knownRanks[knownRanks.length - 1]!.norm;
    const fullLen = cards.length;
    // The missing rank must extend or fill the sequence.
    const possibleMissing: number[] = [];
    for (let v = min; v <= max; v++) {
      if (!knownRanks.some((k) => k.norm === v)) possibleMissing.push(v);
    }
    if (possibleMissing.length === 1 && max - min + 1 === fullLen) {
      const missing = possibleMissing[0]!;
      const card = unnormToCard(missing, suit, m);
      if (card) return card;
    } else if (possibleMissing.length === 0 && max - min + 1 === fullLen - 1) {
      // The wild sits at one of the ends.
      const candidatesAtEnds = [min - 1, max + 1].filter((v) => v >= 0 && v <= 13);
      // Prefer based on wildSlot position relative to sorted order.
      // Without ambiguity removal we just return one if there's exactly one valid.
      const valid = candidatesAtEnds
        .map((v) => unnormToCard(v, suit, m))
        .filter((x): x is Card => !!x);
      if (valid.length === 1) return valid[0]!;
      // If both ends are valid we cannot disambiguate without an explicit declaration.
      return null;
    }
  }
  return null;
}

function unnormToCard(norm: number, suit: Suit, mode: 'low' | 'high'): Card | null {
  // norm range valid: 0..13 (where 0=A-low, 13=A-high).
  if (norm < 0 || norm > 13) return null;
  if (norm === 0) {
    if (mode !== 'low') return null;
    return `A${suit}` as Card;
  }
  if (norm === 13) {
    if (mode !== 'high') return null;
    return `A${suit}` as Card;
  }
  const rank = RANKS[norm]!; // A=0, but we've handled aces above.
  return `${rank}${suit}` as Card;
}

/**
 * Determine which natural cards may extend a meld (used for layoffs).
 * Returns the set of cards that could be appended (canonical positions don't matter for
 * the caller — the meld is rebuilt with the new card).
 */
export function extensionsFor(meld: MeldShape, wildRank: Rank, acesMode: AcesMode): Card[] {
  const result: Card[] = [];
  if (meld.kind === 'set') {
    const r = rankOf(meld.cards.find((_, i) => i !== meld.wildSlot)!);
    const usedSuits = new Set(
      meld.cards.map((c, i) => (i === meld.wildSlot ? suitOf(meld.wildRepresents!) : suitOf(c))),
    );
    for (const s of ['S', 'H', 'D', 'C'] as Suit[]) {
      if (!usedSuits.has(s)) result.push(`${r}${s}` as Card);
    }
    return result;
  }
  // Run: figure out the suit and current min/max norm using wildRepresents to fill.
  const suit = suitOf(meld.cards.find((_, i) => i !== meld.wildSlot)!);
  const candidatesMode: ('low' | 'high')[] = acesMode === 'either' ? ['high', 'low'] : [acesMode];
  for (const mode of candidatesMode) {
    const norms = meld.cards.map((c, i) =>
      i === meld.wildSlot
        ? normRank(rankOf(meld.wildRepresents!), mode)
        : normRank(rankOf(c), mode),
    );
    const min = Math.min(...norms);
    const max = Math.max(...norms);
    const candidates = [min - 1, max + 1].filter((v) => v >= 0 && v <= 13);
    for (const v of candidates) {
      const c = unnormToCard(v, suit, mode);
      if (c && !result.includes(c) && !meld.cards.includes(c) && rankOf(c) !== wildRank) {
        result.push(c);
      }
    }
  }
  return result;
}

export { normRank, parseCard };
