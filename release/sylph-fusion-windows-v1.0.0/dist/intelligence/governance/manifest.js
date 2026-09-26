/**
 * SOL-SYLPH Master Production Intelligence - Strategy Governance & Production Gates
 * Specifications: Sections 87 (Strategy Governance), 88 (Strategy Promotion),
 * 89 (Champion/Challenger), 90 (Rollback), 95 (Production Gates), 97 (Safety Certificate).
 */
import { createHash } from 'node:crypto';
import { SafetyConstitution } from '../safety/constitution.js';
export class StrategyGovernance {
    championStrategy;
    manifests = new Map();
    /**
     * Create an immutable hashed StrategyManifest.
     */
    createManifest(strategyId, version, policies, featureSchemaVersion, modelVersion, parentVersion) {
        const configHash = createHash('sha256').update(JSON.stringify(policies)).digest('hex');
        const strategyHash = createHash('sha256')
            .update(`${strategyId}:${version}:${featureSchemaVersion}:${modelVersion}:${configHash}`)
            .digest('hex');
        const manifest = {
            strategyId,
            version,
            parentVersion,
            policies,
            featureSchemaVersion,
            modelVersion,
            configHash,
            strategyHash,
            state: 'PROPOSED',
            createdAtMs: Date.now(),
        };
        this.manifests.set(`${strategyId}:${version}`, manifest);
        return manifest;
    }
    /**
     * Evaluate all 10 hierarchical production gates.
     */
    evaluateProductionGates(checks) {
        const gates = {
            DATA_GATE: { gateId: 'DATA_GATE', isPassed: checks.isDataFeedLive, reason: checks.isDataFeedLive ? 'OK' : 'Data feed unavailable' },
            CHAIN_GATE: { gateId: 'CHAIN_GATE', isPassed: checks.isChainReconciliationClean, reason: checks.isChainReconciliationClean ? 'OK' : 'Reconciliation pending' },
            MODEL_GATE: { gateId: 'MODEL_GATE', isPassed: checks.isModelCalibrated, reason: checks.isModelCalibrated ? 'OK' : 'Calibration unverified' },
            MEMORY_GATE: { gateId: 'MEMORY_GATE', isPassed: checks.isMemoryRetrievalLeakFree, reason: checks.isMemoryRetrievalLeakFree ? 'OK' : 'Lookahead detected' },
            PORTFOLIO_GATE: { gateId: 'PORTFOLIO_GATE', isPassed: checks.isPortfolioTailRiskWithinLimit, reason: checks.isPortfolioTailRiskWithinLimit ? 'OK' : 'Tail risk limit breached' },
            RISK_GATE: { gateId: 'RISK_GATE', isPassed: checks.isRiskFirewallApproved, reason: checks.isRiskFirewallApproved ? 'OK' : 'Risk firewall blocked' },
            EXECUTION_GATE: { gateId: 'EXECUTION_GATE', isPassed: checks.isExecutionRouterOperational, reason: checks.isExecutionRouterOperational ? 'OK' : 'Router offline' },
            SECURITY_GATE: { gateId: 'SECURITY_GATE', isPassed: checks.isKeySecurityVerified, reason: checks.isKeySecurityVerified ? 'OK' : 'Security breach' },
            OPERATIONS_GATE: { gateId: 'OPERATIONS_GATE', isPassed: checks.isOperationsClean, reason: checks.isOperationsClean ? 'OK' : 'Operations unhealthy' },
            SAFETY_GATE: { gateId: 'SAFETY_GATE', isPassed: checks.isSafetyMonitorGreen, reason: checks.isSafetyMonitorGreen ? 'OK' : 'Safety monitor locked' },
        };
        const allPassed = Object.values(gates).every((g) => g.isPassed);
        const analyticsReady = gates.DATA_GATE.isPassed && gates.CHAIN_GATE.isPassed;
        return {
            timestampMs: Date.now(),
            gates,
            isLiveExecutionReady: allPassed,
            isAnalyticsReady: analyticsReady,
        };
    }
    /**
     * Promote strategy through lifecycle to Champion if human approval exists.
     */
    promoteToChampion(strategyId, version, humanApproved) {
        const key = `${strategyId}:${version}`;
        const manifest = this.manifests.get(key);
        if (!manifest) {
            throw new Error(`Strategy ${key} not found`);
        }
        if (manifest.policies.requireHumanSignoff && !humanApproved) {
            throw new Error('Section 88 Invariant: Strategy cannot self-promote to Champion without human approval boundary');
        }
        const champion = {
            ...manifest,
            state: 'CHAMPION',
        };
        this.championStrategy = champion;
        this.manifests.set(key, champion);
        return champion;
    }
    getChampion() {
        return this.championStrategy;
    }
    /**
     * Generate Production Safety Certificate.
     */
    generateSafetyCertificate(buildId, codeHash, gateReport) {
        const constitutionHash = SafetyConstitution.getConstitutionHash();
        const champ = this.championStrategy;
        return {
            buildId,
            codeHash,
            configHash: champ?.configHash ?? 'no_config',
            strategyHash: champ?.strategyHash ?? 'no_strategy',
            safetyConstitutionHash: constitutionHash,
            certifiedAtMs: Date.now(),
            isCertifiedForLive: gateReport.isLiveExecutionReady && !!champ,
        };
    }
}
//# sourceMappingURL=manifest.js.map