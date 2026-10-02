/**
 * SOL-SYLPH Platform - Automatic Falsification Agent & Adversarial Scenario Generator
 * Specifications: 500-Item Roadmap Layer I (#62, #82), Layer III (#300), Layer IV (#301-#400), Layer V (#409, #499).
 *
 * Implements:
 * 1. AdversarialScenarioGenerator: Synthesizes red-team attack vectors:
 *    - CREATOR_STEALTH_DUMP: Coordinated exit of latent insider inventory
 *    - JITO_BUNDLE_SANDWICH: Toxic MEV sandwich maximizing allowable slippage
 *    - LIQUIDITY_CLIFF_DRAIN: Sudden reserve depletion / migration shock
 *    - SCHEDULER_LOCK_STARVATION: Hotspot account contention delaying execution past event horizon
 *    - SYBIL_ORGANIC_EVAPORATION: Wash trading volume immediately halts upon entry
 * 2. AutomaticFalsificationAgent: Red-team agent calculating:
 *    - minimumPlausibleBreakCapitalSol: The smallest plausible attack capital required to bankrupt/invalidate the thesis (Roadmap #400).
 *    - survivabilityIndex across all attack scenarios (0.0 to 1.0).
 *    - Falsification veto to fail-safe against brittle claims.
 */

import { createHash } from 'node:crypto';

export type AttackVectorType =
  | 'CREATOR_STEALTH_DUMP'
  | 'JITO_BUNDLE_SANDWICH'
  | 'LIQUIDITY_CLIFF_DRAIN'
  | 'SCHEDULER_LOCK_STARVATION'
  | 'SYBIL_ORGANIC_EVAPORATION';

export interface StressScenarioResult {
  readonly attackVector: AttackVectorType;
  readonly attackCapitalSol: number;
  readonly simulatedPostShockPriceDeltaBps: number;
  readonly isLethalToPosition: boolean; // Position wiped or stop-loss breached
  readonly survivalProbability: number; // 0.0 to 1.0
  readonly attackMechanism: string;
}

export interface FalsificationReport {
  readonly reportId: string;
  readonly mint: string;
  readonly slot: number;
  readonly isThesisFalsified: boolean;              // True if any plausible attack breaks the thesis
  readonly falsificationConfidence: number;         // 0.0 to 1.0
  readonly survivabilityIndex: number;              // 0.0 (utterly brittle) to 1.0 (resilient)
  readonly minimumPlausibleBreakCapitalSol: number; // Smallest attack capital that invalidates thesis (#400)
  readonly lethalAttackVector: AttackVectorType | 'NONE';
  readonly stressScenariosTested: readonly StressScenarioResult[];
  readonly isVetoRecommended: boolean;
  readonly rationale: string;
}

export class AdversarialScenarioGenerator {
  /**
   * Generates plausible adversarial attacks based on pool micro-state and entity control.
   */
  public static generateAttacks(params: {
    poolSolReserve: number;
    latentInventoryFraction: number;
    expectedNetEvBps: number;
    alphaHalfLifeMs: number;
    maxSlippageBps: number;
    washTradingProbability: number;
  }): readonly StressScenarioResult[] {
    const {
      poolSolReserve,
      latentInventoryFraction,
      expectedNetEvBps,
      alphaHalfLifeMs,
      maxSlippageBps,
      washTradingProbability,
    } = params;

    const results: StressScenarioResult[] = [];

    // 1. Creator Stealth Dump:
    // If latent inventory is e.g. 25%, a dump extracts ~25% of pool reserve
    const dumpCapitalSol = poolSolReserve * latentInventoryFraction;
    const dumpPriceImpactBps = -Math.round((latentInventoryFraction / (1.0 + latentInventoryFraction)) * 10_000);
    const dumpLethal = Math.abs(dumpPriceImpactBps) > 1500; // Breaches 15% structural stop
    results.push({
      attackVector: 'CREATOR_STEALTH_DUMP',
      attackCapitalSol: Number(dumpCapitalSol.toFixed(2)),
      simulatedPostShockPriceDeltaBps: dumpPriceImpactBps,
      isLethalToPosition: dumpLethal,
      survivalProbability: Number(Math.max(0, 1.0 - (latentInventoryFraction * 2.5)).toFixed(2)),
      attackMechanism: `Insider cluster dumps ${(latentInventoryFraction * 100).toFixed(1)}% latent supply, causing ${dumpPriceImpactBps} bps shock`,
    });

    // 2. Jito Bundle Sandwich:
    // Frontruns up to allowable slippage and backruns, capturing full allowable slippage
    const sandwichExtractionBps = -maxSlippageBps;
    const sandwichLethal = maxSlippageBps >= expectedNetEvBps;
    results.push({
      attackVector: 'JITO_BUNDLE_SANDWICH',
      attackCapitalSol: Number(Math.min(50, poolSolReserve * 0.20).toFixed(2)),
      simulatedPostShockPriceDeltaBps: sandwichExtractionBps,
      isLethalToPosition: sandwichLethal,
      survivalProbability: sandwichLethal ? 0.2 : 0.85,
      attackMechanism: `Adversarial searcher bundle extracts ${maxSlippageBps} bps max allowable slippage at tip auction boundary`,
    });

    // 3. Liquidity Cliff Drain:
    // Plausible unbonding/drain is small for deep pools with locked/burned LP, severe for shallow pools
    const drainFraction = poolSolReserve > 150 ? 0.10 : (poolSolReserve > 50 ? 0.20 : 0.35);
    const drainCapitalSol = poolSolReserve * drainFraction;
    const drainImpactBps = -Math.round((drainFraction / (1.0 - drainFraction)) * 5000);
    const drainLethal = Math.abs(drainImpactBps) > 1800;
    results.push({
      attackVector: 'LIQUIDITY_CLIFF_DRAIN',
      attackCapitalSol: Number(drainCapitalSol.toFixed(2)),
      simulatedPostShockPriceDeltaBps: drainImpactBps,
      isLethalToPosition: drainLethal,
      survivalProbability: drainLethal ? 0.3 : 0.85,
      attackMechanism: `Liquidity migration or LP withdrawal drains ${(drainFraction * 100).toFixed(0)}% of pool depth`,
    });

    // 4. Scheduler Lock Starvation:
    // Contention delays inclusion by 1.5 seconds (~4 slots). Alpha decay drops edge.
    const delayMs = 1500;
    const edgeRemainingFraction = Math.max(0, 1.0 - (delayMs / (alphaHalfLifeMs * 2.0)));
    const starvationPriceImpactBps = -Math.round(expectedNetEvBps * (1.0 - edgeRemainingFraction));
    const starvationLethal = edgeRemainingFraction < 0.25;
    results.push({
      attackVector: 'SCHEDULER_LOCK_STARVATION',
      attackCapitalSol: 0.05, // Negligible tip war spam cost
      simulatedPostShockPriceDeltaBps: starvationPriceImpactBps,
      isLethalToPosition: starvationLethal,
      survivalProbability: Number(edgeRemainingFraction.toFixed(2)),
      attackMechanism: `Contention delays execution by ${delayMs}ms, eroding alpha half-life by ${((1 - edgeRemainingFraction) * 100).toFixed(1)}%`,
    });

    // 5. Sybil Organic Evaporation:
    // Wash trading vanishes, true organic velocity is revealed
    const washImpactBps = -Math.round(washTradingProbability * 2500);
    const washLethal = washTradingProbability > 0.45;
    results.push({
      attackVector: 'SYBIL_ORGANIC_EVAPORATION',
      attackCapitalSol: 0,
      simulatedPostShockPriceDeltaBps: washImpactBps,
      isLethalToPosition: washLethal,
      survivalProbability: Number(Math.max(0, 1.0 - (washTradingProbability * 1.8)).toFixed(2)),
      attackMechanism: `Volume halts as Sybil bots disengage; baseline demand collapses by ${washImpactBps} bps`,
    });

    return Object.freeze(results);
  }
}

