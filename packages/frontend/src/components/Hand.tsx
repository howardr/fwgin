/**
 * The current player's hand.
 *
 * Cards are clickable (toggles into a "selected" set the caller uses for actions like
 * lay-meld and discard) and draggable (lets the player rearrange their hand for their
 * own organization — purely local UI state, never sent to the server).
 *
 * Click vs drag is distinguished by a small movement threshold: if the pointer moves
 * less than DRAG_THRESHOLD_PX between down and up, the gesture is treated as a click.
 *
 * The hand displayed here is computed from two inputs:
 *   - `hand`: the authoritative server-side hand for this player (order from server)
 *   - `customOrder`: the player's own preferred ordering, applied on top
 *
 * If `customOrder` is empty, cards are shown in the default suit/rank sort. Once the
 * player drags any card, `customOrder` becomes set and remains stable. Cards that leave
 * the hand (discarded, melded) are removed from the order automatically; cards that
 * arrive (drawn, taken from discard) are appended to the right end.
 */

import { type Card as CardId, type Rank, rankOf } from '@fwgin/shared';
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CardFace } from './Card.js';

export interface HandProps {
  hand: CardId[];
  selected: CardId[];
  wildRank: Rank | null;
  /** Player's preferred order. Empty = use default sort. */
  customOrder: CardId[];
  onToggle(card: CardId): void;
  /** Called whenever the user finishes a drag that produces a new ordering. */
  onReorder(next: CardId[]): void;
}

interface DragState {
  cardIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  /** Crosses the threshold at which we declare this gesture a drag (vs click). */
  isDragging: boolean;
  /** Insertion gap index in [0, displayHand.length] inclusive. */
  dropTargetGap: number;
}

const DRAG_THRESHOLD_PX = 6;

export function Hand({ hand, selected, wildRank, customOrder, onToggle, onReorder }: HandProps) {
  const displayHand = useMemo(() => computeDisplayHand(hand, customOrder), [hand, customOrder]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());
  // Set when a drag finishes, to swallow the synthetic click event the browser fires
  // immediately after pointerup on the same element (we don't want a drag-then-release
  // to also toggle selection).
  const suppressClickRef = useRef(false);

  function setCardRef(idx: number, el: HTMLElement | null) {
    if (el) cardRefs.current.set(idx, el);
    else cardRefs.current.delete(idx);
  }

  function handlePointerDown(idx: number, ev: ReactPointerEvent<HTMLDivElement>) {
    // Mouse: only respond to the primary (left) button.
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setDragState({
      cardIndex: idx,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      currentX: ev.clientX,
      currentY: ev.clientY,
      isDragging: false,
      dropTargetGap: idx,
    });
  }

  function handlePointerMove(ev: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    const crossed =
      dragState.isDragging || dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
    if (!crossed) return;
    // Exclude the dragged card from the search — its bounding rect tracks the pointer
    // (because of the translate transform) so it would always win the closest-card
    // contest, leading to no-op drops. We want the closest *non-dragged* neighbor.
    const dropTargetGap = computeDropTargetGap(
      ev.clientX,
      ev.clientY,
      cardRefs.current,
      displayHand.length,
      dragState.cardIndex,
    );
    setDragState({
      ...dragState,
      currentX: ev.clientX,
      currentY: ev.clientY,
      isDragging: true,
      dropTargetGap,
    });
  }

  function endDrag(ev: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    if (dragState.isDragging) {
      // Suppress the upcoming click event so the drop doesn't also toggle selection.
      suppressClickRef.current = true;
      if (commit) {
        const next = reorder(displayHand, dragState.cardIndex, dragState.dropTargetGap);
        if (next !== displayHand) onReorder(next);
      }
    }
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    } catch {
      /* element may already have lost capture; ignore */
    }
    setDragState(null);
  }

  function handleClickCapture(ev: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      ev.preventDefault();
      ev.stopPropagation();
      suppressClickRef.current = false;
    }
  }

  return (
    <div className="hand" onClickCapture={handleClickCapture}>
      {displayHand.map((card, i) => {
        const isThisDragging = dragState?.cardIndex === i && dragState.isDragging;
        const showLeftIndicator = shouldShowIndicator(dragState, i);
        // Lifted look while dragging: translate + slight scale and tilt + heavier
        // shadow make the dragged card visually "above" the others, and reinforce that
        // the card under the pointer is the one being moved.
        const wrapperStyle = isThisDragging
          ? ({
              transform: `translate(${dragState.currentX - dragState.startX}px, ${
                dragState.currentY - dragState.startY
              }px) rotate(-3deg) scale(1.06)`,
              zIndex: 10,
              opacity: 0.95,
              touchAction: 'none',
              filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.55))',
            } as const)
          : ({ touchAction: 'none' } as const);
        return (
          <Fragment key={card}>
            {showLeftIndicator && <span className="drop-indicator" aria-hidden />}
            <div
              className={`hand-card${isThisDragging ? ' hand-card-dragging' : ''}`}
              style={wrapperStyle}
              ref={(el) => setCardRef(i, el)}
              onPointerDown={(e) => handlePointerDown(i, e)}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => endDrag(e, true)}
              onPointerCancel={(e) => endDrag(e, false)}
            >
              <CardFace
                card={card}
                selected={selected.includes(card)}
                isWild={wildRank !== null && rankOf(card) === wildRank}
                onClick={() => onToggle(card)}
                size="md"
              />
            </div>
          </Fragment>
        );
      })}
      {shouldShowIndicator(dragState, displayHand.length) && (
        <span className="drop-indicator" aria-hidden />
      )}
    </div>
  );
}

