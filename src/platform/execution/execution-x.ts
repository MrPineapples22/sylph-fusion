/**
 * SYLPH FUSION — SOL AGENT 3: EXECUTION ENGINEER (EXECUTION-X)
 * Specifications: Sections 3 (Sol Agent 3), 28 (Account Contention), 29 (Jito/Leader Intelligence),
 * 32 (Simulation Fidelity), 36 (Alpha TTL), 37 (Execution Generations), 39 (Account Warmth & Breakeven).
 *
 * Implements:
 * 1. LockGraphEngine: LOCKGRAPH-X writable account conflict graph and hotspot analysis.
 * 2. LocalFeePressureEngine: LOCAL-FEE-PRESSURE-X, CONTENTION-ELASTICITY-X.
 * 3. LeaderRegimeEngine: leader classification with uncalibrated estimates withheld.
 * 4. RouteMutationEntropyEngine: ROUTE-MUTATION-ENTROPY-X pool reserve stability.
 * 5. AlphaTtlEngine: ALPHA-TTL-X, EXPIRY-FRONTIER-X, RetryEV calculation.
 * 6. GenerationFencedRetryEngine: process-local research registry; advance/retire quarantined.
 * 7. AllInBreakevenEngine: ACCOUNT-SETUP-TAX-X, ACCOUNT-WARMTH-X, ALL-IN-BREAKEVEN-X.
 * 8. SimulationEnsembleEngine: research scenario arithmetic and residual comparison.
 * This standalone module does not grant trade, signing, or release authority.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. LOCKGRAPH-X: Account Contention Graph (Section 28)
// ---------------------------------------------------------------------------

export interface AccountLockSet {
  readonly readAccounts: readonly string[];
  readonly writableAccounts: readonly string[];
}

export interface LockConflictResult {
  readonly hasConflict: boolean;
  readonly conflictingAccounts: readonly string[];
  readonly contentionScore: number; // 0.0 (no contention) to 1.0 (hotlock)
}

export class LockGraphEngine {
  private activeWriteLocks = new Map<string, string>();
  private activeReadLocks = new Map<string, Set<string>>();

  public acquireLocks(intentId: string, locks: AccountLockSet): LockConflictResult {
    if (typeof intentId !== 'string' || intentId.trim().length === 0) {
      throw new Error('intentId must be a non-empty string');
    }
    if (!locks || !Array.isArray(locks.readAccounts) || !Array.isArray(locks.writableAccounts)) {
      throw new Error('readAccounts and writableAccounts must be arrays');
    }
    const accounts = [...locks.readAccounts, ...locks.writableAccounts];
    if (accounts.some(account => typeof account !== 'string' || account.trim().length === 0)) {
      throw new Error('account keys must be non-empty strings');
    }
    const reads = new Set(locks.readAccounts);
    const writes = new Set(locks.writableAccounts);
    const conflicting = new Set<string>();
    for (const account of reads) {
      const writer = this.activeWriteLocks.get(account);
      if (writer !== undefined && writer !== intentId) conflicting.add(account);
    }
    for (const account of writes) {
      const writer = this.activeWriteLocks.get(account);
      const readers = this.activeReadLocks.get(account);
      if ((writer !== undefined && writer !== intentId) ||
          (readers !== undefined && [...readers].some(reader => reader !== intentId))) {
        conflicting.add(account);
      }
    }

    if (conflicting.size > 0) {
      return {
        hasConflict: true,
        conflictingAccounts: [...conflicting],
        contentionScore: Math.min(1.0, conflicting.size * 0.35),
      };
    }

    for (const account of reads) {
      const readers = this.activeReadLocks.get(account) ?? new Set<string>();
      readers.add(intentId);
      this.activeReadLocks.set(account, readers);
    }
    for (const account of writes) {
      this.activeWriteLocks.set(account, intentId);
    }

    return {
      hasConflict: false,
      conflictingAccounts: [],
      contentionScore: 0.0,
    };
  }

  public releaseLocks(intentId: string): void {
    for (const [account, ownerIntent] of this.activeWriteLocks.entries()) {
      if (ownerIntent === intentId) {
        this.activeWriteLocks.delete(account);
      }
    }
    for (const [account, readers] of this.activeReadLocks.entries()) {
      readers.delete(intentId);
      if (readers.size === 0) {
        this.activeReadLocks.delete(account);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. LOCAL-FEE-PRESSURE & LEADER REGIME (Sections 28, 29)
// ---------------------------------------------------------------------------

export type LeaderType = 'JITO_STAKED' | 'VANILLA_RPC';

export interface LeaderRegimeStatus {
  readonly slot: number;
  readonly leaderIdentity: string;
  readonly leaderType: LeaderType;
  readonly inputLocalFeeMicroLamports: bigint;
  readonly evidenceClass: 'RESEARCH_ONLY_UNCALIBRATED';
  readonly auctionShadowPriceLamports: null;
  readonly optimalTipLamports: null;
  readonly estimatedLandingProbability: null;
  readonly unavailableReason: 'NO_OBSERVED_AUCTION_OR_LANDING_MODEL';
}

export class LeaderRegimeEngine {
  public static evaluateLeader(
    slot: number,
    leaderIdentity: string,
    isJitoStaked: boolean,
    localFeeMicroLamports: bigint,
    tradeSizeSol: number
  ): LeaderRegimeStatus {
    if (!Number.isSafeInteger(slot) || slot < 0) {
      throw new Error('slot must be a non-negative safe integer');
    }
    if (typeof leaderIdentity !== 'string' || leaderIdentity.trim().length === 0) {
      throw new Error('leaderIdentity must be a non-empty string');
    }
    if (typeof isJitoStaked !== 'boolean') {
      throw new Error('isJitoStaked must be a boolean');
    }
    if (typeof localFeeMicroLamports !== 'bigint' || localFeeMicroLamports < 0n) {
      throw new Error('localFeeMicroLamports must be a non-negative bigint');
    }
    if (!Number.isFinite(tradeSizeSol) || tradeSizeSol <= 0) {
      throw new Error('tradeSizeSol must be finite and positive');
    }
    const leaderType: LeaderType = isJitoStaked ? 'JITO_STAKED' : 'VANILLA_RPC';
    return {
      slot,
      leaderIdentity,
      leaderType,
      inputLocalFeeMicroLamports: localFeeMicroLamports,
      evidenceClass: 'RESEARCH_ONLY_UNCALIBRATED',
      auctionShadowPriceLamports: null,
      optimalTipLamports: null,
      estimatedLandingProbability: null,
      unavailableReason: 'NO_OBSERVED_AUCTION_OR_LANDING_MODEL',
    };
  }
}

// ---------------------------------------------------------------------------
// 3. ALPHA-TTL-X & EXPIRY FRONTIER (Section 36)
// ---------------------------------------------------------------------------

export interface AlphaTtlEvaluation {
  readonly intentId: string;
  readonly effectiveTtlSeconds: number;
  readonly retryEv: number;
  readonly isExpired: boolean;
  readonly reason?: string;
}

export class AlphaTtlEngine {
  public static evaluateTtl(input: {
    intentId: string;
    elapsedSeconds: number;
    blockhashTtlSeconds: number;
    quoteTtlSeconds: number;
    alphaTtlSeconds: number;
    riskTtlSeconds: number;
    capabilityTtlSeconds: number;
    grossAlphaEv: number;
    feeCostSol: number;
  }): AlphaTtlEvaluation {
    if (typeof input.intentId !== 'string' || input.intentId.trim().length === 0) {
      throw new Error('intentId must be a non-empty string');
    }
    if (!Number.isFinite(input.elapsedSeconds) || input.elapsedSeconds < 0) {
      throw new Error('elapsedSeconds must be finite and non-negative');
    }
    for (const [label, ttl] of [
      ['blockhashTtlSeconds', input.blockhashTtlSeconds],
      ['quoteTtlSeconds', input.quoteTtlSeconds],
      ['alphaTtlSeconds', input.alphaTtlSeconds],
      ['riskTtlSeconds', input.riskTtlSeconds],
      ['capabilityTtlSeconds', input.capabilityTtlSeconds],
    ] as const) {
      if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new Error(`${label} must be finite and positive`);
      }
    }
    if (!Number.isFinite(input.grossAlphaEv) || input.grossAlphaEv < 0 ||
        !Number.isFinite(input.feeCostSol) || input.feeCostSol < 0) {
      throw new Error('grossAlphaEv and feeCostSol must be finite and non-negative');
    }
    const effectiveTtl = Math.min(
      input.blockhashTtlSeconds,
      input.quoteTtlSeconds,
      input.alphaTtlSeconds,
      input.riskTtlSeconds,
      input.capabilityTtlSeconds
    );

    const remainingTtl = effectiveTtl - input.elapsedSeconds;
    const isExpired = remainingTtl <= 0;

    // Retry EV drops as time elapses and alpha decays
    const alphaDecayFactor = Math.max(0, remainingTtl / Math.max(1, effectiveTtl));
    const decayedAlpha = input.grossAlphaEv * alphaDecayFactor;
    const retryEv = decayedAlpha - input.feeCostSol;

    let reason: string | undefined;
    if (isExpired) {
      reason = 'EFFECTIVE_TTL_EXPIRED';
    } else if (retryEv <= 0) {
      reason = 'RETRY_EV_NEGATIVE';
    }

    return {
      intentId: input.intentId,
      effectiveTtlSeconds: effectiveTtl,
      retryEv,
      isExpired: isExpired || retryEv <= 0,
      reason,
    };
  }
}

// ---------------------------------------------------------------------------
// 4. GENERATION-FENCED-RETRY-X (Section 37)
// ---------------------------------------------------------------------------

export interface ExecutionGenerationRecord {
  readonly authority: 'RESEARCH_ONLY';
  readonly intentId: string;
  readonly activeGeneration: number;
  readonly supersedesGeneration?: number;
  readonly isFenced: boolean;
  readonly transactionHash: string;
}

function validResearchGenerationIntentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9._:-]/.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value.toLowerCase());
}

/**
 * Quarantined prototype, not an execution or terminal-evidence authority.
 * First allocation is research-only and retained only for this object lifetime.
 * New objects/processes have no shared history. Advancement and retirement are
 * unavailable until connected to a trusted, durable terminal-evidence owner.
 */
