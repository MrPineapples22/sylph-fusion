/**
 * SOLARIS-NEXUS: Bimodal Execution Router
 * Decides optimal transaction dispatch route (Jito MEV bundle vs. Direct TPU/RPC)
 * based on active leader Jito compatibility and account contention.
 */

import { LeaderScheduleTracker } from './leader-schedule.js';
import { DynamicTipAndContentionOracle, TradeUrgency } from './tip-oracle.js';
import { BimodalRoutePlan, BimodalRouteType } from './types.js';

export interface RouteRequest {
  readonly intentId: string;
  readonly currentSlot: number;
  readonly writeLockedAccounts: string[];
  readonly urgency?: TradeUrgency;
  readonly maxAllowedSlotDelay?: number;
}

export class BimodalExecutionRouter {
  private totalRoutesGenerated = 0;
  private jitoBundleCount = 0;
  private directTpuCount = 0;
  private congestionAbstainCount = 0;

  constructor(
    private readonly leaderTracker: LeaderScheduleTracker,
    private readonly tipOracle: DynamicTipAndContentionOracle
  ) {}

  public planRoute(req: RouteRequest): BimodalRoutePlan {
    this.totalRoutesGenerated++;
    const urgency = req.urgency ?? 'STANDARD';
    const lookaheadCount = Math.max(1, req.maxAllowedSlotDelay ?? 4);
    const immediateLeader = this.leaderTracker.getSlotLeader(req.currentSlot);
    if (!immediateLeader) {
      this.congestionAbstainCount++;
      return {
        routeType: 'ABSTAIN_LEADER_UNAVAILABLE',
        targetSlot: req.currentSlot,
        targetLeaderPubkey: 'UNAVAILABLE',
        isJitoLeader: false,
        recommendedJitoTipLamports: 0n,
        recommendedPriorityMicroLamports: 0n,
        computeUnitLimit: 0,
        rationale: 'Leader schedule is unavailable for the target slot; no execution route may be inferred.',
        evaluatedAtMs: Date.now(),
      };
    }
    const tipFloor = this.tipOracle.getTipFloor();
    const contention = this.tipOracle.estimateContention(req.writeLockedAccounts);
    if (!tipFloor.isFresh || !contention.isObserved) {
      this.congestionAbstainCount++;
      return {
        routeType: 'ABSTAIN_FEE_EVIDENCE_UNAVAILABLE',
        targetSlot: req.currentSlot,
        targetLeaderPubkey: immediateLeader.leaderPubkey,
        isJitoLeader: immediateLeader.isJitoLeader,
        recommendedJitoTipLamports: 0n,
        recommendedPriorityMicroLamports: 0n,
        computeUnitLimit: 0,
        rationale: 'Current observed tip-floor and account-contention evidence are required before planning an execution route.',
        evaluatedAtMs: Date.now(),
      };
    }
    const window = this.leaderTracker.getUpcomingWindow(req.currentSlot, lookaheadCount);
    const tip = this.tipOracle.getRecommendedTip(urgency);
    const { priorityMicroLamports, contentionTier } = this.tipOracle.getRecommendedPriorityFee(req.writeLockedAccounts, urgency);

    // If critical contention and standard urgency, check if friction would burn edge
    if (contentionTier === 'CRITICAL' && urgency === 'STANDARD') {
      this.congestionAbstainCount++;
      return {
        routeType: 'ABSTAIN_CONGESTION',
        targetSlot: req.currentSlot,
        targetLeaderPubkey: immediateLeader.leaderPubkey,
        isJitoLeader: immediateLeader.isJitoLeader,
        recommendedJitoTipLamports: tip,
        recommendedPriorityMicroLamports: priorityMicroLamports,
        computeUnitLimit: 120_000,
        rationale: `Contention tier CRITICAL on write-locked accounts; delaying non-urgent entry to protect capital`,
        evaluatedAtMs: Date.now(),
      };
    }

    // Check if immediate slot or next adjacent slot is Jito-enabled
    if (immediateLeader.isJitoLeader) {
      this.jitoBundleCount++;
      return {
        routeType: 'JITO_BUNDLE',
        targetSlot: immediateLeader.slot,
        targetLeaderPubkey: immediateLeader.leaderPubkey,
        isJitoLeader: true,
        recommendedJitoTipLamports: tip,
        recommendedPriorityMicroLamports: 1_000n, // baseline CU fee inside Jito bundle
        computeUnitLimit: 120_000,
        rationale: `Target slot ${immediateLeader.slot} leader ${immediateLeader.leaderPubkey.slice(0, 8)}... is Jito-Solana enabled; routing private MEV bundle`,
        evaluatedAtMs: Date.now(),
      };
    }

    // Immediate leader is vanilla agave. Check if next leader in window (e.g. within 2 slots) is Jito
    const nextJitoSlot = window.find(slotInfo => slotInfo.isJitoLeader);
    if (nextJitoSlot && (nextJitoSlot.slot - req.currentSlot) <= 2 && urgency === 'STANDARD') {
      this.jitoBundleCount++;
      return {
        routeType: 'JITO_BUNDLE',
        targetSlot: nextJitoSlot.slot,
        targetLeaderPubkey: nextJitoSlot.leaderPubkey,
        isJitoLeader: true,
        recommendedJitoTipLamports: tip,
        recommendedPriorityMicroLamports: 1_000n,
        computeUnitLimit: 120_000,
        rationale: `Slot ${req.currentSlot} is vanilla agave, but slot ${nextJitoSlot.slot} (+${nextJitoSlot.slot - req.currentSlot}) is Jito-Solana; queuing for target Jito bundle`,
        evaluatedAtMs: Date.now(),
      };
    }

    // Otherwise, route Direct TPU/RPC to land in immediate vanilla slot
    this.directTpuCount++;
    return {
      routeType: 'DIRECT_TPU_QUIC',
      targetSlot: immediateLeader.slot,
      targetLeaderPubkey: immediateLeader.leaderPubkey,
      isJitoLeader: false,
      recommendedJitoTipLamports: 0n,
      recommendedPriorityMicroLamports: priorityMicroLamports,
      computeUnitLimit: 140_000,
      rationale: `Target slot ${immediateLeader.slot} leader ${immediateLeader.leaderPubkey.slice(0, 8)}... is vanilla agave; dispatching direct TPU/RPC with dynamic ${priorityMicroLamports} micro-lamports/CU`,
      evaluatedAtMs: Date.now(),
    };
  }

  public getStats(): {
    totalRoutesGenerated: number;
    jitoBundleCount: number;
    directTpuCount: number;
    congestionAbstainCount: number;
    jitoRouteRatio: number;
  } {
    const total = this.totalRoutesGenerated || 1;
    return {
      totalRoutesGenerated: this.totalRoutesGenerated,
      jitoBundleCount: this.jitoBundleCount,
      directTpuCount: this.directTpuCount,
      congestionAbstainCount: this.congestionAbstainCount,
      jitoRouteRatio: Math.round((this.jitoBundleCount / total) * 100) / 100,
    };
  }
}
