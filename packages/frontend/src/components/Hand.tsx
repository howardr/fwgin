/**
 * The current player's hand. Cards are clickable and toggle into a "selected" set the
 * caller can use to trigger actions (lay meld, discard, etc.).
 */

import { type Card as CardId, type Rank, rankOf } from '@fwgin/shared';
import { CardFace } from './Card.js';

export interface HandProps {
  hand: CardId[];
  selected: CardId[];
  wildRank: Rank | null;
  onToggle(card: CardId): void;
}

export function Hand({ hand, selected, wildRank, onToggle }: HandProps) {
  const sorted = [...hand].sort(byRankSuit);
  return (
    <div className="hand">
      {sorted.map((c) => (
        <CardFace
          key={c}
          card={c}
          selected={selected.includes(c)}
          isWild={wildRank !== null && rankOf(c) === wildRank}
          onClick={() => onToggle(c)}
          size="md"
        />
      ))}
    </div>
  );
}

function byRankSuit(a: CardId, b: CardId): number {
  // Sort by suit (S, H, D, C) then rank.
  const order: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
  const sa = a[1]!;
  const sb = b[1]!;
  if (sa !== sb) return order[sa]! - order[sb]!;
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
  return ranks.indexOf(a[0]!) - ranks.indexOf(b[0]!);
}
