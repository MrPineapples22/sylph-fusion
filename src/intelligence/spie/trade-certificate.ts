/**
 * SOL-SYLPH Platform - Post-Trade Audit Certificate & Attribution Engine
 * Specifications: Master Quantitative Upgrade (Phases 13 & 14).
 *
 * Emits an immutable, cryptographically verifiable TradeCertificate for every
 * closed position to support counterfactual learning, model calibration, and
 * scientific outcome attribution.
 */

import { createHash } from 'node:crypto';

export type AlphaAttributionType =
  | 'TOKEN_SELECTION_ALPHA'
  | 'ENTRY_TIMING_ALPHA'
  | 'EXECUTION_ALPHA'
  | 'EXIT_ALPHA'
  | 'ADVERSE_MARKET_DRAG';

export interface TradeCertificateInput {
  readonly tradeId: string;
  readonly mint: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly entryPriceUsd: number;
  readonly exitPriceUsd: number;
  readonly positionSizeSol: number;
  readonly realizedPnlSol: number;
  readonly maxPriceObservedUsd: number;
  readonly minPriceObservedUsd: number;
  readonly feesPaidSol: number;
  readonly estimatedSlippageBps: number;
  readonly spieVectorAtEntry: Record<string, number>;
  readonly regimeAtEntry: string;
  readonly exitReason: string;
  readonly priceAtInitialSignalUsd?: number;
  readonly price5mPostExitUsd?: number;
}

export interface TradeCertificate {
  readonly certificateId: string;
  readonly tradeId: string;
  readonly mint: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly durationSeconds: number;
  readonly entryPriceUsd: number;
  readonly exitPriceUsd: number;
  readonly positionSizeSol: number;
  readonly realizedPnlSol: number;
  readonly realizedPnlPct: number;
  readonly realizedPnlBps: number;
  readonly maxFavorableExcursionPct: number; // MFE: (MaxPrice - Entry) / Entry
  readonly maxAdverseExcursionPct: number;   // MAE: (MinPrice - Entry) / Entry
  readonly feesPaidSol: number;
  readonly estimatedSlippageBps: number;
  readonly spieVectorAtEntry: Record<string, number>;
  readonly regimeAtEntry: string;
  readonly exitReason: string;
  readonly counterfactuals: {
    readonly initialSignalVsEntryDeltaBps: number;
    readonly postExit5mDriftBps: number;
    readonly executionLossBps: number;
  };
  readonly attribution: AlphaAttributionType;
  readonly integrityHash: string;
}

