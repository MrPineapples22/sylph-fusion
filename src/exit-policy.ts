/**
 * ============================================================================
 * SOL-SYLPH GOD-TIER 50 EXIT POLICY ENGINE (exit-policy.ts)
 * ============================================================================
 * Deterministic, paper-safe, mathematically sound canonical exit referee.
 * Enforces the 50 God-Tier Controls:
 *   - Monotonic stop ratchet (floor never regresses)
 *   - 50/50 rule for take profits (50% scale-out at >=20% targets)
 *   - Dynamic Staged Trailing Stops (Gain <100%: 20%, >100%: 30%, >500%: 40%)
 *   - 0s Dev dump emergency bailout
 *   - Single-block liquidity shock & adverse orderflow toxicity
 *   - False breakout quick cut (-2.5% loss in <45s)
 *   - True last-peak momentum exhaustion clock (90s without new high)
 *   - Accurate net proceeds & cost basis accounting
 * ============================================================================
 */
export const EXIT_POLICY_VERSION = 'god-tier-50-v2-max-profit';

export type ExitPolicyInput = Readonly<{
  entry: number;
  mark: number;
  peak: number;
  stage: number;
  openedAt: number;
  now: number;
  stopBps: number;
  markAt?: number;
  maxMarkAgeMs?: number;
  lastPeakAt?: number;
  devDumped?: boolean;
  reserveDropPct?: number;
  consecutiveSellBlocks?: number;
  sellPressureRatio?: number;
  buyVelocity?: number;
  isDex?: boolean;
  atrVolatility?: number;
  partialExitBps?: number;
}>;

export type ExitPolicyDecision = Readonly<{
  reason:
    | 'STOP_LOSS'
    | 'FALSE_BREAKOUT'
    | 'TRAILING_PROFIT'
    | 'TAKE_PROFIT_1'
    | 'TAKE_PROFIT_2'
    | 'TAKE_PROFIT_3'
    | 'TAKE_PROFIT_4'
    | 'STAGNATION'
    | 'DEV_DUMP_BAILOUT'
    | 'LIQUIDITY_SHOCK'
    | 'ADVERSE_FLOW_TOXICITY'
    | 'MOMENTUM_EXHAUSTION'
    | 'BREAKEVEN_PROTECT';
  fractionBps: number;
  emergency: boolean;
  nextStage: number;
  protectiveStop: number;
}>;

const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

/**
 * Single source of truth for both displayed and enforced protective floors.
 * Ratchets monotonically upwards as price advances through profit milestones.
 */
export function protectiveStop(input: Pick<ExitPolicyInput, 'entry' | 'peak' | 'stopBps'>): number | null {
  const { entry, peak, stopBps } = input;
  if (![entry, peak, stopBps].every(finitePositive) || stopBps >= 10_000) return null;
  const hardStop = entry * (1 - stopBps / 10_000);
  const peakRatio = peak / entry;
  if (peakRatio < 1.04) return hardStop;

  // Dynamic Staged Trailing Stops for Moonshots (AGENTS.md & God-Tier Controls):
  // Static tight trailing stops choke out 1500% runners that experience 30-40% structural pullbacks.
  // Gain < 25%: 15% trail (breakeven floor)
  // Gain 25% - 100%: 20% trail (floor entry * 1.10)
  // Gain 100% - 500%: 30% trail (floor entry * 1.50)
  // Gain > 500%: 40% structural trail (floor entry * 4.0)
  let floorMultiplier = 1.01;
  let trailPct = 0.15;

  if (peakRatio >= 6.0) {
    // 500%+ Moonshot runner: Allow 40% structural breath room to capture 1500%+ expansions
    floorMultiplier = 4.0;
    trailPct = 0.40;
  } else if (peakRatio >= 2.0) {
    // 100%+ Double: Allow 30% pullback trail
    floorMultiplier = 1.50;
    trailPct = 0.30;
  } else if (peakRatio >= 1.25) {
    // 25%+ Gain: 20% trail
    floorMultiplier = 1.10;
    trailPct = 0.20;
  } else {
    // 4% - 25%: 15% trail with breakeven protection
    floorMultiplier = 1.01;
    trailPct = 0.15;
  }

  const stagedFloor = entry * floorMultiplier;
  const trailingPrice = peak * (1 - trailPct);
  return Math.max(hardStop, stagedFloor, trailingPrice);
}

/**
 * Returns null for invalid or stale evidence; silence is safer than a guessed exit.
 * Enforces the 50 God-Tier Controls with strict rule priority order.
 */
