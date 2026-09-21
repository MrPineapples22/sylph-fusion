/**
 * SOL-SYLPH Master Production Intelligence - Clean-Room Market State & Deception Gap
 * Specifications: Sections 17 (Clean-Room Market State), 18 (Decision Manipulability).
 *
 * Rules:
 * 1. Maintain OBSERVED STATE vs DECONTAMINATED STATE.
 * 2. Decontaminated state discounts/removes coordinated cluster activity.
 * 3. Disagreement between observed and decontaminated becomes DECEPTION_GAP evidence.
 * 4. Test DecisionManipulability: cost to flip decision.
 */

export interface ObservedMarketFeatures {
  readonly volumeSol: number;
  readonly buyerCount: number;
  readonly compositeHsi: number;
  readonly pumpScore: number;
}

export interface DecontaminatedMarketFeatures {
  readonly cleanVolumeSol: number;
  readonly cleanBuyerCount: number;
  readonly cleanCompositeHsi: number;
  readonly cleanPumpScore: number;
  readonly removedClusterVolumeSol: number;
  readonly removedSybilBuyerCount: number;
}

export interface DeceptionGapReport {
  readonly observed: ObservedMarketFeatures;
  readonly decontaminated: DecontaminatedMarketFeatures;
  readonly volumeDeceptionPct: number;
  readonly buyerDeceptionPct: number;
  readonly hsiDivergence: number;
  readonly isDeceptionSevere: boolean;
  readonly decisionManipulabilityCostSol: number; // estimated SOL needed to flip signals
}

export class CleanRoomStateEngine {
  public evaluateDecontamination(
    observed: ObservedMarketFeatures,
    insiderClusterRatio: number // 0.0 = all organic, 0.6 = 60% insider cluster
  ): DeceptionGapReport {
    const cleanVolume = observed.volumeSol * (1.0 - insiderClusterRatio);
    const cleanBuyers = Math.max(1, Math.round(observed.buyerCount * (1.0 - insiderClusterRatio)));

    // Clean HSI is more suspicious if raw HSI was artificially masked by wash volume
    const cleanHsi = Math.min(100, Math.round(observed.compositeHsi + insiderClusterRatio * 40));
    const cleanPump = Math.max(0, Math.round(observed.pumpScore * (1.0 - insiderClusterRatio * 0.8)));

    const volumeDeception = observed.volumeSol > 0 ? ((observed.volumeSol - cleanVolume) / observed.volumeSol) * 100 : 0;
    const buyerDeception = observed.buyerCount > 0 ? ((observed.buyerCount - cleanBuyers) / observed.buyerCount) * 100 : 0;
    const hsiDiff = Math.abs(observed.compositeHsi - cleanHsi);

    const isSevere = volumeDeception >= 40.0 || buyerDeception >= 40.0 || hsiDiff >= 25;

    // Estimate manipulation cost: cost in SOL to wash trade / forge this volume
    // e.g. Raydium/Pump fees 1.5% on volume + gas
    const minAttackCost = observed.volumeSol * 0.015;
    const clusterWashCost = (observed.volumeSol - cleanVolume) * 0.015;
    const washCostSol = Math.max(minAttackCost, clusterWashCost);

    return {
      observed,
      decontaminated: {
        cleanVolumeSol: Number(cleanVolume.toFixed(2)),
        cleanBuyerCount: cleanBuyers,
        cleanCompositeHsi: cleanHsi,
        cleanPumpScore: cleanPump,
        removedClusterVolumeSol: Number((observed.volumeSol - cleanVolume).toFixed(2)),
        removedSybilBuyerCount: observed.buyerCount - cleanBuyers,
      },
      volumeDeceptionPct: Number(volumeDeception.toFixed(1)),
      buyerDeceptionPct: Number(buyerDeception.toFixed(1)),
      hsiDivergence: hsiDiff,
      isDeceptionSevere: isSevere,
      decisionManipulabilityCostSol: Number(washCostSol.toFixed(3)),
    };
  }
}
