/**
 * SYLPH FUSION — CAPABILITY REGISTRY & RESEARCH PROMOTION GOVERNANCE
 * Specifications: Prompt 28, Prompt 29, Prompt 45, Prompt 46
 *
 * Rules:
 * 1. Promotion ladder: RESEARCH -> SHADOW -> MICRO -> LIMITED -> CERTIFIED.
 * 2. NO direct MODEL -> MONEY or RESEARCH -> PRODUCTION shortcut.
 * 3. JEV rule-v0 remains deterministic rule-based research intelligence (authority=INFER).
 * 4. MULTIPLIER-X remains research intelligence only (authority=INFER).
 * 5. Capability categories:
 *      ObservationFeature, ExecutionFeature, RiskFeature, ProfitAdjustment,
 *      RouteCandidate, TransportCandidate, AdmissionRule.
 * 6. Most experimental capabilities have OBSERVE or INFER authority only.
 */
export class CapabilityRegistry {
    capabilities = new Map();
    modelRegistry = new Map();
    constructor() {
        this.registerDefaultCapabilities();
    }
    registerDefaultCapabilities() {
        // Prompt 28: JEV rule-v0
        this.registerModel({
            modelId: 'jev-rule-v0',
            modelVersion: '0.1.0-rules',
            trainingStatus: 'RULE_BASED',
            calibrationStatus: 'HEURISTIC',
            validationStatus: 'RESEARCH_ONLY',
            authority: 'INFER',
        });
        // Prompt 29: MULTIPLIER-X
        this.registerModel({
            modelId: 'multiplier-x',
            modelVersion: '1.0.0-research',
            trainingStatus: 'RULE_BASED',
            calibrationStatus: 'HEURISTIC',
            validationStatus: 'RESEARCH_ONLY',
            authority: 'INFER',
        });
        // Core Solana-Native Execution Features (Prompt 47)
        this.registerCapability({
            id: 'solana-bank-state-fingerprint',
            name: 'Bank-State Fingerprint',
            version: '1.0.0',
            category: 'ObservationFeature',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['slot', 'blockhash', 'commitment'],
            outputs: ['bankFingerprint'],
            dependencies: ['ChainTruthEngine'],
            failureMode: 'FALLBACK_TO_UNFINGERPRINTED_STALL',
        });
        this.registerCapability({
            id: 'token-2022-semantics-inspector',
            name: 'Token-2022 Extension Compiler',
            version: '1.0.0',
            category: 'AdmissionRule',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['mintBytecode', 'accountInfo'],
            outputs: ['transferHooks', 'permanentDelegate', 'withheldFees'],
            dependencies: ['TokenProgramInspector'],
            failureMode: 'VETO_UNVERIFIED_PROGRAM',
        });
        // Prompt 47: Solana-Native Execution Features
        this.registerCapability({
            id: 'leader-relative-execution-clock',
            name: 'Leader-Relative Execution Clock',
            version: '1.0.0',
            category: 'ExecutionFeature',
            stage: 'RESEARCH',
            authority: 'INFER',
            inputs: ['slot', 'leaderSchedule', 'expectedLatency'],
            outputs: ['slotOffset', 'leaderAffinityScore'],
            dependencies: ['ChainTruthEngine'],
            failureMode: 'FAIL_TO_CONSERVATIVE_SLOT_MIDPOINT',
        });
        this.registerCapability({
            id: 'local-auction-mapper',
            name: 'Local Auction Mapper',
            version: '1.0.0',
            category: 'ExecutionFeature',
            stage: 'RESEARCH',
            authority: 'OBSERVE',
            inputs: ['writableAccounts', 'recentBlockFees'],
            outputs: ['contentionBps', 'localizedAuctionIndex'],
            dependencies: ['RpcPool'],
            failureMode: 'FALLBACK_TO_CLUSTER_MEAN_FEE',
        });
        this.registerCapability({
            id: 'priority-fee-jito-tip-optimizer',
            name: 'Priority-Fee + Jito-Tip Joint Optimizer',
            version: '1.0.0',
            category: 'ExecutionFeature',
            stage: 'SHADOW',
            authority: 'INFER',
            inputs: ['localizedAuctionIndex', 'targetLandingSlot', 'expectedAlphaLamports'],
            outputs: ['optimalPriorityFeeMicroLamports', 'optimalJitoTipLamports'],
            dependencies: ['local-auction-mapper'],
            failureMode: 'CLAMP_TO_MAX_SAFE_FEES',
        });
        // Prompt 48: Transport / Ingestion Features
        this.registerCapability({
            id: 'cross-transport-same-intent-ledger',
            name: 'Cross-Transport Same-Intent Ledger',
            version: '1.0.0',
            category: 'TransportCandidate',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['economicFactId', 'messageHash', 'transactionSignature'],
            outputs: ['activeTransportAttempts', 'deduplicationKey'],
            dependencies: ['FusionJournal'],
            failureMode: 'REJECT_DUPLICATE_INTENT',
        });
        this.registerCapability({
            id: 'preflight-divergence-detector',
            name: 'Preflight Divergence Detector',
            version: '1.0.0',
            category: 'ObservationFeature',
            stage: 'RESEARCH',
            authority: 'OBSERVE',
            inputs: ['simulatedResult', 'onChainLandedResult'],
            outputs: ['divergenceClass', 'deltaLamports'],
            dependencies: ['RpcPool'],
            failureMode: 'FLAG_HIGH_SIMULATION_SENSITIVITY',
        });
        // Prompt 49: Outcome / Economic Features
        this.registerCapability({
            id: 'real-slippage-observatory',
            name: 'Real Slippage Observatory',
            version: '1.0.0',
            category: 'ObservationFeature',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['quotePrice', 'landedPrice', 'quoteAgeMs', 'route'],
            outputs: ['realizedLossBps', 'lossDecomposition'],
            dependencies: ['EconomicAuthorityStore'],
            failureMode: 'REJECT_UNVERIFIED_ESTIMATE',
        });
        this.registerCapability({
            id: 'capital-time-accounting',
            name: 'Capital-Time Accounting',
            version: '1.0.0',
            category: 'ProfitAdjustment',
            stage: 'CERTIFIED',
            authority: 'INFER',
            inputs: ['capitalLockedLamports', 'lockDurationMs', 'hurdleRateAnnualizedBps'],
            outputs: ['capitalTimeCostLamports'],
            dependencies: ['EconomicAuthorityStore'],
            failureMode: 'CONSERVATIVE_MAX_LOCK_COST',
        });
        // Prompt 50: Token / Program Semantic Features
        this.registerCapability({
            id: 'transfer-hook-dependency-graph',
            name: 'Transfer-Hook Dependency Graph',
            version: '1.0.0',
            category: 'AdmissionRule',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['mintAddress', 'extraAccountMetas'],
            outputs: ['hookProgramId', 'requiredExtraAccounts'],
            dependencies: ['TokenProgramInspector'],
            failureMode: 'QUARANTINE_UNKNOWN_HOOK',
        });
        this.registerCapability({
            id: 'cpi-semantic-firewall',
            name: 'CPI Semantic Firewall',
            version: '1.0.0',
            category: 'AdmissionRule',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['instructionBytes', 'invokedProgramIds'],
            outputs: ['verifiedCpiTree', 'unauthorizedTransferDetected'],
            dependencies: ['TransactionVerifier'],
            failureMode: 'VETO_UNAUTHORIZED_CPI',
        });
        // Prompt 51: Market / Resource / Governance Features
        this.registerCapability({
            id: 'economic-workload-deduplicator',
            name: 'Economic Workload Deduplicator',
            version: '1.0.0',
            category: 'AdmissionRule',
            stage: 'CERTIFIED',
            authority: 'OBSERVE',
            inputs: ['economicFactId', 'activePermits'],
            outputs: ['workloadAdmitted', 'concurrentReservationCount'],
            dependencies: ['ExecutionAuthorityAdapter'],
            failureMode: 'DROP_DUPLICATE_WORKLOAD',
        });
        this.registerCapability({
            id: 'mainnet-reality-tournament-engine',
            name: 'Mainnet Reality Tournament Engine',
            version: '1.0.0',
            category: 'ObservationFeature',
            stage: 'RESEARCH',
            authority: 'OBSERVE',
            inputs: ['competitorObservations', 'groundTruthOutcomes'],
            outputs: ['scorecards', 'rankings', 'reportHash'],
            dependencies: ['MainnetRealityTournament'],
            failureMode: 'DISCARD_UNCALIBRATED_RANKINGS',
        });
    }
    registerCapability(capability) {
        // Invariant: Research cannot register with AUTHORIZE, SIGN, or SETTLE authority
        if (capability.stage === 'RESEARCH' &&
            (capability.authority === 'AUTHORIZE' ||
                capability.authority === 'SIGN' ||
                capability.authority === 'SETTLE' ||
                capability.authority === 'RESERVE')) {
            throw new Error(`GOVERNANCE_VIOLATION: Capability '${capability.id}' at RESEARCH stage cannot claim '${capability.authority}' authority`);
        }
        this.capabilities.set(capability.id, Object.freeze({ ...capability }));
    }
    getCapability(id) {
        return this.capabilities.get(id);
    }
    registerModel(meta) {
        // Invariant: Models may never claim AUTHORIZE, SIGN, or SETTLE authority
        if (meta.authority !== 'INFER' && meta.authority !== 'RECOMMEND' && meta.authority !== 'OBSERVE') {
            throw new Error(`EPISTEMIC_VIOLATION: Model '${meta.modelId}' attempted to claim prohibited authority '${meta.authority}'. Models may only claim INFER, RECOMMEND, or OBSERVE.`);
        }
        this.modelRegistry.set(meta.modelId, Object.freeze({ ...meta }));
    }
    getModel(modelId) {
        return this.modelRegistry.get(modelId);
    }
    /**
     * Evaluates promotion gate for a capability.
     * Progression must be strictly sequential: RESEARCH -> SHADOW -> MICRO -> LIMITED -> CERTIFIED.
     */
    promoteCapability(id, targetStage, evidenceSampleSize, drawdownBps) {
        const cap = this.capabilities.get(id);
        if (!cap)
            throw new Error(`Capability not found: ${id}`);
        const stageOrder = ['RESEARCH', 'SHADOW', 'MICRO', 'LIMITED', 'CERTIFIED'];
        const currentIndex = stageOrder.indexOf(cap.stage);
        const targetIndex = stageOrder.indexOf(targetStage);
        if (targetIndex !== currentIndex + 1) {
            throw new Error(`INVALID_PROMOTION_LADDER: Cannot jump from ${cap.stage} to ${targetStage}. Step-by-step promotion required.`);
        }
        if (cap.promotionRequirements) {
            if (evidenceSampleSize < cap.promotionRequirements.minSampleSize) {
                throw new Error(`INSUFFICIENT_EVIDENCE: Sample size ${evidenceSampleSize} < required ${cap.promotionRequirements.minSampleSize}`);
            }
            if (drawdownBps > cap.promotionRequirements.maxDrawdownBps) {
                throw new Error(`DRAWDOWN_EXCEEDED: Observed drawdown ${drawdownBps}bps > allowed ${cap.promotionRequirements.maxDrawdownBps}bps`);
            }
        }
        const updated = {
            ...cap,
            stage: targetStage,
        };
        this.capabilities.set(id, Object.freeze(updated));
    }
    allCapabilities() {
        return Object.freeze(Array.from(this.capabilities.values()));
    }
}
//# sourceMappingURL=capability-registry.js.map