import { UserAccount, UserVault, VaultLifecycleState } from './types.js';
import { UserRiskMandate, UserRiskMandateType, SegregatedVaultBalances } from '../types.js';

export const MANDATE_PRESETS: Record<UserRiskMandateType, UserRiskMandate> = {
  CONSERVATIVE: {
    type: 'CONSERVATIVE',
    maxActiveExposureBps: 4000,   // 40% max exposure
    reservePercentageBps: 4000,   // 40% reserve floor
    maxPositions: 2,
    maxPositionSizeBps: 2000,     // 20% max single position
    maxCycleDrawdownBps: 500,     // 5% max drawdown
    minLiquidityLamports: 2_000_000_000n, // 2 SOL min pool depth
    maxPriceImpactBps: 300,       // 3% max impact
    maxSlippageBps: 250,          // 2.5% max slippage
  },
  BALANCED: {
    type: 'BALANCED',
    maxActiveExposureBps: 6000,   // 60% max exposure
    reservePercentageBps: 2500,   // 25% reserve floor
    maxPositions: 3,
    maxPositionSizeBps: 2500,     // 25% max single position
    maxCycleDrawdownBps: 800,     // 8% max drawdown
    minLiquidityLamports: 1_000_000_000n, // 1 SOL min pool depth
    maxPriceImpactBps: 400,       // 4% max impact
    maxSlippageBps: 300,          // 3% max slippage
  },
  AGGRESSIVE: {
    type: 'AGGRESSIVE',
    maxActiveExposureBps: 8000,   // 80% max exposure
    reservePercentageBps: 1500,   // 15% reserve floor
    maxPositions: 4,
    maxPositionSizeBps: 3000,     // 30% max single position
    maxCycleDrawdownBps: 1200,    // 12% max drawdown
    minLiquidityLamports: 750_000_000n,  // 0.75 SOL min pool depth
    maxPriceImpactBps: 500,       // 5% max impact
    maxSlippageBps: 400,          // 4% max slippage
  },
};

export class VaultManager {
  private users = new Map<string, UserAccount>();
  private vaults = new Map<string, UserVault>();

  registerUser(userId: string, destinationAddress: string, notes?: string): UserAccount {
    if (this.users.has(userId)) {
      throw new Error(`User with ID ${userId} already registered`);
    }
    if (!destinationAddress || destinationAddress.length < 32) {
      throw new Error(`Invalid confirmed destination address: ${destinationAddress}`);
    }
    const user: UserAccount = {
      userId,
      confirmedDestinationAddress: destinationAddress,
      createdAt: Date.now(),
      kycVerified: true,
      notes,
    };
    this.users.set(userId, user);
    return user;
  }

  getUser(userId: string): UserAccount | undefined {
    return this.users.get(userId);
  }

  createVault(vaultId: string, userId: string, mandateType: UserRiskMandateType = 'BALANCED'): UserVault {
    if (!this.users.has(userId)) {
      throw new Error(`Cannot create vault: Unknown user ID ${userId}`);
    }
    if (this.vaults.has(vaultId)) {
      throw new Error(`Vault ID ${vaultId} already exists`);
    }

    const mandate = MANDATE_PRESETS[mandateType];
    const initialBalances: SegregatedVaultBalances = {
      customerAssetsLamports: 0n,
      platformTreasuryLamports: 0n,
      platformOperatingFundsLamports: 0n,
      operationalReserveLamports: 0n,
      settlementFundsLamports: 0n,
      tradingCapitalLamports: 0n,
      lockedInPositionsLamports: 0n,
    };

    const vault: UserVault = {
      vaultId,
      userId,
      state: 'CREATED',
      mandate,
      currentCycleId: null,
      cycleStartedAt: null,
      cycleEndsAt: null,
      balances: initialBalances,
      authorizedRiskCapitalLamports: 0n,
      highWaterMarkLamports: 0n,
      startingNavLamports: 0n,
      currentNavLamports: 0n,
      peakNavLamports: 0n,
      lifetimeRealizedPnlLamports: 0n,
      lifetimeFeesPaidLamports: 0n,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.vaults.set(vaultId, vault);
    return vault;
  }

  getVault(vaultId: string): UserVault | undefined {
    return this.vaults.get(vaultId);
  }

  getAllVaults(): UserVault[] {
    return [...this.vaults.values()];
  }

  getVaultsByUser(userId: string): UserVault[] {
    return [...this.vaults.values()].filter(v => v.userId === userId);
  }

  /**
   * Process an incoming deposit into a vault.
   * Separates Customer Equity from Authorized Risk Capital.
   * Reserves are set aside based on mandate reserve percentage.
   */
  processDeposit(vaultId: string, amountLamports: bigint): UserVault {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new Error(`Vault ${vaultId} not found`);
    if (amountLamports <= 0n) throw new Error('Deposit amount must be positive');

    // Deposit enters customer assets
    vault.balances.customerAssetsLamports += amountLamports;
    vault.currentNavLamports += amountLamports;

    // First deposit initializes startingNav and high-water mark
    if (vault.startingNavLamports === 0n) {
      vault.startingNavLamports = amountLamports;
      vault.peakNavLamports = amountLamports;
      vault.highWaterMarkLamports = amountLamports;
    } else {
      // Subsequent deposits scale startingNav and HWM proportionally without manufacturing trading profit
      vault.startingNavLamports += amountLamports;
      vault.highWaterMarkLamports += amountLamports;
      vault.peakNavLamports += amountLamports;
    }

    // Segregate Capital: Reserve floor is held back, remaining becomes trading capital
    const reserveAmount = (amountLamports * BigInt(vault.mandate.reservePercentageBps)) / 10_000n;
    const deployableTradingCapital = amountLamports - reserveAmount;

    vault.balances.operationalReserveLamports += reserveAmount;
    vault.balances.tradingCapitalLamports += deployableTradingCapital;

    // Authorize risk capital based on active exposure cap
    // FUNDAMENTAL LAW: ACCOUNT EQUITY != AUTHORIZED RISK CAPITAL
    const maxExposure = (vault.currentNavLamports * BigInt(vault.mandate.maxActiveExposureBps)) / 10_000n;
    vault.authorizedRiskCapitalLamports = maxExposure < vault.balances.tradingCapitalLamports
      ? maxExposure
      : vault.balances.tradingCapitalLamports;

    vault.state = 'FUNDED';
    vault.updatedAt = Date.now();
    return vault;
  }

  /**
   * Update vault state with validation against allowed state transitions
   */
  transitionState(vaultId: string, nextState: VaultLifecycleState, reason?: string): UserVault {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new Error(`Vault ${vaultId} not found`);

    vault.state = nextState;
    vault.updatedAt = Date.now();
    return vault;
  }
}
