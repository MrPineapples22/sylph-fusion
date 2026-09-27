/**
 * SYLPH FUSION — HOLDERROOT: Exact Holder Concentration Authority
 * Specifications: Sections 11, 12, 92, 93, 103 (Invariant 11)
 *
 * Solves the top-holder false-veto problem:
 * - Never assume known top holders + entire unknown tail = concentrated.
 * - Distinguishes 3 census levels: FAST_BOUND, FULL_ACCOUNT_CENSUS, INDEXED_OWNER_CENSUS.
 * - Excludes certified protocol inventory (bonding curve PDAs, PumpSwap reserves, burn accounts).
 * - Computes Top1, Top3, Top10, HHI (Herfindahl-Hirschman Index), holder count, and unknown-tail confidence.
 * - Out-of-bounds concentration outputs: SAFE, UNSAFE, AMBIGUOUS (ambiguity != malicious).
 */

import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

export type CensusLevel = 'FAST_BOUND' | 'FULL_ACCOUNT_CENSUS' | 'INDEXED_OWNER_CENSUS';
export type HolderConcentrationStatus = 'SAFE' | 'UNSAFE' | 'AMBIGUOUS';

export interface ProtocolInventory {
  readonly bondingCurveAta?: string;
  readonly bondingCurvePda?: string;
  readonly ammPoolVault?: string;
  readonly customEscrows?: readonly string[];
}

export interface HolderMetrics {
  readonly top1Raw: bigint;
  readonly top1Bps: number;
  readonly top3Raw: bigint;
  readonly top3Bps: number;
  readonly top10Raw: bigint;
  readonly top10Bps: number;
  readonly hhi: number; // 0 to 10000 (Herfindahl-Hirschman Index)
  readonly nonProtocolSupply: bigint;
  readonly protocolInventoryRaw: bigint;
  readonly observedNonProtocolRaw: bigint;
  readonly unknownTailRaw: bigint;
  readonly unknownTailConfidence: number; // 0.0 to 1.0
  readonly uniqueHolderCount: number;
}

export interface HolderConcentrationCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly level: CensusLevel;
  readonly status: HolderConcentrationStatus;
  readonly metrics: HolderMetrics;
  readonly evaluatedAtMs: number;
  readonly reason: string;
}

export interface RawHolderAccount {
  readonly address: string;
  readonly owner: string;
  readonly amount: bigint;
}

// Certified system burn addresses on Solana
const SYSTEM_BURN_ADDRESSES = new Set<string>([
  '11111111111111111111111111111111',
  '11111111111111111111111111111112',
  'deaddeaddeaddeaddeaddeaddeaddeaddeaddead',
]);

/**
 * Evaluates Fast Bound holder concentration from bounded account samples (e.g. getTokenLargestAccounts).
 * Follows exact mathematical proof:
 * 1. Exclude protocol inventory (bonding curve, AMM pool, burn accounts).
 * 2. Calculate non-protocol circulating supply.
 * 3. Worst-case top 10 = known top 10 + unknown tail.
 * 4. If worst-case top 10 <= maxAllowed: Provably SAFE.
 * 5. If known top 10 > maxAllowed: Provably UNSAFE.
 * 6. Otherwise: AMBIGUOUS (evaluate unknown tail confidence).
 */