/**
 * Compose the hand's display order from server hand + user's custom ordering.
 * - When customOrder is empty, falls back to default suit/rank sort.
 * - Otherwise: keeps cards in customOrder, drops any no longer in hand, and appends
 *   any new arrivals at the right end (default-sorted relative to each other so the
 *   relative order of multiple new cards is stable).
 */
export function computeDisplayHand(hand: CardId[], customOrder: CardId[]): CardId[] {
  if (customOrder.length === 0) {
    return [...hand].sort(byRankSuit);
  }
  const handSet = new Set(hand);
  const ordered = customOrder.filter((c) => handSet.has(c));
  const orderedSet = new Set(ordered);
  const newCards = hand.filter((c) => !orderedSet.has(c)).sort(byRankSuit);
  return [...ordered, ...newCards];
}

/**
 * Find the closest gap (in [0, totalCards]) to the pointer's current position.
 * Iterates over rendered card rects (skipping `skipIdx` if provided — typically the
 * dragged card, whose rect tracks the pointer and would always win), picks the card
 * whose center is closest in 2D, then decides left or right gap based on which side
 * of that card's center the pointer is on. Wrap-friendly: the 2D-distance approach
 * naturally handles multi-row hands (the closest card is in the row nearest the
 * pointer's Y, and the X side-check picks the gap on that row).
 */
function computeDropTargetGap(
  pointerX: number,
  pointerY: number,
  cardRefs: Map<number, HTMLElement>,
  totalCards: number,
  skipIdx?: number,
): number {
  if (totalCards === 0) return 0;
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [idx, el] of cardRefs) {
    if (idx === skipIdx) continue;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = pointerX - cx;
    const dy = pointerY - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestIdx = idx;
    }
  }
  // Hand has only the dragged card (or refs are missing): no meaningful target.
  if (bestIdx === -1) return skipIdx ?? 0;
  const closest = cardRefs.get(bestIdx);
  if (!closest) return bestIdx;
  const rect = closest.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  return pointerX < cx ? bestIdx : bestIdx + 1;
}

/**
 * Move the item at `from` to gap `gapTo` (gap indices are 0..arr.length, where 0 is
 * before the first item and arr.length is after the last). Returns the same array if
 * the move would be a no-op.
 */
export function reorder<T>(arr: T[], from: number, gapTo: number): T[] {
  if (from === gapTo || from + 1 === gapTo) return arr;
  if (from < 0 || from >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  if (item === undefined) return arr;
  // If the source was before the target gap, removing it shifts the gap left by one.
  const insertAt = from < gapTo ? gapTo - 1 : gapTo;
  next.splice(insertAt, 0, item);
  return next;
}

/**
 * Drop indicator visibility: only show when actively dragging, when the pointer is at
 * a gap that would actually move the card (not adjacent to its current position).
 */
function shouldShowIndicator(dragState: DragState | null, gap: number): boolean {
  if (!dragState || !dragState.isDragging) return false;
  if (dragState.dropTargetGap !== gap) return false;
  if (gap === dragState.cardIndex) return false; // gap immediately before the source = no-op
  if (gap === dragState.cardIndex + 1) return false; // gap immediately after the source = no-op
  return true;
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