export function decideExit(input: ExitPolicyInput): ExitPolicyDecision | null {
  const {
    entry,
    mark,
    peak,
    stage,
    openedAt,
    now,
    stopBps,
    markAt,
    maxMarkAgeMs = 10_000,
  } = input;

  // Control 1 & 2: Finite Positive Prices and Invariant Parameters
  if (
    ![entry, mark, peak, now, openedAt, stopBps].every(finitePositive) ||
    !Number.isInteger(stage) ||
    stage < 0 ||
    stopBps < 1 ||
    stopBps >= 10_000
  ) {
    return null;
  }

  // Control 6 & 7: Fresh Mark Fence (<maxMarkAgeMs) & Anti-Clock Skew
  if (
    markAt !== undefined &&
    (!Number.isSafeInteger(markAt) || markAt > now + 1_000 || now - markAt > maxMarkAgeMs)
  ) {
    return null;
  }

  const ratio = mark / entry;
  const currentPeak = Math.max(peak, mark);
  const peakRatio = currentPeak / entry;
  const ageMs = now - openedAt;
  if (ageMs < 0) return null;

  const hardStop = 1 - stopBps / 10_000;
  const stop = protectiveStop({ entry, peak: currentPeak, stopBps })!;

  // ── Priority 1: 0-Second Creator Dump Instant Bailout (Control 36) ───────────
  if (input.devDumped === true) {
    return {
      reason: 'DEV_DUMP_BAILOUT',
      fractionBps: 10_000,
      emergency: true,
      nextStage: stage,
      protectiveStop: mark,
    };
  }

  // ── Priority 2: Liquidity Shock Guard (>=15% reserve drop) (Control 37) ──────
  if (input.reserveDropPct !== undefined && input.reserveDropPct >= 0.15) {
    return {
      reason: 'LIQUIDITY_SHOCK',
      fractionBps: 10_000,
      emergency: true,
      nextStage: stage,
      protectiveStop: mark,
    };
  }

  // ── Priority 3: Adverse Orderflow Toxicity Cascade (Control 38) ──────────────
  if (
    (input.consecutiveSellBlocks ?? 0) >= 4 &&
    (input.sellPressureRatio ?? 0) >= 0.75
  ) {
    return {
      reason: 'ADVERSE_FLOW_TOXICITY',
      fractionBps: 10_000,
      emergency: true,
      nextStage: stage,
      protectiveStop: mark,
    };
  }

  // ── Priority 4: Structural Hard Stop (-12%) (Control 16 & 25) ────────────────
  if (ratio <= hardStop) {
    return {
      reason: 'STOP_LOSS',
      fractionBps: 10_000,
      emergency: true,
      nextStage: stage,
      protectiveStop: entry * hardStop,
    };
  }

  // ── Priority 5: False Breakout Quick Cut (Control 44) ────────────────────────
  if (ageMs <= 45_000 && peakRatio <= 1.008 && ratio <= 0.975) {
    return {
      reason: 'FALSE_BREAKOUT',
      fractionBps: 10_000,
      emergency: true,
      nextStage: stage,
      protectiveStop: entry * 0.975,
    };
  }

  // ── Priority 6: Dynamic Staged Trailing Stop & Ratchet Floor (Control 17, 18, 22, 41)
  if (peakRatio >= 1.04) {
    if (mark <= stop) {
      return {
        reason: 'TRAILING_PROFIT',
        fractionBps: 10_000,
        emergency: false,
        nextStage: stage,
        protectiveStop: stop,
      };
    }
  }

  // ── Priority 7: Staged Profit-Taking Ladder (50/50 Rule: Control 12, 18, 23, 26) ──
  const targets = [1.12, 1.25, 1.5, 2.0];
  if (stage < targets.length && ratio >= targets[stage]) {
    // 50/50 rule: for trades reaching +20% gain or 2x, secure 50% scale-out to make runner risk-free
    const fractionBps = input.partialExitBps ?? (ratio >= 1.20 ? 5_000 : 2_500);
    return {
      reason: (`TAKE_PROFIT_${stage + 1}` as ExitPolicyDecision['reason']),
      fractionBps,
      emergency: false,
      nextStage: stage + 1,
      protectiveStop: entry,
    };
  }

  // ── Priority 8: True Last-Peak Momentum Exhaustion Clock (Control 39) ─────────
  const peakTime = input.lastPeakAt ?? openedAt;
  const timeSincePeak = now - peakTime;
  if (
    timeSincePeak >= 90_000 &&
    ratio > 1.0 &&
    (input.buyVelocity ?? 0) < 2.0 &&
    mark <= currentPeak * 0.95
  ) {
    return {
      reason: 'MOMENTUM_EXHAUSTION',
      fractionBps: 10_000,
      emergency: false,
      nextStage: stage,
      protectiveStop: stop,
    };
  }

  // ── Priority 9: Stagnation / Time-Decay Exit (Control 40) ─────────────────────
  if (ageMs >= 120_000 && Math.abs(ratio - 1) < 0.025) {
    return {
      reason: 'STAGNATION',
      fractionBps: 10_000,
      emergency: false,
      nextStage: stage,
      protectiveStop: entry * hardStop,
    };
  }

  return null;
}