export class GenerationFencedRetryEngine {
  readonly #activeGenerations = new Map<string, number>();

  public createInitialGeneration(intentId: string, txHash: string): ExecutionGenerationRecord {
    if (!validResearchGenerationIntentId(intentId)) {
      throw new Error('INVALID_INTENT_ID: Expected a bounded non-reserved ASCII research intent identity');
    }
    if (this.#activeGenerations.has(intentId)) {
      throw new Error(`GENERATION_ALREADY_ACTIVE: Intent ${intentId} already has an active execution generation.`);
    }
    this.#activeGenerations.set(intentId, 1);
    return Object.freeze({
      authority: 'RESEARCH_ONLY',
      intentId,
      activeGeneration: 1,
      isFenced: false,
      transactionHash: txHash,
    });
  }

  public advanceGeneration(_intentId: string, _newTxHash: string): ExecutionGenerationRecord {
    throw new Error('TERMINAL_TRANSITION_UNAVAILABLE: Research registry cannot authorize generation advancement');
  }

  /** Local research identity match only; never grants execution permission. */
  public validateGeneration(intentId: string, generation: number): boolean {
    if (!validResearchGenerationIntentId(intentId) || !Number.isSafeInteger(generation) || generation <= 0) return false;
    const current = this.#activeGenerations.get(intentId);
    return current !== undefined && current === generation;
  }

