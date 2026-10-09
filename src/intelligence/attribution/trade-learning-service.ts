/**
 * SOL-SYLPH Trade Learning & Attribution Service
 * Specifications: Blueprint Engine #39 (Pavlov Attribution) & Section 42 (Adaptive Feedback)
 *
 * Ingests unverified research closed trade autopsies from an explicitly selected or repository-local CSV,
 * classifies decision credit vs financial outcome via Pavlov Attribution, tracks win/loss distributions,
 * and dynamically calibrates adaptive HSI hurdles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PavlovOutcomeAttributionEngine, type DecisionSoundness, type PavlovAttributionRecord } from './pavlov-attribution.js';
import {
  OutcomeMaturityGate,
  type OutcomeMaturityInput,
  type OutcomeMaturityCertificate,
} from '../../platform/pipeline/conservation-proofs.js';

export interface ClosedTradeReport {
  readonly tradeId: string;
  readonly tokenMint: string;
  readonly symbol: string;
  readonly entryPriceUsd: number;
  readonly exitPriceUsd: number;
  readonly costBasisUsd: number;
  readonly proceedsUsd: number;
  readonly realizedPnlUsd: number;
  readonly realizedPnlPct: number;
  readonly holdDurationMs: number;
  readonly exitTrigger: 'EMERGENCY_UNWIND' | 'TRAILING_TARGET' | 'OPERATOR_CLOSE' | 'AUTO_GUARDIAN' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'FALSE_BREAKOUT' | string;
  readonly wasDecisionSound: DecisionSoundness;
  readonly closedAt: number;
  readonly mfePriceUsd?: number;
  readonly mfePct?: number;
  readonly maePriceUsd?: number;
  readonly maePct?: number;
  readonly profitCaptureRatio?: number;
  readonly exitEfficiency?: number;
  readonly exitEnvelopeHash?: string;
  readonly decisionSoundnessReason?: string;
  readonly processEvidenceRef?: string;
}

/** Supplied only after an external verifier checks evidence linked to this report. */
export interface VerifiedProcessAssessment {
  readonly wasDecisionSound: boolean;
  readonly reason: string;
  readonly evidenceRef: string;
}

/** Must resolve and verify evidence independently of CSV flags, reasons and outcomes.
 * No default verifier exists. Use the same resolver for ingestion and reload.
 */
export type ProcessAssessmentContext = Readonly<Pick<ClosedTradeReport,
  'tradeId' | 'tokenMint' | 'symbol' | 'entryPriceUsd' | 'costBasisUsd' | 'processEvidenceRef'>>;
export type ProcessAssessmentResolver = (report: ProcessAssessmentContext) => VerifiedProcessAssessment | undefined;

export interface TradeAutopsyRecord extends ClosedTradeReport {
  readonly attribution: PavlovAttributionRecord;
  readonly maturityCertificate?: OutcomeMaturityCertificate;
}

export interface TradeLearningServiceOptions {
  readonly requireOutcomeMaturity?: boolean;
  readonly minMaturityDelayMs?: number;
  readonly minMaturitySlotDelta?: bigint;
}

