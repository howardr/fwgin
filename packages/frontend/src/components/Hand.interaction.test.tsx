/**
 * Component-level regression tests for the Hand's pointer-based interaction model.
 *
 * The drag-to-reorder gesture calls `setPointerCapture` in `pointerdown`, which (per
 * the Pointer Events spec) redirects the synthetic `click` event to the captured
 * wrapper `<div>`. That means the inner `<button>`'s `onClick` never fires for
 * mouse/touch — `endDrag` has to invoke `onToggle` itself when the gesture has no
 * movement. These tests guard that behavior.
 *
 * jsdom does emulate `setPointerCapture` (without redirecting `click` itself), so
 * `endDrag`'s manual `onToggle` call is what we observe firing here. The fact that we
 * don't get a *double* toggle in jsdom is incidental — `suppressClickRef` is the
 * production-side guard for browsers that do bubble the click through.
 */

import type { Card } from '@fwgin/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hand } from './Hand.js';

afterEach(() => {
  cleanup();
});

function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX: number; clientY: number; pointerId?: number; button?: number } = {
    clientX: 0,
    clientY: 0,
  },
): PointerEvent {
  // jsdom doesn't ship a PointerEvent constructor; fall back to MouseEvent and stamp
  // the pointer-specific fields manually. fireEvent treats it as a pointer event
  // because we pass it through the matching firePointer* helper.
  const PointerCtor = (globalThis as unknown as { PointerEvent?: typeof PointerEvent })
    .PointerEvent;
  if (PointerCtor) {
    return new PointerCtor(type, {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
      clientX: init.clientX,
      clientY: init.clientY,
    });
  }
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  return ev as PointerEvent;
}

describe('Hand interaction (pointer-based)', () => {
  it('toggles selection when a card is clicked without movement', () => {
    const onToggle = vi.fn();
    const hand: Card[] = ['AS', 'KH', '7C'];
    render(
      <Hand
        hand={hand}
        selected={[]}
        wildRank={null}
        customOrder={[]}
        onToggle={onToggle}
        onReorder={() => undefined}
      />,
    );

    const cards = screen.getAllByRole('button');
    expect(cards.length).toBeGreaterThan(0);
    // Default sort puts AS first (suit S, rank A).
    const target = cards[0]!;
    const wrapper = target.closest('.hand-card') as HTMLElement;
    expect(wrapper).toBeTruthy();

    fireEvent(wrapper, pointerEvent('pointerdown', { clientX: 50, clientY: 50 }));
    fireEvent(wrapper, pointerEvent('pointerup', { clientX: 50, clientY: 50 }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('AS');
  });

  it('does NOT toggle selection when the gesture is a drag', () => {
    const onToggle = vi.fn();
    const onReorder = vi.fn();
    const hand: Card[] = ['AS', 'KH', '7C'];
    render(
      <Hand
        hand={hand}
        selected={[]}
        wildRank={null}
        customOrder={[]}
        onToggle={onToggle}
        onReorder={onReorder}
      />,
    );

    const wrapper = screen.getAllByRole('button')[0]!.closest('.hand-card') as HTMLElement;
    fireEvent(wrapper, pointerEvent('pointerdown', { clientX: 50, clientY: 50 }));
    // Move well past the 6px drag threshold.
    fireEvent(wrapper, pointerEvent('pointermove', { clientX: 200, clientY: 50 }));
    fireEvent(wrapper, pointerEvent('pointerup', { clientX: 200, clientY: 50 }));

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keyboard activation on the inner button still toggles selection', () => {
    const onToggle = vi.fn();
    const hand: Card[] = ['AS', 'KH', '7C'];
    render(
      <Hand
        hand={hand}
        selected={[]}
        wildRank={null}
        customOrder={[]}
        onToggle={onToggle}
        onReorder={() => undefined}
      />,
    );

    // Keyboard Enter on a focused button fires a click without any preceding pointer
    // events — so no pointer capture, no redirect, and the button's `onClick`
    // (which calls `onToggle`) fires normally.
    const button = screen.getAllByRole('button')[0]!;
    fireEvent.click(button);

    expect(onToggle).toHaveBeenCalledWith('AS');
  });
});
