/**
 * SOL-SYLPH Master Implementation Blueprint - COMPASS
 * Mission Objective Arbitration & Multi-Objective Optimization
 * Specifications: Parts 17-19.
 */

import { MissionMode } from '../contracts/blueprint-contracts.js';

export interface ObjectiveWeights {
  readonly capital_survival: number; // Hard constraint base
  readonly drawdown_containment: number;
  readonly expected_edge: number;
  readonly tail_risk_penalty: number;
  readonly liquidity_preservation: number;
  readonly capital_lockup_penalty: number;
  readonly optionality_value: number;
  readonly information_acquisition: number;
  readonly execution_quality: number;
}

export interface CompassDecisionEvaluation {
  readonly evaluated_mode: MissionMode;
  readonly composite_utility_score: number;
  readonly hard_constraints_passed: boolean;
  readonly hard_constraint_failures: readonly string[];
  readonly objective_breakdown: Record<string, number>;
  readonly recommended_action_scaling: number; // 0.0 (veto) to 1.0 (full permission)
  readonly rationale: string;
}

export class MissionCompassEngine {
  private currentMode: MissionMode = 'NORMAL';
  private modeLastChangedAt: number = Date.now();
  private modeEvidenceCount: number = 0;

  // Hysteresis threshold: requires at least 3 consecutive evidence observations before mode switch
  private static readonly HYSTERESIS_SAMPLES_REQUIRED = 3;
  private pendingModeProposal: { mode: MissionMode; count: number } | null = null;

  public getCurrentMode(): MissionMode {
    return this.currentMode;
  }

  public getWeightsForMode(mode: MissionMode = this.currentMode): ObjectiveWeights {
    switch (mode) {
      case 'PRESERVATION':
      case 'RECOVERY':
        return {
          capital_survival: 1.0,
          drawdown_containment: 0.95,
          expected_edge: 0.1,
          tail_risk_penalty: 1.0,
          liquidity_preservation: 0.9,
          capital_lockup_penalty: 0.8,
          optionality_value: 0.8,
          information_acquisition: 0.05,
          execution_quality: 0.7,
        };

      case 'DEFENSIVE':
      case 'DATA_DEGRADED':
      case 'EXECUTION_DEGRADED':
        return {
          capital_survival: 0.9,
          drawdown_containment: 0.85,
          expected_edge: 0.35,
          tail_risk_penalty: 0.9,
          liquidity_preservation: 0.8,
          capital_lockup_penalty: 0.7,
          optionality_value: 0.75,
          information_acquisition: 0.1,
          execution_quality: 0.85,
        };

      case 'CAPITAL_SCARCE':
        return {
          capital_survival: 0.8,
          drawdown_containment: 0.75,
          expected_edge: 0.7,
          tail_risk_penalty: 0.8,
          liquidity_preservation: 0.85,
          capital_lockup_penalty: 0.9,
          optionality_value: 0.9,
          information_acquisition: 0.2,
          execution_quality: 0.8,
        };

      case 'OPPORTUNITY_RICH':
        return {
          capital_survival: 0.7,
          drawdown_containment: 0.6,
          expected_edge: 0.9,
          tail_risk_penalty: 0.65,
          liquidity_preservation: 0.6,
          capital_lockup_penalty: 0.5,
          optionality_value: 0.6,
          information_acquisition: 0.4,
          execution_quality: 0.85,
        };

      case 'RESEARCH':
        return {
          capital_survival: 0.6,
          drawdown_containment: 0.5,
          expected_edge: 0.4,
          tail_risk_penalty: 0.5,
          liquidity_preservation: 0.5,
          capital_lockup_penalty: 0.3,
          optionality_value: 0.5,
          information_acquisition: 1.0,
          execution_quality: 0.7,
        };

      case 'NORMAL':
      default:
        return {
          capital_survival: 0.75,
          drawdown_containment: 0.7,
          expected_edge: 0.75,
          tail_risk_penalty: 0.75,
          liquidity_preservation: 0.7,
          capital_lockup_penalty: 0.6,
          optionality_value: 0.7,
          information_acquisition: 0.3,
          execution_quality: 0.8,
        };
    }
  }

