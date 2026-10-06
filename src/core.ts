export type Position = {
  mint: string; creator: string; tokenProgram: string; qty: string; initialQty: string;
  cost: string; originalCost: string; peak: string; stage: number; opened: number;
  reserve: string; panic: boolean; creatorTokens: string;
  candidateId?: string; candidateGenerationId?: string; entrySlot?: number; mfePct?: number; maePct?: number;
};
export type Pending = {
  id: string; mint: string; side: 'buy' | 'sell'; signature: string; wire: string;
  lastValidBlockHeight: number; created: number; creator: string; tokenProgram: string;
  stage: number; reserve: string; reason: string; requested: string; creatorTokens?: string;
  deliveryAttempts?: Array<{
    status: 'ACCEPTED' | 'UNKNOWN' | 'NOT_SENT'; attemptedAt: number;
    bundleId?: string; reason?: string;
  }>;
};
export type Performance = { since: number; realized: string; fills: { at:number; mint:string; side:string; signature:string; net:string; pnl:string }[]; count:number };
export type RiskState = {
  failures: number[];
  equity: { at: number; value: string }[];
  highWater: string;
  haltReason?: string;
  lifetimePeak?: string;
  shadowHalted?: boolean;
  bypassedHalts?: string[];
  bankrupt?: boolean;
  bankruptAt?: number;
};
export type ReconciliationBlock = {
  signature: string;
  mint: string;
  side: 'buy' | 'sell';
  lastValidBlockHeight: number;
  detectedAt: number;
  reason: 'LIVE_RECONCILIATION_UNRESOLVED';
};
/** A restart-persistent marker that research-evidence writes were rejected.
 * This is an observability/recovery signal only; it must not affect capital decisions. */
export type ResearchEvidenceLoss = {
  schemaVersion: 1;
  failureCount: number;
  firstFailureAtMs: number;
  lastFailureAtMs: number;
  lastEvent: string;
  lastReason: string;
  recoveryRequired: true;
};
export function recordResult(state: State, mint:string, side:string, signature:string, net:bigint, pnl:bigint) {
 const report = state.performance ??= {since:Date.now(), realized:'0', fills:[], count:0};
 report.realized = String(BigInt(report.realized)+pnl); report.count++;
 report.fills.push({at:Date.now(),mint,side,signature,net:String(net),pnl:String(pnl)});
 if(report.fills.length>300) report.fills.shift();
}
export type State = {
  version: 1; wallet: string; mode: string; positions: Record<string, Position>;
  pending: Pending | null; cash: string; day: string; dayPnl: string;
  closed: Record<string, number>; halted: boolean; operatorPaused?: boolean; performance?: Performance; risk?: RiskState;
  /** Blocks every automatic economic action until finalized wallet balances are reconciled. */
  reconciliationBlocked?: ReconciliationBlock;
  /** Known research journal/audit loss; absence does not certify complete capture. */
  researchEvidenceLoss?: ResearchEvidenceLoss;
};
export const mulBps = (x: bigint, bps: number) => x * BigInt(bps) / 10_000n;
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export interface EmpiricalExitPolicy {
  readonly id: string;
  readonly name: string;
  readonly targetBps: number; // 20_000 = 2.0x
  readonly deriskFractionBps: number; // 5000 = 50%
  readonly stopLossBps: number; // 2500 = -25%
  readonly trailStopBps: number; // 3000 = -30%
  readonly maxHoldMs: number; // 180_000 = 3m
}

export const EMPIRICAL_STAGED_DERISK_POLICY: EmpiricalExitPolicy = {
  id: 'STAGED_DERISK_2X_TRAIL',
  name: 'Staged Derisk (50% @ 2.0x, Trail -30%, 3m Max Hold)',
  targetBps: 20_000,
  deriskFractionBps: 5000,
  stopLossBps: 2500,
  trailStopBps: 3000,
  maxHoldMs: 180_000,
};

export function empiricalExitDecision(
  p: Position,
  value: bigint,
  nowMs = Date.now(),
  policy: EmpiricalExitPolicy = EMPIRICAL_STAGED_DERISK_POLICY,
  isMaxRisk = false
): { fraction: number; stage: number; reason: string } | null {
  const qty = BigInt(p.qty), initial = BigInt(p.initialQty);
  if (qty <= 0n) return null;
  const normalized = value * initial / qty;
  const cost = BigInt(p.originalCost), peak = BigInt(p.peak);

  if (p.panic) return { fraction: 10_000, stage: p.stage, reason: 'panic' };

  // 1. Time stop: Pre-committed maximum hold to exit before terminal 80.4% post-peak decay
  if (p.opened && nowMs - p.opened >= policy.maxHoldMs) {
    return { fraction: 10_000, stage: p.stage, reason: 'time-stop' };
  }

  // 2. Hard Stop loss: Sized to bound max loss to pre-committed limit
  if (!isMaxRisk && normalized <= mulBps(cost, 10_000 - policy.stopLossBps)) {
    return { fraction: 10_000, stage: p.stage, reason: 'stop' };
  }

  // 3. Breakeven floor once stage > 0 (capital reclamation)
  if (!isMaxRisk && p.stage > 0 && normalized <= cost) {
    return { fraction: 10_000, stage: p.stage, reason: 'breakeven-trigger' };
  }

  // 4. Staged Derisk Target: Sell exactly 50% at 2.0x (reclaiming 100% of initial SOL + friction)
  if (p.stage === 0 && normalized >= mulBps(cost, policy.targetBps)) {
    return { fraction: policy.deriskFractionBps, stage: 1, reason: 'staged-derisk-take-profit' };
  }

  // 5. Trailing stop on remaining runner (-30% from peak)
  if (!isMaxRisk && p.stage > 0) {
    const trailFloor = mulBps(peak, 10_000 - policy.trailStopBps);
    if (normalized <= trailFloor) {
      return { fraction: 10_000, stage: p.stage, reason: 'trailing-stop' };
    }
  }

  return null;
}