export class AutomaticFalsificationAgent {
  /**
   * Systematically attempts to falsify the hypothesis that buying this token produces positive net EV.
   */
  public static falsifyOpportunity(params: {
    mint: string;
    slot: number;
    poolSolReserve: number;
    latentInventoryFraction: number;
    expectedNetEvBps: number;
    alphaHalfLifeMs: number;
    maxSlippageBps: number;
    washTradingProbability: number;
  }): FalsificationReport {
    const { mint, slot, poolSolReserve } = params;

    const scenarios = AdversarialScenarioGenerator.generateAttacks(params);

    // Compute survivability index (average survival probability)
    const avgSurvival = scenarios.reduce((sum, s) => sum + s.survivalProbability, 0) / scenarios.length;
    const survivabilityIndex = Number(avgSurvival.toFixed(3));

    // Find lethal scenarios
    const lethalScenarios = scenarios.filter(s => s.isLethalToPosition);
    const isThesisFalsified = lethalScenarios.length > 0;

    // Smallest plausible capital to break thesis (#400)
    let minimumPlausibleBreakCapitalSol = poolSolReserve;
    let lethalAttackVector: AttackVectorType | 'NONE' = 'NONE';

    for (const lethal of lethalScenarios) {
      if (lethal.attackCapitalSol < minimumPlausibleBreakCapitalSol) {
        minimumPlausibleBreakCapitalSol = lethal.attackCapitalSol;
        lethalAttackVector = lethal.attackVector;
      }
    }

    if (!isThesisFalsified) {
      minimumPlausibleBreakCapitalSol = poolSolReserve * 0.75;
    }

    // Veto recommended if thesis is falsified by an attack requiring less than 5 SOL
    // or if overall survivability index is below 0.60
    const isVetoRecommended =
      isThesisFalsified &&
      (minimumPlausibleBreakCapitalSol <= 5.0 || survivabilityIndex < 0.60);

    const falsificationConfidence = Number(
      Math.min(0.98, isThesisFalsified ? 0.70 + (1.0 - survivabilityIndex) * 0.28 : 0.85).toFixed(2)
    );

    const reportId = `falsify_${mint.slice(0, 8)}_${slot}_${createHash('sha256').update(`${mint}:${slot}:${isThesisFalsified}`).digest('hex').slice(0, 8)}`;

    const rationale = isThesisFalsified
      ? `THESIS_FALSIFIED: Opportunity invalidated under ${lethalAttackVector} (${lethalScenarios.length}/${scenarios.length} lethal vectors). Break capital: ${minimumPlausibleBreakCapitalSol} SOL, Survivability: ${(survivabilityIndex * 100).toFixed(1)}%`
      : `Thesis survived all 5 red-team adversarial attacks (Survivability: ${(survivabilityIndex * 100).toFixed(1)}%, Min break capital: ${minimumPlausibleBreakCapitalSol.toFixed(1)} SOL)`;

    return {
      reportId,
      mint,
      slot,
      isThesisFalsified,
      falsificationConfidence,
      survivabilityIndex,
      minimumPlausibleBreakCapitalSol: Number(minimumPlausibleBreakCapitalSol.toFixed(2)),
      lethalAttackVector,
      stressScenariosTested: scenarios,
      isVetoRecommended,
      rationale,
    };
  }
}