export function assessFastBoundHolderConcentration(input: {
  readonly supply: bigint;
  readonly observedRaw: bigint;
  readonly knownTopTenRaw: bigint;
  readonly maxTopTenBps: number;
  readonly protocolInventoryRaw?: bigint;
}): {
  readonly level: 'FAST_BOUND';
  readonly status: HolderConcentrationStatus;
  readonly observedRaw: bigint;
  readonly knownTopTenRaw: bigint;
  readonly unknownTailRaw: bigint;
  readonly topTenBps: number;
  readonly reason: string;
} {
  const { supply, observedRaw, knownTopTenRaw, maxTopTenBps } = input;
  const protocolInventoryRaw = input.protocolInventoryRaw ?? 0n;

  if (supply <= 0n || observedRaw < 0n || knownTopTenRaw < 0n || observedRaw > supply) {
    throw new Error('inconsistent holder snapshot');
  }

  // Base calculation on non-protocol circulating supply
  const nonProtocolSupply = supply > protocolInventoryRaw ? supply - protocolInventoryRaw : supply;
  const maxAllowedRaw = (nonProtocolSupply * BigInt(maxTopTenBps)) / 10_000n;

  if (knownTopTenRaw > maxAllowedRaw) {
    const topTenBps = Number((knownTopTenRaw * 10_000n) / (nonProtocolSupply > 0n ? nonProtocolSupply : 1n));
    return {
      level: 'FAST_BOUND',
      status: 'UNSAFE',
      observedRaw,
      knownTopTenRaw,
      unknownTailRaw: supply - observedRaw,
      topTenBps,
      reason: `Observed top-10 concentration (${topTenBps} bps) exceeds limit (${maxTopTenBps} bps)`,
    };
  }

  const unknownTailRaw = supply - observedRaw;
  const worstCaseTopTenRaw = knownTopTenRaw + unknownTailRaw;
  const topTenBps = Number((knownTopTenRaw * 10_000n) / (nonProtocolSupply > 0n ? nonProtocolSupply : 1n));

  // Mathematical proof of SAFE: Even if 100% of unknown tail belonged to top 10, it cannot exceed the cap.
  if (worstCaseTopTenRaw <= maxAllowedRaw) {
    return {
      level: 'FAST_BOUND',
      status: 'SAFE',
      observedRaw,
      knownTopTenRaw,
      unknownTailRaw,
      topTenBps,
      reason: `Worst-case top-10 concentration (${Number((worstCaseTopTenRaw * 10_000n) / nonProtocolSupply)} bps) mathematically bounded within limit (${maxTopTenBps} bps)`,
    };
  }

  // Bounded query is ambiguous: Known holders are within limit, but worst-case exceeds limit.
  return {
    level: 'FAST_BOUND',
    status: unknownTailRaw === 0n ? 'SAFE' : 'AMBIGUOUS',
    observedRaw,
    knownTopTenRaw,
    unknownTailRaw,
    topTenBps,
    reason: `Observed top-10 is ${topTenBps} bps, but unobserved tail (${unknownTailRaw} raw units) requires full census certification`,
  };
}

/**
 * Authoritative HOLDERROOT Engine:
 * Aggregates token accounts by economic owner, strips protocol inventory,
 * and calculates exact HHI and multi-tier concentration metrics.
 */
export class HolderRootAuthority {
  private certificates = new Map<string, HolderConcentrationCertificate>();

