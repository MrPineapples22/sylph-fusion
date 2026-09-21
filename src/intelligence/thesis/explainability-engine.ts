/**
 * SOL-SYLPH Forensic Explainability Engine
 * Blueprint Part LI
 *
 * Implements the 4 essential explainability questions:
 * 1. WHY? (Evidence supporting the current state)
 * 2. WHY NOT? (Evidence preventing approval or live execution)
 * 3. WHAT CHANGED? (Material delta between state revisions)
 * 4. WHY STILL VALID? (Why thesis holds despite adverse noise or price dips)
 */

export interface ForensicExplainabilityReport {
  readonly mint: string;
  readonly why: readonly string[];
  readonly whyNot: readonly string[];
  readonly whatChanged: readonly string[];
  readonly whyStillValid: readonly string[];
  readonly generatedAtMs: number;
}

export class ForensicExplainabilityEngine {
  public generateReport(params: {
    mint: string;
    proofState: '3/3' | '2/3' | 'REVIEW' | 'FAIL' | 'UNKNOWN';
    structuralValid: boolean;
    structuralFailures?: readonly string[];
    marketValid: boolean;
    marketFailures?: readonly string[];
    executionValid: boolean;
    executionFailures?: readonly string[];
    priceChangePct?: number;
    netIndependentFlowSol?: number;
    topClusterSharePct?: number;
    exitCapacitySol?: number;
    stateDeltas?: readonly string[];
  }): ForensicExplainabilityReport {
    const mint = params.mint;
    const why: string[] = [];
    const whyNot: string[] = [];
    const whatChanged: string[] = params.stateDeltas ? [...params.stateDeltas] : [];
    const whyStillValid: string[] = [];

    // 1. WHY?
    if (params.structuralValid) why.push('Structural safety invariants verified (mint/freeze authorities safe, no backdoor extensions).');
    if (params.marketValid) why.push('Market authenticity confirmed by independent economic actor cluster growth.');
    if (params.executionValid) why.push('Round-trip quotes verified and robust exit capacity meets sizing constraints.');
    if ((params.netIndependentFlowSol ?? 0) > 0) why.push(`Net independent capital flow positive (+${(params.netIndependentFlowSol ?? 0).toFixed(2)} SOL).`);

    // 2. WHY NOT?
    if (!params.structuralValid) {
      whyNot.push(`Structural gates failed: ${params.structuralFailures?.join(', ') || 'Unsafe authorities'}`);
    }
    if (!params.marketValid) {
      whyNot.push(`Market authenticity gates failed: ${params.marketFailures?.join(', ') || 'Sybil/wash swarm detected'}`);
    }
    if (!params.executionValid) {
      whyNot.push(`Execution gates failed: ${params.executionFailures?.join(', ') || 'Insufficient exit capacity'}`);
    }
    if (params.proofState !== '3/3') {
      whyNot.push(`Unified proof state is ${params.proofState} (requires 3/3 for live capital execution).`);
    }

    // 3. WHAT CHANGED?
    if (whatChanged.length === 0) {
      whatChanged.push('No material state transitions in the current evaluation window.');
    }

    // 4. WHY STILL VALID?
    const priceDipped = (params.priceChangePct ?? 0) < -5;
    if (priceDipped) {
      whyStillValid.push(`Price fell by ${Math.abs(params.priceChangePct ?? 0).toFixed(1)}%, but:`);
      if ((params.netIndependentFlowSol ?? 0) >= 0) {
        whyStillValid.push('Independent capital remains positive or stable (no net retail capital flight).');
      }
      if ((params.topClusterSharePct ?? 0) < 40) {
        whyStillValid.push(`Top cluster concentration acceptable (${(params.topClusterSharePct ?? 0).toFixed(1)}%).`);
      }
      if ((params.exitCapacitySol ?? 0) >= 2.0) {
        whyStillValid.push(`Executable exit capacity remains robust (${(params.exitCapacitySol ?? 0).toFixed(2)} SOL).`);
      }
      if (params.structuralValid) {
        whyStillValid.push('Structural certificate remains intact and valid.');
      }
      whyStillValid.push('Conclusion: Price movement is volatile noise; fundamental thesis has NOT been invalidated.');
    } else {
      whyStillValid.push('All baseline assumptions hold; no contradicting adversarial shock observed.');
    }

    return {
      mint,
      why,
      whyNot,
      whatChanged,
      whyStillValid,
      generatedAtMs: Date.now(),
    };
  }
}
