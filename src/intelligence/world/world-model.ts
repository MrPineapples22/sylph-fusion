/**
 * SOL-SYLPH Master Production Intelligence - World Model & Multi-Horizon Forecaster
 * Specifications: Sections 20 (Launch Cohort Engine), 22 (World Model), 23 (Market State Machine).
 *
 * Rules:
 * 1. Probabilistic market-state forecasting across +5s, +15s, +30s, +1m, +3m, +5m, +15m.
 * 2. Forecasts return distribution, drawdown distribution, and survival/collapse probabilities.
 * 3. Never return only one single scalar probability.
 */

export type ForecastHorizon = '5s' | '15s' | '30s' | '1m' | '3m' | '5m' | '15m';

export interface HorizonDistribution {
  readonly horizon: ForecastHorizon;
  readonly expectedReturnBps: number;
  readonly returnP10Bps: number;
  readonly returnP50Bps: number;
  readonly returnP90Bps: number;
  readonly maxDrawdownBps: number;
  readonly survivalProbability: number; // 0.0 to 1.0
  readonly collapseProbability: number; // 0.0 to 1.0
}

export interface WorldModelForecast {
  readonly mint: string;
  readonly evaluatedAtMs: number;
  readonly marketPhase: 'DISCOVERY' | 'ACCUMULATION' | 'ACCELERATION' | 'EXHAUSTION' | 'DISTRIBUTION' | 'DUMP';
  readonly horizons: Readonly<Record<ForecastHorizon, HorizonDistribution>>;
  readonly confidence: number; // 0.0 to 1.0
  readonly uncertaintyBps: number;
}

export class WorldModelEngine {
  public forecast(params: {
    mint: string;
    tokenAgeSeconds: number;
    pumpScore: number;
    compositeHsi: number;
    cleanRoomDeceptionSevere: boolean;
    regimeMultiplier: number;
  }): WorldModelForecast {
    const now = Date.now();
    const { mint, tokenAgeSeconds, pumpScore, compositeHsi, cleanRoomDeceptionSevere, regimeMultiplier } = params;

    // Determine market phase
    let phase: WorldModelForecast['marketPhase'] = 'DISCOVERY';
    if (compositeHsi >= 70 || cleanRoomDeceptionSevere) {
      phase = 'DUMP';
    } else if (tokenAgeSeconds > 300 && pumpScore < 30) {
      phase = 'EXHAUSTION';
    } else if (pumpScore >= 70 && compositeHsi < 40) {
      phase = 'ACCELERATION';
    } else if (tokenAgeSeconds > 60) {
      phase = 'ACCUMULATION';
    }

    const horizons: Record<ForecastHorizon, HorizonDistribution> = {
      '5s': this.buildDistribution('5s', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
      '15s': this.buildDistribution('15s', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
      '30s': this.buildDistribution('30s', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
      '1m': this.buildDistribution('1m', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
      '3m': this.buildDistribution('3m', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
      '5m': this.buildDistribution('5m', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
      '15m': this.buildDistribution('15m', pumpScore, compositeHsi, regimeMultiplier, cleanRoomDeceptionSevere),
    };

    const confidence = cleanRoomDeceptionSevere ? 0.3 : Math.max(0.2, (100 - compositeHsi) / 100);
    const uncertaintyBps = cleanRoomDeceptionSevere ? 2500 : Math.round(compositeHsi * 20);

    return {
      mint,
      evaluatedAtMs: now,
      marketPhase: phase,
      horizons,
      confidence: Number(confidence.toFixed(2)),
      uncertaintyBps,
    };
  }

  private buildDistribution(
    horizon: ForecastHorizon,
    pumpScore: number,
    hsi: number,
    regimeMultiplier: number,
    deceptionSevere: boolean
  ): HorizonDistribution {
    if (deceptionSevere) {
      return {
        horizon,
        expectedReturnBps: -4000,
        returnP10Bps: -8000,
        returnP50Bps: -3500,
        returnP90Bps: -500,
        maxDrawdownBps: 8500,
        survivalProbability: 0.15,
        collapseProbability: 0.85,
      };
    }

    const baseReturn = (pumpScore - hsi) * 10 * regimeMultiplier;
    const survival = Math.max(0.1, Math.min(0.95, (100 - hsi * 0.8) / 100));
    const collapse = Number((1.0 - survival).toFixed(3));

    return {
      horizon,
      expectedReturnBps: Math.round(baseReturn),
      returnP10Bps: Math.round(baseReturn - 1500),
      returnP50Bps: Math.round(baseReturn),
      returnP90Bps: Math.round(baseReturn + 2500),
      maxDrawdownBps: Math.round(hsi * 35),
      survivalProbability: Number(survival.toFixed(3)),
      collapseProbability: collapse,
    };
  }
}