export class TradeCertificateFactory {
  public static generateCertificate(input: TradeCertificateInput): TradeCertificate {
    const entry = input.entryPriceUsd;
    const exit = input.exitPriceUsd;
    const durationSeconds = Math.max(1, Math.floor((input.exitTimestamp - input.entryTimestamp) / 1000));

    const realizedPnlPct = entry > 0 ? (exit - entry) / entry : 0;
    const realizedPnlBps = Math.round(realizedPnlPct * 10000);

    const maxFavorableExcursionPct = entry > 0 ? Math.max(0, (input.maxPriceObservedUsd - entry) / entry) : 0;
    const maxAdverseExcursionPct = entry > 0 ? Math.min(0, (input.minPriceObservedUsd - entry) / entry) : 0;

    // Counterfactual Analysis
    // 1. Did waiting for entry save us from negative slippage or early dump?
    const signalPrice = input.priceAtInitialSignalUsd ?? entry;
    const initialSignalVsEntryDeltaBps = signalPrice > 0 ? Math.round(((entry - signalPrice) / signalPrice) * 10000) : 0;

    // 2. Did the token collapse or continue pumping after our exit?
    const postExitPrice = input.price5mPostExitUsd ?? exit;
    const postExit5mDriftBps = exit > 0 ? Math.round(((postExitPrice - exit) / exit) * 10000) : 0;

    // 3. Execution loss (slippage + fee friction)
    const feeBps = input.positionSizeSol > 0 ? Math.round((input.feesPaidSol / input.positionSizeSol) * 10000) : 0;
    const executionLossBps = input.estimatedSlippageBps + feeBps;

    // Deduce Primary Alpha Attribution
    let attribution: AlphaAttributionType = 'TOKEN_SELECTION_ALPHA';

    if (realizedPnlPct < 0) {
      attribution = executionLossBps > Math.abs(realizedPnlBps) * 0.5 ? 'EXECUTION_ALPHA' : 'ADVERSE_MARKET_DRAG';
    } else {
      if (postExit5mDriftBps < -1500) {
        // Exited right before a -15% dump: Exit Alpha saved capital!
        attribution = 'EXIT_ALPHA';
      } else if (initialSignalVsEntryDeltaBps < -500 && realizedPnlPct > 0.10) {
        // Waited for pullback before buying: Entry Timing Alpha!
        attribution = 'ENTRY_TIMING_ALPHA';
      } else {
        attribution = 'TOKEN_SELECTION_ALPHA';
      }
    }

    const payloadWithoutHash = {
      tradeId: input.tradeId,
      mint: input.mint,
      strategy: input.strategy,
      entryPriceUsd: entry,
      exitPriceUsd: exit,
      positionSizeSol: input.positionSizeSol,
      realizedPnlBps,
      maxFavorableExcursionPct: Number(maxFavorableExcursionPct.toFixed(4)),
      maxAdverseExcursionPct: Number(maxAdverseExcursionPct.toFixed(4)),
      attribution,
      timestamp: input.exitTimestamp,
    };

    const integrityHash = createHash('sha256').update(JSON.stringify(payloadWithoutHash)).digest('hex');
    const certificateId = `cert-${input.mint.slice(0, 8)}-${input.tradeId.slice(-6)}`;

    return {
      certificateId,
      tradeId: input.tradeId,
      mint: input.mint,
      symbol: input.symbol,
      strategy: input.strategy,
      entryTimestamp: input.entryTimestamp,
      exitTimestamp: input.exitTimestamp,
      durationSeconds,
      entryPriceUsd: entry,
      exitPriceUsd: exit,
      positionSizeSol: input.positionSizeSol,
      realizedPnlSol: input.realizedPnlSol,
      realizedPnlPct: Number(realizedPnlPct.toFixed(4)),
      realizedPnlBps,
      maxFavorableExcursionPct: Number(maxFavorableExcursionPct.toFixed(4)),
      maxAdverseExcursionPct: Number(maxAdverseExcursionPct.toFixed(4)),
      feesPaidSol: input.feesPaidSol,
      estimatedSlippageBps: input.estimatedSlippageBps,
      spieVectorAtEntry: input.spieVectorAtEntry,
      regimeAtEntry: input.regimeAtEntry,
      exitReason: input.exitReason,
      counterfactuals: {
        initialSignalVsEntryDeltaBps,
        postExit5mDriftBps,
        executionLossBps,
      },
      attribution,
      integrityHash,
    };
  }

  public static verifyCertificate(cert: TradeCertificate): boolean {
    const payloadWithoutHash = {
      tradeId: cert.tradeId,
      mint: cert.mint,
      strategy: cert.strategy,
      entryPriceUsd: cert.entryPriceUsd,
      exitPriceUsd: cert.exitPriceUsd,
      positionSizeSol: cert.positionSizeSol,
      realizedPnlBps: cert.realizedPnlBps,
      maxFavorableExcursionPct: cert.maxFavorableExcursionPct,
      maxAdverseExcursionPct: cert.maxAdverseExcursionPct,
      attribution: cert.attribution,
      timestamp: cert.exitTimestamp,
    };
    const expectedHash = createHash('sha256').update(JSON.stringify(payloadWithoutHash)).digest('hex');
    return cert.integrityHash === expectedHash;
  }
}

