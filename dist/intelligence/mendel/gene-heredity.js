/**
 * SOL-SYLPH MENDEL — Strategy Heredity, Component Attribution & Safe Recombination
 * Part V — 12 Gene Types, Gene Lineage Graph, Synergistic/Antagonistic Interactions
 */
export class MendelGeneHeredityEngine {
    genes = new Map();
    interactions = new Map();
    constructor() {
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
    registerGene(gene) {
        this.genes.set(gene.gene_id, gene);
    }
    getGene(gene_id) {
        return this.genes.get(gene_id);
    }
    getAllGenes() {
        return Array.from(this.genes.values());
    }
    /**
     * Safe Recombination: Propose a child strategy combining genes from two parents.
     * INVARIANT: CERTIFIED PARENT + CERTIFIED PARENT != CERTIFIED CHILD.
     * Child ALWAYS starts at UNVERIFIED.
     */
    recombineStrategies(parent_strategy_a, parent_strategy_b) {
        const combinedGeneIds = Array.from(new Set([...parent_strategy_a.genes, ...parent_strategy_b.genes]));
        const inherited = [];
        for (const gid of combinedGeneIds) {
            const g = this.genes.get(gid);
            if (g)
                inherited.push(g);
        }
        const predictedInteractions = [
            {
                gene_a: parent_strategy_a.genes[0] || 'gene_entry_accel',
                gene_b: parent_strategy_b.genes[0] || 'gene_filter_pod',
                interaction: 'SYNERGISTIC',
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
    attributeGeneEffect(gene_id, with_gene_pnl, without_gene_pnl) {
        const diff = with_gene_pnl - without_gene_pnl;
        let interaction = 'NEUTRAL';
        if (diff > 0.5)
            interaction = 'SYNERGISTIC';
        else if (diff < -0.2)
            interaction = 'ANTAGONISTIC';
        return {
            gene_id,
            marginal_contribution_sol: Number(diff.toFixed(3)),
            interaction,
        };
    }
}
//# sourceMappingURL=gene-heredity.js.map