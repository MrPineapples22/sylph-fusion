/**
 * SOL-SYLPH MENDEL — Strategy Heredity, Component Attribution & Safe Recombination
 * Part V — 12 Gene Types, Gene Lineage Graph, Synergistic/Antagonistic Interactions
 */

export type GeneType =
  | 'EntryGene'
  | 'FilterGene'
  | 'TimingGene'
  | 'ScaleGene'
  | 'EvidenceGene'
  | 'WalletGene'
  | 'RegimeGene'
  | 'SizingGene'
  | 'RiskGene'
  | 'ExitGene'
  | 'RecoveryGene'
  | 'ExecutionAdapterGene';

export type GeneInteraction = 'SYNERGISTIC' | 'ANTAGONISTIC' | 'NEUTRAL' | 'UNKNOWN';

export interface StrategyGene {
  readonly gene_id: string;
  readonly gene_type: GeneType;
  readonly version: string;
  readonly implementation_ref: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly required_capabilities: readonly string[];
  readonly required_evidence: readonly string[];
  readonly supported_regimes: readonly string[];
  readonly latency_budget_ms: number;
  readonly risk_class: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  readonly authority_ceiling: 'A0_OBSERVE' | 'A1_ADVISE' | 'A2_INFLUENCE' | 'A3_VETO' | 'A4_AUTHORIZE';
  readonly dependencies: readonly string[];
  readonly incompatibilities: readonly string[];
  readonly parent_gene_ids: readonly string[];
  readonly artifact_hash: string;
  readonly certification_state: 'CERTIFIED' | 'PROVISIONAL' | 'UNVERIFIED' | 'DEPRECATED';
}

export interface RecombinationProposal {
  readonly child_strategy_id: string;
  readonly parent_strategy_ids: readonly [string, string];
  readonly inherited_genes: readonly StrategyGene[];
  readonly certification_state: 'UNVERIFIED'; // Invariant: Child never inherits certified status!
  readonly predicted_interactions: readonly {
    gene_a: string;
    gene_b: string;
    interaction: GeneInteraction;
  }[];
  readonly requires_verification_pipeline: true;
}

export class MendelGeneHeredityEngine {
  private readonly genes = new Map<string, StrategyGene>();
  private readonly interactions = new Map<string, GeneInteraction>();

  public constructor() {
    // Seed core baseline genes
    this.registerGene({
      gene_id: 'gene_entry_accel',
      gene_type: 'EntryGene',
      version: '1.0.0',
      implementation_ref: 'bonding_curve_accel_v1',
      inputs: ['pump_score', 'velocity'],
      outputs: ['entry_signal'],
      required_capabilities: ['TOKEN_DISCOVERY'],
      required_evidence: ['fresh_quotes'],
      supported_regimes: ['NORMAL', 'OPPORTUNITY_RICH'],
      latency_budget_ms: 10,
      risk_class: 'MODERATE',
      authority_ceiling: 'A1_ADVISE',
      dependencies: [],
      incompatibilities: ['gene_entry_mean_reversion'],
      parent_gene_ids: [],
      artifact_hash: 'hash_gene_entry_accel',
      certification_state: 'CERTIFIED',
    });

    this.registerGene({
      gene_id: 'gene_filter_pod',
      gene_type: 'FilterGene',
      version: '1.0.0',
      implementation_ref: 'pod_overhang_filter_v1',
      inputs: ['pod_score', 'top_cluster_share'],
      outputs: ['filter_verdict'],
      required_capabilities: ['MARKET_MONITORING'],
      required_evidence: ['cluster_graph'],
      supported_regimes: ['ALL'],
      latency_budget_ms: 5,
      risk_class: 'CONSERVATIVE',
      authority_ceiling: 'A3_VETO',
      dependencies: [],
      incompatibilities: [],
      parent_gene_ids: [],
      artifact_hash: 'hash_gene_filter_pod',
      certification_state: 'CERTIFIED',
    });
  }

  public registerGene(gene: StrategyGene): void {
    this.genes.set(gene.gene_id, gene);
  }

  public getGene(gene_id: string): StrategyGene | undefined {
    return this.genes.get(gene_id);
  }

  public getAllGenes(): readonly StrategyGene[] {
    return Array.from(this.genes.values());
  }

  /**
   * Safe Recombination: Propose a child strategy combining genes from two parents.
   * INVARIANT: CERTIFIED PARENT + CERTIFIED PARENT != CERTIFIED CHILD.
   * Child ALWAYS starts at UNVERIFIED.
   */
  public recombineStrategies(
    parent_strategy_a: { id: string; genes: readonly string[] },
    parent_strategy_b: { id: string; genes: readonly string[] }
  ): RecombinationProposal {
    const combinedGeneIds = Array.from(new Set([...parent_strategy_a.genes, ...parent_strategy_b.genes]));
    const inherited: StrategyGene[] = [];

    for (const gid of combinedGeneIds) {
      const g = this.genes.get(gid);
      if (g) inherited.push(g);
    }

    const predictedInteractions = [
      {
        gene_a: parent_strategy_a.genes[0] || 'gene_entry_accel',
        gene_b: parent_strategy_b.genes[0] || 'gene_filter_pod',
        interaction: 'SYNERGISTIC' as GeneInteraction,
      },
    ];

    return {
      child_strategy_id: `strat_child_${parent_strategy_a.id.slice(0, 4)}_${parent_strategy_b.id.slice(0, 4)}_${Date.now()}`,
      parent_strategy_ids: [parent_strategy_a.id, parent_strategy_b.id],
      inherited_genes: inherited,
      certification_state: 'UNVERIFIED', // Non-negotiable invariant!
      predicted_interactions: predictedInteractions,
      requires_verification_pipeline: true,
    };
  }

  /**
   * Component Attribution (Ablation / Paired Replay Testing)
   */
  public attributeGeneEffect(
    gene_id: string,
    with_gene_pnl: number,
    without_gene_pnl: number
  ): {
    gene_id: string;
    marginal_contribution_sol: number;
    interaction: GeneInteraction;
  } {
    const diff = with_gene_pnl - without_gene_pnl;
    let interaction: GeneInteraction = 'NEUTRAL';
    if (diff > 0.5) interaction = 'SYNERGISTIC';
    else if (diff < -0.2) interaction = 'ANTAGONISTIC';

    return {
      gene_id,
      marginal_contribution_sol: Number(diff.toFixed(3)),
      interaction,
    };
  }
}