export function exitDecision(
  p: Position,
  value: bigint,
  stopBps: number,
  isMaxRisk = false,
  nowMs?: number,
  policy?: EmpiricalExitPolicy
): { fraction: number; stage: number; reason: string } | null {
  if (policy) {
    return empiricalExitDecision(p, value, nowMs, policy, isMaxRisk);
  }
  const qty = BigInt(p.qty), initial = BigInt(p.initialQty);
  if (qty <= 0n) return null;
  const normalized = value * initial / qty;
  const cost = BigInt(p.originalCost), peak = BigInt(p.peak);
  if (p.panic) return { fraction: 10_000, stage: p.stage, reason: 'panic' };
  if (!isMaxRisk) {
    if (normalized <= mulBps(cost, 10_000 - stopBps)) return { fraction: 10_000, stage: p.stage, reason: 'stop' };
    if (p.stage > 0 && normalized <= cost) return { fraction: 10_000, stage: p.stage, reason: 'breakeven-trigger' };
  }
  const thresholds = [12_000, 16_000, 25_000, 60_000, 160_000];
  if (p.stage < thresholds.length && normalized >= mulBps(cost, thresholds[p.stage]))
    return { fraction: p.stage === 4 ? 10_000 : 5000, stage: p.stage + 1, reason: 'take-profit' };
  if (!isMaxRisk) {
    const trail = peak >= cost * 6n ? 4000 : peak >= mulBps(cost, 25_000) ? 3000 : peak >= mulBps(cost, 15_000) ? 2500 : 2000;
    const floor = peak >= cost * 6n ? mulBps(cost, 20_000) : peak >= mulBps(cost, 25_000) ? mulBps(cost, 15_000) : peak >= mulBps(cost, 15_000) ? mulBps(cost, 12_000) : mulBps(cost, 10_500);
    if (peak >= mulBps(cost, 12_000) && normalized <= (mulBps(peak, 10_000 - trail) > floor ? mulBps(peak, 10_000 - trail) : floor))
      return { fraction: 10_000, stage: p.stage, reason: 'trailing-stop' };
  }
  return null;
}
export function settle(state: State, tokenDelta: bigint, solDelta: bigint): void {
  const o = state.pending;
  if (!o) throw new Error('no pending order');
  const today = new Date().toISOString().slice(0, 10);
  if (state.day !== today) { state.day = today; state.dayPnl = '0'; }
  let realized = 0n;
  if (o.side === 'buy') {
    if (tokenDelta <= 0n || solDelta >= 0n || state.positions[o.mint]) throw new Error('invalid buy fill');
    state.positions[o.mint] = { mint: o.mint, creator: o.creator, tokenProgram: o.tokenProgram,
      qty: String(tokenDelta), initialQty: String(tokenDelta), cost: String(-solDelta), originalCost: String(-solDelta),
      peak: String(-solDelta), stage: 0, opened: o.created, reserve: o.reserve, panic: false, creatorTokens: o.creatorTokens ?? '0' };
  } else {
    const p = state.positions[o.mint];
    if (!p || tokenDelta >= 0n || -tokenDelta > BigInt(p.qty)) throw new Error('invalid sell fill');
    const allocated = BigInt(p.cost) * -tokenDelta / BigInt(p.qty);
    realized = solDelta - allocated;
    p.qty = String(BigInt(p.qty) + tokenDelta); p.cost = String(BigInt(p.cost) - allocated);
    p.stage = o.stage;
    state.dayPnl = String(BigInt(state.dayPnl) + solDelta - allocated);
    if (BigInt(p.qty) === 0n) { delete state.positions[o.mint]; state.closed[o.mint] = Date.now(); }
  }
  recordResult(state, o.mint, o.side, o.signature, solDelta, realized);
  state.cash = String(BigInt(state.cash) + solDelta);
  state.pending = null;
}
export class BoundedSet {
  private values = new Map<string, number>();
  constructor(private max: number, private ttl: number) {}
  has(key: string, now = Date.now()): boolean {
    const previous = this.values.get(key);
    if (previous === undefined || now - previous >= this.ttl) {
      if (previous !== undefined) this.values.delete(key);
      return false;
    }
    return true;
  }
  add(key: string, now = Date.now()): boolean {
    const previous = this.values.get(key);
    if (previous !== undefined && now - previous < this.ttl) return false;
    this.values.delete(key); this.values.set(key, now);
    while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!);
    return true;
  }
}
const SENSITIVE_KEY_REGEX = /key|secret|password|auth|token|seed|private/i;
const SENSITIVE_URL_REGEX = /^https?:\/\/[^\s]+[?&](api-key|key|token|auth)=/i;

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      if (SENSITIVE_URL_REGEX.test(v)) {
        try {
          const u = new URL(v);
          result[k] = `${u.protocol}//${u.host}${u.pathname}?api-key=[REDACTED]`;
        } catch {
          result[k] = '[REDACTED_URL]';
        }
      } else if (v.length >= 64 && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v) && !['mint', 'signature'].includes(k)) {
        result[k] = '[REDACTED_KEY]';
      } else {
        result[k] = v;
      }
    } else if (Array.isArray(v) && v.length === 64 && typeof v[0] === 'number') {
      result[k] = '[REDACTED_KEYPAIR_BYTES]';
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function log(event: string, fields: Record<string, unknown> = {}) {
  const sanitized = sanitizeLogFields(fields);
  recentEvents.push({ time: new Date().toISOString(), event, ...Object.fromEntries(Object.entries(sanitized).filter(([k]) => ['mint', 'side', 'reason', 'signature', 'status', 'netLamports', 'tokenDelta', 'stage', 'quoteAgeMs', 'slippageBps', 'tipLamports', 'priorityLamports', 'rentLamports', 'uptimeHours'].includes(k))) });
  if (recentEvents.length > 100) recentEvents.shift();
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), event, ...sanitized }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
}
export const recentEvents: Record<string, unknown>[] = [];

