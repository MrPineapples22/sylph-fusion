/**
 * SOL-SYLPH Trade Learning & Attribution Service
 * Specifications: Blueprint Engine #39 (Pavlov Attribution) & Section 42 (Adaptive Feedback)
 *
 * Ingests authoritative closed trade autopsies from D:\\pump\\SOL-SYLPH\\pavlov_attributions.csv,
 * classifies decision credit vs financial outcome via Pavlov Attribution, tracks win/loss distributions,
 * and dynamically calibrates adaptive HSI hurdles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PavlovOutcomeAttributionEngine, type PavlovAttributionRecord, type PavlovCreditArchetype } from './pavlov-attribution.js';

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

  public static getInstance(): TradeLearningService {
    if (!TradeLearningService.instance) {
      TradeLearningService.instance = new TradeLearningService();
    }
    return TradeLearningService.instance;
  }

  public constructor() {
    // Tests start with an isolated in-memory instance (0 records).
    // Production servers call .loadFromCsv() to ingest authoritative CSV telemetry.
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
      if (lines.length <= 1) {
        return { loadedCount: 0, source: filePath, winRatePct: 0, totalRealizedPnlUsd: 0 };
      }

      const headers = parseCsvLine(lines[0]);
      const colMap = new Map<string, number>();
      headers.forEach((h, i) => colMap.set(h.toLowerCase().trim(), i));

      const parsedAutopsies: TradeAutopsyRecord[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 5) continue;

        const getVal = (name: string): string => {
          const idx = colMap.get(name);
          return idx != null && idx < row.length ? row[idx] : '';
        };

        const tradeId = getVal('trade_id') || ('csv_' + i);
        const tokenMint = getVal('token_mint') || '';
        const symbol = getVal('symbol') || (tokenMint ? tokenMint.slice(0, 6) : 'TOKEN');
        const entryPriceUsd = parseFloat(getVal('entry_price_usd')) || 0;
        const exitPriceUsd = parseFloat(getVal('exit_price_usd')) || 0;
        const costBasisUsd = parseFloat(getVal('cost_basis_usd')) || 50.0;
        const proceedsUsd = parseFloat(getVal('proceeds_usd')) || (costBasisUsd + (parseFloat(getVal('realized_pnl_usd')) || 0));
        const realizedPnlUsd = parseFloat(getVal('realized_pnl_usd')) || (proceedsUsd - costBasisUsd);
        const realizedPnlPct = parseFloat(getVal('realized_pnl_pct')) || (costBasisUsd > 0 ? (realizedPnlUsd / costBasisUsd) * 100 : 0);
        const holdDurationMs = parseInt(getVal('hold_duration_ms'), 10) || 15000;
        const exitTrigger = getVal('exit_trigger') || 'EXIT_FILLED';
        const wasDecisionSound = getVal('was_decision_sound') === '1' || getVal('was_decision_sound').toLowerCase() === 'true';
        const closedAt = parseInt(getVal('closed_at_ms'), 10) || Date.now();
        const mfePct = parseFloat(getVal('mfe_pct')) || 0;
        const maePct = parseFloat(getVal('mae_pct')) || 0;
        const profitCaptureRatio = parseFloat(getVal('profit_capture_ratio')) || (mfePct > 0 ? Math.max(0, Math.min(1, realizedPnlPct / mfePct)) : (realizedPnlPct >= 0 ? 1 : 0));
        const exitEfficiency = parseFloat(getVal('exit_efficiency')) || 0.5;
        const creditArchetype = (getVal('credit_archetype') || (realizedPnlUsd >= 0 ? 'GOOD_DECISION_GOOD_OUTCOME' : 'GOOD_DECISION_BAD_OUTCOME')) as PavlovCreditArchetype;
        const policyAction = (getVal('policy_reinforcement_action') || (realizedPnlUsd >= 0 ? 'REINFORCE' : 'NEUTRAL_VARIANCE')) as any;
        const attributionNotes = getVal('attribution_notes') || (wasDecisionSound ? 'Sound decision process evaluated.' : 'Decision flaw flagged.');
        const exitEnvelopeHash = getVal('exit_envelope_hash') || '';

        const autopsy: TradeAutopsyRecord = {
          tradeId,
          tokenMint,
          symbol,
          entryPriceUsd,
          exitPriceUsd,
          costBasisUsd,
          proceedsUsd,
          realizedPnlUsd,
          realizedPnlPct: Number(realizedPnlPct.toFixed(2)),
          holdDurationMs,
          exitTrigger,
          wasDecisionSound,
          closedAt,
          mfePct,
          maePct,
          profitCaptureRatio,
          exitEfficiency,
          exitEnvelopeHash,
          attribution: {
            attribution_id: tradeId,
            token_mint: tokenMint,
            action_taken: 'PAPER_EXIT_' + exitTrigger,
            was_decision_sound: wasDecisionSound,
            realized_pnl_pct: realizedPnlPct,
            credit_archetype: creditArchetype,
            policy_reinforcement_action: policyAction,
            attribution_notes: attributionNotes,
            timestamp_ms: closedAt,
          }
        };

        parsedAutopsies.push(autopsy);
      }

      // Sort reverse-chronologically so autopsies[0] is the most recent closed trade
      parsedAutopsies.sort((a, b) => b.closedAt - a.closedAt);

      this.autopsies.length = 0;
      this.autopsies.push(...parsedAutopsies);

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

    // Continuous Supervised Ingestion: Append to authoritative pavlov_attributions.csv
    try {
      if (this.autoSync && this.csvPath && fs.existsSync(this.csvPath)) {
        const row = [
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
        ].join(',') + '\n';

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
      totalCsvRecordsLoaded: this.totalCsvRecordsLoaded || totalTrades,
      lastUpdatedAt: Date.now(),
    };
  }

  public clear(): void {
    this.autopsies.length = 0;
    this.totalCsvRecordsLoaded = 0;
  }
}

export const globalTradeLearningService = TradeLearningService.getInstance();
