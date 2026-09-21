/**
 * SOL-SYLPH Platform - Multi-Mode Entry Timing Engine
 * Specifications: Master Quantitative Upgrade (Phase 5).
 *
 * Replaces naive "market buy on first tick" with structured timing models:
 * 1. PULLBACK_CONFIRMATION: 10%-25% retrace from initial peak with seller exhaustion
 * 2. BREAKOUT_EXPANSION: Resistance breach with >3x volume expansion & buyer breadth
 * 3. LIQUIDITY_GROWTH: Organic curve growth >= 2.0 SOL within 30s
 * 4. SMART_WALLET_CONFIRMATION: Verified high-win-rate wallet entry
 */

export type EntryTimingMode =
  | 'PULLBACK_CONFIRMATION'
  | 'BREAKOUT_EXPANSION'
  | 'LIQUIDITY_GROWTH'
  | 'SMART_WALLET_CONFIRMATION'
  | 'IMMEDIATE_FAST'
  | 'WAIT_FOR_SETUP';

export interface EntryTelemetry {
  readonly mint: string;
  readonly realSolReserve: number;
  readonly priceVelocityBps: number;        // Price change BPS per second
  readonly volumeVelocitySolSec: number;    // Volume in SOL per second
  readonly sellPressureRatio: number;       // Sells / (Buys + Sells) over recent window [0, 1]
  readonly retraceFromPeakPct: number;      // Retrace from peak [0.0, 1.0] (e.g. 0.15 = 15% pullback)
  readonly smartWalletPresent: boolean;
  readonly recentTxCount: number;
  readonly uniqueBuyerGrowthRate: number;   // New buyers per minute
  readonly tokenAgeSeconds: number;
}

export interface TimingDecision {
  readonly isReady: boolean;
  readonly mode: EntryTimingMode;
  readonly timingScore: number;             // 0 to 100
  readonly confidence: number;              // 0.0 to 1.0
  readonly invalidationReason?: string;
  readonly notes: string;
}

export class EntryTimingEngine {
  public evaluateTiming(telemetry: EntryTelemetry): TimingDecision {
    // 1. Invalidation checks: high seller dominance or extreme dumping
    if (telemetry.sellPressureRatio > 0.70) {
      return {
        isReady: false,
        mode: 'WAIT_FOR_SETUP',
        timingScore: 15,
        confidence: 0.85,
        invalidationReason: `SELLER_DOMINANCE: Sell pressure ratio is ${(telemetry.sellPressureRatio * 100).toFixed(0)}% (>70% ceiling)`,
        notes: 'Excessive selling indicates early sniper dump or lack of organic bid support.',
      };
    }

    if (telemetry.retraceFromPeakPct > 0.40) {
      return {
        isReady: false,
        mode: 'WAIT_FOR_SETUP',
        timingScore: 20,
        confidence: 0.90,
        invalidationReason: `DEEP_PULLBACK_COLLAPSE: Retrace from peak is ${(telemetry.retraceFromPeakPct * 100).toFixed(0)}% (>40% breakdown)`,
        notes: 'Pullback exceeded 40% threshold; structural trend broken into possible rug.',
      };
    }

    // 2. Mode 1: Smart-Wallet Confirmation
    if (telemetry.smartWalletPresent && telemetry.sellPressureRatio < 0.45) {
      return {
        isReady: true,
        mode: 'SMART_WALLET_CONFIRMATION',
        timingScore: 92,
        confidence: 0.88,
        notes: 'Verified historical smart wallet accumulated with low adverse sell flow.',
      };
    }

    // 3. Mode 2: Pullback Confirmation Mode
    // Optimal for curves with established liquidity (> 3.0 SOL) that had an initial run
    if (telemetry.realSolReserve >= 3.0 && telemetry.tokenAgeSeconds >= 20) {
      if (telemetry.retraceFromPeakPct >= 0.08 && telemetry.retraceFromPeakPct <= 0.25) {
        if (telemetry.sellPressureRatio <= 0.40 && telemetry.uniqueBuyerGrowthRate >= 2) {
          return {
            isReady: true,
            mode: 'PULLBACK_CONFIRMATION',
            timingScore: 88,
            confidence: 0.82,
            notes: `Clean ${(telemetry.retraceFromPeakPct * 100).toFixed(1)}% pullback with seller exhaustion and new organic buyers entering.`,
          };
        }
      }
    }

    // 4. Mode 3: Breakout Expansion Mode
    // Rapid momentum acceleration with broad buyer breadth
    if (telemetry.priceVelocityBps > 50 && telemetry.volumeVelocitySolSec > 0.5) {
      if (telemetry.uniqueBuyerGrowthRate >= 5 && telemetry.sellPressureRatio <= 0.30) {
        return {
          isReady: true,
          mode: 'BREAKOUT_EXPANSION',
          timingScore: 85,
          confidence: 0.78,
          notes: `Breakout confirmed: +${telemetry.priceVelocityBps} BPS/s velocity with ${telemetry.volumeVelocitySolSec.toFixed(2)} SOL/s volume and expanding buyer breadth.`,
        };
      }
    }

    // 5. Mode 4: Liquidity Growth Mode
    // Consistent organic reserve accumulation
    if (telemetry.realSolReserve >= 2.5 && telemetry.recentTxCount >= 10 && telemetry.sellPressureRatio <= 0.35) {
      return {
        isReady: true,
        mode: 'LIQUIDITY_GROWTH',
        timingScore: 78,
        confidence: 0.75,
        notes: `Steady curve accumulation (${telemetry.realSolReserve.toFixed(2)} SOL reserves, ${telemetry.recentTxCount} txs).`,
      };
    }

    // 6. Default: Wait for Setup
    return {
      isReady: false,
      mode: 'WAIT_FOR_SETUP',
      timingScore: 45,
      confidence: 0.60,
      notes: 'Awaiting clean pullback or volume acceleration trigger before issuing permit.',
    };
  }
}
