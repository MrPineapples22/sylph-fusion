/**
 * SOL-SYLPH Prover / Challenger / Arbiter Architecture
 * Blueprint Part XXXI
 *
 * Every serious approval requires:
 * - PROVER: Why evidence supports approval.
 * - CHALLENGER: Strongest plausible contradictory interpretation / falsification attempt.
 * - ARBITER: Resolves using evidence hierarchy, freshness, coverage, uncertainty, and hard gates.
 */

export interface ArgumentPoint {
  readonly claim: string;
  readonly supportingEvidence: string;
  readonly confidence: number;
  readonly isHardGate: boolean;
}

export interface ProverBrief {
  readonly position: 'APPROVE_THESIS';
  readonly thesisPoints: readonly ArgumentPoint[];
  readonly aggregateStrength: number; // 0.0 - 1.0
}

export interface ChallengerBrief {
  readonly position: 'FALSIFY_THESIS';
  readonly counterTheses: readonly ArgumentPoint[];
  readonly fatalFlawIdentified: boolean;
  readonly strongestObjection: string;
  readonly aggregateSeverity: number; // 0.0 - 1.0
}

export interface ArbiterRuling {
  readonly decision: 'PROCEED' | 'CHALLENGE_UPHELD' | 'ABSTAIN_UNCERTAINTY';
  readonly proverConfidence: number;
  readonly challengerSeverity: number;
  readonly resolutionRationale: string;
  readonly decisiveEvidenceCategory: string;
  readonly ruledAtMs: number;
}

export class ProverChallengerArbiterEngine {
  public evaluateCase(params: {
    mint: string;
    proverPoints: readonly ArgumentPoint[];
    challengerPoints: readonly ArgumentPoint[];
    evidenceCoverageRatio: number;
    hasCriticalUnknowns: boolean;
  }): ArbiterRuling {
    const proverStrength = params.proverPoints.length > 0
      ? params.proverPoints.reduce((acc, p) => acc + p.confidence, 0) / params.proverPoints.length
      : 0.0;

    const hasFatal = params.challengerPoints.some(c => c.isHardGate || c.confidence > 0.85);
    const challengerSeverity = params.challengerPoints.length > 0
      ? Math.max(...params.challengerPoints.map(c => c.confidence))
      : 0.0;

    const now = Date.now();

    // Arbiter hierarchy:
    // 1. Hard Gate / Fatal Flaws strictly veto.
    // 2. High uncertainty or critical unknowns force ABSTAIN.
    // 3. Prover vs Challenger evidence balance.

    if (hasFatal) {
      const fatal = params.challengerPoints.find(c => c.isHardGate || c.confidence > 0.85)!;
      return {
        decision: 'CHALLENGE_UPHELD',
        proverConfidence: proverStrength,
        challengerSeverity,
        resolutionRationale: `Challenger upheld: Fatal flaw detected (${fatal.claim}: ${fatal.supportingEvidence})`,
        decisiveEvidenceCategory: 'STRUCTURAL_HARD_GATE',
        ruledAtMs: now,
      };
    }

    if (params.hasCriticalUnknowns || params.evidenceCoverageRatio < 0.6) {
      return {
        decision: 'ABSTAIN_UNCERTAINTY',
        proverConfidence: proverStrength,
        challengerSeverity,
        resolutionRationale: `Arbiter abstains: Insufficient evidence coverage (${(params.evidenceCoverageRatio * 100).toFixed(0)}%) or critical unknown facts present.`,
        decisiveEvidenceCategory: 'UNCERTAINTY_CEILING',
        ruledAtMs: now,
      };
    }

    if (proverStrength > 0.65 && challengerSeverity < 0.6) {
      return {
        decision: 'PROCEED',
        proverConfidence: proverStrength,
        challengerSeverity,
        resolutionRationale: `Prover prevails: Supported by ${params.proverPoints.length} verified evidence points with low challenger contradiction.`,
        decisiveEvidenceCategory: 'VERIFIED_MULTI_AGENT_CONSENSUS',
        ruledAtMs: now,
      };
    }

    return {
      decision: 'CHALLENGE_UPHELD',
      proverConfidence: proverStrength,
      challengerSeverity,
      resolutionRationale: `Challenger prevails: Counter-thesis objections (${challengerSeverity.toFixed(2)}) outweigh affirmative evidence (${proverStrength.toFixed(2)}).`,
      decisiveEvidenceCategory: 'ADVERSARIAL_CONTRADICTION',
      ruledAtMs: now,
    };
  }
}
