import { createHash } from 'node:crypto';
import { evaluateExitEv } from './exit-ev.js';
const clamp = (n) => Math.max(0, Math.min(1, n));
const validSnapshot = (s) => [s.positionGeneration, s.evidenceAsOfMs, s.remainingQuantity, s.entryPriceUsd, s.markPriceUsd, s.peakPriceUsd, s.troughPriceUsd, s.confidence, s.uncertaintyBps].every(Number.isFinite)
    && s.positionGeneration >= 0 && s.remainingQuantity > 0 && s.entryPriceUsd > 0 && s.markPriceUsd > 0 && s.peakPriceUsd > 0 && s.troughPriceUsd > 0;
const quoteCost = (q) => q.expectedSlippageBps + q.priceImpactBps + q.priorityFeeBps + q.jitoTipBps;
const snapshotHash = (snapshot) => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
/**
 * Stateless, deterministic policy referee. It cannot submit an order. Callers
 * must fence the returned generation and revalidate quote expiry before a
 * reduce-only intent is created.
 */
export class ExitDecisionService {
    decide(input) {
        const { snapshot, nowMs } = input;
        if (!validSnapshot(snapshot) || !Number.isSafeInteger(nowMs) || nowMs < snapshot.evidenceAsOfMs)
            return null;
        const fresh = input.quotes.filter(q => Number.isFinite(q.fractionBps) && q.fractionBps > 0 && q.fractionBps <= 10_000
            && q.receivedAtMs <= nowMs && q.validUntilMs >= nowMs && q.expectedNetProceedsUsd >= 0
            && q.landingProbability >= 0 && q.landingProbability <= 1 && q.confirmationProbability >= 0 && q.confirmationProbability <= 1);
        const mfeBps = Math.round(((Math.max(snapshot.peakPriceUsd, snapshot.markPriceUsd) - snapshot.entryPriceUsd) / snapshot.entryPriceUsd) * 10_000);
        const maeBps = Math.round(((Math.min(snapshot.troughPriceUsd, snapshot.markPriceUsd) - snapshot.entryPriceUsd) / snapshot.entryPriceUsd) * 10_000);
        const givebackBps = Math.max(0, Math.round(((Math.max(snapshot.peakPriceUsd, snapshot.markPriceUsd) - snapshot.markPriceUsd) / Math.max(snapshot.peakPriceUsd, snapshot.markPriceUsd)) * 10_000));
        const hash = snapshotHash(snapshot);
        const base = { positionValueUsd: snapshot.remainingQuantity * snapshot.markPriceUsd, reduceFraction: 1,
            probabilityUpside: clamp(input.probabilityUpside), upsideBps: input.upsideBps, probabilityReversal: clamp(input.probabilityReversal), reversalBps: input.reversalBps,
            probabilityRug: clamp(input.probabilityRug), rugLossBps: input.rugLossBps, holdCostBps: input.holdCostBps, uncertaintyBps: snapshot.uncertaintyBps };
        const hold = evaluateExitEv({ ...base, exitCostBps: 0 });
        if (!hold)
            return null;
        const best = fresh.map(q => ({ quote: q, ev: evaluateExitEv({ ...base, reduceFraction: q.fractionBps / 10_000, exitCostBps: quoteCost(q) }) }))
            .sort((a, b) => ({ HOLD: a.ev.evHoldBps, REDUCE: a.ev.evReduceBps, CLOSE: a.ev.evCloseBps }[a.ev.selectedAction]) - ({ HOLD: b.ev.evHoldBps, REDUCE: b.ev.evReduceBps, CLOSE: b.ev.evCloseBps }[b.ev.selectedAction]))[0];
        const emergency = snapshot.hardSurvivalReason;
        const selected = emergency ? fresh.filter(q => q.fractionBps === 10_000).sort((a, b) => quoteCost(a) - quoteCost(b))[0] : best?.quote;
        const selectedEv = selected ? evaluateExitEv({ ...base, reduceFraction: selected.fractionBps / 10_000, exitCostBps: quoteCost(selected) }) : undefined;
        let chosenAction = 'HOLD';
        let priority = 'P3_OPTIMIZATION';
        const reasons = [];
        if (emergency && selected) {
            chosenAction = 'EMERGENCY_CLOSE';
            priority = 'P0_SURVIVAL';
            reasons.push(emergency);
        }
        else if (!selected) {
            priority = 'P1_PROTECTION';
            reasons.push('NO_FRESH_EXECUTABLE_QUOTE');
        }
        else if (selectedEv.selectedAction === 'CLOSE' && selected.fractionBps === 10_000) {
            chosenAction = 'CLOSE';
            priority = 'P1_PROTECTION';
            reasons.push('EXIT_EV_EXCEEDS_HOLD');
        }
        else if (selectedEv.selectedAction === 'REDUCE') {
            chosenAction = 'REDUCE';
            priority = 'P2_PROFIT_PROTECTION';
            reasons.push('REDUCE_EV_EXCEEDS_HOLD');
        }
        else
            reasons.push('HOLD_EV_DOMINATES_AFTER_COSTS');
        const requestedQuantity = chosenAction === 'HOLD' ? 0 : snapshot.remainingQuantity * ((selected?.fractionBps ?? 0) / 10_000);
        const validity = selected ? Math.min(selected.validUntilMs, nowMs + 5_000) : nowMs;
        return { certificateId: `exit-${snapshot.tradeId}-${snapshot.positionGeneration}-${nowMs}`, tradeId: snapshot.tradeId, mint: snapshot.mint, positionGeneration: snapshot.positionGeneration,
            priority, chosenAction, requestedQuantity, selectedRouteId: selected?.routeId, maxAcceptableSlippageBps: selected?.expectedSlippageBps,
            evHoldBps: hold.evHoldBps, evReduceBps: selectedEv?.evReduceBps, evExitBps: selectedEv?.evCloseBps, confidence: clamp(snapshot.confidence), uncertaintyBps: snapshot.uncertaintyBps,
            mfeBps, maeBps, givebackBps, marketRegime: snapshot.marketRegime, lifecycleRegime: snapshot.lifecycleRegime, reasons, evidenceAsOfMs: snapshot.evidenceAsOfMs,
            validUntilMs: validity, policyVersion: input.policyVersion, modelVersions: input.modelVersions, snapshotHash: hash };
    }
}
//# sourceMappingURL=exit-decision-service.js.map