/**
 * Visual representation of a single card, plus a face-down variant.
 */

import { type Card as CardId, type Rank, parseCard } from '@fwgin/shared';

const SUIT_GLYPH: Record<string, string> = {
  S: '\u2660',
  H: '\u2665',
  D: '\u2666',
  C: '\u2663',
};
const RED_SUITS = new Set(['H', 'D']);

export interface CardProps {
  card: CardId;
  selected?: boolean;
  isWild?: boolean;
  onClick?(): void;
  draggable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}

export function CardFace({ card, selected, isWild, onClick, size = 'md', title }: CardProps) {
  const { rank, suit } = parseCard(card);
  const red = RED_SUITS.has(suit);
  const className = [
    'card',
    `card-${size}`,
    red ? 'card-red' : 'card-black',
    selected ? 'card-selected' : '',
    isWild ? 'card-wild' : '',
    onClick ? 'card-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={title ?? card}
      tabIndex={onClick ? 0 : -1}
      aria-pressed={selected ? 'true' : undefined}
    >
      <span className="card-rank">{displayRank(rank)}</span>
      <span className="card-suit">{SUIT_GLYPH[suit]}</span>
    </button>
  );
}

export function CardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`card card-${size} card-back`} aria-hidden />;
}

function displayRank(r: Rank): string {
  if (r === 'T') return '10';
  return r;
}
