/**
 * SOL-SYLPH Three Independent Approval Certificates
 * Blueprint Parts XXXII, LXXIX
 *
 * Maintains independent certificates:
 * 1. StructuralCertificate
 * 2. MarketCertificate
 * 3. ExecutionCertificate
 *
 * Only when all policy requirements are satisfied can the candidate reach 3/3 Proof state.
 * Never hide partial failures behind one average score!
 */

export interface StructuralCertificate {
  readonly mint: string;
  readonly valid: boolean;
  readonly evaluatedAtMs: number;
  readonly programOwner: string;
  readonly hasFreezeAuthority: boolean;
  readonly hasMintAuthority: boolean;
  readonly hasPermanentDelegate: boolean;
  readonly isNonTransferable: boolean;
  readonly transferFeeBps: number;
  readonly unverifiedExtensionsCount: number;
  readonly failureReasons: string[];
}

export interface MarketCertificate {
  readonly mint: string;
  readonly valid: boolean;
  readonly evaluatedAtMs: number;
  readonly independentActorsCount: number;
  readonly marketAuthenticityScore: number; // 0.0 - 1.0
  readonly capitalNoveltyRatio: number;     // 0.0 - 1.0
  readonly washVolumeRatio: number;         // 0.0 - 1.0
  readonly topClusterConcentrationPct: number;
  readonly failureReasons: string[];
}

export interface ExecutionCertificate {
  readonly mint: string;
  readonly valid: boolean;
  readonly evaluatedAtMs: number;
  readonly buyPathValid: boolean;
  readonly sellPathValid: boolean;
  readonly roundTripImpactBps: number;
  readonly robustExitCapacitySol: number;
  readonly routeRedundancyCount: number;
  readonly quoteAgeMs: number;
  readonly failureReasons: string[];
}

export type ProofState = '3/3' | '2/3' | 'REVIEW' | 'FAIL' | 'UNKNOWN';

export interface UnifiedProofReport {
  readonly mint: string;
  readonly proofState: ProofState;
  readonly validCertificatesCount: number;
  readonly totalCertificatesCount: 3;
  readonly structural: StructuralCertificate;
  readonly market: MarketCertificate;
  readonly execution: ExecutionCertificate;
  readonly isExecutionReady: boolean;
  readonly summary: string;
}

export class ApprovalCertificateEngine {
  public issueStructuralCertificate(params: {
    mint: string;
    programOwner?: string;
    hasFreezeAuthority?: boolean;
    hasMintAuthority?: boolean;
    hasPermanentDelegate?: boolean;
    isNonTransferable?: boolean;
    transferFeeBps?: number;
    unverifiedExtensionsCount?: number;
  }): StructuralCertificate {
    const failureReasons: string[] = [];
    if (params.hasFreezeAuthority) failureReasons.push('ACTIVE_FREEZE_AUTHORITY');
    if (params.hasPermanentDelegate) failureReasons.push('PERMANENT_DELEGATE_BACKDOOR');
    if (params.isNonTransferable) failureReasons.push('NON_TRANSFERABLE_TOKEN');
    if ((params.transferFeeBps ?? 0) > 500) failureReasons.push(`EXCESSIVE_TRANSFER_FEE_${params.transferFeeBps}BPS`);
    if ((params.unverifiedExtensionsCount ?? 0) > 0) failureReasons.push('UNVERIFIED_EXTENSIONS');

    return {
      mint: params.mint,
      valid: failureReasons.length === 0,
      evaluatedAtMs: Date.now(),
      programOwner: params.programOwner ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: Boolean(params.hasFreezeAuthority),
      hasMintAuthority: Boolean(params.hasMintAuthority),
      hasPermanentDelegate: Boolean(params.hasPermanentDelegate),
      isNonTransferable: Boolean(params.isNonTransferable),
      transferFeeBps: params.transferFeeBps ?? 0,
      unverifiedExtensionsCount: params.unverifiedExtensionsCount ?? 0,
      failureReasons,
    };
  }

