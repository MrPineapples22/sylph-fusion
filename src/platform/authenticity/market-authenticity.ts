/**
 * SOL-SYLPH Platform - Market Authenticity & Cost-to-Fake Intelligence
 * Specifications: Master Blueprint Sections 9 & 10, Priority Item 13.
 *
 * Implements:
 * 1. MarketAuthenticityCertificate: Authoritative decoupled truth for authentic vs artificial market activity.
 * 2. Separate orthogonal probability decomposition:
 *    - P_authentic
 *    - P_wash
 *    - P_coordination
 *    - P_fake_volume
 *    - P_creator_manipulation
 *    - P_hidden_control
 *    - P_social_manipulation
 * 3. Cost-to-Fake Intelligence & ManipulationResistanceScore:
 *    - Ranks signals based on adversarial manufacturing cost (cheap micro-buys vs expensive sustained capital absorption).
 * 4. Hard invariant enforcement:
 *    high P10x + low authenticity != trade.
 */

import { createHash } from 'node:crypto';

export interface AuthenticityObservationInputs {
  readonly mint: string;
  readonly walletCount: number;
  readonly uniqueEntityCount: number; // Disambiguated entities from EntityControlX
  readonly washTradingVolumeSol: number;
  readonly totalVolumeSol: number;
  readonly creatorControlledSupplyPct: number;
  readonly insiderSupplyPct: number;
  readonly coordinatedSupplyPct: number;
  readonly funderConcentrationScore: number; // 0.0 - 1.0 (1.0 = single funding source for all buyers)
  readonly sustainedCapitalInflowSol: number; // Independent capital sustained across >= 5 minutes
  readonly sellerAbsorptionRate: number; // 0.0 - 1.0 (organic buyers absorbing dev/insider sales)
  readonly observationSlot: number;
  readonly observedAtMs: number;
}

export interface AuthenticityProbabilityBreakdown {
  readonly pAuthentic: number;
  readonly pWash: number;
  readonly pCoordination: number;
  readonly pFakeVolume: number;
  readonly pCreatorManipulation: number;
  readonly pHiddenControl: number;
  readonly pSocialManipulation: number;
}

export interface MarketAuthenticityCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly observationSlot: number;
  readonly observedAtMs: number;
  readonly probabilities: AuthenticityProbabilityBreakdown;
  readonly manipulationResistanceScore: number; // 0.0 - 1.0 (cost-to-fake metric)
  readonly estimatedCostToFakeSol: number; // Estimated capital an attacker had to commit
  readonly cheapSignalsDetected: readonly string[];
  readonly durableSignalsVerified: readonly string[];
  readonly isApprovedForCapital: boolean;
  readonly disqualificationReasons: readonly string[];
  readonly evidenceHash: string;
}

export class MarketAuthenticityEngine {
  public static readonly MINIMUM_AUTHENTIC_PROBABILITY_FOR_CAPITAL = 0.65;
  public static readonly MINIMUM_MANIPULATION_RESISTANCE = 0.50;
  public static readonly MAXIMUM_INSIDER_CONTROL_PCT = 25.0; // Over 25% coordinated/insider supply vetoes trade

