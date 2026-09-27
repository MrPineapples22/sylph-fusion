/**
 * SYLPH FUSION — TREASURY-SHIELD: Capital Custody & Blast-Radius Segmentation
 * Specifications: Section 10 (Upgrade 6: Treasury-Shield), Section 103 (Invariants 8, 10)
 *
 * Invariants:
 * 1. Segregate TradingCapital from TreasuryCapital.
 * 2. Trading execution authority has zero rights to dispatch external treasury transfers.
 * 3. 7 segmented capital domains:
 *    TradingCapital, FeeReserve, EmergencyExitReserve, PendingSettlement,
 *    RealizedProfitPendingSweep, TreasuryCapital, RecoveryReserve.
 * 4. Treasury transfers require approved destination allowlists, maximum transfer limits,
 *    and are automatically frozen during active incident safety halts.
 */

export type CapitalDomain =
  | 'TRADING_CAPITAL'
  | 'FEE_RESERVE'
  | 'EMERGENCY_EXIT_RESERVE'
  | 'PENDING_SETTLEMENT'
  | 'REALIZED_PROFIT_PENDING_SWEEP'
  | 'TREASURY_CAPITAL'
  | 'RECOVERY_RESERVE';

export interface TreasuryPolicy {
  readonly tradingWalletCeilingLamports: bigint;
  readonly minEmergencyReserveLamports: bigint;
  readonly autoSweepThresholdLamports: bigint;
  readonly approvedTreasuryDestinations: ReadonlySet<string>;
  readonly maxSingleTransferLamports: bigint;
  readonly maxHourlyTransferVelocityLamports: bigint;
  readonly isIncidentLockActive: boolean;
}

export interface TreasuryTransferRequest {
  readonly transferId: string;
  readonly destinationAddress: string;
  readonly amountLamports: bigint;
  readonly sourceDomain: CapitalDomain;
  readonly requestedAtMs: number;
  readonly authorizationSignature: string;
}

export class TreasuryShieldAuthority {
  private policy: TreasuryPolicy;
  private balances = new Map<CapitalDomain, bigint>();
  private hourlyTransfers: { timestampMs: number; amountLamports: bigint }[] = [];

  constructor(policy: TreasuryPolicy, initialBalances?: Partial<Record<CapitalDomain, bigint>>) {
    this.policy = policy;
    const domains: CapitalDomain[] = [
      'TRADING_CAPITAL',
      'FEE_RESERVE',
      'EMERGENCY_EXIT_RESERVE',
      'PENDING_SETTLEMENT',
      'REALIZED_PROFIT_PENDING_SWEEP',
      'TREASURY_CAPITAL',
      'RECOVERY_RESERVE'
    ];
    for (const d of domains) {
      this.balances.set(d, initialBalances?.[d] ?? 0n);
    }
  }

  public getBalance(domain: CapitalDomain): bigint {
    return this.balances.get(domain) ?? 0n;
  }

  public setIncidentLock(active: boolean): void {
    this.policy = { ...this.policy, isIncidentLockActive: active };
  }

  /**
   * Sweeps realized profits above trading ceiling into cold TreasuryCapital.
   */
  public sweepRealizedProfits(): { sweptLamports: bigint; newTradingBalance: bigint } {
    const trading = this.getBalance('TRADING_CAPITAL');
    const pendingSweep = this.getBalance('REALIZED_PROFIT_PENDING_SWEEP');
    const totalTrading = trading + pendingSweep;

    if (totalTrading > this.policy.tradingWalletCeilingLamports) {
      const excess = totalTrading - this.policy.tradingWalletCeilingLamports;
      this.balances.set('TRADING_CAPITAL', this.policy.tradingWalletCeilingLamports);
      this.balances.set('REALIZED_PROFIT_PENDING_SWEEP', 0n);
      const currentTreasury = this.getBalance('TREASURY_CAPITAL');
      this.balances.set('TREASURY_CAPITAL', currentTreasury + excess);
      return { sweptLamports: excess, newTradingBalance: this.policy.tradingWalletCeilingLamports };
    }

    return { sweptLamports: 0n, newTradingBalance: trading };
  }

  /**
   * Authorizes an external transfer from TreasuryCapital.
   * Trading execution authority cannot call this function.
   */
  public authorizeExternalTransfer(
    request: TreasuryTransferRequest,
    nowMs: number = Date.now()
  ): { isAuthorized: boolean; reason?: string } {
    // 1. Incident Lock Check
    if (this.policy.isIncidentLockActive) {
      return { isAuthorized: false, reason: 'INCIDENT_LOCK_ACTIVE: All treasury transfers frozen during incident halt' };
    }

    // 2. Source Domain Check
    if (request.sourceDomain !== 'TREASURY_CAPITAL') {
      return {
        isAuthorized: false,
        reason: `SOURCE_DOMAIN_VIOLATION: Cannot transfer directly from ${request.sourceDomain}. Must sweep to TREASURY_CAPITAL first.`
      };
    }

    // 3. Destination Address Allowlist Check
    if (!this.policy.approvedTreasuryDestinations.has(request.destinationAddress)) {
      return {
        isAuthorized: false,
        reason: `UNAPPROVED_DESTINATION: Address ${request.destinationAddress} is not in treasury destination allowlist`
      };
    }

    // 4. Single Transfer Limit Check
    if (request.amountLamports > this.policy.maxSingleTransferLamports) {
      return {
        isAuthorized: false,
        reason: `TRANSFER_LIMIT_EXCEEDED: Requested ${request.amountLamports} > max ${this.policy.maxSingleTransferLamports}`
      };
    }

    // 5. Hourly Velocity Limit Check
    const oneHourAgo = nowMs - 3_600_000;
    this.hourlyTransfers = this.hourlyTransfers.filter((t) => t.timestampMs > oneHourAgo);
    const hourlyTotal = this.hourlyTransfers.reduce((acc, t) => acc + t.amountLamports, 0n);

    if (hourlyTotal + request.amountLamports > this.policy.maxHourlyTransferVelocityLamports) {
      return {
        isAuthorized: false,
        reason: `VELOCITY_LIMIT_EXCEEDED: Hourly outflow ${hourlyTotal + request.amountLamports} > max ${this.policy.maxHourlyTransferVelocityLamports}`
      };
    }

    // 6. Sufficient Balance Check
    const currentTreasury = this.getBalance('TREASURY_CAPITAL');
    if (currentTreasury < request.amountLamports) {
      return { isAuthorized: false, reason: `INSUFFICIENT_FUNDS: Available ${currentTreasury} < requested ${request.amountLamports}` };
    }

    // Deduct and record
    this.balances.set('TREASURY_CAPITAL', currentTreasury - request.amountLamports);
    this.hourlyTransfers.push({ timestampMs: nowMs, amountLamports: request.amountLamports });

    return { isAuthorized: true };
  }
}
