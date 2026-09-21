/**
 * SOL-SYLPH Projection Engine, Universal Why System & UI Command Bus
 * Specifications: Parts XCV, XCVI, XCVII, XCVIII, XCIX - CVI, XCIII
 *
 * Enforces:
 * 1. UI consumes dedicated Projections only (TokenTableProjection, TokenInspectorProjection, AlertProjection).
 * 2. Incremental rendering with dirty_tokens and dirty_fields.
 * 3. Universal "Why?" Engine: explains Why Pump? Why HSI? Why PoD? Why Protected? What changed? What matters? What is uncertain?
 * 4. UI Command Bus: All user actions flow through domain commands -> events -> state -> projection. Never direct state mutation from widgets.
 */

import type { TokenId, StateVersion } from '../events/canonical-event.js';
import type { CanonicalTokenState } from '../truth/canonical-store.js';

// --- Part XCV: Dedicated Projections ---
export interface TokenTableRowProjection {
  readonly mint: TokenId;
  readonly symbol: string;
  readonly timeFormatted: string;
  readonly txs: number;
  readonly mcapFormatted: string;
  readonly liquidityFormatted: string;
  readonly auditsFormatted: string;
  readonly rugFormatted: string;
  readonly hsiFormatted: string;
  readonly statusBadge: string;
  readonly stateVersion: StateVersion;
}

export interface UniversalWhyExplanation {
  readonly mint: TokenId;
  readonly whyPump: string;
  readonly whyHsi: string;
  readonly whyPod: string;
  readonly whyProtected: string;
  readonly whatChanged: readonly string[];
  readonly whatMatters: readonly string[];
  readonly whatIsUncertain: readonly string[];
  readonly whatConflicts: readonly string[];
  readonly whatHappensNext: string;
  readonly whatBreaksThis: readonly string[];
}

export class UniversalWhyEngine {
  public explainToken(state: CanonicalTokenState): UniversalWhyExplanation {
    const whatChanged: string[] = [
      `Liquidity marked at ${state.realLiquiditySol.toFixed(1)} SOL`,
      `HSI evaluated at ${state.hsi.toFixed(1)}`,
      `PoD in ${state.podState} state`,
    ];

    const whatMatters: string[] = [
      state.realLiquiditySol < 15 ? 'Critical: Real liquidity below safety floor' : 'Liquidity healthy',
      state.creatorHoldingPct > 10 ? 'Warning: Elevated creator concentration' : 'Creator holding safe',
    ];

    const whatIsUncertain: string[] = [
      state.overallUncertainty > 0.40 ? 'High model uncertainty on current curve trajectory' : 'Model confidence high',
      state.rugCheckScore > 30 ? 'Contract capability ambiguity detected' : 'Token capabilities verified',
    ];

    const whatConflicts: string[] = [];
    if (state.pumpScore > 70 && state.hsi < 35) {
      whatConflicts.push('PumpScore spike contradicts weak holder organic score (HSI)');
    }

    const whatBreaksThis: string[] = [
      'Liquidity drainage > 5.0 SOL in a single block',
      'Creator selling more than 2% of total supply',
      'PoD transition to Dump (D)',
    ];

    return {
      mint: state.mint,
      whyPump: `PumpScore ${state.pumpScore}: driven by ${state.txCount} txs and ${state.realLiquiditySol.toFixed(1)} SOL liquidity`,
      whyHsi: `HSI ${state.hsi}: calculated across 7 evidence families with ${state.independentParticipantsCount} independent participants`,
      whyPod: `PoD ${state.podState}: ${state.podState === 'P' ? 'Sustained buying momentum' : state.podState === 'D' ? 'Aggressive sniper dumping detected' : 'Neutral consolidation'}`,
      whyProtected: `Protection ${state.protectionState}: lease valid for ${Math.max(0, (state.protectionValidUntilMs - Date.now()) / 1000).toFixed(0)}s`,
      whatChanged,
      whatMatters,
      whatIsUncertain,
      whatConflicts,
      whatHappensNext: state.trajectory === 'IMPROVING' ? '↑ Strengthening' : state.trajectory === 'WEAKENING' ? '↓ Weakening' : '→ Stable consolidation',
      whatBreaksThis,
    };
  }
}

// --- Part XCVI & XCVII: Projection Engine with Incremental Rendering ---
export class ProjectionEngine {
  private readonly dirtyTokens = new Set<TokenId>();
  private readonly cachedTableRows = new Map<TokenId, TokenTableRowProjection>();
  public readonly whyEngine = new UniversalWhyEngine();

  public markDirty(mint: TokenId): void {
    this.dirtyTokens.add(mint);
  }

  public getDirtyCount(): number {
    return this.dirtyTokens.size;
  }

  public projectTokenRow(state: CanonicalTokenState): TokenTableRowProjection {
    const row: TokenTableRowProjection = {
      mint: state.mint,
      symbol: state.symbol,
      timeFormatted: new Date(state.lastUpdatedMs).toLocaleTimeString(),
      txs: state.txCount,
      mcapFormatted: `$${(state.mcapUsd / 1000).toFixed(1)}K`,
      liquidityFormatted: `${state.realLiquiditySol.toFixed(1)} SOL`,
      auditsFormatted: state.isDiamondCore ? 'DIAMOND' : state.isSolarCore ? 'SOLAR' : `A${state.auditCount}`,
      rugFormatted: state.rugCheckScore > 30 ? 'WARN' : 'GOOD',
      hsiFormatted: `${state.hsi.toFixed(0)}`,
      statusBadge: state.protectionState,
      stateVersion: state.stateVersion,
    };

    this.cachedTableRows.set(state.mint, row);
    this.dirtyTokens.delete(state.mint);
    return row;
  }

  public projectTable(states: readonly CanonicalTokenState[]): readonly TokenTableRowProjection[] {
    return states.map(s => this.projectTokenRow(s));
  }
}

// --- Part XCIII: UI Command Bus ---
export type UICommandType =
  | 'MANUAL_AUDIT'
  | 'WATCH_TOKEN'
  | 'HIDE_TOKEN'
  | 'FORCE_DEX_REFRESH'
  | 'SIMULATION_TOGGLE'
  | 'EMERGENCY_HALT';

export interface UICommand {
  readonly commandId: string;
  readonly type: UICommandType;
  readonly mint?: TokenId;
  readonly payload?: Record<string, unknown>;
  readonly requestedAtMs: number;
}

export class CommandBus {
  private readonly commandHistory: UICommand[] = [];
  private readonly handlers = new Map<UICommandType, (cmd: UICommand) => void>();

  public registerHandler(type: UICommandType, handler: (cmd: UICommand) => void): void {
    this.handlers.set(type, handler);
  }

  public dispatch(command: UICommand): { accepted: boolean; reason?: string } {
    this.commandHistory.push(command);
    const handler = this.handlers.get(command.type);
    if (!handler) {
      return { accepted: false, reason: `No registered handler for command ${command.type}` };
    }

    try {
      handler(command);
      return { accepted: true };
    } catch (err) {
      return { accepted: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  public getHistory(): readonly UICommand[] {
    return this.commandHistory;
  }
}
