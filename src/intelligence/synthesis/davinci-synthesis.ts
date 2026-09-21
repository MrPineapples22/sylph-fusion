/**
 * DA VINCI: Strategy Synthesis & Hypothesis Discovery Engine
 * Blueprint Engine #36
 * 
 * Generates candidate hypotheses, feature combinations, and novel interaction signals.
 * Invariant: All outputs remain unverified research candidates until validated by Franklin/Fisher.
 * Maintains a permanent archive of rejected hypotheses.
 */

export interface CandidateSynthesizedHypothesis {
  readonly hypothesis_id: string;
  readonly name: string;
  readonly feature_combination: readonly string[];
  readonly condition_logic: string;
  readonly initial_rationale: string;
  readonly is_negative_signal: boolean;
  readonly status: 'PROPOSED' | 'SUBMITTED_TO_FRANKLIN' | 'REJECTED';
  readonly rejection_reason?: string;
  readonly created_at_ms: number;
}

export class DaVinciStrategySynthesisEngine {
  public static readonly VERSION = '1.0.0';
  private synthesized: Map<string, CandidateSynthesizedHypothesis> = new Map();
  private rejectedArchive: CandidateSynthesizedHypothesis[] = [];

  /**
   * Synthesizes a new hypothesis from feature interactions.
   */
  public synthesizeHypothesis(params: {
    name: string;
    feature_combination: readonly string[];
    condition_logic: string;
    initial_rationale: string;
    is_negative_signal?: boolean;
  }): CandidateSynthesizedHypothesis {
    const id = `dv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const hyp: CandidateSynthesizedHypothesis = {
      hypothesis_id: id,
      name: params.name,
      feature_combination: params.feature_combination,
      condition_logic: params.condition_logic,
      initial_rationale: params.initial_rationale,
      is_negative_signal: Boolean(params.is_negative_signal),
      status: 'PROPOSED',
      created_at_ms: Date.now()
    };

    this.synthesized.set(id, hyp);
    return hyp;
  }

  public rejectHypothesis(id: string, reason: string): void {
    const existing = this.synthesized.get(id);
    if (!existing) return;

    const rejected: CandidateSynthesizedHypothesis = {
      ...existing,
      status: 'REJECTED',
      rejection_reason: reason
    };

    this.synthesized.set(id, rejected);
    this.rejectedArchive.push(rejected);
  }

  public getActiveProposals(): readonly CandidateSynthesizedHypothesis[] {
    return Array.from(this.synthesized.values()).filter(h => h.status === 'PROPOSED');
  }

  public getRejectedArchive(): readonly CandidateSynthesizedHypothesis[] {
    return this.rejectedArchive;
  }
}