function riskState(state: State): RiskState {
  return state.risk ??= { failures: [], equity: [], highWater: state.cash };
}

/** Record a failed transaction and halt after a bounded burst of failures. */
export function recordFailure(state: State, now = Date.now(), windowMs = 3_600_000, limit = 3): boolean {
  const risk = riskState(state);
  risk.failures = risk.failures.filter(at => now - at <= windowMs);
  risk.failures.push(now);
  if (risk.failures.length >= limit) {
    const reason = `${limit} transaction failures in ${Math.round(windowMs / 60_000)} minutes`;
    risk.haltReason = reason;
    if (state.mode === 'paper_max_risk' || state.mode === 'paper_chaos') {
      risk.shadowHalted = true;
      risk.bypassedHalts ??= [];
      risk.bypassedHalts.push(`FAILURE_BURST: ${reason}`);
      log('paper_risk_bypass', { rule: 'TRANSACTION_FAILURE_LIMIT', normalResult: 'DENY', paperMaxRiskResult: 'ATTEMPT', reason });
    } else {
      state.halted = true;
    }
  }
  return state.halted;
}

/** Track rolling equity and halt when drawdown from the active-window high-water mark is breached. */
export function recordEquity(state: State, value: bigint, now = Date.now(), windowMs = 3_600_000, drawdownBps = 500): boolean {
  const risk = riskState(state);
  risk.equity = risk.equity.filter(sample => now - sample.at <= windowMs);
  risk.equity.push({ at: now, value: String(value) });
  const current = value;
  const high = risk.equity.reduce((max, sample) => {
    const n = BigInt(sample.value);
    return n > max ? n : max;
  }, 0n);
  const lifetime = BigInt(risk.lifetimePeak || risk.highWater || '0');
  if (current > lifetime) risk.lifetimePeak = String(current);
  risk.highWater = String(high);
  const water = high;
  if (water > 0n && current * 10_000n <= water * BigInt(10_000 - drawdownBps)) {
    const reason = `rolling drawdown reached ${drawdownBps} bps`;
    risk.haltReason = reason;
    if (state.mode === 'paper_max_risk' || state.mode === 'paper_chaos') {
      risk.shadowHalted = true;
      risk.bypassedHalts ??= [];
      risk.bypassedHalts.push(`ROLLING_DRAWDOWN: ${reason}`);
      log('paper_risk_bypass', { rule: 'ROLLING_DRAWDOWN_LIMIT', normalResult: 'DENY', paperMaxRiskResult: 'ATTEMPT', reason });
    } else {
      state.halted = true;
    }
  }
  return state.halted;
}

/** Prune stale failure and equity samples outside the rolling window, recalibrating rolling high water. */
export function pruneRiskState(state: State, now = Date.now(), windowMs = 3_600_000): void {
  if (!state.risk) return;
  state.risk.failures = state.risk.failures.filter(at => now - at <= windowMs);
  state.risk.equity = state.risk.equity.filter(sample => now - sample.at <= windowMs);
  if (state.risk.equity.length) {
    const high = state.risk.equity.reduce((max, sample) => {
      const n = BigInt(sample.value);
      return n > max ? n : max;
    }, 0n);
    state.risk.highWater = String(high);
  } else {
    state.risk.highWater = state.cash;
  }
}
