/**
 * The stock and discard piles, side-by-side. The stock shows a face-down card and a
 * count; the discard shows the visible top cards (per `discardVisibility`).
 */

import type { Card as CardId } from '@fwgin/shared';
import { CardBack, CardFace } from './Card.js';

export interface PileProps {
  stockCount: number;
  discard: CardId[];
  discardTotal: number;
  onDrawStock?(): void;
  onDrawDiscard?(): void;
}

export function Pile({ stockCount, discard, discardTotal, onDrawStock, onDrawDiscard }: PileProps) {
  const top = discard[discard.length - 1];
  return (
    <div className="pile-row">
      <div className="pile">
        <div className="pile-label">Stock ({stockCount})</div>
        {stockCount > 0 ? (
          <button
            type="button"
            className="pile-action"
            onClick={onDrawStock}
            disabled={!onDrawStock}
          >
            <CardBack size="md" />
          </button>
        ) : (
          <div className="card-empty card-md" aria-label="empty stock" />
        )}
      </div>
      <div className="pile">
        <div className="pile-label">Discard ({discardTotal})</div>
        {top ? (
          <button
            type="button"
            className="pile-action"
            onClick={onDrawDiscard}
            disabled={!onDrawDiscard}
          >
            <CardFace card={top} size="md" />
          </button>
        ) : (
          <div className="card-empty card-md" aria-label="empty discard" />
        )}
        {discard.length > 1 && (
          <div className="discard-history">
            {discard.slice(0, -1).map((c) => (
              // Each card appears at most once in the discard pile in our variant, so the
              // card id is a stable key.
              <CardFace key={c} card={c} size="sm" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