export interface AdaptiveLearningSnapshot {
  readonly evidenceStatus: 'RESEARCH_ONLY_NOT_PROOF_OF_PROFITABILITY';
  readonly dataQuality: { readonly csvRowsRead: number; readonly acceptedRows: number; readonly rejectedRows: number; readonly rejectionReasons: Readonly<Record<string, number>> };
  readonly totalTradesEvaluated: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly winRatePct: number;
  readonly totalRealizedPnlUsd: number;
  readonly averageProfitCaptureRatio: number;
  readonly averageExitEfficiency: number;
  readonly averageHoldDurationMs: number;
  readonly attributionSummary: {
    readonly unknown: number;
    readonly reinforceAlpha: number;
    readonly neutralVariance: number;
    readonly doNotReinforceLuck: number;
    readonly penalizePolicy: number;
  };
  readonly adaptiveCalibration: {
    readonly baseHsiHurdle: number;
    readonly adaptiveHsiHurdle: number;
    readonly calibrationRegime: 'OPTIMAL' | 'BALANCED' | 'DEFENSIVE';
    readonly recommendedStopPct: number;
    readonly recommendedTargetPct: number;
  };
  readonly recentAutopsies: readonly TradeAutopsyRecord[];
  readonly dataSource?: string;
  readonly totalCsvRecordsLoaded?: number;
  readonly lastUpdatedAt: number;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export class TradeLearningService {
  private static instance: TradeLearningService;
  private readonly pavlov = new PavlovOutcomeAttributionEngine();
  private readonly autopsies: TradeAutopsyRecord[] = [];
  private readonly maturityGate: OutcomeMaturityGate;
  private requireOutcomeMaturity: boolean = false;
  private minMaturityDelayMs: number = 60_000;
  private minMaturitySlotDelta: bigint = 100n;
  private csvPath: string = '';
  private lastLoadedMtimeMs: number = 0;
  private totalCsvRecordsLoaded: number = 0;
  private dataSourceName: string = 'In-Memory Telemetry';
  private autoSync: boolean = false;
  private dataQuality = { csvRowsRead: 0, acceptedRows: 0, rejectedRows: 0, rejectionReasons: {} as Record<string, number> };

  private rejectionReason(report: ClosedTradeReport): string | undefined {
    if (report.symbol.toUpperCase() === 'TEST' || /^GodTierSim/i.test(report.tokenMint)) return 'SYNTHETIC_RECORD';
    if (!report.tradeId || !report.tokenMint || !report.symbol || !report.exitTrigger) return 'MISSING_IDENTITY';
    const required = [report.entryPriceUsd, report.exitPriceUsd, report.costBasisUsd, report.proceedsUsd,
      report.realizedPnlUsd, report.realizedPnlPct, report.holdDurationMs, report.closedAt];
    if (!required.every(Number.isFinite)) return 'MISSING_OR_NONFINITE_NUMBER';
    if (report.entryPriceUsd <= 0 || report.exitPriceUsd < 0 || report.costBasisUsd <= 0 || report.proceedsUsd < 0 || report.holdDurationMs < 0 || report.closedAt <= 0) return 'INVALID_ECONOMIC_RANGE';
    // Currency and percentage fields in CSV may be rounded to two decimal places.
    if (Math.abs(report.proceedsUsd - report.costBasisUsd - report.realizedPnlUsd) > 0.011 ||
        Math.abs(report.realizedPnlUsd / report.costBasisUsd * 100 - report.realizedPnlPct) > 0.011) return 'INCONSISTENT_PNL';
    for (const value of [report.mfePriceUsd, report.maePriceUsd, report.mfePct, report.maePct, report.profitCaptureRatio, report.exitEfficiency]) {
      if (value !== undefined && !Number.isFinite(value)) return 'INVALID_OPTIONAL_METRIC';
    }
    for (const value of [report.profitCaptureRatio, report.exitEfficiency]) {
      if (value !== undefined && (value < 0 || value > 1)) return 'INVALID_OPTIONAL_METRIC';
    }
    if (typeof report.wasDecisionSound !== 'boolean' && report.wasDecisionSound !== 'UNKNOWN') return 'INVALID_DECISION_FLAG';
    return undefined;
  }

  public static getInstance(): TradeLearningService {
    if (!TradeLearningService.instance) {
      TradeLearningService.instance = new TradeLearningService();
    }
    return TradeLearningService.instance;
  }

  public constructor(
    private resolveProcessAssessment?: ProcessAssessmentResolver,
    maturityGate?: OutcomeMaturityGate,
    options?: TradeLearningServiceOptions
  ) {
    this.maturityGate = maturityGate ?? new OutcomeMaturityGate();
    if (options?.requireOutcomeMaturity !== undefined) {
      this.requireOutcomeMaturity = options.requireOutcomeMaturity;
    }
    if (options?.minMaturityDelayMs !== undefined) {
      this.minMaturityDelayMs = options.minMaturityDelayMs;
    }
    if (options?.minMaturitySlotDelta !== undefined) {
      this.minMaturitySlotDelta = options.minMaturitySlotDelta;
    }
    // Tests start with an isolated in-memory instance (0 records).
    // Servers call .loadFromCsv() to ingest validated but unverified research telemetry.
  }

  public setOutcomeMaturityRequired(required: boolean, minDelayMs?: number, minSlotDelta?: bigint): void {
    this.requireOutcomeMaturity = required;
    if (minDelayMs !== undefined) this.minMaturityDelayMs = minDelayMs;
    if (minSlotDelta !== undefined) this.minMaturitySlotDelta = minSlotDelta;
  }

  public getOutcomeMaturityGate(): OutcomeMaturityGate {
    return this.maturityGate;
  }

  public setProcessAssessmentResolver(resolver: ProcessAssessmentResolver): void {
    this.resolveProcessAssessment = resolver;
  }

  private assessProcess(report: ClosedTradeReport): ClosedTradeReport {
    // Labels in the report/CSV are claims, never evidence. Fail closed if verification fails.
    let assessment: VerifiedProcessAssessment | undefined;
    const evidenceRef = report.processEvidenceRef?.trim() ||
      (report.tradeId?.startsWith('trd_') && report.tokenMint ? `evidence:paper_entry_${report.tokenMint}_${report.tradeId}` : undefined);
    try {
      if (evidenceRef) {
        assessment = this.resolveProcessAssessment?.(Object.freeze({
          tradeId: report.tradeId,
          tokenMint: report.tokenMint,
          symbol: report.symbol,
          entryPriceUsd: report.entryPriceUsd,
          costBasisUsd: report.costBasisUsd,
          processEvidenceRef: evidenceRef,
        }));
      }
    } catch { /* unavailable evidence */ }
    if (assessment && typeof assessment.wasDecisionSound === 'boolean' &&
        typeof assessment.reason === 'string' && assessment.reason.trim() &&
        typeof assessment.evidenceRef === 'string' && assessment.evidenceRef.trim() &&
        assessment.evidenceRef === evidenceRef) {
      return {
        ...report,
        wasDecisionSound: assessment.wasDecisionSound,
        decisionSoundnessReason: assessment.reason,
        processEvidenceRef: assessment.evidenceRef,
      };
    }
    return {
      ...report,
      wasDecisionSound: 'UNKNOWN',
      decisionSoundnessReason: 'MISSING_VERIFIED_PROCESS_EVIDENCE',
      processEvidenceRef: undefined,
    };
  }

  private resolveCsvPath(preferredPath?: string): string {
    // An explicitly configured source never falls through to another dataset.
    return path.resolve(preferredPath ?? process.env.PAVLOV_ATTRIBUTIONS_PATH ?? 'data/pavlov_attributions.csv');
  }

  public loadFromCsv(targetPath?: string): { loadedCount: number; source: string; winRatePct: number; totalRealizedPnlUsd: number } {
    const filePath = this.resolveCsvPath(targetPath);
    this.csvPath = filePath;
    this.autoSync = false;
    if (!fs.existsSync(filePath)) {
      this.clear();
      this.dataSourceName = 'Not found: ' + filePath;
      return { loadedCount: 0, source: 'Not found: ' + filePath, winRatePct: 0, totalRealizedPnlUsd: 0 };
    }

    try {
      const stat = fs.statSync(filePath);
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.trim().split(/\r?\n/).filter(l => l.trim().length > 0);


      const headers = parseCsvLine(lines[0] ?? '');
      const colMap = new Map<string, number>();
      headers.forEach((h, i) => colMap.set(h.toLowerCase().trim(), i));

      const parsedAutopsies: TradeAutopsyRecord[] = [];
      const seen = new Set<string>();
      const quality = { csvRowsRead: Math.max(0, lines.length - 1), acceptedRows: 0, rejectedRows: 0, rejectionReasons: {} as Record<string, number> };
      const reject = (reason: string) => { quality.rejectedRows++; quality.rejectionReasons[reason] = (quality.rejectionReasons[reason] ?? 0) + 1; };

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 12) { reject('MALFORMED_ROW'); continue; }

        const getVal = (name: string): string => {
          const idx = colMap.get(name);
          return idx != null && idx < row.length ? row[idx] : '';
        };

        const numeric = (name: string): number => getVal(name) === '' ? NaN : Number(getVal(name));
        const optional = (name: string): number | undefined => getVal(name) === '' ? undefined : Number(getVal(name));
        const rawReport: ClosedTradeReport = {
          tradeId: getVal('trade_id'), tokenMint: getVal('token_mint'), symbol: getVal('symbol'),
          entryPriceUsd: numeric('entry_price_usd'), exitPriceUsd: numeric('exit_price_usd'),
          costBasisUsd: numeric('cost_basis_usd'), proceedsUsd: numeric('proceeds_usd'),
          realizedPnlUsd: numeric('realized_pnl_usd'), realizedPnlPct: numeric('realized_pnl_pct'),
          holdDurationMs: numeric('hold_duration_ms'), exitTrigger: getVal('exit_trigger'),
          wasDecisionSound: 'UNKNOWN', closedAt: numeric('closed_at_ms'),
          mfePct: optional('mfe_pct'), maePct: optional('mae_pct'),
          profitCaptureRatio: optional('profit_capture_ratio'), exitEfficiency: optional('exit_efficiency'),
          exitEnvelopeHash: getVal('exit_envelope_hash'),
          processEvidenceRef: getVal('process_evidence_ref') || undefined,
        };
        const reason = this.rejectionReason(rawReport);
        if (reason) { reject(reason); continue; }

        let maturityCert: OutcomeMaturityCertificate | undefined;
        if (this.requireOutcomeMaturity) {
          const nowMs = Date.now();
          const settledMs = rawReport.closedAt;
          maturityCert = this.maturityGate.evaluateMaturity({
            tradeId: rawReport.tradeId,
            economicFactId: `fact_${rawReport.tradeId}`,
            accountMode: 'paper',
            settledSlot: 0n,
            currentSlot: BigInt(Math.max(0, Math.floor((nowMs - settledMs) / 400))),
            settledAtMs: settledMs,
            currentAtMs: nowMs,
            minMaturityDelayMs: this.minMaturityDelayMs,
            minMaturitySlotDelta: this.minMaturitySlotDelta,
            mfePct: rawReport.mfePct ?? 0,
            maePct: rawReport.maePct ?? 0,
            realizedNetPnLLamports: BigInt(Math.round(rawReport.realizedPnlUsd * 1_000_000_000)),
          }, new Date(nowMs).toISOString());

          if (!maturityCert.isMature || !maturityCert.learningReady) {
            reject('IMMATURE_OUTCOME');
            continue;
          }
        }

        const report = this.assessProcess(rawReport);
        if (seen.has(report.tradeId)) { reject('DUPLICATE_TRADE_ID'); continue; }
        seen.add(report.tradeId);
        const attribution = this.pavlov.attributeOutcome({
          token_mint: report.tokenMint, action_taken: 'PAPER_EXIT_' + report.exitTrigger,
          was_decision_sound: report.wasDecisionSound, realized_pnl_pct: report.realizedPnlPct,
        });
        const autopsy: TradeAutopsyRecord = {
          ...report,
          attribution: { ...attribution, attribution_id: report.tradeId, timestamp_ms: report.closedAt },
          maturityCertificate: maturityCert,
        };
        parsedAutopsies.push(autopsy);
      }

      // Sort reverse-chronologically so autopsies[0] is the most recent closed trade
      parsedAutopsies.sort((a, b) => b.closedAt - a.closedAt);

      this.autopsies.length = 0;
      this.autopsies.push(...parsedAutopsies);

      quality.acceptedRows = parsedAutopsies.length;
      this.dataQuality = quality;
      this.lastLoadedMtimeMs = stat.mtimeMs;
      this.totalCsvRecordsLoaded = parsedAutopsies.length;
      this.dataSourceName = filePath;
      this.autoSync = true;

      const snapshot = this.getSnapshot();
      return {
        loadedCount: parsedAutopsies.length,
        source: filePath,
        winRatePct: snapshot.winRatePct,
        totalRealizedPnlUsd: snapshot.totalRealizedPnlUsd,
      };
    } catch (err) {
      console.warn('[TradeLearningService] Error loading ' + filePath + ':', err);
      return { loadedCount: 0, source: 'Error loading ' + filePath, winRatePct: 0, totalRealizedPnlUsd: 0 };
    }
  }

  public syncIfModified(): boolean {
    if (!this.autoSync || !this.csvPath || !fs.existsSync(this.csvPath)) return false;
    try {
      const stat = fs.statSync(this.csvPath);
      if (stat.mtimeMs > this.lastLoadedMtimeMs) {
        this.loadFromCsv(this.csvPath);
        return true;
      }
    } catch {
      // non-blocking
    }
    return false;
  }

  public recordClosedTrade(
    report: Omit<ClosedTradeReport, 'tradeId' | 'closedAt'>,
    maturityContext?: {
      economicFactId?: string;
      accountMode?: 'paper' | 'live';
      settledSlot?: bigint;
      currentSlot?: bigint;
      settledAtMs?: number;
      currentAtMs?: number;
    }
  ): TradeAutopsyRecord {
    const closedAt = Date.now();
    const tradeId = 'trd_' + closedAt + '_' + Math.floor(Math.random() * 1000);

    const reason = this.rejectionReason({ ...report, tradeId, closedAt });
    if (reason) throw new Error('Rejected learning report: ' + reason);

    const mfePrice = report.mfePriceUsd ?? Math.max(report.entryPriceUsd, report.exitPriceUsd);
    const mfePct = report.mfePct ?? (report.entryPriceUsd > 0 ? Number((((mfePrice - report.entryPriceUsd) / report.entryPriceUsd) * 100).toFixed(2)) : 0);
    const maePrice = report.maePriceUsd ?? Math.min(report.entryPriceUsd, report.exitPriceUsd);
    const maePct = report.maePct ?? (report.entryPriceUsd > 0 ? Number((((maePrice - report.entryPriceUsd) / report.entryPriceUsd) * 100).toFixed(2)) : 0);
    const profitCaptureRatio = report.profitCaptureRatio ?? (mfePct > 0 ? Number(Math.max(0, Math.min(1, report.realizedPnlPct / mfePct)).toFixed(4)) : (report.realizedPnlPct >= 0 ? 1 : 0));
    const exitEfficiency = report.exitEfficiency ?? ((mfePrice > maePrice) ? Number(Math.max(0, Math.min(1, (report.exitPriceUsd - maePrice) / (mfePrice - maePrice))).toFixed(4)) : 1);

    // Evaluate Outcome Maturity if required or context is provided
    let maturityCert: OutcomeMaturityCertificate | undefined;
    if (this.requireOutcomeMaturity || maturityContext) {
      const nowMs = maturityContext?.currentAtMs ?? closedAt;
      const settledMs = maturityContext?.settledAtMs ?? closedAt;
      const settledSlot = maturityContext?.settledSlot ?? 0n;
      const currentSlot = maturityContext?.currentSlot ?? (settledSlot + BigInt(Math.max(0, Math.floor((nowMs - settledMs) / 400))));

      maturityCert = this.maturityGate.evaluateMaturity({
        tradeId,
        economicFactId: maturityContext?.economicFactId ?? `fact_${tradeId}`,
        accountMode: maturityContext?.accountMode ?? 'paper',
        settledSlot,
        currentSlot,
        settledAtMs: settledMs,
        currentAtMs: nowMs,
        minMaturityDelayMs: this.minMaturityDelayMs,
        minMaturitySlotDelta: this.minMaturitySlotDelta,
        mfePct,
        maePct,
        realizedNetPnLLamports: BigInt(Math.round(report.realizedPnlUsd * 1_000_000_000)),
      }, new Date(nowMs).toISOString());

      if (this.requireOutcomeMaturity && (!maturityCert.isMature || !maturityCert.learningReady)) {
        throw new Error(`Rejected learning report: IMMATURE_OUTCOME (${maturityCert.rejectionReason})`);
      }
    }

    const envelopeData = report.tokenMint + ':' + report.entryPriceUsd + ':' + report.exitPriceUsd + ':' + report.realizedPnlPct + ':' + report.exitTrigger + ':' + closedAt;
    let hash = 0;
    for (let i = 0; i < envelopeData.length; i++) {
      hash = ((hash << 5) - hash) + envelopeData.charCodeAt(i);
      hash |= 0;
    }
    const exitEnvelopeHash = report.exitEnvelopeHash || ('0x' + Math.abs(hash).toString(16).padStart(8, '0'));

    // An older header cannot persist an evidence link. Keep the runtime record
    // unassessed too, so a later reload cannot silently change its process quality.
    let processEvidenceRef = report.processEvidenceRef;
    if (this.autoSync && this.csvPath) {
      try {
        const headers = parseCsvLine(fs.readFileSync(this.csvPath, 'utf8').split(/\r?\n/, 1)[0]);
        if (!headers.some(header => header.toLowerCase().trim() === 'process_evidence_ref')) processEvidenceRef = undefined;
      } catch { processEvidenceRef = undefined; }
    }
    const fullReport = this.assessProcess({
      ...report,
      processEvidenceRef,
      tradeId,
      closedAt,
      mfePriceUsd: mfePrice,
      mfePct,
      maePriceUsd: maePrice,
      maePct,
      profitCaptureRatio,
      exitEfficiency,
      exitEnvelopeHash,
    });

    const attribution = this.pavlov.attributeOutcome({
      token_mint: fullReport.tokenMint,
      action_taken: 'PAPER_EXIT_' + fullReport.exitTrigger,
      was_decision_sound: fullReport.wasDecisionSound,
      realized_pnl_pct: fullReport.realizedPnlPct,
    });

    const autopsy: TradeAutopsyRecord = {
      ...fullReport,
      attribution,
      maturityCertificate: maturityCert,
    };

    this.autopsies.unshift(autopsy);

    // Append validated research telemetry; this is not proof of executed trades or profitability.
    try {
      if (this.autoSync && this.csvPath && fs.existsSync(this.csvPath)) {
        const values = [
          autopsy.tradeId,
          autopsy.tokenMint,
          autopsy.symbol,
          autopsy.entryPriceUsd,
          autopsy.exitPriceUsd,
          autopsy.costBasisUsd,
          autopsy.proceedsUsd,
          autopsy.realizedPnlUsd,
          autopsy.realizedPnlPct,
          autopsy.holdDurationMs,
          autopsy.exitTrigger,
          autopsy.wasDecisionSound === 'UNKNOWN' ? 'UNKNOWN' : (autopsy.wasDecisionSound ? '1' : '0'),
          autopsy.closedAt,
          autopsy.mfePct,
          autopsy.maePct,
          autopsy.profitCaptureRatio,
          autopsy.exitEfficiency,
          autopsy.attribution.credit_archetype,
          autopsy.attribution.policy_reinforcement_action,
          autopsy.wasDecisionSound === 'UNKNOWN' ? '' : (autopsy.attribution.policy_reinforcement_action === 'PENALIZE_POLICY' ? 85 : 82),
          autopsy.wasDecisionSound === 'UNKNOWN' ? '' : (autopsy.attribution.policy_reinforcement_action === 'PENALIZE_POLICY' ? 'DEFENSIVE' : 'BALANCED'),
          '',
          autopsy.exitEnvelopeHash,
          autopsy.attribution.attribution_notes.replaceAll(',', ';'),
          autopsy.decisionSoundnessReason,
          autopsy.processEvidenceRef
        ];
        const standardHeaders = 'trade_id,token_mint,symbol,entry_price_usd,exit_price_usd,cost_basis_usd,proceeds_usd,realized_pnl_usd,realized_pnl_pct,hold_duration_ms,exit_trigger,was_decision_sound,closed_at_ms,mfe_pct,mae_pct,profit_capture_ratio,exit_efficiency,credit_archetype,policy_reinforcement_action,adaptive_hsi_hurdle,calibration_regime,counterfactual_pnl_pct,exit_envelope_hash,attribution_notes,decision_soundness_reason,process_evidence_ref'.split(',');
        const mapped = new Map(standardHeaders.map((header, index) => [header, values[index]]));
        const headers = parseCsvLine(fs.readFileSync(this.csvPath, 'utf8').split(/\r?\n/, 1)[0]);
        const row = headers.map(header => {
          const value = String(mapped.get(header.toLowerCase().trim()) ?? '');
          return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
        }).join(',') + '\n';

        fs.appendFileSync(this.csvPath, row, 'utf8');
        this.totalCsvRecordsLoaded++;
        this.lastLoadedMtimeMs = Date.now();
      }
    } catch {
      // Non-blocking telemetry persistence
    }

    return autopsy;
  }

  public getSnapshot(): AdaptiveLearningSnapshot {
    this.syncIfModified();
    const totalTrades = this.autopsies.length;
    let winCount = 0;
    let lossCount = 0;
    let totalRealizedPnlUsd = 0;
    let unknown = 0;
    let reinforceAlpha = 0;
    let neutralVariance = 0;
    let doNotReinforceLuck = 0;
    let penalizePolicy = 0;
    let totalPcr = 0;
    let totalEe = 0;
    let totalHoldMs = 0;

    for (const a of this.autopsies) {
      if (a.realizedPnlUsd > 0) winCount++;
      else lossCount++;
      totalRealizedPnlUsd += a.realizedPnlUsd;
      totalPcr += a.profitCaptureRatio ?? 0;
      totalEe += a.exitEfficiency ?? 0;
      totalHoldMs += a.holdDurationMs ?? 0;

      switch (a.attribution.credit_archetype) {
        case 'UNKNOWN':
          unknown++;
          break;
        case 'GOOD_DECISION_GOOD_OUTCOME':
          reinforceAlpha++;
          break;
        case 'GOOD_DECISION_BAD_OUTCOME':
          neutralVariance++;
          break;
        case 'BAD_DECISION_GOOD_OUTCOME':
          doNotReinforceLuck++;
          break;
        case 'BAD_DECISION_BAD_OUTCOME':
          penalizePolicy++;
          break;
      }
    }

    const winRatePct = totalTrades > 0 ? Number(((winCount / totalTrades) * 100).toFixed(1)) : 0;
    const averageProfitCaptureRatio = totalTrades > 0 ? Number((totalPcr / totalTrades).toFixed(3)) : 0;
    const averageExitEfficiency = totalTrades > 0 ? Number((totalEe / totalTrades).toFixed(3)) : 0;
    const averageHoldDurationMs = totalTrades > 0 ? Math.round(totalHoldMs / totalTrades) : 0;

    // Only verified process assessments participate in calibration.
    const assessedTrades = totalTrades - unknown;
    const assessedWinRatePct = assessedTrades > 0 ? (reinforceAlpha + doNotReinforceLuck) / assessedTrades * 100 : 0;
    let adaptiveHsiHurdle = 80;
    let calibrationRegime: 'OPTIMAL' | 'BALANCED' | 'DEFENSIVE' = 'BALANCED';

    if (assessedTrades >= 3) {
      if (penalizePolicy > 0 || assessedWinRatePct < 40) {
        adaptiveHsiHurdle = 85;
        calibrationRegime = 'DEFENSIVE';
      } else if (assessedWinRatePct >= 65 && doNotReinforceLuck === 0) {
        adaptiveHsiHurdle = 80;
        calibrationRegime = 'OPTIMAL';
      } else {
        adaptiveHsiHurdle = 82;
        calibrationRegime = 'BALANCED';
      }
    }

    return {
      evidenceStatus: 'RESEARCH_ONLY_NOT_PROOF_OF_PROFITABILITY',
      dataQuality: { ...this.dataQuality, rejectionReasons: { ...this.dataQuality.rejectionReasons } },
      totalTradesEvaluated: totalTrades,
      winCount,
      lossCount,
      winRatePct,
      totalRealizedPnlUsd: Number(totalRealizedPnlUsd.toFixed(2)),
      averageProfitCaptureRatio,
      averageExitEfficiency,
      averageHoldDurationMs,
      attributionSummary: {
        unknown,
        reinforceAlpha,
        neutralVariance,
        doNotReinforceLuck,
        penalizePolicy,
      },
      adaptiveCalibration: {
        baseHsiHurdle: 80,
        adaptiveHsiHurdle,
        calibrationRegime,
        recommendedStopPct: -12.0,
        recommendedTargetPct: 15.0,
      },
      recentAutopsies: this.autopsies.slice(0, 25),
      dataSource: this.dataSourceName,
      totalCsvRecordsLoaded: this.totalCsvRecordsLoaded,
      lastUpdatedAt: Date.now(),
    };
  }

  public clear(): void {
    this.autopsies.length = 0;
    this.totalCsvRecordsLoaded = 0;
    this.dataQuality = { csvRowsRead: 0, acceptedRows: 0, rejectedRows: 0, rejectionReasons: {} };
  }
}

export const globalTradeLearningService = TradeLearningService.getInstance();
