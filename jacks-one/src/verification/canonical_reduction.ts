import { DECK } from '../core/card.ts';
import type { Card } from '../core/card.ts';
import { createHand, canonicalizeHand } from '../core/hand.ts';

/**
 * Validates the mathematical reduction of 2,598,960 initial five-card hands
 * into the 134,459 canonical suit-isomorphic equivalence classes.
 */

export interface CanonicalReductionStats {
  totalCombinations: number; // 2,598,960
  canonicalClasses: number;  // 134,459
  compressionRatio: number;  // ~19.328
}

/**
 * Fast canonical key using 24-permutation minimization.
 */
export function getCanonicalHandKey(c0: number, c1: number, c2: number, c3: number, c4: number): number {
  // Input: 5 distinct card IDs (0..51)
  const r0 = Math.floor(c0 / 4);
  const s0 = c0 % 4;
  const r1 = Math.floor(c1 / 4);
  const s1 = c1 % 4;
  const r2 = Math.floor(c2 / 4);
  const s2 = c2 % 4;
  const r3 = Math.floor(c3 / 4);
  const s3 = c3 % 4;
  const r4 = Math.floor(c4 / 4);
  const s4 = c4 % 4;

  const suitPerms = [
    [0,1,2,3], [0,1,3,2], [0,2,1,3], [0,2,3,1], [0,3,1,2], [0,3,2,1],
    [1,0,2,3], [1,0,3,2], [1,2,0,3], [1,2,3,0], [1,3,0,2], [1,3,2,0],
    [2,0,1,3], [2,0,3,1], [2,1,0,3], [2,1,3,0], [2,3,0,1], [2,3,1,0],
    [3,0,1,2], [3,0,2,1], [3,1,0,2], [3,1,2,0], [3,2,0,1], [3,2,1,0],
  ];

  let minKey = Number.MAX_SAFE_INTEGER;

  for (let p = 0; p < 24; p++) {
    const perm = suitPerms[p];
    let k0 = r0 * 4 + perm[s0];
    let k1 = r1 * 4 + perm[s1];
    let k2 = r2 * 4 + perm[s2];
    let k3 = r3 * 4 + perm[s3];
    let k4 = r4 * 4 + perm[s4];

    // Sorting 5 integers (simple insertion sort)
    if (k0 > k1) { const t = k0; k0 = k1; k1 = t; }
    if (k1 > k2) { const t = k1; k1 = k2; k2 = t; }
    if (k2 > k3) { const t = k2; k2 = k3; k3 = t; }
    if (k3 > k4) { const t = k3; k3 = k4; k4 = t; }
    if (k0 > k1) { const t = k0; k0 = k1; k1 = t; }
    if (k1 > k2) { const t = k1; k1 = k2; k2 = t; }
    if (k2 > k3) { const t = k2; k2 = k3; k3 = t; }
    if (k0 > k1) { const t = k0; k0 = k1; k1 = t; }
    if (k1 > k2) { const t = k1; k1 = k2; k2 = t; }
    if (k0 > k1) { const t = k0; k0 = k1; k1 = t; }

    // Combine 5 card IDs (each 0..51, fits in 6 bits: 30 bits total)
    const key = (k0) | (k1 << 6) | (k2 << 12) | (k3 << 18) | (k4 << 24);
    if (key < minKey) {
      minKey = key;
    }
  }

  return minKey;
}