  /**
   * Evaluates and produces an immutable HolderConcentrationCertificate.
   */
  public evaluateCensus(params: {
    mint: string;
    supply: bigint;
    accounts: readonly RawHolderAccount[];
    protocol: ProtocolInventory;
    maxTop1Bps?: number;
    maxTop3Bps?: number;
    maxTop10Bps?: number;
    maxHhi?: number;
  }): HolderConcentrationCertificate {
    const { mint, supply, accounts, protocol } = params;
    const maxTop1Bps = params.maxTop1Bps ?? 2000;  // 20%
    const maxTop3Bps = params.maxTop3Bps ?? 4000;  // 40%
    const maxTop10Bps = params.maxTop10Bps ?? 6000; // 60%
    const maxHhi = params.maxHhi ?? 2500;          // Standard antitrust moderate concentration cutoff

    // Build exclusion set for protocol inventory
    const protocolSet = new Set<string>();
    if (protocol.bondingCurveAta) protocolSet.add(protocol.bondingCurveAta);
    if (protocol.bondingCurvePda) protocolSet.add(protocol.bondingCurvePda);
    if (protocol.ammPoolVault) protocolSet.add(protocol.ammPoolVault);
    if (protocol.customEscrows) {
      for (const e of protocol.customEscrows) protocolSet.add(e);
    }
    for (const burn of SYSTEM_BURN_ADDRESSES) {
      protocolSet.add(burn);
    }

    // Aggregate by economic owner
    const ownerBalances = new Map<string, bigint>();
    let protocolInventoryRaw = 0n;
    let observedTotalRaw = 0n;

    for (const acc of accounts) {
      observedTotalRaw += acc.amount;
      if (protocolSet.has(acc.address) || protocolSet.has(acc.owner)) {
        protocolInventoryRaw += acc.amount;
        continue;
      }
      const existing = ownerBalances.get(acc.owner) ?? 0n;
      ownerBalances.set(acc.owner, existing + acc.amount);
    }

    const nonProtocolSupply = supply > protocolInventoryRaw ? supply - protocolInventoryRaw : supply;
    const observedNonProtocolRaw = observedTotalRaw > protocolInventoryRaw ? observedTotalRaw - protocolInventoryRaw : 0n;
    const unknownTailRaw = nonProtocolSupply > observedNonProtocolRaw ? nonProtocolSupply - observedNonProtocolRaw : 0n;

    // Sort balances descending
    const sortedBalances = [...ownerBalances.values()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    const uniqueHolderCount = sortedBalances.length;

    const top1Raw = sortedBalances[0] ?? 0n;
    const top3Raw = sortedBalances.slice(0, 3).reduce((acc, v) => acc + v, 0n);
    const top10Raw = sortedBalances.slice(0, 10).reduce((acc, v) => acc + v, 0n);

    const safeDenominator = nonProtocolSupply > 0n ? nonProtocolSupply : 1n;
    const top1Bps = Number((top1Raw * 10_000n) / safeDenominator);
    const top3Bps = Number((top3Raw * 10_000n) / safeDenominator);
    const top10Bps = Number((top10Raw * 10_000n) / safeDenominator);

    // Compute HHI (sum of squared market percentages: 0 to 10,000)
    let hhi = 0;
    for (const bal of sortedBalances) {
      const sharePct = Number((bal * 10_000n) / safeDenominator) / 100; // e.g. 15.5%
      hhi += sharePct * sharePct;
    }
    hhi = Math.round(hhi);

    // Unknown tail confidence: fraction of non-protocol supply observed + holder diversity
    const coverageRatio = nonProtocolSupply > 0n
      ? Number(observedNonProtocolRaw) / Number(nonProtocolSupply)
      : 1.0;
    const unknownTailConfidence = Math.min(1.0, Math.max(0.0, coverageRatio * (uniqueHolderCount >= 20 ? 1.0 : uniqueHolderCount / 20)));

    // Determine status
    let status: HolderConcentrationStatus = 'SAFE';
    let reason = 'Holder distribution within certified safety bounds';

    if (top1Bps > maxTop1Bps) {
      status = 'UNSAFE';
      reason = `Top-1 holder owns ${top1Bps} bps (limit ${maxTop1Bps} bps)`;
    } else if (top3Bps > maxTop3Bps) {
      status = 'UNSAFE';
      reason = `Top-3 holders own ${top3Bps} bps (limit ${maxTop3Bps} bps)`;
    } else if (top10Bps > maxTop10Bps) {
      status = 'UNSAFE';
      reason = `Top-10 holders own ${top10Bps} bps (limit ${maxTop10Bps} bps)`;
    } else if (hhi > maxHhi && uniqueHolderCount < 15) {
      status = 'UNSAFE';
      reason = `HHI concentration index ${hhi} exceeds threshold ${maxHhi} with low holder count (${uniqueHolderCount})`;
    } else if (unknownTailRaw > 0n && (top10Raw + unknownTailRaw) > (nonProtocolSupply * BigInt(maxTop10Bps)) / 10_000n) {
      if (coverageRatio < 0.85) {
        status = 'AMBIGUOUS';
        reason = `Unobserved tail (${Number(unknownTailRaw) / 1e6}M units, coverage ${(coverageRatio * 100).toFixed(1)}%) requires extended census`;
      }
    }

    const certId = createHash('sha256')
      .update(`${mint}:${status}:${top10Bps}:${hhi}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16);

    const certificate: HolderConcentrationCertificate = {
      certificateId: `HCERT-${certId}`,
      mint,
      level: accounts.length > 20 ? 'FULL_ACCOUNT_CENSUS' : 'FAST_BOUND',
      status,
      metrics: {
        top1Raw,
        top1Bps,
        top3Raw,
        top3Bps,
        top10Raw,
        top10Bps,
        hhi,
        nonProtocolSupply,
        protocolInventoryRaw,
        observedNonProtocolRaw,
        unknownTailRaw,
        unknownTailConfidence,
        uniqueHolderCount,
      },
      evaluatedAtMs: Date.now(),
      reason,
    };

    this.certificates.set(mint, certificate);
    return certificate;
  }

  public getCertificate(mint: string): HolderConcentrationCertificate | undefined {
    return this.certificates.get(mint);
  }
}

export const globalHolderRoot = new HolderRootAuthority();