  /**
   * Evaluates market evidence to produce an immutable MarketAuthenticityCertificate.
   */
  public static evaluateAuthenticity(inputs: AuthenticityObservationInputs): MarketAuthenticityCertificate {
    const {
      mint,
      walletCount,
      uniqueEntityCount,
      washTradingVolumeSol,
      totalVolumeSol,
      creatorControlledSupplyPct,
      insiderSupplyPct,
      coordinatedSupplyPct,
      funderConcentrationScore,
      sustainedCapitalInflowSol,
      sellerAbsorptionRate,
      observationSlot,
      observedAtMs,
    } = inputs;

    const cheapSignalsDetected: string[] = [];
    const durableSignalsVerified: string[] = [];
    const disqualificationReasons: string[] = [];

    // 1. Evaluate Entity Disparity (Wallets vs Real Entities)
    const entityRatio = walletCount > 0 ? uniqueEntityCount / walletCount : 0;
    if (walletCount >= 20 && entityRatio < 0.25) {
      cheapSignalsDetected.push(
        `SYBIL_WALLET_SWARM: ${walletCount} wallets resolve to only ${uniqueEntityCount} distinct entities (ratio: ${(entityRatio * 100).toFixed(1)}%)`
      );
    } else if (uniqueEntityCount >= 15 && entityRatio >= 0.70) {
      durableSignalsVerified.push(`DIVERSE_ENTITIES: ${uniqueEntityCount} distinct entities verified`);
    }

    // 2. Volume Authenticity
    const washRatio = totalVolumeSol > 0 ? washTradingVolumeSol / totalVolumeSol : 0;
    if (washRatio > 0.30) {
      cheapSignalsDetected.push(
        `HIGH_WASH_VOLUME: ${(washRatio * 100).toFixed(1)}% of trading volume is circular/wash`
      );
    } else if (washRatio < 0.08 && totalVolumeSol >= 20) {
      durableSignalsVerified.push(`CLEAN_VOLUME: ${(100 - washRatio * 100).toFixed(1)}% organic volume`);
    }

    // 3. Insider and Funder Control
    const totalInsiderSupply = creatorControlledSupplyPct + insiderSupplyPct + coordinatedSupplyPct;
    if (totalInsiderSupply > this.MAXIMUM_INSIDER_CONTROL_PCT) {
      cheapSignalsDetected.push(
        `HOSTILE_SUPPLY_CONCENTRATION: Total insider/creator control is ${totalInsiderSupply.toFixed(1)}% (> ${this.MAXIMUM_INSIDER_CONTROL_PCT}%)`
      );
    }

    if (funderConcentrationScore > 0.65) {
      cheapSignalsDetected.push(
        `SHARED_FUNDING_DOMINANCE: Funder concentration score is ${funderConcentrationScore.toFixed(2)}`
      );
    } else if (funderConcentrationScore < 0.20 && uniqueEntityCount >= 10) {
      durableSignalsVerified.push('INDEPENDENT_CAPITAL_ORIGINS: Diverse funding roots verified');
    }

    // 4. Absorption and Sustained Capital (Expensive to Fake)
    if (sustainedCapitalInflowSol >= 15.0) {
      durableSignalsVerified.push(
        `SUSTAINED_CAPITAL_INFLOW: ${sustainedCapitalInflowSol.toFixed(1)} SOL sustained genuine capital commitment`
      );
    }
    if (sellerAbsorptionRate >= 0.75) {
      durableSignalsVerified.push(
        `STRONG_SELLER_ABSORPTION: ${(sellerAbsorptionRate * 100).toFixed(1)}% of seller inventory organically absorbed`
      );
    }

    // Compute Probabilities
    const pWash = Number(Math.min(1.0, Math.max(0.0, washRatio * 1.5)).toFixed(3));
    const pCoordination = Number(
      Math.min(1.0, Math.max(0.0, funderConcentrationScore * 0.6 + (1 - entityRatio) * 0.4)).toFixed(3)
    );
    const pCreatorManipulation = Number(
      Math.min(1.0, Math.max(0.0, (creatorControlledSupplyPct + insiderSupplyPct) / 40.0)).toFixed(3)
    );
    const pHiddenControl = Number(
      Math.min(1.0, Math.max(0.0, totalInsiderSupply / 50.0)).toFixed(3)
    );
    const pFakeVolume = Number(Math.min(1.0, Math.max(0.0, washRatio * 1.2)).toFixed(3));
    const pSocialManipulation = Number(
      Math.min(1.0, Math.max(0.0, walletCount > 50 && entityRatio < 0.2 ? 0.8 : 0.2)).toFixed(3)
    );

    // Composite authentic probability
    const adverseProbMax = Math.max(pWash, pCoordination, pCreatorManipulation, pHiddenControl);
    const pAuthentic = Number(
      Math.max(0.01, Math.min(0.99, (1 - adverseProbMax) * 0.7 + sellerAbsorptionRate * 0.3)).toFixed(3)
    );

    // Compute Manipulation Resistance Score (Cost to Fake)
    // Fabrication cost estimation: Cost to fund N wallets (rent + fees) + wash volume fees + committed insider capital
    const feePerWallet = 0.003; // SOL rent + tx fees
    const estimatedSybilCostSol = walletCount * feePerWallet;
    const washTradingCostSol = washTradingVolumeSol * 0.01; // ~1% DEX fee per circular flip
    const estimatedCostToFakeSol = Number((estimatedSybilCostSol + washTradingCostSol).toFixed(3));

    // High resistance requires real sustained capital and absorption which cannot be faked cheaply
    let resistanceScore = 0.50;
    resistanceScore += durableSignalsVerified.length * 0.12;
    resistanceScore -= cheapSignalsDetected.length * 0.15;
    const manipulationResistanceScore = Number(Math.max(0.05, Math.min(0.98, resistanceScore)).toFixed(3));

    // Evaluate Capital Invariants
    if (pAuthentic < this.MINIMUM_AUTHENTIC_PROBABILITY_FOR_CAPITAL) {
      disqualificationReasons.push(
        `AUTHENTICITY_PROBABILITY_INSUFFICIENT: P_authentic=${pAuthentic} < ${this.MINIMUM_AUTHENTIC_PROBABILITY_FOR_CAPITAL}`
      );
    }
    if (manipulationResistanceScore < this.MINIMUM_MANIPULATION_RESISTANCE) {
      disqualificationReasons.push(
        `MANIPULATION_RESISTANCE_LOW: Score=${manipulationResistanceScore} < ${this.MINIMUM_MANIPULATION_RESISTANCE}`
      );
    }
    if (totalInsiderSupply > this.MAXIMUM_INSIDER_CONTROL_PCT) {
      disqualificationReasons.push(
        `INSIDER_SUPPLY_EXCESSIVE: Total insider holding=${totalInsiderSupply.toFixed(1)}%`
      );
    }

    const isApprovedForCapital = disqualificationReasons.length === 0;

    const probabilities: AuthenticityProbabilityBreakdown = {
      pAuthentic,
      pWash,
      pCoordination,
      pFakeVolume,
      pCreatorManipulation,
      pHiddenControl,
      pSocialManipulation,
    };

    const evidenceHash = createHash('sha256')
      .update('AUTHENTICITY_CERTIFICATE:')
      .update(mint)
      .update(observationSlot.toString())
      .update(pAuthentic.toString())
      .update(manipulationResistanceScore.toString())
      .update(isApprovedForCapital ? 'APPROVED' : 'REJECTED')
      .digest('hex');

    const certificateId = `auth_cert_${mint.slice(0, 8)}_${observationSlot}`;

    return {
      certificateId,
      mint,
      observationSlot,
      observedAtMs,
      probabilities,
      manipulationResistanceScore,
      estimatedCostToFakeSol,
      cheapSignalsDetected: Object.freeze(cheapSignalsDetected),
      durableSignalsVerified: Object.freeze(durableSignalsVerified),
      isApprovedForCapital,
      disqualificationReasons: Object.freeze(disqualificationReasons),
      evidenceHash,
    };
  }
}
