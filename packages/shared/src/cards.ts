/**
 * Cards, suits, ranks, and a standard 52-card deck.
 *
 * Cards are represented as compact strings of the form `<rank><suit>`, e.g. `"7H"`, `"TC"`,
 * `"AS"`. Ranks 2-9 use their digit; T/J/Q/K/A use those letters. Suits are S/H/D/C.
 *
 * Storing cards as strings keeps state JSON-friendly (good for DO storage and the wire
 * format) while still being trivially destructurable via {@link parseCard}.
 */

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

/** Card identifier, e.g. `"AS"`, `"TD"`, `"7C"`. */
export type Card = `${Rank}${Suit}`;

const RANK_INDEX: Record<Rank, number> = {
  A: 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
  '8': 7,
  '9': 8,
  T: 9,
  J: 10,
  Q: 11,
  K: 12,
};

export function parseCard(card: Card): { rank: Rank; suit: Suit } {
  const rank = card[0] as Rank;
  const suit = card[1] as Suit;
  return { rank, suit };
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** Stable numeric index for a rank, A=0, 2=1, ..., K=12. Useful for run-detection. */
export function rankIndex(rank: Rank): number {
  return RANK_INDEX[rank];
}

/** Build a fresh, sorted 52-card deck. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

/** Round number (1-13) to the rank that is wild for that round. */
export function wildRankForRound(round: number): Rank {
  // Round 1 -> "2", Round 2 -> "3", ..., Round 12 -> "K", Round 13 -> "A".
  if (round < 1 || round > 13 || !Number.isInteger(round)) {
    throw new Error(`Invalid round: ${round}`);
  }
  // RANKS = [A, 2, 3, ..., K]. We want round 1 -> "2" (index 1), round 13 -> "A" (index 0).
  if (round === 13) return 'A';
  return RANKS[round]!;
}

/** Convenience: card -> human-readable name (used in events/log strings). */
export function cardName(card: Card): string {
  const { rank, suit } = parseCard(card);
  const rankNames: Record<Rank, string> = {
    A: 'Ace',
    '2': 'Two',
    '3': 'Three',
    '4': 'Four',
    '5': 'Five',
    '6': 'Six',
    '7': 'Seven',
    '8': 'Eight',
    '9': 'Nine',
    T: 'Ten',
    J: 'Jack',
    Q: 'Queen',
    K: 'King',
  };
  const suitNames: Record<Suit, string> = {
    S: 'Spades',
    H: 'Hearts',
    D: 'Diamonds',
    C: 'Clubs',
  };
  return `${rankNames[rank]} of ${suitNames[suit]}`;
}
