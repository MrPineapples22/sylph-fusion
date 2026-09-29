/**
 * SYLPH FUSION — MULTIPLIER-X GEN-2
 * Module: src/intelligence/science/nexus-mx.ts
 *
 * Implements the NEXUS-MX Connecting Spine and Core Multiplier-X Gen-2 Contracts:
 * - Invariants 1.1–1.8 (Price != Capital, Wallet != Entity, Volume != Demand, etc.)
 * - Lineage-bound NexusLineage tracking across every lifecycle stage
 * - JournalEnvelope & OutcomeObservationCertificate (Observation Integrity)
 * - TokenEpisode canonical lifecycle entity
 * - ManipulationVector & LiquidityReality contracts
 * - Multiplier-X Gen-2 Barrier Probability Surfaces & Competing-Risk Engine
 * - Capturability-X latency & slippage discounting
 * - Realized-EV Engine & SPIE Output Contracts
 * - MultiplierCertificate & Verification Authority
 */
import { createHash } from 'node:crypto';
export function computeLineageDigest(lineage) {
    const serialized = JSON.stringify(lineage, Object.keys(lineage).sort());
    return createHash('sha256').update(serialized).digest('hex');
}
export function createJournalEnvelope(source, schemaVersion, payload, meta) {
    const receivedAt = Date.now();
    const serialized = JSON.stringify(payload);
    const payloadHash = createHash('sha256').update(serialized).digest('hex');
    const journalId = `jnl_${receivedAt}_${payloadHash.slice(0, 12)}`;
    return {
        journalId,
        source,
        receivedAt,
        schemaVersion,
        payloadHash,
        payload,
        ...meta,
    };
}
export function computeCapitalBackedMultiplier(entryPriceSol, organicNetSolInflow, poolReservesSol, observedPriceSol) {
    if (entryPriceSol <= 0 || poolReservesSol <= 0) {
        return { displayedPriceMultiple: 1.0, capitalBackedMultiple: 1.0 };
    }
    const reserveRatio = Math.max(0, (poolReservesSol + organicNetSolInflow) / poolReservesSol);
    const capitalBackedMultiple = Math.max(0.1, reserveRatio * reserveRatio);
    return {
        displayedPriceMultiple: (observedPriceSol !== undefined && observedPriceSol > 0) ? (observedPriceSol / entryPriceSol) : (reserveRatio * reserveRatio),
        capitalBackedMultiple,
    };
}
export class ManipulationFirewall {
    /**
     * Evaluates Liquidity Pool Price Inflation (LPI-X):
     * CapitalEfficiencyOfMove = log(P_t / P_0) / max(NetOrganicQuoteInflow, epsilon)
     */
    static evaluateLpiHazard(priceRatio, netOrganicSolInflow, observedGrossSolVolume) {
        if (priceRatio <= 1.0)
            return { lpiHazard: 0, mechanicalPriceMove: false };
        const logMove = Math.log(priceRatio);
        const organicInflow = Math.max(0.01, netOrganicSolInflow);
        const efficiency = logMove / organicInflow;
        const lpiHazard = Math.min(1.0, Math.max(0, (efficiency - 0.5) / 2.0));
        const mechanicalPriceMove = lpiHazard > 0.65 || (priceRatio > 1.5 && observedGrossSolVolume < 1.0);
        return { lpiHazard, mechanicalPriceMove };
    }
}
export class LiquidityRealityEngine {
    /**
     * Computes realizable return after constant-product price impact across position sizes
     */
    static computeRealizableExitCurve(displayedMultiple, poolLiquidityUsd, routeRedundancyCount = 1) {
        const calculateRealizable = (notionalUsd) => {
            if (poolLiquidityUsd <= 0 || displayedMultiple <= 0)
                return 0;
            const reserveUsd = Math.max(10, poolLiquidityUsd / 2);
            const impact = Math.min(0.95, notionalUsd / reserveUsd);
            return Math.max(0, displayedMultiple * (1.0 - impact));
        };
        const rm100 = calculateRealizable(100);
        const rm500 = calculateRealizable(500);
        const rm1000 = calculateRealizable(1000);
        const rm5000 = calculateRealizable(5000);
        const exitabilityScore = Math.min(1.0, Math.max(0, (poolLiquidityUsd / 20_000) * (routeRedundancyCount > 1 ? 1.2 : 1.0)));
        return {
            displayedMultiple,
            realizableMultipleAt100Usd: Number(rm100.toFixed(2)),
            realizableMultipleAt500Usd: Number(rm500.toFixed(2)),
            realizableMultipleAt1000Usd: Number(rm1000.toFixed(2)),
            realizableMultipleAt5000Usd: Number(rm5000.toFixed(2)),
            exitabilityScore: Number(exitabilityScore.toFixed(3)),
            routeRedundancyCount,
            liquidityDecayPct: 0.0,
        };
    }
}
export class RealizedEVEngine {
    /**
     * Computes expected net PnL accounting for competing risks and execution friction:
     * EV = sum(P_i * Return_i) - Costs - TailRiskAdjustment
     */
    static calculateEV(multipliers, risks, capturability, roundtripCostBps = 300 // Base fee + Jito + Priority + DEX fee
    ) {
        const costRatio = roundtripCostBps / 10_000;
        const pSuccess = multipliers.p2x * (1.0 - risks.compositeFailureHazard);
        const pFailure = risks.compositeFailureHazard;
        const capturableGain = (2.0 * capturability.capturableUpsideRatio) - 1.0;
        const expectedProfit = Math.max(0, pSuccess * capturableGain);
        const expectedLoss = pFailure * 0.15; // Typical 15% structural stop
        const tailAdjustment = risks.rugHazardRate * 0.5;
        const netEV = expectedProfit - expectedLoss - costRatio - tailAdjustment;
        return {
            expectedValueSolPerSol: Number(netEV.toFixed(4)),
            winProbability: Number(pSuccess.toFixed(3)),
            expectedProfitRatio: Number(expectedProfit.toFixed(3)),
            expectedLossRatio: Number(expectedLoss.toFixed(3)),
            tailRiskAdjustment: Number(tailAdjustment.toFixed(4)),
            isViable: netEV > 0.05 && capturability.pFill >= 0.85 && capturability.pExit >= 0.85,
        };
    }
}
export class MultiplierCertificateAuthority {
    static issueCertificate(lineage, mint, capitalFlow, manipulation, exitCurve, multipliers, competingRisks, uncertainty, capturability, spie, validDurationMs = 5000) {
        const now = Date.now();
        const ev = RealizedEVEngine.calculateEV(multipliers, competingRisks, capturability);
        let decision = 'WAIT_CONFIRMATION';
        const primaryEvidence = [];
        const riskFactors = [];
        const invalidationConditions = [
            'PRICE_DROP_EXCEEDING_STOP_15PCT',
            'CONTROLLER_DUMP_EXCEEDING_5PCT_SUPPLY',
            'LIQUIDITY_DRAIN_EVENT',
            'EXCESSIVE_LATENCY_SKEW_OVER_1000MS',
        ];
        if (manipulation.lpiProbability > 0.70 || manipulation.coordinatedDumpProbability > 0.60) {
            decision = 'VETO_HARD';
            riskFactors.push('CRITICAL_MANIPULATION_HAZARD');
        }
        else if (exitCurve.exitabilityScore < 0.20) {
            decision = 'VETO_HARD';
            riskFactors.push('INSUFFICIENT_EXITABILITY_DEPTH');
        }
        else if (ev.isViable && spie.compositeScore >= 70 && uncertainty.totalUncertaintyMargin <= 0.25) {
            decision = 'ENTER_ELIGIBLE';
            primaryEvidence.push(`ORGANIC_NET_INFLOW_${capitalFlow.organicNetSol.toFixed(1)}_SOL`);
            primaryEvidence.push(`REALIZED_EV_+${ev.expectedValueSolPerSol}_SOL_PER_SOL`);
            primaryEvidence.push(`P_2X_${(multipliers.p2x * 100).toFixed(0)}%`);
        }
        else {
            decision = 'VETO_STATISTICAL';
            riskFactors.push('SUB_THRESHOLD_NET_EV_OR_SPIE');
        }
        const payloadToHash = {
            lineage,
            mint,
            now,
            decision,
            multipliers,
            competingRisks,
            ev,
        };
        const certificateHash = createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
        const certificateId = `cert_mx2_${now}_${certificateHash.slice(0, 16)}`;
        return {
            certificateId,
            lineage: { ...lineage, certificateId },
            mint,
            issuedAtMs: now,
            expiresAtMs: now + validDurationMs,
            capitalFlow,
            manipulation,
            exitCurve,
            multipliers,
            competingRisks,
            uncertainty,
            capturability,
            realizedEV: ev,
            spie,
            decision,
            primaryEvidence,
            riskFactors,
            invalidationConditions,
            certificateHash,
        };
    }
}
//# sourceMappingURL=nexus-mx.js.map