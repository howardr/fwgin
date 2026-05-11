import { describe, expect, it } from 'vitest';
import { canonicalizeMeld, extensionsFor, validateMeld } from './meld.js';

describe('validateMeld — sets', () => {
  it('accepts a 3-card set', () => {
    const r = validateMeld({ kind: 'set', cards: ['7S', '7H', '7D'] }, '2', 'high');
    expect(r).toEqual({ ok: true, kind: 'set' });
  });

  it('accepts a 4-card set', () => {
    const r = validateMeld({ kind: 'set', cards: ['7S', '7H', '7D', '7C'] }, '2', 'high');
    expect(r.ok).toBe(true);
  });

  it('rejects more than 4 in a set', () => {
    const r = validateMeld({ kind: 'set', cards: ['7S', '7H', '7D', '7C', '7S'] }, '2', 'high');
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate suits in a set', () => {
    const r = validateMeld({ kind: 'set', cards: ['7S', '7H', '7H'] }, '2', 'high');
    expect(r.ok).toBe(false);
  });

  it('accepts a set with a wild', () => {
    const r = validateMeld(
      { kind: 'set', cards: ['7S', '7H', '2C'], wildSlot: 2, wildRepresents: '7D' },
      '2',
      'high',
    );
    expect(r).toEqual({ ok: true, kind: 'set' });
  });

  it('rejects a wild representing a card already in the set', () => {
    const r = validateMeld(
      { kind: 'set', cards: ['7S', '7H', '2C'], wildSlot: 2, wildRepresents: '7H' },
      '2',
      'high',
    );
    expect(r.ok).toBe(false);
  });
});

