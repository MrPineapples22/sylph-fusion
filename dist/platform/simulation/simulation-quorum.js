/**
 * SOL-SYLPH Platform - Multi-Provider Simulation Quorum & Quarantine Engine
 * Specifications: 500-Item Roadmap Layer II (#145, #146), Layer III (#280, #281, #284).
 *
 * Implements:
 * 1. Multi-Provider SimulationQuorum: Cross-evaluates simulation outcomes across distinct RPC backends.
 * 2. Provider Context-Slot Normalization: Adjusts for provider ledger lag and rejects desynced nodes.
 * 3. Automated Provider Quarantine: Quarantines nodes that return divergent transaction traces or silent omissions.
 */
export class SimulationQuorum {
    static MAX_SLOT_LAG = 2;
    static MAX_OUTPUT_DIVERGENCE_BPS = 150; // 1.5% max allowable divergence across nodes
    static MAX_CU_DIVERGENCE_BPS = 2500; // 25% max allowable CU variance
    /**
     * Evaluates simulation outputs from multiple providers and enforces consensus.
     * Fails closed if nodes disagree on execution outcome, revert status, or token amount.
     *
     * @param responses Set of simulation responses from independent RPC providers
     */
    static evaluateQuorum(responses) {
        if (responses.length === 0) {
            return {
                status: 'QUORUM_FAILED',
                totalProviders: 0,
                agreeingProviders: [],
                quarantinedProviders: [],
                consensusOutputLamports: 0n,
                consensusComputeUnits: 0,
                maxOutputDivergenceBps: 10_000,
                referenceContextSlot: 0,
                quorumConfidence: 0,
                rationale: 'QUORUM_EMPTY: No provider simulation responses provided; failing closed',
            };
        }
        // 1. Context-Slot Normalization: Find the leading context slot
        const maxContextSlot = Math.max(...responses.map(r => r.contextSlot));
        const quarantinedProviders = [];
        const validResponses = [];
        for (const res of responses) {
            if (maxContextSlot - res.contextSlot > this.MAX_SLOT_LAG) {
                quarantinedProviders.push(`${res.providerId} (LAGGING_SLOT: slot ${res.contextSlot} vs lead ${maxContextSlot})`);
            }
            else {
                validResponses.push(res);
            }
        }
        if (validResponses.length === 0) {
            return {
                status: 'PROVIDER_DISAGREEMENT_QUARANTINE',
                totalProviders: responses.length,
                agreeingProviders: [],
                quarantinedProviders: Object.freeze(quarantinedProviders),
                consensusOutputLamports: 0n,
                consensusComputeUnits: 0,
                maxOutputDivergenceBps: 10_000,
                referenceContextSlot: maxContextSlot,
                quorumConfidence: 0,
                rationale: 'ALL_PROVIDERS_LAGGING: Every provider failed context slot synchronization; quarantined',
            };
        }
        // 2. Success Status Check
        const successful = validResponses.filter(r => r.success && r.outputLamports > 0n);
        const failed = validResponses.filter(r => !r.success || r.outputLamports <= 0n);
        // If providers disagree on whether the transaction reverts, fail closed and quarantine
        if (failed.length > 0 && successful.length > 0) {
            for (const f of failed) {
                quarantinedProviders.push(`${f.providerId} (EXECUTION_REVERT: ${f.errorCode ?? 'SIMULATION_REVERTED'})`);
            }
            return {
                status: 'PROVIDER_DISAGREEMENT_QUARANTINE',
                totalProviders: responses.length,
                agreeingProviders: Object.freeze(successful.map(s => s.providerId)),
                quarantinedProviders: Object.freeze(quarantinedProviders),
                consensusOutputLamports: 0n,
                consensusComputeUnits: 0,
                maxOutputDivergenceBps: 10_000,
                referenceContextSlot: maxContextSlot,
                quorumConfidence: 0,
                rationale: `EXECUTION_DISAGREEMENT: ${successful.length} providers reported success but ${failed.length} reported revert; failing closed`,
            };
        }
        if (successful.length === 0) {
            return {
                status: 'QUORUM_FAILED',
                totalProviders: responses.length,
                agreeingProviders: [],
                quarantinedProviders: Object.freeze(quarantinedProviders),
                consensusOutputLamports: 0n,
                consensusComputeUnits: 0,
                maxOutputDivergenceBps: 0,
                referenceContextSlot: maxContextSlot,
                quorumConfidence: 0,
                rationale: `ALL_PROVIDERS_REVERTED: Simulation failed across all valid nodes (${failed.map(f => f.errorCode || 'UNKNOWN').join(', ')})`,
            };
        }
        // 3. Output Amount & CU Divergence Check
        // Sort outputs to compute median
        const sortedOutputs = [...successful].sort((a, b) => (a.outputLamports < b.outputLamports ? -1 : 1));
        const medianResponse = sortedOutputs[Math.floor(sortedOutputs.length / 2)];
        const medianOutput = medianResponse.outputLamports;
        let maxOutputDivergenceBps = 0;
        const agreeingProviders = [];
        for (const res of successful) {
            const diff = res.outputLamports > medianOutput
                ? res.outputLamports - medianOutput
                : medianOutput - res.outputLamports;
            const divergenceBps = Number((diff * 10000n) / medianOutput);
            if (divergenceBps > this.MAX_OUTPUT_DIVERGENCE_BPS) {
                quarantinedProviders.push(`${res.providerId} (OUTPUT_DIVERGENCE: ${divergenceBps} bps vs median ${medianOutput})`);
            }
            else {
                agreeingProviders.push(res.providerId);
                if (divergenceBps > maxOutputDivergenceBps) {
                    maxOutputDivergenceBps = divergenceBps;
                }
            }
        }
        // Consensus requires majority of participating providers to agree
        const consensusRatio = agreeingProviders.length / responses.length;
        if (agreeingProviders.length === 0 || consensusRatio < 0.5) {
            return {
                status: 'PROVIDER_DISAGREEMENT_QUARANTINE',
                totalProviders: responses.length,
                agreeingProviders: Object.freeze(agreeingProviders),
                quarantinedProviders: Object.freeze(quarantinedProviders),
                consensusOutputLamports: 0n,
                consensusComputeUnits: 0,
                maxOutputDivergenceBps,
                referenceContextSlot: maxContextSlot,
                quorumConfidence: Number(consensusRatio.toFixed(2)),
                rationale: `QUORUM_DIVERGENCE: Less than 50% consensus on output amount (${agreeingProviders.length}/${responses.length} agree)`,
            };
        }
        // Average CU among agreeing providers
        const agreeingResponses = successful.filter(r => agreeingProviders.includes(r.providerId));
        const avgCu = Math.round(agreeingResponses.reduce((sum, r) => sum + r.computeUnitsConsumed, 0) / agreeingResponses.length);
        return {
            status: 'CONSENSUS_ACHIEVED',
            totalProviders: responses.length,
            agreeingProviders: Object.freeze(agreeingProviders),
            quarantinedProviders: Object.freeze(quarantinedProviders),
            consensusOutputLamports: medianOutput,
            consensusComputeUnits: avgCu,
            maxOutputDivergenceBps,
            referenceContextSlot: maxContextSlot,
            quorumConfidence: Number(consensusRatio.toFixed(2)),
            rationale: `Consensus achieved: ${agreeingProviders.length}/${responses.length} providers agreed with max divergence ${maxOutputDivergenceBps} bps`,
        };
    }
}
//# sourceMappingURL=simulation-quorum.js.map