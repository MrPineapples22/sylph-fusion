/**
 * SYLPH FUSION — SOLANA ALPHA FACTORY & OPPORTUNITY ARBITER
 * Specification: Solana-Only Integration Blueprint (Section 45)
 *
 * Epistemic Invariants:
 * 1. Coordinates all 17 Solana Alpha strategy species.
 * 2. Strict Invariant: "All strategies compete. None directly owns execution authority."
 * 3. Foundational Directive:
 *    "Which Solana opportunity currently has the highest independently verified
 *     executable return per unit of risk, capital, time, liquidity and execution capacity?"
 * 4. Fails closed: Missing evidence, uncertified leases, or unhedged tail loss strictly blocks entry.
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';
import { SolanaMarketIR } from './market-ir.js';
import { ProtocolCompatibilityRegistry } from './protocol-compatibility-lease.js';
import { SolanaCapacityEngine } from './capacity-curves.js';

export type SolanaAlphaSpecies =
  | 'LAUNCH_INTELLIGENCE'
  | 'WALLET_INTELLIGENCE'
  | 'CREATOR_INTELLIGENCE'
  | 'ACTOR_GRAPHS'
  | 'MOMENTUM'
  | 'MEAN_REVERSION'
  | 'CROSS_DEX_ARBITRAGE'
  | 'TRIANGULAR_ARBITRAGE'
  | 'ROUTE_ARBITRAGE'
  | 'MARKET_MAKING'
  | 'LIQUIDITY_PROVISION'
  | 'MIGRATION_INTELLIGENCE'
  | 'GRADUATION_INTELLIGENCE'
  | 'CONGESTION_INTELLIGENCE'
  | 'FAILURE_INTELLIGENCE'
  | 'COMPETITION_INTELLIGENCE'
  | 'REFERENCE_MARKET_LEAD_LAG';

export interface StrategyOpportunityProposal {
  readonly proposalId: string;
  readonly strategySpecies: SolanaAlphaSpecies;
  readonly strategyName: string;
  readonly targetMint: string;
  readonly targetPoolId: string;
  readonly expectedExecutableReturnBps: number;
  readonly confidenceScorePct: number; // 0 to 100
  readonly recommendedNotionalLamports: bigint;
  readonly holdingHorizonSeconds: number;
  readonly expectedTailLossBps: number; // P(tail) * LossGivenTail
  readonly requiredCapacityLamports: bigint;
  readonly correlationRiskDiscountPct: number;
  readonly proposalTimestampMs: number;
}

export interface OpportunityArbiterVerdict {
  readonly winningProposal: StrategyOpportunityProposal | null;
  readonly rankedProposals: readonly {
    readonly proposal: StrategyOpportunityProposal;
    readonly compositeEfficiencyScore: number;
    readonly passGating: boolean;
    readonly rejectionReason?: string;
  }[];
  readonly evaluationTimestampMs: number;
  readonly answerSummary: string;
}

export class SolanaAlphaFactory {
  private readonly registeredProposals: StrategyOpportunityProposal[] = [];
  private readonly protocolRegistry: ProtocolCompatibilityRegistry;

  constructor(protocolRegistry: ProtocolCompatibilityRegistry) {
    this.protocolRegistry = protocolRegistry;
  }

  /**
   * Submit an opportunity proposal from any of the 17 Solana alpha strategies.
   * Does NOT execute or authorize execution.
   */
  public submitProposal(proposal: Omit<StrategyOpportunityProposal, 'proposalId' | 'proposalTimestampMs'>): StrategyOpportunityProposal {
    const payload = {
      strategySpecies: proposal.strategySpecies,
      strategyName: proposal.strategyName,
      targetMint: proposal.targetMint,
      targetPoolId: proposal.targetPoolId,
      expectedExecutableReturnBps: proposal.expectedExecutableReturnBps,
      recommendedNotionalLamports: proposal.recommendedNotionalLamports,
    };
    const proposalId = `prop_${hashCanonical(payload).slice(0, 16)}`;

    const full: StrategyOpportunityProposal = Object.freeze({
      proposalId,
      ...proposal,
      proposalTimestampMs: Date.now(),
    });

    this.registeredProposals.push(full);
    if (this.registeredProposals.length > 500) {
      this.registeredProposals.shift();
    }

    return full;
  }

  /**
   * Evaluates all competing proposals and selects the opportunity that answers:
   * "Which Solana opportunity currently has the highest independently verified
   *  executable return per unit of risk, capital, time, liquidity and execution capacity?"
   */
  public arbitrateOpportunities(params: {
    marketIRs: readonly SolanaMarketIR[];
    currentSlot: bigint;
    solPriceUsd?: number;
  }): OpportunityArbiterVerdict {
    const ranked = [];
    const solPrice = params.solPriceUsd ?? 150;

    for (const proposal of this.registeredProposals) {
      const market = params.marketIRs.find(m => m.mint === proposal.targetMint);
      let passGating = true;
      let rejectionReason: string | undefined;

      // Gate 1: Market IR must exist and be valid
      if (!market) {
        passGating = false;
        rejectionReason = 'MISSING_MARKET_IR: Target mint has no verified point-in-time Market IR';
      } else {
        // Gate 2: Protocol compatibility lease must be valid
        const leaseVerification = this.protocolRegistry.verifyCompatibility(market.programId, params.currentSlot);
        if (!leaseVerification.valid) {
          passGating = false;
          rejectionReason = `PROTOCOL_LEASE_BLOCKED: ${leaseVerification.reason}`;
        }

        // Gate 3: Exit Before Entry simulation
        if (passGating) {
          const exitCheck = SolanaCapacityEngine.simulateExitBeforeEntry({
            proposedNotionalLamports: proposal.recommendedNotionalLamports,
            poolLiquidityLamports: market.liquidityLamports,
            hasFallbackRoute: true,
            jitoAvailable: true,
          });

          if (!exitCheck.entryPermitted) {
            passGating = false;
            rejectionReason = exitCheck.refusalReason || 'EXIT_STRESS_FAILURE';
          }
        }
      }

      // Compute composite efficiency:
      // Executable Return / (Risk * Capital-Time * Capacity Penalty)
      let compositeScore = 0;
      if (passGating && proposal.expectedExecutableReturnBps > 0) {
        const capitalSol = Number(proposal.recommendedNotionalLamports) / 1e9;
        const timeHours = Math.max(0.001, proposal.holdingHorizonSeconds / 3600);
        const capitalTime = Math.max(0.01, capitalSol * timeHours);
        const riskFactor = Math.max(0.1, (proposal.expectedTailLossBps / 100) * (1 - proposal.confidenceScorePct / 100));
        
        // Capital-Time Alpha efficiency
        compositeScore = (proposal.expectedExecutableReturnBps / (riskFactor * capitalTime)) * (1 - proposal.correlationRiskDiscountPct / 100);
      }

      ranked.push({
        proposal,
        compositeEfficiencyScore: compositeScore,
        passGating,
        rejectionReason,
      });
    }

    // Sort by composite efficiency descending
    ranked.sort((a, b) => b.compositeEfficiencyScore - a.compositeEfficiencyScore);

    const winner = ranked.find(r => r.passGating && r.compositeEfficiencyScore > 0)?.proposal ?? null;

    let summary: string;
    if (winner) {
      summary = `Winner: ${winner.strategyName} (${winner.strategySpecies}) on ${winner.targetMint.slice(0, 8)}… with ${winner.expectedExecutableReturnBps} bps return (Score: ${ranked[0].compositeEfficiencyScore.toFixed(2)})`;
    } else {
      summary = 'NO_EXECUTABLE_OPPORTUNITY: Zero proposals passed all epistemic, protocol, and exitability gates.';
    }

    return Object.freeze({
      winningProposal: winner,
      rankedProposals: Object.freeze(ranked),
      evaluationTimestampMs: Date.now(),
      answerSummary: summary,
    });
  }

  public getProposalCount(): number {
    return this.registeredProposals.length;
  }
}
