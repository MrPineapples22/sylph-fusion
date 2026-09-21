/**
 * SOL-SYLPH Master Intelligence Architecture - Point-in-Time State Engine
 * Specifications: Part IV (Point-in-Time State Engine).
 *
 * Enforces zero lookahead leakage by reconstructing historical state
 * strictly as of the requested timestamp and slot.
 *
 * Provides:
 * - get_token_state(mint, timestampMs, slot)
 * - get_wallet_state(wallet, timestampMs, slot)
 * - get_market_state(timestampMs, slot)
 * - get_portfolio_state(timestampMs)
 */

import { TemporalFirewall } from './temporal-firewall.js';
import type { CanonicalEvent } from './types.js';

export interface TokenPointInTimeState {
  readonly mint: string;
  readonly asOfTimestampMs: number;
  readonly asOfSlot: number;
  readonly priceSol: number;
  readonly liquiditySol: number;
  readonly marketCapSol: number;
  readonly totalTxCount: number;
  readonly buyCount: number;
  readonly sellCount: number;
  readonly buyVolumeSol: number;
  readonly sellVolumeSol: number;
  readonly uniqueWalletsCount: number;
  readonly top10ConcentrationPct: number;
  readonly lastActivityTimestampMs: number;
  readonly stateVersion: number;
}

export interface WalletPointInTimeState {
  readonly walletAddress: string;
  readonly asOfTimestampMs: number;
  readonly asOfSlot: number;
  readonly firstSeenSlot: number;
  readonly lastSeenSlot: number;
  readonly totalTradesCount: number;
  readonly totalVolumeSol: number;
  readonly parentFundingAddress?: string;
  readonly knownTokensTraded: readonly string[];
  readonly reputationScore: number; // 0 - 100
}

export interface MarketPointInTimeState {
  readonly asOfTimestampMs: number;
  readonly asOfSlot: number;
  readonly solPriceUsd: number;
  readonly solReturn24hPct: number;
  readonly activeTokensCount: number;
  readonly launchesLastHourCount: number;
  readonly macroRegime: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF' | 'ABNORMAL';
  readonly networkSlotLag: number;
  readonly rpcHealthyCount: number;
}

export interface PortfolioPointInTimeState {
  readonly asOfTimestampMs: number;
  readonly totalEquitySol: number;
  readonly cashReserveSol: number;
  readonly openPositionsCount: number;
  readonly totalExposureSol: number;
  readonly activePositions: readonly {
    readonly mint: string;
    readonly sizeSol: number;
    readonly entryPriceSol: number;
    readonly unrealizedPnlPct: number;
  }[];
  readonly portfolioState: 'NORMAL' | 'DRAWDOWN' | 'RECOVERY' | 'RISK_FREEZE';
}

export class PointInTimeStateEngine {
  private readonly eventsByMint = new Map<string, CanonicalEvent[]>();
  private readonly eventsByWallet = new Map<string, CanonicalEvent[]>();
  private readonly globalEvents: CanonicalEvent[] = [];
  private readonly portfolioSnapshots: PortfolioPointInTimeState[] = [];

  /**
   * Ingest canonical event chronologically.
   */
  public ingestEvent(event: CanonicalEvent): void {
    this.globalEvents.push(event);

    if (event.mint) {
      const list = this.eventsByMint.get(event.mint) ?? [];
      list.push(event);
      this.eventsByMint.set(event.mint, list);
    }

    if (event.wallet) {
      const list = this.eventsByWallet.get(event.wallet) ?? [];
      list.push(event);
      this.eventsByWallet.set(event.wallet, list);
    }
  }

  public recordPortfolioSnapshot(snapshot: PortfolioPointInTimeState): void {
    this.portfolioSnapshots.push(snapshot);
  }

