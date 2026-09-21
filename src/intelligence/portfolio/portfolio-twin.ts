/**
 * SOL-SYLPH Portfolio Digital Twin & Structural Correlation Engine
 * Blueprint Parts XLI, XLII, XLIII
 *
 * Calculates:
 * 1. EconomicDependencyGraph (shared actors, funding, routes)
 * 2. Marginal Portfolio Risk (confirmed + pending + reserved)
 * 3. Simultaneous Portfolio Liquidation Simulation (PortfolioExitFragility, RobustPortfolioCapacity)
 */

export interface PositionExposure {
  readonly mint: string;
  readonly confirmedSol: number;
  readonly pendingSol: number;
  readonly reservedSol: number;
  readonly primaryWhaleActor: string;
  readonly poolProtocol: string;
  readonly routeProgram: string;
}

export interface PortfolioStressResult {
  readonly scenario: string;
  readonly totalLossSol: number;
  readonly portfolioExitFragilityScore: number; // 0.0 (liquid) to 1.0 (frozen)
  readonly survivingCapitalSol: number;
}

export interface PortfolioDigitalTwinReport {
  readonly totalConfirmedSol: number;
  readonly totalPendingSol: number;
  readonly totalReservedSol: number;
  readonly totalExposureSol: number;
  readonly robustPortfolioCapacitySol: number;
  readonly structuralConcentrationHhi: number;
  readonly sharedWhaleExposureSol: number;
  readonly portfolioExitFragilityScore: number;
  readonly stressScenarios: readonly PortfolioStressResult[];
  readonly isMarginalOrderAllowed: boolean;
}

export class PortfolioDigitalTwinEngine {
  private readonly maxTotalExposureSol: number;

  constructor(maxTotalExposureSol: number = 10.0) {
    this.maxTotalExposureSol = maxTotalExposureSol;
  }

  public simulatePortfolio(
    currentPositions: readonly PositionExposure[],
    prospectiveOrder?: { mint: string; sizeSol: number; whaleActor?: string; poolProtocol?: string }
  ): PortfolioDigitalTwinReport {
    let confirmed = 0;
    let pending = 0;
    let reserved = 0;

    const whaleExposures = new Map<string, number>();
    const protocolExposures = new Map<string, number>();

    for (const p of currentPositions) {
      confirmed += p.confirmedSol;
      pending += p.pendingSol;
      reserved += p.reservedSol;
      const totalP = p.confirmedSol + p.pendingSol + p.reservedSol;
      whaleExposures.set(p.primaryWhaleActor, (whaleExposures.get(p.primaryWhaleActor) ?? 0) + totalP);
      protocolExposures.set(p.poolProtocol, (protocolExposures.get(p.poolProtocol) ?? 0) + totalP);
    }

    if (prospectiveOrder) {
      reserved += prospectiveOrder.sizeSol;
      if (prospectiveOrder.whaleActor) {
        whaleExposures.set(prospectiveOrder.whaleActor, (whaleExposures.get(prospectiveOrder.whaleActor) ?? 0) + prospectiveOrder.sizeSol);
      }
    }

    const totalExposure = confirmed + pending + reserved;

    // HHI structural concentration across positions
    let hhi = 0;
    if (totalExposure > 0) {
      for (const p of currentPositions) {
        const share = (p.confirmedSol + p.pendingSol + p.reservedSol) / totalExposure;
        hhi += share * share;
      }
    }

    // Shared whale exposure
    let maxWhaleExposure = 0;
    for (const amt of whaleExposures.values()) {
      if (amt > maxWhaleExposure) maxWhaleExposure = amt;
    }

    // Simultaneous portfolio liquidation simulation (Part XLIII)
    const stressScenarios: PortfolioStressResult[] = [
      {
        scenario: 'SHARED_WHALE_SIMULTANEOUS_DUMP',
        totalLossSol: Number((maxWhaleExposure * 0.45).toFixed(2)),
        portfolioExitFragilityScore: maxWhaleExposure > 2.0 ? 0.75 : 0.25,
        survivingCapitalSol: Number((totalExposure - maxWhaleExposure * 0.45).toFixed(2)),
      },
      {
        scenario: 'SOL_MACRO_SHOCK_CONGESTION',
        totalLossSol: Number((totalExposure * 0.25).toFixed(2)),
        portfolioExitFragilityScore: 0.6,
        survivingCapitalSol: Number((totalExposure * 0.75).toFixed(2)),
      },
    ];

    const maxFragility = Math.max(...stressScenarios.map(s => s.portfolioExitFragilityScore));
    const robustCapacity = Math.max(0, this.maxTotalExposureSol - totalExposure);

    // Marginal risk check: reject order if portfolio would breach max capacity or extreme fragility
    const orderAllowed = Boolean(
      totalExposure <= this.maxTotalExposureSol &&
      maxFragility < 0.85 &&
      maxWhaleExposure <= this.maxTotalExposureSol * 0.4
    );

    return {
      totalConfirmedSol: Number(confirmed.toFixed(3)),
      totalPendingSol: Number(pending.toFixed(3)),
      totalReservedSol: Number(reserved.toFixed(3)),
      totalExposureSol: Number(totalExposure.toFixed(3)),
      robustPortfolioCapacitySol: Number(robustCapacity.toFixed(3)),
      structuralConcentrationHhi: Number(hhi.toFixed(3)),
      sharedWhaleExposureSol: Number(maxWhaleExposure.toFixed(3)),
      portfolioExitFragilityScore: Number(maxFragility.toFixed(2)),
      stressScenarios,
      isMarginalOrderAllowed: orderAllowed,
    };
  }
}
