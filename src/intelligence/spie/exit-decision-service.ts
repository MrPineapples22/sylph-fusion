import { createHash } from 'node:crypto';
import { evaluateExitEv, type ExitEvAction, type ExitEvEvaluation } from './exit-ev.js';

/** Point-in-time-only inputs for an advisory exit decision. */
export interface ExitFeatureSnapshot {
  readonly tradeId: string;
  readonly mint: string;
  readonly positionGeneration: number;
  readonly evidenceAsOfMs: number;
  readonly sourceSlot?: number;
  readonly remainingQuantity: number;
  readonly entryPriceUsd: number;
  readonly markPriceUsd: number;
  readonly peakPriceUsd: number;
  readonly troughPriceUsd: number;
  readonly confidence: number;
  readonly uncertaintyBps: number;
  readonly marketRegime: string;
  readonly lifecycleRegime: string;
  readonly hardSurvivalReason?: string;
}

export interface ExitActionQuote {
  readonly fractionBps: number;
  readonly expectedNetProceedsUsd: number;
  readonly expectedSlippageBps: number;
  readonly priceImpactBps: number;
  readonly priorityFeeBps: number;
  readonly jitoTipBps: number;
  readonly landingProbability: number;
  readonly confirmationProbability: number;
  readonly receivedAtMs: number;
  readonly validUntilMs: number;
  readonly routeId: string;
}

export type ExitPriority = 'P0_SURVIVAL' | 'P1_PROTECTION' | 'P2_PROFIT_PROTECTION' | 'P3_OPTIMIZATION';
export type ExitDecisionAction = 'HOLD' | 'REDUCE' | 'CLOSE' | 'EMERGENCY_CLOSE';

export interface ExitDecisionInput {
  readonly snapshot: ExitFeatureSnapshot;
  readonly quotes: readonly ExitActionQuote[];
  readonly nowMs: number;
  readonly probabilityUpside: number;
  readonly upsideBps: number;
  readonly probabilityReversal: number;
  readonly reversalBps: number;
  readonly probabilityRug: number;
  readonly rugLossBps: number;
  readonly holdCostBps: number;
  readonly policyVersion: string;
  readonly modelVersions: readonly string[];
}

export interface ExitDecisionCertificate {
  readonly certificateId: string;
  readonly tradeId: string;
  readonly mint: string;
  readonly positionGeneration: number;
  readonly priority: ExitPriority;
  readonly chosenAction: ExitDecisionAction;
  readonly requestedQuantity: number;
  readonly selectedRouteId?: string;
  readonly maxAcceptableSlippageBps?: number;
  readonly evHoldBps: number;
  readonly evReduceBps?: number;
  readonly evExitBps?: number;
  readonly confidence: number;
  readonly uncertaintyBps: number;
  readonly mfeBps: number;
  readonly maeBps: number;
  readonly givebackBps: number;
  readonly marketRegime: string;
  readonly lifecycleRegime: string;
  readonly reasons: readonly string[];
  readonly evidenceAsOfMs: number;
  readonly validUntilMs: number;
  readonly policyVersion: string;
  readonly modelVersions: readonly string[];
  readonly snapshotHash: string;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const validSnapshot = (s: ExitFeatureSnapshot) => [s.positionGeneration, s.evidenceAsOfMs, s.remainingQuantity, s.entryPriceUsd, s.markPriceUsd, s.peakPriceUsd, s.troughPriceUsd, s.confidence, s.uncertaintyBps].every(Number.isFinite)
  && s.positionGeneration >= 0 && s.remainingQuantity > 0 && s.entryPriceUsd > 0 && s.markPriceUsd > 0 && s.peakPriceUsd > 0 && s.troughPriceUsd > 0;
const quoteCost = (q: ExitActionQuote) => q.expectedSlippageBps + q.priceImpactBps + q.priorityFeeBps + q.jitoTipBps;
const snapshotHash = (snapshot: ExitFeatureSnapshot) => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

/**
 * Stateless, deterministic policy referee. It cannot submit an order. Callers
 * must fence the returned generation and revalidate quote expiry before a
 * reduce-only intent is created.
 */
export class ExitDecisionService {
  public decide(input: ExitDecisionInput): ExitDecisionCertificate | null {
    const { snapshot, nowMs } = input;
    if (!validSnapshot(snapshot) || !Number.isSafeInteger(nowMs) || nowMs < snapshot.evidenceAsOfMs) return null;
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
    if (!hold) return null;
    const score = (e: ExitEvEvaluation) => e.selectedAction === 'HOLD' ? e.evHoldBps : e.selectedAction === 'REDUCE' ? e.evReduceBps : e.evCloseBps;
    const best = fresh.map(q => ({ quote: q, ev: evaluateExitEv({ ...base, reduceFraction: q.fractionBps / 10_000, exitCostBps: quoteCost(q) })! }))
      .sort((a, b) => score(b.ev) - score(a.ev))[0];
    const emergency = snapshot.hardSurvivalReason;
    const selected = emergency ? fresh.filter(q => q.fractionBps === 10_000).sort((a, b) => quoteCost(a) - quoteCost(b))[0] : best?.quote;
    const selectedEv = selected ? evaluateExitEv({ ...base, reduceFraction: selected.fractionBps / 10_000, exitCostBps: quoteCost(selected) })! : undefined;
    let chosenAction: ExitDecisionAction = 'HOLD';
    let priority: ExitPriority = 'P3_OPTIMIZATION';
    const reasons: string[] = [];
    if (emergency && selected) { chosenAction = 'EMERGENCY_CLOSE'; priority = 'P0_SURVIVAL'; reasons.push(emergency); }
    else if (!selected) { priority = 'P1_PROTECTION'; reasons.push('NO_FRESH_EXECUTABLE_QUOTE'); }
    else if (selectedEv!.selectedAction === 'CLOSE' && selected.fractionBps === 10_000) { chosenAction = 'CLOSE'; priority = 'P1_PROTECTION'; reasons.push('EXIT_EV_EXCEEDS_HOLD'); }
    else if (selectedEv!.selectedAction === 'REDUCE') { chosenAction = 'REDUCE'; priority = 'P2_PROFIT_PROTECTION'; reasons.push('REDUCE_EV_EXCEEDS_HOLD'); }
    else reasons.push('HOLD_EV_DOMINATES_AFTER_COSTS');
    const requestedQuantity = chosenAction === 'HOLD' ? 0 : snapshot.remainingQuantity * ((selected?.fractionBps ?? 0) / 10_000);
    const validity = selected ? Math.min(selected.validUntilMs, nowMs + 5_000) : nowMs;
    return { certificateId: `exit-${snapshot.tradeId}-${snapshot.positionGeneration}-${nowMs}`, tradeId: snapshot.tradeId, mint: snapshot.mint, positionGeneration: snapshot.positionGeneration,
      priority, chosenAction, requestedQuantity, selectedRouteId: selected?.routeId, maxAcceptableSlippageBps: selected?.expectedSlippageBps,
      evHoldBps: hold.evHoldBps, evReduceBps: selectedEv?.evReduceBps, evExitBps: selectedEv?.evCloseBps, confidence: clamp(snapshot.confidence), uncertaintyBps: snapshot.uncertaintyBps,
      mfeBps, maeBps, givebackBps, marketRegime: snapshot.marketRegime, lifecycleRegime: snapshot.lifecycleRegime, reasons, evidenceAsOfMs: snapshot.evidenceAsOfMs,
      validUntilMs: validity, policyVersion: input.policyVersion, modelVersions: input.modelVersions, snapshotHash: hash };
  }
}