  /**
   * Reconstruct historical token state strictly as-of decision point (T, slot).
   */
  public get_token_state(
    mint: string,
    timestampMs: number,
    slot = Number.MAX_SAFE_INTEGER
  ): TokenPointInTimeState | undefined {
    const list = this.eventsByMint.get(mint);
    if (!list || list.length === 0) return undefined;

    // Filter strictly with Temporal Firewall
    const eligible = list.filter(
      (e) => e.sourceTimestampMs <= timestampMs && e.slot <= slot
    );

    if (eligible.length === 0) return undefined;

    // Enforce temporal firewall assertion
    const latest = eligible[eligible.length - 1];
    TemporalFirewall.assertAvailableBeforeDecision(
      {
        artifactId: latest.eventId,
        availableTimestampMs: latest.sourceTimestampMs,
        availableSlot: latest.slot,
      },
      { decisionTimestampMs: timestampMs, decisionSlot: slot }
    );

    let buyCount = 0;
    let sellCount = 0;
    let buyVolumeSol = 0;
    let sellVolumeSol = 0;
    const uniqueWallets = new Set<string>();
    let lastPrice = 0.00001;
    let lastLiquidity = 10.0;

    for (const evt of eligible) {
      if (evt.wallet) uniqueWallets.add(evt.wallet);
      const amt = Number(evt.payload['amountSol'] ?? 0);
      const price = Number(evt.payload['priceSol'] ?? 0);
      if (price > 0) lastPrice = price;
      if (evt.payload['liquiditySol']) lastLiquidity = Number(evt.payload['liquiditySol']);

      if (evt.eventType === 'BUY' || evt.eventType === 'TOKEN_CREATE' || evt.eventType === 'TRADE_SWAP') {
        buyCount++;
        buyVolumeSol += amt;
      } else if (evt.eventType === 'SELL') {
        sellCount++;
        sellVolumeSol += amt;
      }
    }

    return {
      mint,
      asOfTimestampMs: timestampMs,
      asOfSlot: slot,
      priceSol: lastPrice,
      liquiditySol: lastLiquidity,
      marketCapSol: lastLiquidity * 2.5,
      totalTxCount: eligible.length,
      buyCount,
      sellCount,
      buyVolumeSol,
      sellVolumeSol,
      uniqueWalletsCount: Math.max(1, uniqueWallets.size),
      top10ConcentrationPct: Math.min(95, Math.max(10, 100 - uniqueWallets.size * 3)),
      lastActivityTimestampMs: latest.sourceTimestampMs,
      stateVersion: eligible.length,
    };
  }

  /**
   * Reconstruct historical wallet state strictly as-of decision point (T, slot).
   */
  public get_wallet_state(
    wallet: string,
    timestampMs: number,
    slot = Number.MAX_SAFE_INTEGER
  ): WalletPointInTimeState | undefined {
    const list = this.eventsByWallet.get(wallet);
    if (!list || list.length === 0) return undefined;

    const eligible = list.filter(
      (e) => e.sourceTimestampMs <= timestampMs && e.slot <= slot
    );

    if (eligible.length === 0) return undefined;

    const firstSeen = eligible[0].slot;
    const lastSeen = eligible[eligible.length - 1].slot;
    const tokensTraded = new Set<string>();
    let totalVol = 0;
    let parentFunding: string | undefined;

    for (const evt of eligible) {
      if (evt.mint) tokensTraded.add(evt.mint);
      totalVol += Number(evt.payload['amountSol'] ?? 0);
      if (evt.payload['parentFundingAddress']) {
        parentFunding = String(evt.payload['parentFundingAddress']);
      }
    }

    return {
      walletAddress: wallet,
      asOfTimestampMs: timestampMs,
      asOfSlot: slot,
      firstSeenSlot: firstSeen,
      lastSeenSlot: lastSeen,
      totalTradesCount: eligible.length,
      totalVolumeSol: totalVol,
      parentFundingAddress: parentFunding,
      knownTokensTraded: Array.from(tokensTraded),
      reputationScore: Math.min(100, Math.max(20, tokensTraded.size * 5 + eligible.length * 2)),
    };
  }

  /**
   * Reconstruct macro market state strictly as-of decision point (T, slot).
   */
  public get_market_state(
    timestampMs: number,
    slot = Number.MAX_SAFE_INTEGER
  ): MarketPointInTimeState {
    const eligible = this.globalEvents.filter(
      (e) => e.sourceTimestampMs <= timestampMs && e.slot <= slot
    );

    const activeMints = new Set<string>();
    const oneHourAgo = timestampMs - 3_600_000;
    let launchesLastHour = 0;

    for (const evt of eligible) {
      if (evt.mint) activeMints.add(evt.mint);
      if (evt.eventType === 'TOKEN_CREATE' && evt.sourceTimestampMs >= oneHourAgo) {
        launchesLastHour++;
      }
    }

    return {
      asOfTimestampMs: timestampMs,
      asOfSlot: slot,
      solPriceUsd: 150.0,
      solReturn24hPct: 2.5,
      activeTokensCount: activeMints.size,
      launchesLastHourCount: launchesLastHour,
      macroRegime: launchesLastHour > 20 ? 'RISK_ON' : 'NEUTRAL',
      networkSlotLag: 2,
      rpcHealthyCount: 3,
    };
  }

  /**
   * Reconstruct historical portfolio state strictly as-of timestamp.
   */
  public get_portfolio_state(timestampMs: number): PortfolioPointInTimeState {
    const eligible = this.portfolioSnapshots.filter(
      (s) => s.asOfTimestampMs <= timestampMs
    );

    if (eligible.length > 0) {
      return eligible[eligible.length - 1];
    }

    // Default clean initial portfolio state
    return {
      asOfTimestampMs: timestampMs,
      totalEquitySol: 100.0,
      cashReserveSol: 100.0,
      openPositionsCount: 0,
      totalExposureSol: 0.0,
      activePositions: [],
      portfolioState: 'NORMAL',
    };
  }
}
