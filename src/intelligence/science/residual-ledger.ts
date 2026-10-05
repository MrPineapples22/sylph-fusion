/**
 * SYLPH FUSION — RESIDUAL LEDGER & THEORY ENGINE
 * Specifications: Blueprint Section 42
 *
 * Invariant:
 * 1. Store unadulterated residuals: prediction, calibrated prediction, actual matured outcome.
 * 2. Only systematic, clustered residuals may trigger Theory-X hypothesis generation.
 * 3. Any new candidate law requires preregistered out-of-sample prediction before validation.
 */

export interface ResidualObservation {
  readonly observationId: string;
  readonly economicFactId: string;
  readonly strategyId: string;
  readonly predictedValue: number;
  readonly calibratedPrediction: number;
  readonly actualMaturedOutcome: number;
  readonly residual: number; // actualMaturedOutcome - calibratedPrediction
  readonly regime: string;
  readonly actorGraphRoot: string;
  readonly marketGrammarRoot: string;
  readonly executionState: string;
  readonly timestamp: number;
}

export interface SystematicResidualCluster {
  readonly clusterId: string;
  readonly regime: string;
  readonly sampleCount: number;
  readonly meanResidual: number;
  readonly residualStdDev: number;
  readonly isSystematicBias: boolean;
  readonly candidateHypothesisMechanism?: string;
  readonly evidenceRoot: string;
}

export interface PreregisteredTheoryLaw {
  readonly lawId: string;
  readonly clusterId: string;
  readonly proposedMechanism: string;
  readonly targetRegime: string;
  readonly preregisteredAt: number;
  readonly evaluationWindowStart: number;
  readonly evaluationWindowEnd: number;
  readonly expectedDirection: 'POSITIVE_BIAS' | 'NEGATIVE_BIAS';
  readonly isValidated: boolean;
}

export class ResidualLedger {
  private readonly observations: ResidualObservation[] = [];
  private readonly preregisteredLaws = new Map<string, PreregisteredTheoryLaw>();

  public recordObservation(
    params: Omit<ResidualObservation, 'residual'> & { residual?: number }
  ): ResidualObservation {
    const residual = params.residual ?? Number((params.actualMaturedOutcome - params.calibratedPrediction).toFixed(6));
    const obs: ResidualObservation = {
      ...params,
      residual,
    };
    this.observations.push(obs);
    return obs;
  }

  public getObservations(): readonly ResidualObservation[] {
    return this.observations;
  }

  /**
   * Identifies systematic residual clusters across regimes.
   */
  public clusterSystematicResiduals(minClusterSize = 20): readonly SystematicResidualCluster[] {
    const byRegime = new Map<string, ResidualObservation[]>();
    for (const obs of this.observations) {
      let list = byRegime.get(obs.regime);
      if (!list) {
        list = [];
        byRegime.set(obs.regime, list);
      }
      list.push(obs);
    }

    const clusters: SystematicResidualCluster[] = [];

    for (const [regime, obsList] of byRegime) {
      if (obsList.length < minClusterSize) continue;

      const n = obsList.length;
      const sum = obsList.reduce((acc, o) => acc + o.residual, 0);
      const mean = sum / n;
      const variance = obsList.reduce((acc, o) => acc + Math.pow(o.residual - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);

      // Systematic bias detected if mean residual is statistically separated from 0 (|t-stat| > 2.0)
      const tStat = Math.abs(mean) / (stdDev / Math.sqrt(n));
      const isSystematicBias = tStat > 2.0;

      clusters.push({
        clusterId: `cluster_${regime}_${n}`,
        regime,
        sampleCount: n,
        meanResidual: Number(mean.toFixed(6)),
        residualStdDev: Number(stdDev.toFixed(6)),
        isSystematicBias,
        candidateHypothesisMechanism: isSystematicBias
          ? `Regime '${regime}' exhibits persistent ${mean > 0 ? 'under-prediction' : 'over-prediction'} (t=${tStat.toFixed(2)})`
          : undefined,
        evidenceRoot: `ev_resid_${regime}_${n}_${Date.now()}`,
      });
    }

    return clusters;
  }

  /**
   * Preregisters a theoretical law candidate before evaluation.
   */
  public preregisterLaw(params: {
    lawId: string;
    clusterId: string;
    proposedMechanism: string;
    targetRegime: string;
    evaluationWindowDurationMs: number;
    expectedDirection: 'POSITIVE_BIAS' | 'NEGATIVE_BIAS';
  }): PreregisteredTheoryLaw {
    const now = Date.now();
    const law: PreregisteredTheoryLaw = {
      lawId: params.lawId,
      clusterId: params.clusterId,
      proposedMechanism: params.proposedMechanism,
      targetRegime: params.targetRegime,
      preregisteredAt: now,
      evaluationWindowStart: now,
      evaluationWindowEnd: now + params.evaluationWindowDurationMs,
      expectedDirection: params.expectedDirection,
      isValidated: false,
    };

    this.preregisteredLaws.set(params.lawId, law);
    return law;
  }

  /**
   * Evaluates a preregistered law strictly within its declared future evaluation window.
   */
  public evaluatePreregisteredLaw(lawId: string): { isValidated: boolean; reason?: string } {
    const law = this.preregisteredLaws.get(lawId);
    if (!law) {
      return { isValidated: false, reason: `UNKNOWN_LAW: ${lawId}` };
    }

    const now = Date.now();
    if (now < law.evaluationWindowEnd) {
      return {
        isValidated: false,
        reason: `EVALUATION_IN_PROGRESS: Window closes in ${Math.round((law.evaluationWindowEnd - now) / 1000)}s`,
      };
    }

    const windowObservations = this.observations.filter(
      (o) =>
        o.regime === law.targetRegime &&
        o.timestamp >= law.evaluationWindowStart &&
        o.timestamp <= law.evaluationWindowEnd
    );

    if (windowObservations.length < 15) {
      return {
        isValidated: false,
        reason: `INSUFFICIENT_OUT_OF_SAMPLE_DATA: Got ${windowObservations.length} < 15 observations in preregistered window`,
      };
    }

    const mean = windowObservations.reduce((acc, o) => acc + o.residual, 0) / windowObservations.length;
    const directionMatches =
      (law.expectedDirection === 'POSITIVE_BIAS' && mean > 0) ||
      (law.expectedDirection === 'NEGATIVE_BIAS' && mean < 0);

    if (!directionMatches) {
      return {
        isValidated: false,
        reason: `PREDICTION_FAILED: Expected ${law.expectedDirection}, observed mean residual ${mean.toFixed(6)}`,
      };
    }

    this.preregisteredLaws.set(lawId, { ...law, isValidated: true });
    return { isValidated: true };
  }
}
