import type { Card } from './card.ts';

/**
 * HoldMask: Represents which of the 5 cards in an initial hand are held.
 * Value is a 5-bit integer (0..31).
 * Bit i (0 <= i < 5): (mask & (1 << i)) !== 0 means hand[i] is HELD.
 */

export interface HoldMaskInfo {
  readonly mask: number; // 0..31
  readonly heldCount: number; // 0..5
  readonly drawCount: number; // 5 - heldCount
  readonly bitString: string; // e.g. "10100" (where 1 is held)
}

export const ALL_HOLD_MASKS: readonly HoldMaskInfo[] = Array.from({ length: 32 }, (_, mask) => {
  let count = 0;
  let bitString = '';
  for (let i = 0; i < 5; i++) {
    if ((mask & (1 << i)) !== 0) {
      count++;
      bitString += '1';
    } else {
      bitString += '0';
    }
  }
  return Object.freeze({
    mask,
    heldCount: count,
    drawCount: 5 - count,
    bitString,
  });
});

export function getHoldMaskInfo(mask: number): HoldMaskInfo {
  if (mask < 0 || mask > 31 || !Number.isInteger(mask)) {
    throw new Error(`Invalid hold mask: ${mask}. Must be integer 0..31.`);
  }
  return ALL_HOLD_MASKS[mask];
}

export function maskFromIndices(indices: number[]): number {
  let mask = 0;
  for (const idx of indices) {
    if (idx < 0 || idx >= 5) {
      throw new Error(`Card index out of bounds: ${idx}. Must be 0..4.`);
    }
    mask |= (1 << idx);
  }
  return mask;
}

export function getHeldCards(hand: readonly Card[], mask: number): Card[] {
  const held: Card[] = [];
  for (let i = 0; i < 5; i++) {
    if ((mask & (1 << i)) !== 0) {
      held.push(hand[i]);
    }
  }
  return held;
}

export function getDiscardedCards(hand: readonly Card[], mask: number): Card[] {
  const discarded: Card[] = [];
  for (let i = 0; i < 5; i++) {
    if ((mask & (1 << i)) === 0) {
      discarded.push(hand[i]);
    }
  }
  return discarded;
}
