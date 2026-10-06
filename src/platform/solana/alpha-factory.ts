/**
 * SYLPH FUSION — SOLANA ALPHA CLAIM REGISTER & RESEARCH RANKER
 * Specification: Solana-Only Integration Blueprint (Section 45)
 *
 * This module compares strategy-supplied claims for research only. It has no
 * authenticated quote, risk, route, protocol-lease, or execution evidence and
 * therefore cannot identify an executable opportunity or authorize an entry.
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export const SOLANA_ALPHA_SPECIES = Object.freeze([
  'LAUNCH_INTELLIGENCE',
  'WALLET_INTELLIGENCE',
  'CREATOR_INTELLIGENCE',
  'ACTOR_GRAPHS',
  'MOMENTUM',
  'MEAN_REVERSION',
  'CROSS_DEX_ARBITRAGE',
  'TRIANGULAR_ARBITRAGE',
  'ROUTE_ARBITRAGE',
  'MARKET_MAKING',
  'LIQUIDITY_PROVISION',
  'MIGRATION_INTELLIGENCE',
  'GRADUATION_INTELLIGENCE',
  'CONGESTION_INTELLIGENCE',
  'FAILURE_INTELLIGENCE',
  'COMPETITION_INTELLIGENCE',
  'REFERENCE_MARKET_LEAD_LAG',
] as const);

export type SolanaAlphaSpecies = typeof SOLANA_ALPHA_SPECIES[number];

/** Values in this record are assertions by a strategy producer, not verified facts. */
export interface StrategyOpportunityClaim {
  readonly claimId: string;
  readonly strategySpecies: SolanaAlphaSpecies;
  readonly strategyName: string;
  readonly targetMint: string;
  readonly targetPoolId: string;
  readonly claimedReturnBps: number;
  readonly claimedConfidencePct: number;
  readonly proposedNotionalLamports: bigint;
  readonly claimedHoldingHorizonSeconds: number;
  readonly claimedTailLossBps: number;
  readonly proposedCapacityLamports: bigint;
  readonly claimedCorrelationDiscountPct: number;
  readonly submittedAtMs: number;
}

export interface OpportunityClaimRanking {
  readonly claim: StrategyOpportunityClaim;
  readonly researchHeuristicScore: number;
  readonly claimStatus: 'UNVERIFIED_CALLER_CLAIM';
}

export interface OpportunityClaimRankingResult {
  readonly decisionAuthority: 'NONE';
  readonly evidenceStatus: 'UNVERIFIED_CALLER_CLAIMS';
  readonly rankingBasis: 'CALLER_ASSERTED_RETURN_RISK_CAPITAL_AND_TIME';
  readonly rankedClaims: readonly OpportunityClaimRanking[];
  readonly evaluationTimestampMs: number;
  readonly answerSummary: string;
}

const knownSpecies = new Set<string>(SOLANA_ALPHA_SPECIES);
const MAX_RETAINED_CLAIMS = 500;

function assertClaim(claim: Omit<StrategyOpportunityClaim, 'claimId' | 'submittedAtMs'>): void {
  if (!knownSpecies.has(claim.strategySpecies)) throw new Error('ALPHA_CLAIM_INVALID: Unknown strategy species');
  if (!claim.strategyName.trim() || !claim.targetMint.trim() || !claim.targetPoolId.trim()) {
    throw new Error('ALPHA_CLAIM_INVALID: Strategy, mint and pool identifiers are required');
  }
  if (!Number.isFinite(claim.claimedReturnBps) ||
      !Number.isFinite(claim.claimedConfidencePct) || claim.claimedConfidencePct < 0 || claim.claimedConfidencePct > 100 ||
      !Number.isFinite(claim.claimedHoldingHorizonSeconds) || claim.claimedHoldingHorizonSeconds <= 0 ||
      !Number.isFinite(claim.claimedTailLossBps) || claim.claimedTailLossBps < 0 ||
      !Number.isFinite(claim.claimedCorrelationDiscountPct) || claim.claimedCorrelationDiscountPct < 0 || claim.claimedCorrelationDiscountPct > 100) {
    throw new Error('ALPHA_CLAIM_INVALID: Claimed metrics must be finite and within their documented domains');
  }
  if (claim.proposedNotionalLamports <= 0n || claim.proposedCapacityLamports <= 0n ||
      claim.proposedNotionalLamports > BigInt(Number.MAX_SAFE_INTEGER) || claim.proposedCapacityLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ALPHA_CLAIM_INVALID: Proposed notional and capacity must be positive and within safe heuristic precision');
  }
}

export class SolanaAlphaFactory {
  private readonly registeredClaims: StrategyOpportunityClaim[] = [];

  /** Register a strategy claim without treating any supplied metric as verified evidence. */
  public submitClaim(claim: Omit<StrategyOpportunityClaim, 'claimId' | 'submittedAtMs'>): StrategyOpportunityClaim {
    assertClaim(claim);
    const submittedAtMs = Date.now();
    const claimId = `claim_${hashCanonical({ ...claim, submittedAtMs }).slice(0, 16)}`;
    const full = Object.freeze({ claimId, ...claim, submittedAtMs });

    this.registeredClaims.push(full);
    if (this.registeredClaims.length > MAX_RETAINED_CLAIMS) this.registeredClaims.shift();
    return full;
  }

  /**
   * Ranks unverified strategy assertions for analyst triage only. No quote,
   * route, lease, or independent risk evidence is consumed by this method.
   */
  public rankClaims(): OpportunityClaimRankingResult {
    const rankedClaims = this.registeredClaims.map(claim => {
      const capitalSol = Number(claim.proposedNotionalLamports) / 1e9;
      const timeHours = Math.max(0.001, claim.claimedHoldingHorizonSeconds / 3600);
      const capitalTime = Math.max(0.01, capitalSol * timeHours);
      const riskFactor = Math.max(0.1, (claim.claimedTailLossBps / 100) * (1 - claim.claimedConfidencePct / 100));
      const score = claim.claimedReturnBps > 0
        ? (claim.claimedReturnBps / (riskFactor * capitalTime)) * (1 - claim.claimedCorrelationDiscountPct / 100)
        : 0;
      return Object.freeze({
        claim,
        researchHeuristicScore: Number.isFinite(score) ? score : 0,
        claimStatus: 'UNVERIFIED_CALLER_CLAIM' as const,
      });
    }).sort((a, b) => b.researchHeuristicScore - a.researchHeuristicScore);

    return Object.freeze({
      decisionAuthority: 'NONE',
      evidenceStatus: 'UNVERIFIED_CALLER_CLAIMS',
      rankingBasis: 'CALLER_ASSERTED_RETURN_RISK_CAPITAL_AND_TIME',
      rankedClaims: Object.freeze(rankedClaims),
      evaluationTimestampMs: Date.now(),
      answerSummary: rankedClaims.length
        ? `Research-only ranking of ${rankedClaims.length} unverified strategy claims; no opportunity is verified or executable.`
        : 'No strategy claims are registered; no opportunity is verified or executable.',
    });
  }

  public getClaimCount(): number {
    return this.registeredClaims.length;
  }
}