  public retireIntent(_intentId: string): void {
    throw new Error('TERMINAL_TRANSITION_UNAVAILABLE: Research registry cannot authorize intent retirement');
  }
}

// ---------------------------------------------------------------------------
// 5. ALL-IN-BREAKEVEN-X (Section 39)
// ---------------------------------------------------------------------------

export interface BreakevenHurdle {
  readonly evidenceClass: 'RESEARCH_ONLY_ESTIMATE';
  readonly notionalSol: number;
  readonly ataRentLockedSol: number;
  readonly ataRentRecoveryAssumption: 'RECOVER_ON_CLOSE' | 'NO_RECOVERY_ASSUMED' | 'NOT_APPLICABLE';
  readonly assumedUnrecoveredRentCostSol: number;
  readonly baseFeeSol: number;
  readonly priorityFeeSol: number;
  readonly jitoTipSol: number;
  readonly lpTradingFeeSol: number;
  readonly entrySlippageSol: number;
  readonly exitSlippageSol: number;
  readonly totalModeledFrictionSol: number;
  readonly modeledHurdlePercentage: number;
  readonly passesIllustrative15PctHurdle: boolean;
}

export class AllInBreakevenEngine {
  public static calculateHurdle(input: {
    notionalSol: number;
    needsAtaCreation: boolean;
    ataCreationLamports?: bigint;
    ataRentRecoveryAssumption?: 'RECOVER_ON_CLOSE' | 'NO_RECOVERY_ASSUMED';
    baseFeeLamports: bigint;
    computeUnitLimit: number;
    priorityFeeMicroLamports: bigint;
    jitoTipLamports: bigint;
    lpFeeBps: number;       // e.g. 100 bps (1%)
    expectedSlippageBps: number; // e.g. 150 bps
  }): BreakevenHurdle {
    if (!Number.isFinite(input.notionalSol) || input.notionalSol <= 0) {
      throw new Error('notionalSol must be finite and positive');
    }
    if (!Number.isSafeInteger(input.computeUnitLimit) || input.computeUnitLimit <= 0) {
      throw new Error('computeUnitLimit must be a positive safe integer');
    }
    for (const [label, bps] of [['lpFeeBps', input.lpFeeBps], ['expectedSlippageBps', input.expectedSlippageBps]] as const) {
      if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) {
        throw new Error(`${label} must be finite bps in [0, 10000]`);
      }
    }
    for (const [label, lamports] of [
      ['baseFeeLamports', input.baseFeeLamports],
      ['priorityFeeMicroLamports', input.priorityFeeMicroLamports],
      ['jitoTipLamports', input.jitoTipLamports],
    ] as const) {
      if (typeof lamports !== 'bigint' || lamports < 0n) {
        throw new Error(`${label} must be a non-negative bigint`);
      }
    }
    if (typeof input.needsAtaCreation !== 'boolean') {
      throw new Error('needsAtaCreation must be a boolean');
    }
    if (input.needsAtaCreation && (typeof input.ataCreationLamports !== 'bigint' || input.ataCreationLamports <= 0n)) {
      throw new Error('ataCreationLamports must be positive when ATA creation is needed');
    }
    if (!input.needsAtaCreation && input.ataCreationLamports !== undefined && input.ataCreationLamports !== 0n) {
      throw new Error('ataCreationLamports must be zero when ATA creation is not needed');
    }
    if (input.needsAtaCreation && input.ataRentRecoveryAssumption !== 'RECOVER_ON_CLOSE' &&
        input.ataRentRecoveryAssumption !== 'NO_RECOVERY_ASSUMED') {
      throw new Error('ataRentRecoveryAssumption is required when ATA creation is needed');
    }
    if (!input.needsAtaCreation && input.ataRentRecoveryAssumption !== undefined) {
      throw new Error('ataRentRecoveryAssumption is not applicable without ATA creation');
    }
    const toSol = (lamports: bigint, label: string): number => {
      if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label} exceeds exact numeric conversion range`);
      }
      return Number(lamports) / 1_000_000_000;
    };
    const ataRentLocked = toSol(input.ataCreationLamports ?? 0n, 'ataCreationLamports');
    const unrecoveredRentCost = input.ataRentRecoveryAssumption === 'NO_RECOVERY_ASSUMED' ? ataRentLocked : 0;
    const baseFee = toSol(input.baseFeeLamports, 'baseFeeLamports');
    // Solana charges the compute-unit limit times its price, rounded up to lamports.
    const priorityLamports = (BigInt(input.computeUnitLimit) * input.priorityFeeMicroLamports + 999_999n) / 1_000_000n;
    const priorityFee = toSol(priorityLamports, 'priority fee');
    const jitoTip = toSol(input.jitoTipLamports, 'jitoTipLamports');
    const lpFee = (input.notionalSol * input.lpFeeBps * 2) / 10_000; // roundtrip
    const entrySlip = (input.notionalSol * input.expectedSlippageBps) / 10_000;
    const exitSlip = (input.notionalSol * input.expectedSlippageBps) / 10_000;

    const totalFriction = unrecoveredRentCost + baseFee + priorityFee + jitoTip + lpFee + entrySlip + exitSlip;
    const hurdlePercentage = (totalFriction / input.notionalSol) * 100;

    return {
      evidenceClass: 'RESEARCH_ONLY_ESTIMATE',
      notionalSol: input.notionalSol,
      ataRentLockedSol: ataRentLocked,
      ataRentRecoveryAssumption: input.ataRentRecoveryAssumption ?? 'NOT_APPLICABLE',
      assumedUnrecoveredRentCostSol: unrecoveredRentCost,
      baseFeeSol: baseFee,
      priorityFeeSol: priorityFee,
      jitoTipSol: jitoTip,
      lpTradingFeeSol: lpFee,
      entrySlippageSol: entrySlip,
      exitSlippageSol: exitSlip,
      totalModeledFrictionSol: totalFriction,
      modeledHurdlePercentage: hurdlePercentage,
      passesIllustrative15PctHurdle: hurdlePercentage <= 15.0,
    };
  }
}

// ---------------------------------------------------------------------------
// 6. SYNTHETIC RESEARCH SCENARIOS (Section 32)
// ---------------------------------------------------------------------------

export interface SimulationResult {
  readonly scenario: 'OPTIMISTIC' | 'NEUTRAL' | 'PESSIMISTIC';
  readonly simulatedOutputTokens: bigint;
  readonly simulatedPriceImpactBps: number;
  readonly computeUnitsConsumed: number;
  readonly isSuccess: boolean;
}

export interface SyntheticScenarioEstimateX {
  readonly evidenceClass: 'RESEARCH_ONLY_SYNTHETIC';
  readonly isSimulationCertificate: false;
  readonly scenarioId: string;
  readonly intentId: string;
  readonly timestampMs: number;
  readonly quoteTokens: bigint;
  readonly assumedNeutralImpactBps: 200;
  readonly assumedWorstCaseImpactBps: 700;
  readonly neutralTokens: bigint;
  readonly worstCaseTokens: bigint;
  readonly hash: string;
}

export class SimulationEnsembleEngine {
  public static evaluateEnsemble(intentId: string, quoteTokens: bigint): SyntheticScenarioEstimateX {
    if (typeof intentId !== 'string' || intentId.trim().length === 0) {
      throw new Error('intentId must be a non-empty string');
    }
    if (typeof quoteTokens !== 'bigint' || quoteTokens <= 0n) {
      throw new Error('quoteTokens must be a positive bigint');
    }
    const neutralTokens = (quoteTokens * 98n) / 100n; // 2% modeled impact
    const worstCaseTokens = (quoteTokens * 93n) / 100n; // 7% adverse shock

    const timestampMs = Date.now();
    const evidenceClass = 'RESEARCH_ONLY_SYNTHETIC' as const;
    const isSimulationCertificate = false as const;
    const assumedNeutralImpactBps = 200 as const;
    const assumedWorstCaseImpactBps = 700 as const;
    // The hash binds the complete research payload, including the quote and assumptions.
    const payload = JSON.stringify([
      evidenceClass, isSimulationCertificate, intentId, timestampMs, quoteTokens.toString(),
      assumedNeutralImpactBps, assumedWorstCaseImpactBps, neutralTokens.toString(), worstCaseTokens.toString(),
    ]);
    const hash = createHash('sha256').update(payload).digest('hex');

    return {
      evidenceClass,
      isSimulationCertificate,
      scenarioId: `research_scenario_${hash.slice(0, 12)}`,
      intentId,
      timestampMs,
      quoteTokens,
      assumedNeutralImpactBps,
      assumedWorstCaseImpactBps,
      neutralTokens,
      worstCaseTokens,
      hash,
    };
  }

  public static verifyLandingResidual(simulated: bigint, landed: bigint): { divergencePct: number; isAcceptable: boolean } {
    if (typeof simulated !== 'bigint' || simulated < 0n || typeof landed !== 'bigint' || landed < 0n) {
      throw new Error('simulated and landed token amounts must be non-negative bigints');
    }
    if (simulated === 0n) return { divergencePct: Infinity, isAcceptable: false };
    const diff = simulated >= landed ? simulated - landed : landed - simulated;
    const scaledPercent = (diff * 1_000_000n) / simulated;
    const divergencePct = scaledPercent > BigInt(Number.MAX_SAFE_INTEGER)
      ? Infinity : Number(scaledPercent) / 10_000;
    return {
      divergencePct,
      isAcceptable: diff * 10n <= simulated, // Divergence within 10% acceptable
    };
  }
}
