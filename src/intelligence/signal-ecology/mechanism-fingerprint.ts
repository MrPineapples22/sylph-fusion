/**
 * SYLPH FUSION — STRATEGY MECHANISM FINGERPRINTING & NEGATIVE-KNOWLEDGE ECOLOGY
 * Specifications: Blueprint Section 41
 * Workbook: #603, #607, #611, #615, #619, #623, #627, #631, #635, #639
 *
 * Invariant:
 * 1. Renamed strategies with identical or near-identical mechanisms are detected as semantic duplicates.
 * 2. Falsified mechanisms produce permanent negative-knowledge records; near-duplicates inherit
 *    a falsification prior and require strict proof of incremental contribution before admission.
 */

import { createHash } from 'node:crypto';

export interface StrategyMechanismFingerprint {
  readonly strategyId: string;
  readonly inputs: readonly string[];
  readonly featureTransformations: readonly string[];
  readonly hypothesis: string;
  readonly decisionRule: string;
  readonly riskRule: string;
  readonly capitalRule: string;
  readonly executionRoute: string;
  readonly exitRule: string;
  readonly targetRegime: string;
  readonly fingerprintHash: string;
}

export interface FalsifiedMechanismRecord {
  readonly fingerprintHash: string;
  readonly strategyId: string;
  readonly falsifiedAt: number;
  readonly falsificationReason: string;
  readonly evidenceRoot: string;
}

export interface MechanismSimilarityEvaluation {
  readonly candidateStrategyId: string;
  readonly matchedStrategyId: string;
  readonly similarityScore: number;
  readonly isSemanticDuplicate: boolean;
  readonly inheritsFalsificationPrior: boolean;
  readonly priorFalsificationRecord?: FalsifiedMechanismRecord;
  readonly requiredOosSampleHurdle: number;
}

export class StrategyEcologyRegistry {
  private readonly registeredFingerprints = new Map<string, StrategyMechanismFingerprint>();
  private readonly falsifiedMechanisms = new Map<string, FalsifiedMechanismRecord>();

  public static computeFingerprintHash(params: Omit<StrategyMechanismFingerprint, 'fingerprintHash'>): string {
    const canonicalPayload = [
      [...params.inputs].sort().join(','),
      [...params.featureTransformations].sort().join(','),
      params.hypothesis.trim().toLowerCase(),
      params.decisionRule.trim().toLowerCase(),
      params.riskRule.trim().toLowerCase(),
      params.capitalRule.trim().toLowerCase(),
      params.executionRoute.trim().toLowerCase(),
      params.exitRule.trim().toLowerCase(),
      params.targetRegime.trim().toLowerCase(),
    ].join('||');

    return createHash('sha256').update(canonicalPayload).digest('hex');
  }

  public registerStrategy(params: Omit<StrategyMechanismFingerprint, 'fingerprintHash'>): StrategyMechanismFingerprint {
    const fingerprintHash = StrategyEcologyRegistry.computeFingerprintHash(params);
    const fingerprint: StrategyMechanismFingerprint = {
      ...params,
      fingerprintHash,
    };
    this.registeredFingerprints.set(params.strategyId, fingerprint);
    return fingerprint;
  }

  public recordFalsifiedMechanism(record: FalsifiedMechanismRecord): void {
    this.falsifiedMechanisms.set(record.fingerprintHash, record);
  }

  /**
   * Evaluates candidate strategy against known mechanism ecology.
   * Detects semantic duplicates and falsification inheritance.
   */
  public evaluateCandidate(
    candidate: Omit<StrategyMechanismFingerprint, 'fingerprintHash'>
  ): MechanismSimilarityEvaluation {
    const candidateHash = StrategyEcologyRegistry.computeFingerprintHash(candidate);

    // 1. Direct falsification check
    const directFalsified = this.falsifiedMechanisms.get(candidateHash);
    if (directFalsified) {
      return {
        candidateStrategyId: candidate.strategyId,
        matchedStrategyId: directFalsified.strategyId,
        similarityScore: 1.0,
        isSemanticDuplicate: true,
        inheritsFalsificationPrior: true,
        priorFalsificationRecord: directFalsified,
        requiredOosSampleHurdle: 500, // Strict penalty for resurrecting a falsified mechanism
      };
    }

    let highestSimilarity = 0;
    let matchedId = '';
    let inheritedFalsification: FalsifiedMechanismRecord | undefined;

    // 2. Check similarity against all registered and falsified mechanisms
    for (const [id, existing] of this.registeredFingerprints) {
      if (id === candidate.strategyId) continue;
      const score = this.calculateSimilarity(candidate, existing);
      if (score > highestSimilarity) {
        highestSimilarity = score;
        matchedId = id;
      }
    }

    for (const falsified of this.falsifiedMechanisms.values()) {
      // Find original fingerprint if available
      const existing = this.registeredFingerprints.get(falsified.strategyId);
      if (existing) {
        const score = this.calculateSimilarity(candidate, existing);
        if (score >= 0.8 && (!inheritedFalsification || score > highestSimilarity)) {
          inheritedFalsification = falsified;
        }
      }
    }

    const isDuplicate = highestSimilarity >= 0.85;
    const inheritsFalsification = Boolean(inheritedFalsification);

    return {
      candidateStrategyId: candidate.strategyId,
      matchedStrategyId: matchedId,
      similarityScore: Number(highestSimilarity.toFixed(4)),
      isSemanticDuplicate: isDuplicate,
      inheritsFalsificationPrior: inheritsFalsification,
      priorFalsificationRecord: inheritedFalsification,
      requiredOosSampleHurdle: inheritsFalsification ? 300 : isDuplicate ? 200 : 100,
    };
  }

  private calculateSimilarity(
    a: Omit<StrategyMechanismFingerprint, 'fingerprintHash'>,
    b: StrategyMechanismFingerprint
  ): number {
    const inputSim = this.jaccardSimilarity(new Set(a.inputs), new Set(b.inputs));
    const transSim = this.jaccardSimilarity(new Set(a.featureTransformations), new Set(b.featureTransformations));
    const routeSim = a.executionRoute === b.executionRoute ? 1.0 : 0.0;
    const regimeSim = a.targetRegime === b.targetRegime ? 1.0 : 0.0;
    const ruleSim =
      (a.decisionRule === b.decisionRule ? 0.5 : 0) +
      (a.riskRule === b.riskRule ? 0.3 : 0) +
      (a.exitRule === b.exitRule ? 0.2 : 0);

    return inputSim * 0.3 + transSim * 0.2 + routeSim * 0.15 + regimeSim * 0.15 + ruleSim * 0.2;
  }

  private jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    let intersection = 0;
    for (const elem of setA) {
      if (setB.has(elem)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }
}
