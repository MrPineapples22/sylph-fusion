/**
 * Risk Budget Waterfall Evaluator
 *
 * Computes exact capital allocation breakdown from gross funds down to executable entry capacity:
 * Total Cash -> Reserved Capital Floor -> Operable Cash -> Active Exposure -> Pending Orders -> Available Entry Budget
 */

export function evaluateRiskWaterfall({
  cash = '1000000000', // Default 1 SOL in lamports
  positions = [],
  pending = null,
  limits = {},
  solPriceUsd = 150,
  halted = false,
  operatorPaused = false,
} = {}) {
  const cashLamports = BigInt(String(cash || '0'));
  const reserveLamports = BigInt(String(limits.reserve || limits.RESERVE_LAMPORTS || '50000000')); // 0.05 SOL
  const maxExposureLamports = BigInt(String(limits.exposure || limits.MAX_EXPOSURE_LAMPORTS || '500000000')); // 0.5 SOL
  const buyLamports = BigInt(String(limits.buy || limits.BUY_LAMPORTS || '100000000')); // 0.1 SOL
  const riskBps = BigInt(String(limits.riskBps || limits.MAX_SPECULATIVE_RISK_BPS || '500')); // 5%
  const maxPositions = Number(limits.positions || limits.MAX_POSITIONS || 3);

  // Parse positions array or object
  const posList = Array.isArray(positions) ? positions : Object.values(positions || {});
  const activeExposureLamports = posList.reduce((acc, p) => acc + BigInt(String(p.cost || '0')), 0n);

  // Operable cash after deducting safety reserve
  const operableCashLamports = cashLamports > reserveLamports ? cashLamports - reserveLamports : 0n;

  // Remaining exposure capacity under exposure cap
  const remainingExposureCapacityLamports = maxExposureLamports > activeExposureLamports ? maxExposureLamports - activeExposureLamports : 0n;

  // Speculative risk budget cap (max risk allowable based on operable cash)
  const speculativeRiskBudgetLamports = (operableCashLamports * riskBps) / 10000n;

  // In-flight pending buy commitment
  const pendingCommitmentsLamports = pending && pending.side === 'buy' ? BigInt(String(pending.requested || pending.requestedAmount || buyLamports)) : 0n;

  // Available Entry Budget calculation: minimum of operable cash, remaining exposure headroom, and risk cap
  let deployableBeforePending = operableCashLamports < remainingExposureCapacityLamports ? operableCashLamports : remainingExposureCapacityLamports;
  let availableEntryBudgetLamports = deployableBeforePending > pendingCommitmentsLamports ? deployableBeforePending - pendingCommitmentsLamports : 0n;

  // Bottleneck / Headroom Status Identification
  let status = 'CAPACITY_OPEN';
  let bottleneck = 'Headroom available for new position entries';
  let canEnter = true;

  if (halted) {
    status = 'SAFETY_HALTED';
    bottleneck = 'Engine halted by safety protection; entry lane locked';
    canEnter = false;
    availableEntryBudgetLamports = 0n;
  } else if (operatorPaused) {
    status = 'OPERATOR_PAUSED';
    bottleneck = 'Entries paused by operator command';
    canEnter = false;
    availableEntryBudgetLamports = 0n;
  } else if (posList.length >= maxPositions) {
    status = 'MAX_POSITIONS_REACHED';
    bottleneck = `Portfolio slot saturated (${posList.length}/${maxPositions} positions filled)`;
    canEnter = false;
    availableEntryBudgetLamports = 0n;
  } else if (pending) {
    status = 'PENDING_LANE_BUSY';
    bottleneck = `Pending ${pending?.side?.toUpperCase()} order in flight; lane serialized`;
    canEnter = false;
    availableEntryBudgetLamports = 0n;
  } else if (activeExposureLamports >= maxExposureLamports) {
    status = 'EXPOSURE_CAPPED';
    bottleneck = `Max portfolio exposure ceiling reached (${(Number(activeExposureLamports) / 1e9).toFixed(3)} SOL)`;
    canEnter = false;
    availableEntryBudgetLamports = 0n;
  } else if (cashLamports < buyLamports + reserveLamports) {
    status = 'RESERVE_LOCKED';
    bottleneck = `Cash below minimum buffer (${(Number(cashLamports) / 1e9).toFixed(3)} SOL < ${(Number(buyLamports + reserveLamports) / 1e9).toFixed(3)} SOL)`;
    canEnter = false;
    availableEntryBudgetLamports = 0n;
  }

  // Formatting helpers
  const toSol = lamports => Number(lamports) / 1e9;
  const toUsd = lamports => toSol(lamports) * solPriceUsd;

  // Waterfall Bar Steps
  const steps = [
    {
      id: 'gross_cash',
      label: 'Gross Cash',
      amountLamports: cashLamports.toString(),
      amountSol: toSol(cashLamports),
      amountUsd: toUsd(cashLamports),
      category: 'source',
      color: '#14F195', // Emerald
      description: 'Total uncommitted cash in account',
    },
    {
      id: 'reserved_floor',
      label: 'Reserved Capital Floor',
      amountLamports: reserveLamports === 0n ? '0' : (-reserveLamports).toString(),
      amountSol: reserveLamports === 0n ? 0 : -toSol(reserveLamports),
      amountUsd: reserveLamports === 0n ? 0 : -toUsd(reserveLamports),
      category: 'deduction',
      color: '#FF9E2C', // Amber
      description: 'Untouchable reserve buffer (RESERVE_LAMPORTS)',
    },
    {
      id: 'active_exposure',
      label: 'Exposure (separate limit)',
      amountLamports: activeExposureLamports.toString(),
      amountSol: toSol(activeExposureLamports),
      amountUsd: toUsd(activeExposureLamports),
      category: 'allocated',
      color: '#9945FF', // Purple
      description: `${posList.length} open position(s); already deducted from cash on settlement`,
    },
    {
      id: 'pending_hold',
      label: 'Pending Order Hold',
      amountLamports: pendingCommitmentsLamports === 0n ? '0' : (-pendingCommitmentsLamports).toString(),
      amountSol: pendingCommitmentsLamports === 0n ? 0 : -toSol(pendingCommitmentsLamports),
      amountUsd: pendingCommitmentsLamports === 0n ? 0 : -toUsd(pendingCommitmentsLamports),
      category: 'hold',
      color: '#00C2FF', // Cyan
      description: pendingCommitmentsLamports > 0n ? `Hold for ${pending?.side?.toUpperCase()} order (${pending?.mint?.slice(0, 6)}…)` : 'No pending orders in lane',
    },
    {
      id: 'available_budget',
      label: 'Cash / Exposure Headroom',
      amountLamports: availableEntryBudgetLamports.toString(),
      amountSol: toSol(availableEntryBudgetLamports),
      amountUsd: toUsd(availableEntryBudgetLamports),
      category: 'net',
      color: canEnter && availableEntryBudgetLamports > 0n ? '#10B981' : '#6B7280', // Green or Gray
      description: canEnter ? 'Indicative headroom only; fees and execution gates still apply' : 'Capacity restricted by risk rules',
    },
  ];

  // Capacity utilization percentage
  const exposurePct = maxExposureLamports > 0n ? Number(((activeExposureLamports * 10000n) / maxExposureLamports)) / 100 : 0;
  const cashUtilizationPct = cashLamports > 0n ? Number((((activeExposureLamports + reserveLamports) * 10000n) / cashLamports)) / 100 : 0;

  return {
    status,
    bottleneck,
    canEnter,
    metrics: {
      totalCashSol: toSol(cashLamports),
      totalCashUsd: toUsd(cashLamports),
      reserveFloorSol: toSol(reserveLamports),
      operableCashSol: toSol(operableCashLamports),
      activeExposureSol: toSol(activeExposureLamports),
      maxExposureSol: toSol(maxExposureLamports),
      remainingExposureCapacitySol: toSol(remainingExposureCapacityLamports),
      speculativeRiskCapSol: toSol(speculativeRiskBudgetLamports),
      pendingCommitmentSol: toSol(pendingCommitmentsLamports),
      availableEntryBudgetSol: toSol(availableEntryBudgetLamports),
      availableEntryBudgetUsd: toUsd(availableEntryBudgetLamports),
      exposureUtilizationPct: Math.min(100, Math.max(0, exposurePct)),
      cashUtilizationPct: Math.min(100, Math.max(0, cashUtilizationPct)),
      positionSlotsUsed: posList.length,
      maxPositionSlots: maxPositions,
    },
    steps,
  };
}