  public issueMarketCertificate(params: {
    mint: string;
    independentActorsCount?: number;
    marketAuthenticityScore?: number;
    capitalNoveltyRatio?: number;
    washVolumeRatio?: number;
    topClusterConcentrationPct?: number;
  }): MarketCertificate {
    const failureReasons: string[] = [];
    const actors = params.independentActorsCount ?? 1;
    const authScore = params.marketAuthenticityScore ?? 0.8;
    const washRatio = params.washVolumeRatio ?? 0.0;
    const conc = params.topClusterConcentrationPct ?? 15;

    if (actors < 3) failureReasons.push('INSUFFICIENT_INDEPENDENT_ACTORS');
    if (authScore < 0.4) failureReasons.push('LOW_MARKET_AUTHENTICITY');
    if (washRatio > 0.4) failureReasons.push('HIGH_WASH_TRADING_VOLUME');
    if (conc > 50) failureReasons.push('EXTREME_CLUSTER_CONCENTRATION');

    return {
      mint: params.mint,
      valid: failureReasons.length === 0,
      evaluatedAtMs: Date.now(),
      independentActorsCount: actors,
      marketAuthenticityScore: authScore,
      capitalNoveltyRatio: params.capitalNoveltyRatio ?? 0.7,
      washVolumeRatio: washRatio,
      topClusterConcentrationPct: conc,
      failureReasons,
    };
  }

  public issueExecutionCertificate(params: {
    mint: string;
    buyPathValid?: boolean;
    sellPathValid?: boolean;
    roundTripImpactBps?: number;
    robustExitCapacitySol?: number;
    routeRedundancyCount?: number;
    quoteAgeMs?: number;
  }): ExecutionCertificate {
    const failureReasons: string[] = [];
    const buyValid = params.buyPathValid ?? true;
    const sellValid = params.sellPathValid ?? true;
    const impact = params.roundTripImpactBps ?? 80;
    const capacity = params.robustExitCapacitySol ?? 5.0;
    const age = params.quoteAgeMs ?? 100;

    if (!buyValid) failureReasons.push('BUY_ROUTE_UNAVAILABLE');
    if (!sellValid) failureReasons.push('SELL_ROUTE_UNAVAILABLE_HONEYPOT_RISK');
    if (impact > 500) failureReasons.push('EXCESSIVE_ROUND_TRIP_IMPACT');
    if (capacity < 0.5) failureReasons.push('INSUFFICIENT_ROBUST_EXIT_CAPACITY');
    if (age > 10000) failureReasons.push('QUOTE_CRITICALLY_STALE');

    return {
      mint: params.mint,
      valid: failureReasons.length === 0,
      evaluatedAtMs: Date.now(),
      buyPathValid: buyValid,
      sellPathValid: sellValid,
      roundTripImpactBps: impact,
      robustExitCapacitySol: capacity,
      routeRedundancyCount: params.routeRedundancyCount ?? 1,
      quoteAgeMs: age,
      failureReasons,
    };
  }

  public evaluateProof(structural: StructuralCertificate, market: MarketCertificate, execution: ExecutionCertificate): UnifiedProofReport {
    let validCount = 0;
    if (structural.valid) validCount++;
    if (market.valid) validCount++;
    if (execution.valid) validCount++;

    let proofState: ProofState = '3/3';
    if (validCount === 3) {
      proofState = '3/3';
    } else if (validCount === 2) {
      proofState = '2/3';
    } else if (validCount === 1) {
      proofState = 'REVIEW';
    } else {
      proofState = 'FAIL';
    }

    const mint = structural.mint;
    const isExecutionReady = proofState === '3/3';

    let summary = `Proof State ${proofState}: `;
    if (proofState === '3/3') {
      summary += 'All 3 certificates validated (Structural + Market + Execution).';
    } else {
      const fails: string[] = [];
      if (!structural.valid) fails.push(`Structural: ${structural.failureReasons.join(', ')}`);
      if (!market.valid) fails.push(`Market: ${market.failureReasons.join(', ')}`);
      if (!execution.valid) fails.push(`Execution: ${execution.failureReasons.join(', ')}`);
      summary += fails.join(' | ');
    }

    return {
      mint,
      proofState,
      validCertificatesCount: validCount,
      totalCertificatesCount: 3,
      structural,
      market,
      execution,
      isExecutionReady,
      summary,
    };
  }
}
