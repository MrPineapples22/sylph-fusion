/**
 * SOL-SYLPH Capital Provenance Engine
 * Blueprint Part XII
 *
 * Classifies capital:
 * FRESH, ROTATING, RELATED, AUTOMATED, INSIDER_RELATED, ESTABLISHED, UNKNOWN.
 * Builds Capital Novelty Ratio, Net Independent Capital Flow, Capital Source Concentration.
 */

export type CapitalType =
  | 'FRESH'
  | 'ROTATING'
  | 'RELATED'
  | 'AUTOMATED'
  | 'INSIDER_RELATED'
  | 'ESTABLISHED'
  | 'UNKNOWN';

export interface InflowObservation {
  readonly walletAddress: string;
  readonly amountSol: number;
  readonly timestampMs: number;
  readonly capitalType: CapitalType;
  readonly confidence: number;
}

export interface CapitalProvenanceReport {
  readonly mint: string;
  readonly totalCapitalSol: number;
  readonly freshCapitalSol: number;
  readonly rotatingCapitalSol: number;
  readonly relatedCapitalSol: number;
  readonly automatedCapitalSol: number;
  readonly insiderCapitalSol: number;
  readonly establishedCapitalSol: number;
  readonly unknownCapitalSol: number;
  readonly capitalNoveltyRatio: number;        // Fresh / Total
  readonly netIndependentCapitalFlowSol: number; // (Fresh + Established + Rotating) - Related
  readonly capitalSourceConcentration: number;   // Herfindahl-Hirschman Index 0.0 - 1.0
  readonly primaryCapitalClass: CapitalType;
}

export class CapitalProvenanceEngine {
  public evaluateProvenance(mint: string, inflows: readonly InflowObservation[]): CapitalProvenanceReport {
    if (!inflows || inflows.length === 0) {
      return {
        mint,
        totalCapitalSol: 0,
        freshCapitalSol: 0,
        rotatingCapitalSol: 0,
        relatedCapitalSol: 0,
        automatedCapitalSol: 0,
        insiderCapitalSol: 0,
        establishedCapitalSol: 0,
        unknownCapitalSol: 0,
        capitalNoveltyRatio: 0,
        netIndependentCapitalFlowSol: 0,
        capitalSourceConcentration: 0,
        primaryCapitalClass: 'UNKNOWN',
      };
    }

    let total = 0;
    let fresh = 0;
    let rotating = 0;
    let related = 0;
    let automated = 0;
    let insider = 0;
    let established = 0;
    let unknown = 0;

    const sourceTotals = new Map<string, number>();

    for (const flow of inflows) {
      total += flow.amountSol;
      sourceTotals.set(flow.walletAddress, (sourceTotals.get(flow.walletAddress) ?? 0) + flow.amountSol);

      switch (flow.capitalType) {
        case 'FRESH': fresh += flow.amountSol; break;
        case 'ROTATING': rotating += flow.amountSol; break;
        case 'RELATED': related += flow.amountSol; break;
        case 'AUTOMATED': automated += flow.amountSol; break;
        case 'INSIDER_RELATED': insider += flow.amountSol; break;
        case 'ESTABLISHED': established += flow.amountSol; break;
        default: unknown += flow.amountSol; break;
      }
    }

    const safeTotal = Math.max(0.001, total);
    const capitalNoveltyRatio = Number((fresh / safeTotal).toFixed(3));
    const netIndependentFlow = (fresh + established + rotating) - (related + insider);

    // HHI concentration: sum of squared market shares
    let hhi = 0;
    for (const amt of sourceTotals.values()) {
      const share = amt / safeTotal;
      hhi += share * share;
    }

    const classes: [CapitalType, number][] = [
      ['FRESH', fresh],
      ['ROTATING', rotating],
      ['ESTABLISHED', established],
      ['RELATED', related],
      ['INSIDER_RELATED', insider],
      ['AUTOMATED', automated],
    ];
    classes.sort((a, b) => b[1] - a[1]);
    const primaryCapitalClass = classes[0][1] > 0 ? classes[0][0] : 'UNKNOWN';

    return {
      mint,
      totalCapitalSol: Number(total.toFixed(3)),
      freshCapitalSol: Number(fresh.toFixed(3)),
      rotatingCapitalSol: Number(rotating.toFixed(3)),
      relatedCapitalSol: Number(related.toFixed(3)),
      automatedCapitalSol: Number(automated.toFixed(3)),
      insiderCapitalSol: Number(insider.toFixed(3)),
      establishedCapitalSol: Number(established.toFixed(3)),
      unknownCapitalSol: Number(unknown.toFixed(3)),
      capitalNoveltyRatio,
      netIndependentCapitalFlowSol: Number(netIndependentFlow.toFixed(3)),
      capitalSourceConcentration: Number(hhi.toFixed(3)),
      primaryCapitalClass,
    };
  }
}
