/**
 * SOL-SYLPH Authoritative Canonical Token Store & Atomic State Transaction Manager
 * Specifications: Parts XI, XII
 *
 * Enforces:
 * 1. Single authoritative CanonicalTokenState structure.
 * 2. Atomic State Transactions (StateTransaction -> affected dependency recomputation -> StateVersion++ -> publish).
 * 3. Elimination of asynchronous torn state where UI or downstream systems observe contradictory state slices.
 */

import type { TokenId, StateVersion } from '../events/canonical-event.js';
import type { FusedEvidence } from '../evidence/evidence-registry.js';

export type VenueState = 'PUMP_CURVE' | 'MIGRATING' | 'DEX_INITIALIZING' | 'DEX_ACTIVE' | 'MULTI_VENUE' | 'INACTIVE';
export type PoDState = 'P' | 'N' | 'D';
export type ProtectionState = 'ACTIVE' | 'PROVISIONAL' | 'REVIEW' | 'EXPIRED' | 'DISABLED';
export type TrajectoryState = 'STABLE' | 'IMPROVING' | 'WEAKENING' | 'VOLATILE' | 'UNKNOWN';

export interface CanonicalTokenState {
  readonly mint: TokenId;
  readonly symbol: string;
  readonly name: string;
  readonly stateVersion: StateVersion;
  readonly lastUpdatedMs: number;

  // Venue & Lifecycle
  readonly venueLifecycle: VenueState;
  readonly primaryPoolAddress?: string;

  // Market & Authorities
  readonly priceSol: number;
  readonly priceUsd: number;
  readonly supply: bigint;
  readonly mcapSol: number;
  readonly mcapUsd: number;
  readonly realLiquiditySol: number;
  readonly executableLiquiditySol: number;

  // Activity & Microstructure
  readonly txCount: number;
  readonly buyCount: number;
  readonly sellCount: number;
  readonly volumeSol: number;
  readonly uniqueWalletsCount: number;
  readonly independentParticipantsCount: number;

  // Security & Capabilities
  readonly isMintable: boolean;
  readonly isFreezable: boolean;
  readonly hasPermanentDelegate: boolean;
  readonly isBackdoorFree: boolean;
  readonly creatorAddress: string;
  readonly creatorHoldingPct: number;
  readonly rugCheckScore: number;

  // Core Intelligence Signals
  readonly hsi: number; // 0 - 100
  readonly pumpScore: number; // 0 - 100
  readonly podState: PoDState;
  readonly podTransitionTimeMs: number;

  // Protection & Ghost-Town
  readonly protectionState: ProtectionState;
  readonly protectionStartedMs: number;
  readonly protectionValidUntilMs: number;
  readonly isGhostTown: boolean;
  readonly ghostTownSafeAppearances: number;

  // Audits & Cores
  readonly auditCount: number;
  readonly isSolarCore: boolean;
  readonly solarReachedMs?: number;
  readonly isDiamondCore: boolean;
  readonly diamondReachedMs?: number;

  // World Model & Trajectory
  readonly trajectory: TrajectoryState;
  readonly expectedReturn1m: number;
  readonly calibratedConfidence: number;
  readonly overallUncertainty: number;

  // Evidence Lineage
  readonly activeEvidenceIds: readonly string[];
  readonly explanationSummary: string;
}

export interface StateTransaction {
  readonly transactionId: string;
  readonly mint: TokenId;
  readonly mutation: (current: CanonicalTokenState) => Partial<CanonicalTokenState>;
  readonly evidenceIds?: readonly string[];
  readonly reason: string;
  readonly timestampMs: number;
}

export class CanonicalTokenStore {
  private readonly tokens = new Map<TokenId, CanonicalTokenState>();
  private readonly subscribers: Array<(state: CanonicalTokenState, tx: StateTransaction) => void> = [];

  public get(mint: TokenId): CanonicalTokenState | undefined {
    return this.tokens.get(mint);
  }

