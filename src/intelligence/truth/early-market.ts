/**
 * SOL-SYLPH Early Market Formation Engine
 * Blueprint Part IX
 *
 * Tracks high-resolution early windows:
 * T0, +1 slot, +2 slots, +5 slots, +10 slots, +30s, +1m, +2m, +5m.
 * Builds EarlyMarketFormationRecord.
 */

export interface EarlyWindowSnapshot {
  readonly windowId: 'T0' | 'PLUS_1_SLOT' | 'PLUS_2_SLOTS' | 'PLUS_5_SLOTS' | 'PLUS_10_SLOTS' | 'PLUS_30_SEC' | 'PLUS_1_MIN' | 'PLUS_2_MIN' | 'PLUS_5_MIN';
  readonly timestampMs: number;
  readonly slot: number;
  readonly independentEconomicActors: number;
  readonly economicVolumeSol: number;
  readonly buyPressureSol: number;
  readonly sellPressureSol: number;
  readonly bundleDetected: boolean;
  readonly capitalNoveltyRatio: number; // 0.0 - 1.0 (fresh vs recycled)
  readonly top3HolderConcentrationPct: number;
  readonly liquiditySol: number;
  readonly priceImpact1SolPct: number;
}

export interface EarlyMarketFormationRecord {
  readonly mint: string;
  readonly genesisSlot: number;
  readonly genesisTimestampMs: number;
  readonly windows: Partial<Record<string, EarlyWindowSnapshot>>;
  readonly actorExpansionVelocity: number;
  readonly capitalNoveltyTrend: 'EXPANDING' | 'RECYCLING' | 'NEUTRAL';
  readonly bundleRisk: boolean;
  readonly formationAuthenticityScore: number; // 0.0 - 1.0
}

export class EarlyMarketFormationEngine {
  private readonly formations = new Map<string, EarlyMarketFormationRecord>();

  public initializeFormation(mint: string, genesisSlot: number, genesisTimestampMs: number): EarlyMarketFormationRecord {
    const formation: EarlyMarketFormationRecord = {
      mint,
      genesisSlot,
      genesisTimestampMs,
      windows: {},
      actorExpansionVelocity: 0.0,
      capitalNoveltyTrend: 'NEUTRAL',
      bundleRisk: false,
      formationAuthenticityScore: 1.0,
    };
    this.formations.set(mint, formation);
    return formation;
  }

  public recordWindow(mint: string, snapshot: EarlyWindowSnapshot): EarlyMarketFormationRecord {
    let formation = this.formations.get(mint);
    if (!formation) {
      formation = this.initializeFormation(mint, snapshot.slot, snapshot.timestampMs);
    }

    formation.windows[snapshot.windowId] = snapshot;

    // Calculate trends across windows
    const windowKeys = Object.keys(formation.windows);
    const windowValues = Object.values(formation.windows).filter((w): w is EarlyWindowSnapshot => Boolean(w));
    const hasBundle = windowValues.some(w => w.bundleDetected);
    (formation as { bundleRisk: boolean }).bundleRisk = hasBundle;

    if (windowKeys.length >= 2 && windowValues.length >= 2) {
      const sorted = [...windowValues].sort((a, b) => a.timestampMs - b.timestampMs);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (first && last) {
        const timeDeltaSec = Math.max(1, (last.timestampMs - first.timestampMs) / 1000);
        const actorGrowth = (last.independentEconomicActors - first.independentEconomicActors) / timeDeltaSec;
        (formation as { actorExpansionVelocity: number }).actorExpansionVelocity = Number(actorGrowth.toFixed(3));

        const noveltyTrend = last.capitalNoveltyRatio > 0.6 ? 'EXPANDING' : last.capitalNoveltyRatio < 0.3 ? 'RECYCLING' : 'NEUTRAL';
        (formation as { capitalNoveltyTrend: 'EXPANDING' | 'RECYCLING' | 'NEUTRAL' }).capitalNoveltyTrend = noveltyTrend;

        const authenticity = (hasBundle ? 0.4 : 0.8) * Math.min(1.0, last.capitalNoveltyRatio + 0.2) * (1.0 - (last.top3HolderConcentrationPct / 100) * 0.4);
        (formation as { formationAuthenticityScore: number }).formationAuthenticityScore = Math.max(0.0, Math.min(1.0, authenticity));
      }
    }

    return formation;
  }

  public getFormation(mint: string): EarlyMarketFormationRecord | undefined {
    return this.formations.get(mint);
  }
}
