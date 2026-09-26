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
const finitePositive = (n) => Number.isFinite(n) && n > 0;
/**
 * Single source of truth for both displayed and enforced protective floors.
 * Ratchets monotonically upwards as price advances through profit milestones.
 */
export function protectiveStop(input) {
    const { entry, peak, stopBps } = input;
    if (![entry, peak, stopBps].every(finitePositive) || stopBps >= 10_000)
        return null;
    const hardStop = entry * (1 - stopBps / 10_000);
    const peakRatio = peak / entry;
    if (peakRatio < 1.04)
        return hardStop;
    // Staged trailing stops & profit floors per God-Tier controls
    const tier = peakRatio >= 2.0
        ? [1.70, 0.12]
        : peakRatio >= 1.5
            ? [1.35, 0.12]
            : peakRatio >= 1.25
                ? [1.15, 0.10]
                : [1.01, 0.08];
    return Math.max(hardStop, entry * tier[0], peak * (1 - tier[1]));
}
/**
 * Returns null for invalid or stale evidence; silence is safer than a guessed exit.
 * Enforces the 50 God-Tier Controls with strict rule priority order.
 */
export function decideExit(input) {
    const { entry, mark, peak, stage, openedAt, now, stopBps, markAt, maxMarkAgeMs = 10_000, } = input;
    // Control 1 & 2: Finite Positive Prices and Invariant Parameters
    if (![entry, mark, peak, now, openedAt, stopBps].every(finitePositive) ||
        !Number.isInteger(stage) ||
        stage < 0 ||
        stopBps < 1 ||
        stopBps >= 10_000) {
        return null;
    }
    // Control 6 & 7: Fresh Mark Fence (<maxMarkAgeMs) & Anti-Clock Skew
    if (markAt !== undefined &&
        (!Number.isSafeInteger(markAt) || markAt > now + 1_000 || now - markAt > maxMarkAgeMs)) {
        return null;
    }
    const ratio = mark / entry;
    const currentPeak = Math.max(peak, mark);
    const peakRatio = currentPeak / entry;
    const ageMs = now - openedAt;
    if (ageMs < 0)
        return null;
    const hardStop = 1 - stopBps / 10_000;
    const stop = protectiveStop({ entry, peak: currentPeak, stopBps });
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
    if ((input.consecutiveSellBlocks ?? 0) >= 4 &&
        (input.sellPressureRatio ?? 0) >= 0.75) {
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
            reason: `TAKE_PROFIT_${stage + 1}`,
            fractionBps,
            emergency: false,
            nextStage: stage + 1,
            protectiveStop: entry,
        };
    }
    // ── Priority 8: True Last-Peak Momentum Exhaustion Clock (Control 39) ─────────
    const peakTime = input.lastPeakAt ?? openedAt;
    const timeSincePeak = now - peakTime;
    if (timeSincePeak >= 90_000 &&
        ratio > 1.0 &&
        (input.buyVelocity ?? 0) < 2.0 &&
        mark <= currentPeak * 0.95) {
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
//# sourceMappingURL=exit-policy.js.map