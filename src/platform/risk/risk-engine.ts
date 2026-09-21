import {
  TradeProposal,
  RiskAuthorization,
  RiskDisposition,
  CrossCycleRiskMemory,
  SystemicPlatformRiskConfig,
} from './types.js';
import { UserVault } from '../vault/types.js';
import { PhaseEvaluation } from '../lifecycle/types.js';

export const DEFAULT_SYSTEMIC_CONFIG: SystemicPlatformRiskConfig = {
  maxPlatformTotalDeployedBps: 7000,      // Max 70% of platform capital in market
  maxSingleTokenPlatformConcentrationBps: 500, // Max 5% in any one token
  maxSingleCreatorPlatformExposureBps: 300,    // Max 3% in any single creator
  minGlobalLiquidityReserveLamports: 10_000_000_000n, // 10 SOL global reserve buffer
};

export class IndependentRiskEngine {
  private vaultMemories = new Map<string, CrossCycleRiskMemory>();
  private globalTokenExposure = new Map<string, bigint>();
  private globalCreatorExposure = new Map<string, bigint>();
  private totalPlatformDeployedLamports = 0n;

  constructor(private systemicConfig: SystemicPlatformRiskConfig = DEFAULT_SYSTEMIC_CONFIG) {}

  getMemory(vaultId: string): CrossCycleRiskMemory {
    let mem = this.vaultMemories.get(vaultId);
    if (!mem) {
      mem = {
        vaultId,
        consecutiveLossStreak: 0,
        peakCycleDrawdownBps: 0,
        lifetimeCompletedCycles: 0,
        rolling3CycleLossLamports: 0n,
        governorState: 'NORMAL',
        lastEvaluatedAt: Date.now(),
      };
      this.vaultMemories.set(vaultId, mem);
    }
    return mem;
  }

  recordCycleCompletion(vaultId: string, netCyclePnlLamports: bigint, peakDrawdownBps: number): void {
    const mem = this.getMemory(vaultId);
    mem.lifetimeCompletedCycles++;
    mem.peakCycleDrawdownBps = Math.max(mem.peakCycleDrawdownBps, peakDrawdownBps);

    if (netCyclePnlLamports < 0n) {
      mem.consecutiveLossStreak++;
      mem.rolling3CycleLossLamports += -netCyclePnlLamports;
    } else {
      mem.consecutiveLossStreak = 0;
    }

    // Governor rules based on loss streaks and drawdown history
    if (mem.consecutiveLossStreak >= 3 || peakDrawdownBps >= 1500) {
      mem.governorState = 'NO_NEW_ENTRIES';
    } else if (mem.consecutiveLossStreak === 2 || peakDrawdownBps >= 1000) {
      mem.governorState = 'PRESERVATION';
    } else if (mem.consecutiveLossStreak === 1 || peakDrawdownBps >= 600) {
      mem.governorState = 'REDUCED';
    } else {
      mem.governorState = 'NORMAL';
    }
    mem.lastEvaluatedAt = Date.now();
  }

