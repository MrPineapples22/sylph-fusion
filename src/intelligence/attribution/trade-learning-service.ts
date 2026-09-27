/**
 * SOL-SYLPH Trade Learning & Attribution Service
 * Specifications: Blueprint Engine #39 (Pavlov Attribution) & Section 42 (Adaptive Feedback)
 *
 * Ingests unverified research closed trade autopsies from D:\\pump\\SOL-SYLPH\\pavlov_attributions.csv,
 * classifies decision credit vs financial outcome via Pavlov Attribution, tracks win/loss distributions,
 * and dynamically calibrates adaptive HSI hurdles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PavlovOutcomeAttributionEngine, type PavlovAttributionRecord } from './pavlov-attribution.js';

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
  readonly wasDecisionSound: boolean;
  readonly closedAt: number;
  readonly mfePriceUsd?: number;
  readonly mfePct?: number;
  readonly maePriceUsd?: number;
  readonly maePct?: number;
  readonly profitCaptureRatio?: number;
  readonly exitEfficiency?: number;
  readonly exitEnvelopeHash?: string;
}

export interface TradeAutopsyRecord extends ClosedTradeReport {
  readonly attribution: PavlovAttributionRecord;
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
    if (typeof report.wasDecisionSound !== 'boolean') return 'INVALID_DECISION_FLAG';
    return undefined;
  }

  public static getInstance(): TradeLearningService {
    if (!TradeLearningService.instance) {
      TradeLearningService.instance = new TradeLearningService();
    }
    return TradeLearningService.instance;
  }

  public constructor() {
    // Tests start with an isolated in-memory instance (0 records).
    // Servers call .loadFromCsv() to ingest validated but unverified research telemetry.
  }

  private resolveCsvPath(preferredPath?: string): string {
    const candidates = [
      preferredPath,
      process.env.PAVLOV_ATTRIBUTIONS_PATH,
      'D:/pump/SOL-SYLPH/pavlov_attributions.csv',
      'd:\\pump\\SOL-SYLPH\\pavlov_attributions.csv',
      path.resolve(process.cwd(), 'pavlov_attributions.csv'),
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return preferredPath || 'D:/pump/SOL-SYLPH/pavlov_attributions.csv';
  }

  public loadFromCsv(targetPath?: string): { loadedCount: number; source: string; winRatePct: number; totalRealizedPnlUsd: number } {
    const filePath = this.resolveCsvPath(targetPath);
    this.csvPath = filePath;
    this.autoSync = true;
    if (!fs.existsSync(filePath)) {
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
        if (row.length !== headers.length) { reject('MALFORMED_ROW'); continue; }

        const getVal = (name: string): string => {
          const idx = colMap.get(name);
          return idx != null && idx < row.length ? row[idx] : '';
        };

        const numeric = (name: string): number => getVal(name) === '' ? NaN : Number(getVal(name));
        const optional = (name: string): number | undefined => getVal(name) === '' ? undefined : Number(getVal(name));
        const flag = getVal('was_decision_sound').toLowerCase();
        const report: ClosedTradeReport = {
          tradeId: getVal('trade_id'), tokenMint: getVal('token_mint'), symbol: getVal('symbol'),
          entryPriceUsd: numeric('entry_price_usd'), exitPriceUsd: numeric('exit_price_usd'),
          costBasisUsd: numeric('cost_basis_usd'), proceedsUsd: numeric('proceeds_usd'),
          realizedPnlUsd: numeric('realized_pnl_usd'), realizedPnlPct: numeric('realized_pnl_pct'),
          holdDurationMs: numeric('hold_duration_ms'), exitTrigger: getVal('exit_trigger'),
          wasDecisionSound: flag === '1' || flag === 'true', closedAt: numeric('closed_at_ms'),
          mfePct: optional('mfe_pct'), maePct: optional('mae_pct'),
          profitCaptureRatio: optional('profit_capture_ratio'), exitEfficiency: optional('exit_efficiency'),
          exitEnvelopeHash: getVal('exit_envelope_hash'),
        };
        const reason = this.rejectionReason(report) ?? (!['1', '0', 'true', 'false'].includes(flag) ? 'INVALID_DECISION_FLAG' : undefined);
        if (reason) { reject(reason); continue; }
        if (seen.has(report.tradeId)) { reject('DUPLICATE_TRADE_ID'); continue; }
        seen.add(report.tradeId);
        const attribution = this.pavlov.attributeOutcome({
          token_mint: report.tokenMint, action_taken: 'PAPER_EXIT_' + report.exitTrigger,
          was_decision_sound: report.wasDecisionSound, realized_pnl_pct: report.realizedPnlPct,
        });
        const autopsy: TradeAutopsyRecord = { ...report, attribution: { ...attribution, attribution_id: report.tradeId, timestamp_ms: report.closedAt } };
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

  public recordClosedTrade(report: Omit<ClosedTradeReport, 'tradeId' | 'closedAt'>): TradeAutopsyRecord {
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

    const envelopeData = report.tokenMint + ':' + report.entryPriceUsd + ':' + report.exitPriceUsd + ':' + report.realizedPnlPct + ':' + report.exitTrigger + ':' + closedAt;
    let hash = 0;
    for (let i = 0; i < envelopeData.length; i++) {
      hash = ((hash << 5) - hash) + envelopeData.charCodeAt(i);
      hash |= 0;
    }
    const exitEnvelopeHash = report.exitEnvelopeHash || ('0x' + Math.abs(hash).toString(16).padStart(8, '0'));

    const fullReport: ClosedTradeReport = {
      ...report,
      tradeId,
      closedAt,
      mfePriceUsd: mfePrice,
      mfePct,
      maePriceUsd: maePrice,
      maePct,
      profitCaptureRatio,
      exitEfficiency,
      exitEnvelopeHash,
    };

    const attribution = this.pavlov.attributeOutcome({
      token_mint: fullReport.tokenMint,
      action_taken: 'PAPER_EXIT_' + fullReport.exitTrigger,
      was_decision_sound: fullReport.wasDecisionSound,
      realized_pnl_pct: fullReport.realizedPnlPct,
    });

    const autopsy: TradeAutopsyRecord = {
      ...fullReport,
      attribution,
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
          autopsy.wasDecisionSound ? '1' : '0',
          autopsy.closedAt,
          autopsy.mfePct,
          autopsy.maePct,
          autopsy.profitCaptureRatio,
          autopsy.exitEfficiency,
          autopsy.attribution.credit_archetype,
          autopsy.attribution.policy_reinforcement_action,
          82,
          'BALANCED',
          '',
          autopsy.exitEnvelopeHash,
          autopsy.attribution.attribution_notes.replaceAll(',', ';')
        ];
        const standardHeaders = 'trade_id,token_mint,symbol,entry_price_usd,exit_price_usd,cost_basis_usd,proceeds_usd,realized_pnl_usd,realized_pnl_pct,hold_duration_ms,exit_trigger,was_decision_sound,closed_at_ms,mfe_pct,mae_pct,profit_capture_ratio,exit_efficiency,credit_archetype,policy_reinforcement_action,adaptive_hsi_hurdle,calibration_regime,counterfactual_pnl_pct,exit_envelope_hash,attribution_notes'.split(',');
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

    // Adaptive Calibration based on empirical win rate and attribution:
    // If recent win rate drops below 40%, raise HSI hurdle to demand higher conviction.
    // If recent win rate >= 65%, maintain optimal hurdle.
    let adaptiveHsiHurdle = 80;
    let calibrationRegime: 'OPTIMAL' | 'BALANCED' | 'DEFENSIVE' = 'BALANCED';

    if (totalTrades >= 3) {
      if (winRatePct < 40) {
        adaptiveHsiHurdle = 85;
        calibrationRegime = 'DEFENSIVE';
      } else if (winRatePct >= 65) {
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
