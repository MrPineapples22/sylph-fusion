/**
 * SYLPH FUSION — TWIN RED TEAM & ADVERSARIAL REALITY-GAP EXPLOITATION
 * Specifications: Blueprint Section 53
 *
 * Invariant:
 * 1. The Twin Red Team actively searches for states where digital twin predicts
 *    safe/profitable, but replay/reality is unsafe/unprofitable.
 * 2. Every verified exploit directly reduces Twin Trust and degrades downstream exposure.
 */

import { TwinTrustLevel } from './twin-trust-state.js';

export interface TwinPredictionState {
  readonly scenarioId: string;
  readonly predictedNetReturnBps: number;
  readonly predictedSurvivalProbability: number;
  readonly predictedExitCostBps: number;
  readonly twinAssessedSafe: boolean;
}

export interface ReplayRealityState {
  readonly scenarioId: string;
  readonly actualNetReturnBps: number;
  readonly actualSurvival: boolean;
  readonly actualExitCostBps: number;
  readonly liquidityCollapsed: boolean;
  readonly routeFractured: boolean;
}

export interface RedTeamExploitReport {
  readonly scenarioId: string;
  readonly exploitDiscovered: boolean;
  readonly severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CATASTROPHIC';
  readonly trustPenaltyPoints: number;
  readonly explanation?: string;
  readonly evidenceRoot: string;
}

export class TwinRedTeamEngine {
  private totalPenaltyPoints = 0;

  /**
   * Assesses a pair of twin prediction vs reality outcome.
   * Discovers exploits where twin had false confidence.
   */
  public evaluateScenario(
    prediction: TwinPredictionState,
    reality: ReplayRealityState
  ): RedTeamExploitReport {
    if (prediction.scenarioId !== reality.scenarioId) {
      throw new Error(`SCENARIO_MISMATCH: ${prediction.scenarioId} != ${reality.scenarioId}`);
    }

    let exploitDiscovered = false;
    let severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CATASTROPHIC' = 'NONE';
    let trustPenaltyPoints = 0;
    const explanations: string[] = [];

    // Exploit 1: Twin predicted survival, but position died / liquidity collapsed
    if (prediction.twinAssessedSafe && (!reality.actualSurvival || reality.liquidityCollapsed)) {
      exploitDiscovered = true;
      severity = 'CATASTROPHIC';
      trustPenaltyPoints += 50;
      explanations.push(
        `FATAL_BLINDNESS: Twin predicted safe (survival=${prediction.predictedSurvivalProbability}), but reality suffered ${reality.liquidityCollapsed ? 'liquidity collapse' : 'terminal failure'}`
      );
    }
    // Exploit 2: Twin predicted profit, but reality suffered severe loss (> -200 bps)
    else if (prediction.predictedNetReturnBps > 0 && reality.actualNetReturnBps < -200) {
      exploitDiscovered = true;
      severity = 'HIGH';
      trustPenaltyPoints += 25;
      explanations.push(
        `PROFIT_MIRAGE: Twin predicted +${prediction.predictedNetReturnBps}bps, actual realized ${reality.actualNetReturnBps}bps`
      );
    }
    // Exploit 3: Exit cost severely underestimated (actual > 3x predicted)
    else if (reality.actualExitCostBps > prediction.predictedExitCostBps * 3 && reality.actualExitCostBps > 100) {
      exploitDiscovered = true;
      severity = 'MEDIUM';
      trustPenaltyPoints += 15;
      explanations.push(
        `SLIPPAGE_EXPLOSION: Exit cost actual ${reality.actualExitCostBps}bps > 3x predicted ${prediction.predictedExitCostBps}bps`
      );
    }

    this.totalPenaltyPoints += trustPenaltyPoints;

    return {
      scenarioId: prediction.scenarioId,
      exploitDiscovered,
      severity,
      trustPenaltyPoints,
      explanation: explanations.length > 0 ? explanations.join('; ') : undefined,
      evidenceRoot: `ev_redteam_${prediction.scenarioId}_${Date.now()}`,
    };
  }

  /**
   * Translates cumulative red team exploits into an authoritative TwinTrustLevel.
   */
  public getEffectiveTrustLevel(): TwinTrustLevel {
    if (this.totalPenaltyPoints >= 50) {
      return 'QUARANTINED';
    }
    if (this.totalPenaltyPoints >= 25) {
      return 'DEGRADED';
    }
    if (this.totalPenaltyPoints >= 10) {
      return 'WATCH';
    }
    return 'SHADOW_TRUSTED';
  }

  public resetPenalties(): void {
    this.totalPenaltyPoints = 0;
  }
}