  /**
   * Evaluates a trade proposal against User Mandate, Vault Equity, Lifecycle Phase,
   * Governor Memory, and Global Systemic Exposure.
   */
  authorizeTrade(
    proposal: TradeProposal,
    vault: UserVault,
    phase: PhaseEvaluation,
    totalPlatformNavLamports: bigint,
    activePositionsCount: number
  ): RiskAuthorization {
    const appliedConstraints: string[] = [];

    // Sells are always authorized for risk reduction
    if (proposal.side === 'sell') {
      return {
        disposition: 'APPROVE',
        authorizedAmountLamports: proposal.requestedAmountLamports,
        rejectionReason: null,
        appliedConstraints: ['sell_liquidation_unrestricted'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    // 1. Lifecycle Phase Check
    if (!phase.allowNewEntries) {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Lifecycle phase (${phase.phase}) prohibits new entries: ${phase.reason}`,
        appliedConstraints: ['phase_entry_block'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    // 2. Exceptional Vault States
    if (vault.state === 'PAUSED' || vault.state === 'RISK_FROZEN' || vault.state === 'SECURITY_HOLD') {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Vault is in non-tradeable state: ${vault.state}`,
        appliedConstraints: ['vault_exceptional_state'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    // 3. User Risk Mandate Limits
    const mandate = vault.mandate;

    // 3A. Maximum concurrent positions check
    if (activePositionsCount >= mandate.maxPositions) {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Max concurrent positions reached (${activePositionsCount}/${mandate.maxPositions})`,
        appliedConstraints: ['max_positions_limit'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    // 3B. Pool Liquidity Floor Check
    const requiredLiquidity = (mandate.minLiquidityLamports * BigInt(Math.round(phase.liquidityFloorMultiplier * 100))) / 100n;
    if (proposal.poolLiquidityLamports < requiredLiquidity) {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Pool liquidity (${proposal.poolLiquidityLamports}) below required threshold (${requiredLiquidity})`,
        appliedConstraints: ['min_liquidity_gate'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    // 3C. Slippage & Price Impact Checks
    if (proposal.expectedPriceImpactBps > mandate.maxPriceImpactBps) {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Expected price impact (${proposal.expectedPriceImpactBps} bps) exceeds mandate ceiling (${mandate.maxPriceImpactBps} bps)`,
        appliedConstraints: ['max_price_impact_gate'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    if (proposal.expectedSlippageBps > mandate.maxSlippageBps) {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Expected slippage (${proposal.expectedSlippageBps} bps) exceeds mandate ceiling (${mandate.maxSlippageBps} bps)`,
        appliedConstraints: ['max_slippage_gate'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    // 4. Position Sizing Authorization
    let authorized = proposal.requestedAmountLamports;

    // Mandate Single Position Sizing Ceiling:
    const mandateMaxPosition = (vault.currentNavLamports * BigInt(mandate.maxPositionSizeBps)) / 10_000n;
    if (authorized > mandateMaxPosition) {
      authorized = mandateMaxPosition;
      appliedConstraints.push(`capped_by_mandate_max_pos_${mandate.maxPositionSizeBps}bps`);
    }

    // Mandate Active Vault Exposure Ceiling:
    const currentActiveExposure = vault.balances.lockedInPositionsLamports;
    const maxActiveExposure = (vault.currentNavLamports * BigInt(mandate.maxActiveExposureBps)) / 10_000n;
    const remainingExposureHeadroom = maxActiveExposure > currentActiveExposure
      ? maxActiveExposure - currentActiveExposure
      : 0n;

    if (authorized > remainingExposureHeadroom) {
      authorized = remainingExposureHeadroom;
      appliedConstraints.push('capped_by_active_exposure_headroom');
    }

    // Available Trading Capital Floor:
    if (authorized > vault.balances.tradingCapitalLamports) {
      authorized = vault.balances.tradingCapitalLamports;
      appliedConstraints.push('capped_by_available_trading_capital');
    }

    // Phase Exposure Multiplier (e.g. 0.5x in Phase 2):
    if (phase.exposureMultiplier < 1.0) {
      authorized = (authorized * BigInt(Math.round(phase.exposureMultiplier * 100))) / 100n;
      appliedConstraints.push(`scaled_by_phase_${phase.phase}_multiplier`);
    }

    // Cross-Cycle Governor Adjustment:
    const mem = this.getMemory(vault.vaultId);
    if (mem.governorState === 'NO_NEW_ENTRIES') {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Governor in NO_NEW_ENTRIES state due to loss streak (${mem.consecutiveLossStreak})`,
        appliedConstraints: ['governor_halt'],
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    } else if (mem.governorState === 'PRESERVATION') {
      authorized = authorized / 2n;
      appliedConstraints.push('halved_by_governor_preservation');
    } else if (mem.governorState === 'REDUCED') {
      authorized = (authorized * 3n) / 4n;
      appliedConstraints.push('scaled_75pct_by_governor_reduced');
    }

    // 5. Global Systemic Risk Engine (Platform-Wide Constraints)
    const currentTokenExp = this.globalTokenExposure.get(proposal.mint) ?? 0n;
    const currentCreatorExp = this.globalCreatorExposure.get(proposal.creator) ?? 0n;

    if (totalPlatformNavLamports > 0n) {
      // 5A. Single-Token Platform Limit (e.g. max 5% of platform NAV)
      const maxTokenAllowed = (totalPlatformNavLamports * BigInt(this.systemicConfig.maxSingleTokenPlatformConcentrationBps)) / 10_000n;
      const tokenHeadroom = maxTokenAllowed > currentTokenExp ? maxTokenAllowed - currentTokenExp : 0n;
      if (authorized > tokenHeadroom) {
        authorized = tokenHeadroom;
        appliedConstraints.push('capped_by_global_single_token_concentration');
      }

      // 5B. Single-Creator Platform Limit (e.g. max 3% of platform NAV)
      const maxCreatorAllowed = (totalPlatformNavLamports * BigInt(this.systemicConfig.maxSingleCreatorPlatformExposureBps)) / 10_000n;
      const creatorHeadroom = maxCreatorAllowed > currentCreatorExp ? maxCreatorAllowed - currentCreatorExp : 0n;
      if (authorized > creatorHeadroom) {
        authorized = creatorHeadroom;
        appliedConstraints.push('capped_by_global_creator_exposure');
      }

      // 5C. Total Platform Deployed Limit (e.g. max 70% deployed)
      const maxPlatformDeployed = (totalPlatformNavLamports * BigInt(this.systemicConfig.maxPlatformTotalDeployedBps)) / 10_000n;
      const platformHeadroom = maxPlatformDeployed > this.totalPlatformDeployedLamports ? maxPlatformDeployed - this.totalPlatformDeployedLamports : 0n;
      if (authorized > platformHeadroom) {
        authorized = platformHeadroom;
        appliedConstraints.push('capped_by_global_platform_deployed_limit');
      }
    }

    // Minimum economic order threshold (0.01 SOL = 10,000,000 lamports)
    if (authorized < 10_000_000n) {
      return {
        disposition: 'REJECT',
        authorizedAmountLamports: 0n,
        rejectionReason: `Authorized amount (${authorized}) below minimum economic threshold (10,000,000 lamports)`,
        appliedConstraints,
        maxAllowableLossLamports: 0n,
        cycleDrawdownBps: 0,
        globalTokenExposureBps: 0,
        timestamp: Date.now(),
      };
    }

    const disposition: RiskDisposition = authorized < proposal.requestedAmountLamports ? 'REDUCE' : 'APPROVE';
    const globalTokenExposureBps = totalPlatformNavLamports > 0n
      ? Number(((currentTokenExp + authorized) * 10_000n) / totalPlatformNavLamports)
      : 0;

    return {
      disposition,
      authorizedAmountLamports: authorized,
      rejectionReason: null,
      appliedConstraints,
      maxAllowableLossLamports: (authorized * BigInt(mandate.maxCycleDrawdownBps)) / 10_000n,
      cycleDrawdownBps: 0,
      globalTokenExposureBps,
      timestamp: Date.now(),
    };
  }

  recordExecutionFill(mint: string, creator: string, amountLamports: bigint, side: 'buy' | 'sell'): void {
    const curToken = this.globalTokenExposure.get(mint) ?? 0n;
    const curCreator = this.globalCreatorExposure.get(creator) ?? 0n;

    if (side === 'buy') {
      this.globalTokenExposure.set(mint, curToken + amountLamports);
      this.globalCreatorExposure.set(creator, curCreator + amountLamports);
      this.totalPlatformDeployedLamports += amountLamports;
    } else {
      this.globalTokenExposure.set(mint, curToken > amountLamports ? curToken - amountLamports : 0n);
      this.globalCreatorExposure.set(creator, curCreator > amountLamports ? curCreator - amountLamports : 0n);
      this.totalPlatformDeployedLamports = this.totalPlatformDeployedLamports > amountLamports
        ? this.totalPlatformDeployedLamports - amountLamports
        : 0n;
    }
  }
}