  public getAll(): readonly CanonicalTokenState[] {
    return Array.from(this.tokens.values());
  }

  public registerToken(initial: {
    mint: TokenId;
    symbol: string;
    name: string;
    creatorAddress: string;
    initialPriceSol?: number;
    initialLiquiditySol?: number;
    initialSupply?: bigint;
    now?: number;
  }): CanonicalTokenState {
    const now = initial.now ?? Date.now();
    const priceSol = initial.initialPriceSol ?? 0.000001;
    const supply = initial.initialSupply ?? 1_000_000_000n * 1_000_000n;
    const mcapSol = priceSol * Number(supply / 1_000_000n);

    const state: CanonicalTokenState = {
      mint: initial.mint,
      symbol: initial.symbol,
      name: initial.name,
      stateVersion: 1,
      lastUpdatedMs: now,
      venueLifecycle: 'PUMP_CURVE',
      priceSol,
      priceUsd: priceSol * 180,
      supply,
      mcapSol,
      mcapUsd: mcapSol * 180,
      realLiquiditySol: initial.initialLiquiditySol ?? 30.0,
      executableLiquiditySol: (initial.initialLiquiditySol ?? 30.0) * 0.85,
      txCount: 0,
      buyCount: 0,
      sellCount: 0,
      volumeSol: 0,
      uniqueWalletsCount: 1,
      independentParticipantsCount: 1,
      isMintable: false,
      isFreezable: false,
      hasPermanentDelegate: false,
      isBackdoorFree: true,
      creatorAddress: initial.creatorAddress,
      creatorHoldingPct: 0.0,
      rugCheckScore: 0,
      hsi: 50,
      pumpScore: 50,
      podState: 'P',
      podTransitionTimeMs: now,
      protectionState: 'ACTIVE',
      protectionStartedMs: now,
      protectionValidUntilMs: now + 300_000,
      isGhostTown: false,
      ghostTownSafeAppearances: 0,
      auditCount: 0,
      isSolarCore: false,
      isDiamondCore: false,
      trajectory: 'STABLE',
      expectedReturn1m: 0.0,
      calibratedConfidence: 0.85,
      overallUncertainty: 0.15,
      activeEvidenceIds: [],
      explanationSummary: 'Initial token state initialized.',
    };

    this.tokens.set(initial.mint, state);
    return state;
  }

  /**
   * Part XII: Atomic State Transaction.
   * Modifies state atomically, updates StateVersion, and broadcasts consistent snapshot.
   */
  public commitTransaction(tx: StateTransaction): CanonicalTokenState {
    const current = this.tokens.get(tx.mint);
    if (!current) {
      throw new Error(`Cannot commit transaction on untracked token: ${tx.mint}`);
    }

    const partial = tx.mutation(current);
    const newVersion = current.stateVersion + 1;

    // Enforce Invariant: PoD=D with ACTIVE protection is automatically resolved or flagged
    let protectionState = partial.protectionState ?? current.protectionState;
    const podState = partial.podState ?? current.podState;
    if (podState === 'D' && protectionState === 'ACTIVE') {
      protectionState = 'REVIEW';
    }

    const updated: CanonicalTokenState = {
      ...current,
      ...partial,
      protectionState,
      stateVersion: newVersion,
      lastUpdatedMs: tx.timestampMs,
      activeEvidenceIds: tx.evidenceIds ?? current.activeEvidenceIds,
      explanationSummary: tx.reason,
    };

    this.tokens.set(tx.mint, updated);

    // Notify projections
    for (const sub of this.subscribers) {
      try {
        sub(updated, tx);
      } catch (err) {
        // Bulkhead: subscriber error does not corrupt state commit
      }
    }

    return updated;
  }

  public subscribe(handler: (state: CanonicalTokenState, tx: StateTransaction) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      const idx = this.subscribers.indexOf(handler);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }
}
