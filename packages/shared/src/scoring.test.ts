import { describe, expect, it } from 'vitest';
import { cardValue, handValue } from './scoring.js';

describe('scoring.cardValue', () => {
  it('faces are 10', () => {
    expect(cardValue('TH', '2', 'high')).toBe(10);
    expect(cardValue('JH', '2', 'high')).toBe(10);
    expect(cardValue('QH', '2', 'high')).toBe(10);
    expect(cardValue('KH', '2', 'high')).toBe(10);
  });

  it('digits are face value', () => {
    expect(cardValue('2H', '7', 'high')).toBe(2);
    expect(cardValue('9H', '7', 'high')).toBe(9);
  });

  it('Ace is 1 in low mode', () => {
    expect(cardValue('AH', '2', 'low')).toBe(1);
  });

  it('Ace is 13 in high or either mode', () => {
    expect(cardValue('AH', '2', 'high')).toBe(13);
    expect(cardValue('AH', '2', 'either')).toBe(13);
  });

  it('wild rank is 25', () => {
    expect(cardValue('7H', '7', 'high')).toBe(25);
    expect(cardValue('AH', 'A', 'high')).toBe(25);
  });
});

describe('scoring.handValue', () => {
  it('sums correctly', () => {
    expect(handValue(['2H', '5C', 'TS'], '7', 'high')).toBe(17);
  });

  it('counts wilds at 25', () => {
    expect(handValue(['7H', '5C'], '7', 'high')).toBe(30);
  });

  it('empty hand is 0', () => {
    expect(handValue([], '7', 'high')).toBe(0);
  });
});