  /**
   * Part 18: Mode transitions with evidence & hysteresis
   */
  public proposeModeTransition(
    proposedMode: MissionMode,
    evidenceExplanation: string
  ): { transitioned: boolean; currentMode: MissionMode; rationale: string } {
    if (proposedMode === this.currentMode) {
      this.pendingModeProposal = null;
      return { transitioned: false, currentMode: this.currentMode, rationale: 'Already in proposed mode.' };
    }

    if (!this.pendingModeProposal || this.pendingModeProposal.mode !== proposedMode) {
      this.pendingModeProposal = { mode: proposedMode, count: 1 };
      return {
        transitioned: false,
        currentMode: this.currentMode,
        rationale: `Mode change to ${proposedMode} initiated (1/${MissionCompassEngine.HYSTERESIS_SAMPLES_REQUIRED} hysteresis samples): ${evidenceExplanation}`,
      };
    }

    this.pendingModeProposal = {
      mode: proposedMode,
      count: this.pendingModeProposal.count + 1,
    };

    if (this.pendingModeProposal.count >= MissionCompassEngine.HYSTERESIS_SAMPLES_REQUIRED) {
      const oldMode = this.currentMode;
      this.currentMode = proposedMode;
      this.modeLastChangedAt = Date.now();
      this.pendingModeProposal = null;
      return {
        transitioned: true,
        currentMode: this.currentMode,
        rationale: `Mode transitioned from ${oldMode} to ${proposedMode} after confirming ${MissionCompassEngine.HYSTERESIS_SAMPLES_REQUIRED} consecutive evidence samples.`,
      };
    }

    return {
      transitioned: false,
      currentMode: this.currentMode,
      rationale: `Pending transition to ${proposedMode} (${this.pendingModeProposal.count}/${MissionCompassEngine.HYSTERESIS_SAMPLES_REQUIRED} samples).`,
    };
  }

  /**
   * Part 17: Decision Utility Optimization (DUO)
   * Evaluates proposed action against current mission weights and hard constraints.
   */
  public evaluateUtility(input: {
    expected_edge_bps: number;
    trapping_score: number;
    optionality_score: number;
    drawdown_pct: number;
    systemic_risk_score: number;
    uncertainty_score: number;
  }): CompassDecisionEvaluation {
    const weights = this.getWeightsForMode();
    const hardFailures: string[] = [];

    // Part 17: Hard constraints separation
    if (input.drawdown_pct > 25) {
      hardFailures.push(`Drawdown breach (${input.drawdown_pct}% > 25% hard limit)`);
    }
    if (input.systemic_risk_score > 0.85) {
      hardFailures.push(`Systemic risk contagion extreme (${input.systemic_risk_score} > 0.85)`);
    }
    if (this.currentMode === 'PRESERVATION' && input.expected_edge_bps < 150) {
      hardFailures.push(`Preservation mode requires minimum 150 bps edge (observed ${input.expected_edge_bps} bps)`);
    }

    const hardPassed = hardFailures.length === 0;

    // Soft multi-objective score [-1.0, 1.0]
    const edgeUtility = Math.min(1.0, input.expected_edge_bps / 200) * weights.expected_edge;
    const optionalityUtility = input.optionality_score * weights.optionality_value;
    const trappingPenalty = input.trapping_score * weights.capital_lockup_penalty;
    const tailPenalty = input.systemic_risk_score * weights.tail_risk_penalty;
    const uncertaintyPenalty = input.uncertainty_score * 0.4;

    const netUtility = Number(
      (edgeUtility + optionalityUtility - trappingPenalty - tailPenalty - uncertaintyPenalty).toFixed(3)
    );

    let recommendedScaling = 1.0;
    if (!hardPassed) {
      recommendedScaling = 0.0; // Complete veto
    } else if (netUtility < 0.1) {
      recommendedScaling = 0.25; // Heavily throttled
    } else if (netUtility < 0.35) {
      recommendedScaling = 0.5; // Moderately throttled
    }

    return {
      evaluated_mode: this.currentMode,
      composite_utility_score: netUtility,
      hard_constraints_passed: hardPassed,
      hard_constraint_failures: hardFailures,
      objective_breakdown: {
        edge_utility: Number(edgeUtility.toFixed(3)),
        optionality_utility: Number(optionalityUtility.toFixed(3)),
        trapping_penalty: Number(trappingPenalty.toFixed(3)),
        tail_penalty: Number(tailPenalty.toFixed(3)),
      },
      recommended_action_scaling: recommendedScaling,
      rationale: hardPassed
        ? `Utility positive (${netUtility}), scaling at ${(recommendedScaling * 100).toFixed(0)}% under ${this.currentMode} mode.`
        : `Vetoed by hard constraints: ${hardFailures.join('; ')}`,
    };
  }
}
