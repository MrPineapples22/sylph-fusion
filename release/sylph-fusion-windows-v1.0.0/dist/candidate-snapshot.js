import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
export const CURRENT_SCHEMA_VERSION = '1.0.0';
export const DEFAULT_WALLET_SALT = 'sylph-fusion-feature-salt-v1';
export function saltHashWallet(address, salt = DEFAULT_WALLET_SALT) {
    if (!address)
        return '';
    return createHash('sha256')
        .update(`${salt}:${address}`)
        .digest('hex');
}
export function deterministicCandidateId(mint, slot, eventSignature) {
    return createHash('sha256')
        .update(`${mint}:${slot}:${eventSignature}`)
        .digest('hex')
        .slice(0, 32);
}
export function computeFeatureSealHash(microstructure, curveState, transport) {
    const content = JSON.stringify({ microstructure, curveState, transport });
    return createHash('sha256').update(content).digest('hex');
}
export function buildCandidateSnapshot(params) {
    const { mint, poolAddress, slot, eventSignature, observedAtMs, decisionAtMs, policyContext, evaluationDisposition, dispositionReason = null, salt = DEFAULT_WALLET_SALT, } = params;
    if (slot <= 0 || !Number.isInteger(slot)) {
        throw new Error(`Invalid slot number: ${slot}. Slot must be a positive integer.`);
    }
    if (decisionAtMs < observedAtMs) {
        throw new Error(`Clock consistency violation: decisionAtMs (${decisionAtMs}) < observedAtMs (${observedAtMs})`);
    }
    const rawMicro = params.microstructure || {};
    const rawCurve = params.curveState || params.curve || {};
    const rawTransport = params.transport || {};
    const missingKeys = [];
    const TOTAL_TRACKED_FEATURES = 10;
    // Track essential fields for completeness
    if (rawCurve.realSolReservesLamports === undefined)
        missingKeys.push('realSolReservesLamports');
    if (rawCurve.spotPriceUsd === undefined)
        missingKeys.push('spotPriceUsd');
    if (rawCurve.virtualSolReservesLamports === undefined)
        missingKeys.push('virtualSolReservesLamports');
    if (rawMicro.buyerCount5m === undefined)
        missingKeys.push('buyerCount5m');
    if (rawMicro.buyTransactionCount === undefined)
        missingKeys.push('buyTransactionCount');
    if (rawMicro.buySellRatio === undefined)
        missingKeys.push('buySellRatio');
    if (rawMicro.creatorWalletHashed === undefined)
        missingKeys.push('creatorWalletHashed');
    if (rawTransport.quoteAgeMs === undefined)
        missingKeys.push('quoteAgeMs');
    if (rawTransport.leadingRpcLatencyMs === undefined)
        missingKeys.push('leadingRpcLatencyMs');
    if (rawTransport.reservedCashRatio === undefined)
        missingKeys.push('reservedCashRatio');
    const featureAvailability = Number(((TOTAL_TRACKED_FEATURES - missingKeys.length) / TOTAL_TRACKED_FEATURES).toFixed(2));
    const microstructure = {
        buyerCount5m: rawMicro.buyerCount5m ?? 0,
        buyTransactionCount: rawMicro.buyTransactionCount ?? 0,
        sellTransactionCount: rawMicro.sellTransactionCount ?? 0,
        buySellRatio: rawMicro.buySellRatio ?? 1,
        buyerArrivalVelocityPerSec: rawMicro.buyerArrivalVelocityPerSec ?? 0,
        topHoldersHashed: (rawMicro.topHoldersHashed || []).map(h => h.length === 64 ? h : saltHashWallet(h, salt)),
        creatorWalletHashed: rawMicro.creatorWalletHashed
            ? (rawMicro.creatorWalletHashed.length === 64
                ? rawMicro.creatorWalletHashed
                : saltHashWallet(rawMicro.creatorWalletHashed, salt))
            : '',
        creatorInitialSupplyPct: rawMicro.creatorInitialSupplyPct ?? 0,
        creatorCurrentBalancePct: rawMicro.creatorCurrentBalancePct ?? 0,
        creatorNetDeltaPct: rawMicro.creatorNetDeltaPct ?? 0,
    };
    const curveState = {
        tokenAgeSeconds: rawCurve.tokenAgeSeconds ?? 0,
        realSolReservesLamports: rawCurve.realSolReservesLamports ?? '0',
        virtualSolReservesLamports: rawCurve.virtualSolReservesLamports ?? '0',
        virtualTokenReserves: rawCurve.virtualTokenReserves ?? '0',
        curveCompletionPct: rawCurve.curveCompletionPct ?? 0,
        reserveDriftPct: rawCurve.reserveDriftPct ?? 0,
        spotPriceUsd: rawCurve.spotPriceUsd ?? 0,
    };
    const transport = {
        quoteAgeMs: rawTransport.quoteAgeMs ?? 0,
        leadingRpcLatencyMs: rawTransport.leadingRpcLatencyMs ?? 0,
        trailingRpcDropRatePct: rawTransport.trailingRpcDropRatePct ?? 0,
        inFlightOrderCount: rawTransport.inFlightOrderCount ?? 0,
        oldestPendingAgeMs: rawTransport.oldestPendingAgeMs ?? 0,
        reservedCashRatio: rawTransport.reservedCashRatio ?? 0,
    };
    const candidateId = deterministicCandidateId(mint, slot, eventSignature);
    const featureSealHash = computeFeatureSealHash(microstructure, curveState, transport);
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        candidateId,
        mint,
        poolAddress,
        slot,
        eventSignature,
        observedAtMs,
        decisionAtMs,
        featureAvailability,
        missingFeatureCount: missingKeys.length,
        missingFeatureKeys: missingKeys,
        featureSealHash,
        policyContext,
        evaluationDisposition,
        dispositionReason,
        microstructure,
        curveState,
        transport,
    };
}
export function buildOutcomeLabel(params) {
    const cost = BigInt(params.costBasisLamports);
    const proceeds = BigInt(params.grossProceedsLamports);
    const impact = BigInt(params.dexImpactLamports ?? 0);
    const priority = BigInt(params.priorityFeeLamports ?? 0);
    const tip = BigInt(params.jitoTipLamports ?? 0);
    const rent = BigInt(params.ataRentLamports ?? 0);
    const totalFriction = impact + priority + tip + rent;
    const netPnl = proceeds - cost - totalFriction;
    const grossReturnPct = cost > 0n ? Number(((proceeds - cost) * 10000n) / cost) / 100 : 0;
    const netReturnPct = cost > 0n ? Number((netPnl * 10000n) / cost) / 100 : 0;
    const netReturnBps = Math.round(netReturnPct * 100);
    const isCensored = params.censored ?? false;
    const terminalState = isCensored
        ? 'censored_at_cutoff'
        : params.terminalState
            ? params.terminalState
            : grossReturnPct >= 0
                ? 'take_profit'
                : 'stop_loss';
    const milestones = {
        reachedTp1_20Pct: params.terminalMilestones?.reachedTp1_20Pct ?? (grossReturnPct >= 20 ? 1 : 0),
        reachedTp2_50Pct: params.terminalMilestones?.reachedTp2_50Pct ?? (grossReturnPct >= 50 ? 1 : 0),
        reachedTp3_100Pct: params.terminalMilestones?.reachedTp3_100Pct ?? (grossReturnPct >= 100 ? 1 : 0),
        hitHardStop: params.terminalMilestones?.hitHardStop ?? (terminalState === 'stop_loss' ? 1 : 0),
        hitTrailingStop: params.terminalMilestones?.hitTrailingStop ?? 0,
        creatorDumpOccurred: params.terminalMilestones?.creatorDumpOccurred ?? 0,
        graduatedToRaydium: params.terminalMilestones?.graduatedToRaydium ?? 0,
    };
    const mfe = params.maximumFavorableExcursionPct ?? Math.max(0, grossReturnPct);
    const mae = params.maximumAdverseExcursionPct ?? Math.min(0, grossReturnPct);
    const exitStage = params.exitStage ?? 0;
    const realizedSlippageBps = params.realizedSlippageBps ?? 0;
    const financials = {
        grossReturnPct,
        costBasisLamports: cost.toString(),
        grossProceedsLamports: proceeds.toString(),
        dexImpactLamports: impact.toString(),
        priorityFeeLamports: priority.toString(),
        jitoTipLamports: tip.toString(),
        ataRentLamports: rent.toString(),
        frictionTotalLamports: totalFriction.toString(),
        realizedSlippageBps,
        netPnlLamports: netPnl.toString(),
        netReturnPct,
    };
    const pathDynamics = {
        maximumFavorableExcursionPct: mfe,
        maximumAdverseExcursionPct: mae,
        holdingDurationMs: params.observationDurationMs,
        exitStage,
    };
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        candidateId: params.candidateId,
        mint: params.mint,
        entrySnapshotSlot: params.entrySnapshotSlot,
        censored: isCensored,
        censoringReason: params.censoringReason,
        terminalState,
        observationDurationMs: params.observationDurationMs,
        terminalMilestones: milestones,
        financials,
        pathDynamics,
        netReturnLamports: netPnl.toString(),
        netReturnBps,
        frictionTotalLamports: totalFriction.toString(),
        grossProceedsLamports: proceeds.toString(),
        costBasisLamports: cost.toString(),
        realizedSlippageBps,
        maximumFavorableExcursionPct: mfe,
        maximumAdverseExcursionPct: mae,
        exitStage,
    };
}
export function verifySnapshotIntegrity(snapshot) {
    const errors = [];
    if (snapshot.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        errors.push(`Invalid schema version: expected ${CURRENT_SCHEMA_VERSION}, got ${snapshot.schemaVersion}`);
    }
    if (snapshot.decisionAtMs < snapshot.observedAtMs) {
        errors.push(`Clock consistency violation: decisionAtMs (${snapshot.decisionAtMs}) < observedAtMs (${snapshot.observedAtMs})`);
    }
    const expectedId = deterministicCandidateId(snapshot.mint, snapshot.slot, snapshot.eventSignature);
    if (snapshot.candidateId !== expectedId) {
        errors.push(`Candidate ID mismatch: expected ${expectedId}, got ${snapshot.candidateId}`);
    }
    const recomputedSealHash = computeFeatureSealHash(snapshot.microstructure, snapshot.curveState, snapshot.transport);
    if (snapshot.featureSealHash !== recomputedSealHash) {
        errors.push(`Feature seal hash mismatch: expected ${recomputedSealHash}, got ${snapshot.featureSealHash}`);
    }
    return {
        valid: errors.length === 0,
        errors,
        recomputedSealHash,
        reason: errors.join('; '),
    };
}
export function throwIfAborted(signal) {
    if (signal?.aborted) {
        const err = signal.reason instanceof Error ? signal.reason : new Error(signal.reason ? String(signal.reason) : 'Inference aborted by signal');
        throw err;
    }
}
export async function executeModelGate(snapshot, evaluator, options = {}) {
    const maxInferenceMs = options.maxInferenceMs ?? 10.0;
    const mode = options.mode ?? 'deterministic_only';
    if (!evaluator) {
        if (mode === 'deterministic_only') {
            return {
                accepted: snapshot.evaluationDisposition === 'cleared',
                score: null,
                confidence: null,
                inferenceDurationMs: 0,
                evaluationDisposition: snapshot.evaluationDisposition,
                rejectionReason: snapshot.dispositionReason,
            };
        }
        return {
            accepted: false,
            score: null,
            confidence: null,
            inferenceDurationMs: 0,
            evaluationDisposition: 'modelUnavailable',
            rejectionReason: 'missing_model_evaluator',
        };
    }
    if (mode === 'deterministic_only') {
        return {
            accepted: snapshot.evaluationDisposition === 'cleared',
            score: null,
            confidence: null,
            inferenceDurationMs: 0,
            evaluationDisposition: snapshot.evaluationDisposition,
            rejectionReason: snapshot.dispositionReason,
        };
    }
    // Schema completeness check: missing features cannot be evaluated by ML (fail-closed)
    if (snapshot.missingFeatureCount > 0 || snapshot.featureAvailability < 1.0) {
        return {
            accepted: false,
            score: null,
            confidence: null,
            inferenceDurationMs: 0,
            evaluationDisposition: 'modelUnavailable',
            rejectionReason: `schema_incomplete_missing_${snapshot.missingFeatureCount}_features`,
        };
    }
    const startTime = performance.now();
    let timerId = null;
    const abortController = new AbortController();
    try {
        const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(() => {
                abortController.abort(new Error(`TIMEOUT_${maxInferenceMs}MS`));
                reject(new Error(`TIMEOUT_${maxInferenceMs}MS`));
            }, Math.max(1, Math.floor(maxInferenceMs)));
        });
        const evalPromise = evaluator.scoreCandidate(snapshot, abortController.signal);
        const result = await Promise.race([evalPromise, timeoutPromise]);
        const durationMs = Number((performance.now() - startTime).toFixed(3));
        // Even if timer didn't fire first, verify measured time didn't exceed limit
        if (durationMs > maxInferenceMs) {
            return {
                accepted: false,
                score: result.score ?? null,
                confidence: result.confidence ?? null,
                inferenceDurationMs: durationMs,
                evaluationDisposition: 'modelUnavailable',
                rejectionReason: `ml_inference_timeout_${durationMs.toFixed(2)}ms_exceeded_${maxInferenceMs}ms_cap`,
                metadata: result.metadata,
            };
        }
        if (mode === 'shadow') {
            return {
                accepted: snapshot.evaluationDisposition === 'cleared',
                score: result.score,
                confidence: result.confidence ?? 1.0,
                inferenceDurationMs: durationMs,
                evaluationDisposition: snapshot.evaluationDisposition,
                rejectionReason: snapshot.dispositionReason,
                metadata: { ...result.metadata, shadowAccept: result.accept },
            };
        }
        return {
            accepted: result.accept,
            score: result.score,
            confidence: result.confidence ?? 1.0,
            inferenceDurationMs: durationMs,
            evaluationDisposition: result.accept ? 'cleared' : 'rejected',
            rejectionReason: result.accept ? null : 'model_threshold_unmet',
            metadata: result.metadata,
        };
    }
    catch (err) {
        const durationMs = Number((performance.now() - startTime).toFixed(3));
        const isTimeout = err instanceof Error && err.message.startsWith('TIMEOUT');
        const reason = isTimeout
            ? `ml_inference_timeout_${durationMs.toFixed(2)}ms_exceeded_${maxInferenceMs}ms_cap`
            : `ml_inference_error_${err instanceof Error ? err.message : String(err)}`;
        if (mode === 'shadow') {
            return {
                accepted: snapshot.evaluationDisposition === 'cleared',
                score: null,
                confidence: null,
                inferenceDurationMs: durationMs,
                evaluationDisposition: snapshot.evaluationDisposition,
                rejectionReason: snapshot.dispositionReason,
                metadata: { shadowError: reason },
            };
        }
        return {
            accepted: false,
            score: null,
            confidence: null,
            inferenceDurationMs: durationMs,
            evaluationDisposition: 'modelUnavailable',
            rejectionReason: reason,
        };
    }
    finally {
        if (timerId)
            clearTimeout(timerId);
    }
}
//# sourceMappingURL=candidate-snapshot.js.map