describe('validateMeld — runs', () => {
  it('accepts a 3-card run', () => {
    const r = validateMeld({ kind: 'run', cards: ['5H', '6H', '7H'] }, '2', 'high');
    expect(r).toEqual({ ok: true, kind: 'run' });
  });

  it('rejects a run with mixed suits', () => {
    const r = validateMeld({ kind: 'run', cards: ['5H', '6H', '7D'] }, '2', 'high');
    expect(r.ok).toBe(false);
  });

  it('rejects a non-consecutive run', () => {
    const r = validateMeld({ kind: 'run', cards: ['5H', '7H', '8H'] }, '2', 'high');
    expect(r.ok).toBe(false);
  });

  it('accepts Q-K-A in aces=high mode', () => {
    const r = validateMeld({ kind: 'run', cards: ['QH', 'KH', 'AH'] }, '2', 'high');
    expect(r.ok).toBe(true);
  });

  it('rejects Q-K-A in aces=low mode', () => {
    const r = validateMeld({ kind: 'run', cards: ['QH', 'KH', 'AH'] }, '2', 'low');
    expect(r.ok).toBe(false);
  });

  it('accepts A-2-3 in aces=low', () => {
    // We need to ensure 2 is not the wild for this test — use round where wild is "3".
    const r = validateMeld({ kind: 'run', cards: ['AH', '2H', '3H'] }, 'K', 'low');
    expect(r.ok).toBe(true);
  });

  it('rejects A-2-3 in aces=high', () => {
    const r = validateMeld({ kind: 'run', cards: ['AH', '2H', '3H'] }, 'K', 'high');
    expect(r.ok).toBe(false);
  });

  it('accepts A-2-3 and Q-K-A in aces=either', () => {
    expect(validateMeld({ kind: 'run', cards: ['AH', '2H', '3H'] }, 'K', 'either').ok).toBe(true);
    expect(validateMeld({ kind: 'run', cards: ['QH', 'KH', 'AH'] }, '2', 'either').ok).toBe(true);
  });

  it('rejects wraparound K-A-2 in any mode', () => {
    expect(validateMeld({ kind: 'run', cards: ['KH', 'AH', '2H'] }, '3', 'high').ok).toBe(false);
    expect(validateMeld({ kind: 'run', cards: ['KH', 'AH', '2H'] }, '3', 'low').ok).toBe(false);
    expect(validateMeld({ kind: 'run', cards: ['KH', 'AH', '2H'] }, '3', 'either').ok).toBe(false);
  });

  it('accepts a run with a wild', () => {
    const r = validateMeld(
      { kind: 'run', cards: ['5H', '2C', '7H'], wildSlot: 1, wildRepresents: '6H' },
      '2',
      'high',
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a run where wild representation creates wrong suit', () => {
    const r = validateMeld(
      { kind: 'run', cards: ['5H', '2C', '7H'], wildSlot: 1, wildRepresents: '6D' },
      '2',
      'high',
    );
    expect(r.ok).toBe(false);
  });
});

describe('validateMeld — wild slot consistency', () => {
  it('rejects more than one wild', () => {
    const r = validateMeld(
      { kind: 'set', cards: ['7S', '2H', '2C'], wildSlot: 1, wildRepresents: '7H' },
      '2',
      'high',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects wildSlot pointing at non-wild card', () => {
    const r = validateMeld(
      { kind: 'set', cards: ['7S', '7H', '7D'], wildSlot: 0, wildRepresents: '7C' },
      '2',
      'high',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects wild without wildSlot declaration', () => {
    const r = validateMeld({ kind: 'set', cards: ['7S', '7H', '2D'] }, '2', 'high');
    expect(r.ok).toBe(false);
  });

  it('rejects wild representing another wild', () => {
    const r = validateMeld(
      { kind: 'set', cards: ['7S', '7H', '2C'], wildSlot: 2, wildRepresents: '2D' },
      '2',
      'high',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects too few cards', () => {
    expect(validateMeld({ kind: 'set', cards: ['7S', '7H'] }, '2', 'high').ok).toBe(false);
  });

  it('rejects duplicate physical cards', () => {
    expect(validateMeld({ kind: 'set', cards: ['7S', '7S', '7H'] }, '2', 'high').ok).toBe(false);
  });
});

describe('canonicalizeMeld — sets', () => {
  it('orders a set by suit S/H/D/C regardless of input order', () => {
    const r = canonicalizeMeld({ kind: 'set', cards: ['7D', '7C', '7H', '7S'] }, 'high');
    expect(r.cards).toEqual(['7S', '7H', '7D', '7C']);
    expect(r.wildSlot).toBeUndefined();
  });

  it('places a wild at its represented suit position', () => {
    // Wild=2H representing 7C (a Club); should slot after 7D in S/H/D/C order.
    const r = canonicalizeMeld(
      { kind: 'set', cards: ['7H', '2H', '7S'], wildSlot: 1, wildRepresents: '7C' },
      'high',
    );
    expect(r.cards).toEqual(['7S', '7H', '2H']);
    expect(r.wildSlot).toBe(2);
  });

  it('places a wild that represents a middle suit between its neighbours', () => {
    // Wild=2C representing 7H (Hearts) in a set of {7S, 7H(via wild), 7D}.
    const r = canonicalizeMeld(
      { kind: 'set', cards: ['7D', '2C', '7S'], wildSlot: 1, wildRepresents: '7H' },
      'high',
    );
    expect(r.cards).toEqual(['7S', '2C', '7D']);
    expect(r.wildSlot).toBe(1);
  });

  it('is idempotent for an already-canonical set', () => {
    const r = canonicalizeMeld({ kind: 'set', cards: ['7S', '7H', '7D'] }, 'high');
    expect(r.cards).toEqual(['7S', '7H', '7D']);
  });
});

describe('canonicalizeMeld — runs', () => {
  it('sorts a 3-card run in ascending rank order', () => {
    const r = canonicalizeMeld({ kind: 'run', cards: ['7C', '5C', '6C'] }, 'high');
    expect(r.cards).toEqual(['5C', '6C', '7C']);
    expect(r.wildSlot).toBeUndefined();
  });

  it('places a wild representing a mid-run card between its neighbours', () => {
    // Wild=2D representing 6H sits between 5H and 7H.
    const r = canonicalizeMeld(
      { kind: 'run', cards: ['7H', '5H', '2D'], wildSlot: 2, wildRepresents: '6H' },
      'high',
    );
    expect(r.cards).toEqual(['5H', '2D', '7H']);
    expect(r.wildSlot).toBe(1);
  });

  it('places a wild representing the high end at the high end', () => {
    // Wild=2D representing 8H, run is 5H 6H 7H + W.
    const r = canonicalizeMeld(
      { kind: 'run', cards: ['2D', '5H', '6H', '7H'], wildSlot: 0, wildRepresents: '8H' },
      'high',
    );
    expect(r.cards).toEqual(['5H', '6H', '7H', '2D']);
    expect(r.wildSlot).toBe(3);
  });

  it('places a wild representing the low end at the low end', () => {
    // Wild=2D representing 4H, run is W + 5H 6H 7H.
    const r = canonicalizeMeld(
      { kind: 'run', cards: ['5H', '6H', '7H', '2D'], wildSlot: 3, wildRepresents: '4H' },
      'high',
    );
    expect(r.cards).toEqual(['2D', '5H', '6H', '7H']);
    expect(r.wildSlot).toBe(0);
  });

  it('orders a low-ace run as A-2-3 when acesMode=low', () => {
    const r = canonicalizeMeld({ kind: 'run', cards: ['3H', 'AH', '2H'] }, 'low');
    expect(r.cards).toEqual(['AH', '2H', '3H']);
  });

  it('orders a high-ace run as Q-K-A when acesMode=high', () => {
    const r = canonicalizeMeld({ kind: 'run', cards: ['AH', 'QH', 'KH'] }, 'high');
    expect(r.cards).toEqual(['QH', 'KH', 'AH']);
  });

  it('picks the right ace orientation in acesMode=either', () => {
    expect(canonicalizeMeld({ kind: 'run', cards: ['3H', 'AH', '2H'] }, 'either').cards).toEqual([
      'AH',
      '2H',
      '3H',
    ]);
    expect(canonicalizeMeld({ kind: 'run', cards: ['AH', 'QH', 'KH'] }, 'either').cards).toEqual([
      'QH',
      'KH',
      'AH',
    ]);
  });

  it('is idempotent for an already-canonical run', () => {
    const r = canonicalizeMeld({ kind: 'run', cards: ['5H', '6H', '7H'] }, 'high');
    expect(r.cards).toEqual(['5H', '6H', '7H']);
  });
});

describe('extensionsFor', () => {
  it('finds set extensions', () => {
    const r = extensionsFor({ kind: 'set', cards: ['7S', '7H', '7D'] }, '2', 'high');
    expect(r).toContain('7C');
    expect(r).toHaveLength(1);
  });

  it('finds set extensions with a wild filling a suit', () => {
    const r = extensionsFor(
      { kind: 'set', cards: ['7S', '7H', '2C'], wildSlot: 2, wildRepresents: '7D' },
      '2',
      'high',
    );
    expect(r).toEqual(['7C']);
  });

  it('finds run extensions on both ends', () => {
    const r = extensionsFor({ kind: 'run', cards: ['5H', '6H', '7H'] }, '2', 'high');
    expect(r).toContain('4H');
    expect(r).toContain('8H');
  });

  it('caps run at the high end (K)', () => {
    const r = extensionsFor({ kind: 'run', cards: ['JH', 'QH', 'KH'] }, '2', 'high');
    expect(r).toContain('TH');
    // No card above K in aces=high (A would be Q-K-A which is the only ace position).
    // Aces high lets us extend with A.
    expect(r).toContain('AH');
  });

  it('caps run at the low end (A) for aces=low', () => {
    const r = extensionsFor({ kind: 'run', cards: ['2H', '3H', '4H'] }, 'K', 'low');
    expect(r).toContain('5H');
    expect(r).toContain('AH');
  });
});
