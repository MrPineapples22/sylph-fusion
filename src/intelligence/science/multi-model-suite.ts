/**
 * SOL-SYLPH Intelligence Fabric - Multi-Model Prediction Architecture
 * Specifications: Part XVII (Multi-Model Prediction Architecture),
 * Part XVIII (Calibration Engine Integration), Part XXVI (Contradiction Engine).
 *
 * Implements decoupled prediction responsibilities:
 * - Alpha Model: P(+25%), P(+50%), P(2X), P(5X), expected MFE
 * - Failure Model: P(-30%), P(rug), P(liquidity collapse), P(volume death)
 * - Timing Model: P(+50 within 1m, 5m, 15m), P(rug within 1m, 5m, 15m)
 * - Execution Model: P(transaction lands), expected latency, expected slippage,
 *                    expected price impact, expected priority fees, expected Jito tip
 * - Uncertainty Model: model familiarity, sample sufficiency, calibration quality,
 *                      model disagreement, domain similarity, regime similarity, data health
 */

import { ProbabilityCalibrator } from './calibrator.js';

export interface AlphaPrediction {
  readonly pPlus25: number;
  readonly pPlus50: number;
  readonly p2X: number;
  readonly p5X: number;
  readonly expectedMfePct: number;
  readonly alphaDriver: string;
}

export interface FailurePrediction {
  readonly pMinus30: number;
  readonly pRug: number;
  readonly pLiquidityCollapse: number;
  readonly pVolumeDeath: number;
  readonly primaryFailureRisk: string;
}

export interface TimingPrediction {
  readonly pPlus50Within1m: number;
  readonly pPlus50Within5m: number;
  readonly pPlus50Within15m: number;
  readonly pRugWithin1m: number;
  readonly pRugWithin5m: number;
  readonly pRugWithin15m: number;
  readonly optimalHorizonSec: number;
}

export interface ExecutionPrediction {
  readonly pTransactionLands: number;
  readonly expectedLatencyMs: number;
  readonly expectedSlippageBps: number;
  readonly expectedPriceImpactBps: number;
  readonly expectedPriorityFeeSol: number;
  readonly expectedJitoTipSol: number;
  readonly executionViabilityScore: number;
}

export interface UncertaintyAssessment {
  readonly modelFamiliarity: number; // 0.0 - 1.0 (novelty inverse)
  readonly sampleSufficiency: number; // 0.0 - 1.0
  readonly calibrationQuality: number; // 0.0 - 1.0
  readonly modelDisagreement: number; // 0.0 - 1.0
  readonly domainSimilarity: number; // 0.0 - 1.0
  readonly regimeSimilarity: number; // 0.0 - 1.0
  readonly dataHealthScore: number; // 0.0 - 1.0
  readonly compositeUncertainty: number; // 0.0 - 1.0 (higher = more uncertain)
  readonly uncertaintyClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
}

export interface MultiModelPredictionBundle {
  readonly mint: string;
  readonly timestampMs: number;
  readonly modelVersion: string;
  readonly alpha: AlphaPrediction;
  readonly failure: FailurePrediction;
  readonly timing: TimingPrediction;
  readonly execution: ExecutionPrediction;
  readonly uncertainty: UncertaintyAssessment;
  readonly contradictionDetected: boolean;
  readonly contradictionReason?: string;
}

export class AlphaModel {
  private readonly calibrator = new ProbabilityCalibrator();

  public predict(features: {
    organicScore: number;
    buyVolumeSol: number;
    buyVelocity: number;
    hsiScore: number;
    pumpScore: number;
    mcapSol: number;
  }): AlphaPrediction {
    const { organicScore, buyVolumeSol, buyVelocity, hsiScore, pumpScore } = features;

    // Base probabilities derived from validated features
    const rawP25 = Math.min(0.95, (organicScore * 0.4 + hsiScore * 0.3 + (pumpScore / 100) * 0.3) * (buyVelocity > 1 ? 1.1 : 0.9));
    const rawP50 = rawP25 * 0.65;
    const raw2X = rawP50 * 0.50;
    const raw5X = raw2X * 0.35;

    const pPlus25 = this.calibrator.calibrate(rawP25);
    const pPlus50 = this.calibrator.calibrate(rawP50);
    const p2X = this.calibrator.calibrate(raw2X);
    const p5X = this.calibrator.calibrate(raw5X);

    const expectedMfePct = Math.round((pPlus25 * 25 + pPlus50 * 50 + p2X * 100 + p5X * 400) / 2);

    let alphaDriver = 'MODERATE_ORGANIC_FLOW';
    if (buyVelocity > 2.5 && organicScore > 0.7) {
      alphaDriver = 'ACCELERATING_ORGANIC_BREAKOUT';
    } else if (hsiScore > 0.8) {
      alphaDriver = 'HIGH_HOLDER_STABILITY_ACCUMULATION';
    } else if (pumpScore > 80 && organicScore < 0.3) {
      alphaDriver = 'HIGH_VELOCITY_ARTIFICIAL_SURGE';
    }

    return {
      pPlus25,
      pPlus50,
      p2X,
      p5X,
      expectedMfePct,
      alphaDriver,
    };
  }
}

export class FailureModel {
  private readonly calibrator = new ProbabilityCalibrator();

  public predict(features: {
    podScore: number;
    washTradingPct: number;
    clusterConcentration: number;
    liquiditySol: number;
    devHoldingPct: number;
  }): FailurePrediction {
    const { podScore, washTradingPct, clusterConcentration, liquiditySol, devHoldingPct } = features;

    // Probability of Rug / Dev dumping
    const rawRug = Math.min(0.99, (podScore / 100) * 0.5 + (devHoldingPct / 100) * 0.3 + (clusterConcentration) * 0.2);
    // Liquidity collapse
    const rawLiqCollapse = Math.min(0.99, (liquiditySol < 15 ? 0.6 : 0.1) + (clusterConcentration > 0.4 ? 0.3 : 0.05));
    // Volume death
    const rawVolDeath = Math.min(0.99, (washTradingPct / 100) * 0.5 + (1 - Math.min(1, liquiditySol / 50)) * 0.3);
    // Drawdown -30%
    const rawMinus30 = Math.min(0.99, rawRug * 0.7 + rawLiqCollapse * 0.5 + 0.15);

    const pRug = Number(Math.min(0.99, Math.max(0.01, rawRug)).toFixed(3));
    const pLiquidityCollapse = Number(Math.min(0.99, Math.max(0.01, rawLiqCollapse)).toFixed(3));
    const pVolumeDeath = Number(Math.min(0.99, Math.max(0.01, rawVolDeath)).toFixed(3));
    const pMinus30 = Number(Math.min(0.99, Math.max(0.01, rawMinus30)).toFixed(3));

    let primaryFailureRisk = 'NONE_EVIDENT';
    if (pRug > 0.4) primaryFailureRisk = 'DEV_CLUSTER_RUG_RISK';
    else if (pLiquidityCollapse > 0.35) primaryFailureRisk = 'SHALLOW_LIQUIDITY_RUN';
    else if (pVolumeDeath > 0.4) primaryFailureRisk = 'WASH_EXHAUSTION_VOLUME_COLLAPSE';
    else if (pMinus30 > 0.5) primaryFailureRisk = 'HIGH_DRAWDOWN_VOLATILITY';

    return {
      pMinus30,
      pRug,
      pLiquidityCollapse,
      pVolumeDeath,
      primaryFailureRisk,
    };
  }
}

export class TimingModel {
  private readonly calibrator = new ProbabilityCalibrator();

  public predict(features: {
    txAcceleration: number;
    ageSec: number;
    alphaP50: number;
    failurePRug: number;
  }): TimingPrediction {
    const { txAcceleration, ageSec, alphaP50, failurePRug } = features;

    // Probability timing distributions
    const fastP50 = Math.min(0.95, alphaP50 * (txAcceleration > 0.2 ? 0.8 : 0.4));
    const medP50 = Math.min(0.95, alphaP50 * 0.9);
    const slowP50 = Math.min(0.95, alphaP50 * 0.95);

    const fastRug = Math.min(0.95, failurePRug * (ageSec < 30 ? 0.7 : 0.3));
    const medRug = Math.min(0.95, failurePRug * 0.85);
    const slowRug = Math.min(0.95, failurePRug * 0.95);

    let optimalHorizonSec = 300; // 5 min default
    if (txAcceleration > 0.5 && ageSec < 60) optimalHorizonSec = 60; // 1 min fast surge
    else if (ageSec > 300) optimalHorizonSec = 900; // 15 min mature continuation

    return {
      pPlus50Within1m: this.calibrator.calibrate(fastP50),
      pPlus50Within5m: this.calibrator.calibrate(medP50),
      pPlus50Within15m: this.calibrator.calibrate(slowP50),
      pRugWithin1m: this.calibrator.calibrate(fastRug),
      pRugWithin5m: this.calibrator.calibrate(medRug),
      pRugWithin15m: this.calibrator.calibrate(slowRug),
      optimalHorizonSec,
    };
  }
}

export class ExecutionModel {
  public predict(features: {
    liquiditySol: number;
    orderSizeSol: number;
    networkCongestionFactor: number; // 1.0 = normal, 2.0 = congested
    routeType: 'STANDARD' | 'PRIORITY' | 'JITO';
  }): ExecutionPrediction {
    const { liquiditySol, orderSizeSol, networkCongestionFactor, routeType } = features;

    // Price impact: Order / (2 * Liquidity)
    const rawImpactBps = Math.min(2500, Math.round((orderSizeSol / Math.max(1, liquiditySol * 2)) * 10000));
    
    // Slippage expectation
    const expectedSlippageBps = Math.max(25, Math.round(rawImpactBps * 1.25));

    // Latency & Landing probability based on route
    let pTransactionLands = 0.85;
    let expectedLatencyMs = 450 * networkCongestionFactor;
    let expectedPriorityFeeSol = 0.001 * networkCongestionFactor;
    let expectedJitoTipSol = 0.0;

    if (routeType === 'JITO') {
      pTransactionLands = Math.max(0.92, 0.98 - (networkCongestionFactor - 1) * 0.03);
      expectedLatencyMs = 250;
      expectedPriorityFeeSol = 0.0001;
      expectedJitoTipSol = 0.005 * networkCongestionFactor;
    } else if (routeType === 'PRIORITY') {
      pTransactionLands = Math.max(0.80, 0.92 - (networkCongestionFactor - 1) * 0.08);
      expectedLatencyMs = 380 * networkCongestionFactor;
      expectedPriorityFeeSol = 0.003 * networkCongestionFactor;
    } else {
      pTransactionLands = Math.max(0.50, 0.75 - (networkCongestionFactor - 1) * 0.15);
      expectedLatencyMs = 850 * networkCongestionFactor;
      expectedPriorityFeeSol = 0.00005;
    }

    // Viability score: 0 to 100
    const viability = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          pTransactionLands * 60 -
            (expectedSlippageBps / 50) * 10 -
            (expectedLatencyMs / 200) * 10 +
            (liquiditySol > 50 ? 20 : liquiditySol * 0.4)
        )
      )
    );

    return {
      pTransactionLands: Number(pTransactionLands.toFixed(3)),
      expectedLatencyMs: Math.round(expectedLatencyMs),
      expectedSlippageBps,
      expectedPriceImpactBps: rawImpactBps,
      expectedPriorityFeeSol: Number(expectedPriorityFeeSol.toFixed(6)),
      expectedJitoTipSol: Number(expectedJitoTipSol.toFixed(6)),
      executionViabilityScore: viability,
    };
  }
}

export class UncertaintyModel {
  public assess(features: {
    featureNoveltyScore: number; // 0 = known, 1 = novel
    sampleCount: number;
    calibrationBrier: number;
    alphaScore: number;
    failureScore: number;
    regimeMatchScore: number;
    dataHealthConfidence: number;
  }): UncertaintyAssessment {
    const {
      featureNoveltyScore,
      sampleCount,
      calibrationBrier,
      alphaScore,
      failureScore,
      regimeMatchScore,
      dataHealthConfidence,
    } = features;

    const modelFamiliarity = Number(Math.max(0, 1 - featureNoveltyScore).toFixed(3));
    const sampleSufficiency = Number(Math.min(1, sampleCount / 100).toFixed(3));
    const calibrationQuality = Number(Math.max(0, 1 - calibrationBrier * 3).toFixed(3));
    
    // Model disagreement: when both Alpha and Failure predict high
    const modelDisagreement = Number(Math.min(1, alphaScore * failureScore * 4).toFixed(3));
    const domainSimilarity = 0.88; // Solana DEX ecosystem
    const regimeSimilarity = Number(Math.max(0, Math.min(1, regimeMatchScore)).toFixed(3));
    const dataHealthScore = Number(Math.max(0, Math.min(1, dataHealthConfidence)).toFixed(3));

    // Composite uncertainty calculation
    const uncertaintyRaw =
      (1 - modelFamiliarity) * 0.25 +
      (1 - sampleSufficiency) * 0.20 +
      (1 - calibrationQuality) * 0.15 +
      modelDisagreement * 0.20 +
      (1 - regimeSimilarity) * 0.10 +
      (1 - dataHealthScore) * 0.10;

    const compositeUncertainty = Number(Math.max(0.01, Math.min(0.99, uncertaintyRaw)).toFixed(3));

    let uncertaintyClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' = 'LOW';
    if (compositeUncertainty > 0.65) uncertaintyClass = 'HIGH';
    else if (compositeUncertainty > 0.40) uncertaintyClass = 'MEDIUM';
    else if (sampleCount < 5) uncertaintyClass = 'UNKNOWN';

    return {
      modelFamiliarity,
      sampleSufficiency,
      calibrationQuality,
      modelDisagreement,
      domainSimilarity,
      regimeSimilarity,
      dataHealthScore,
      compositeUncertainty,
      uncertaintyClass,
    };
  }
}

export class MultiModelSuite {
  private readonly alphaModel = new AlphaModel();
  private readonly failureModel = new FailureModel();
  private readonly timingModel = new TimingModel();
  private readonly executionModel = new ExecutionModel();
  private readonly uncertaintyModel = new UncertaintyModel();

  public evaluate(params: {
    mint: string;
    timestampMs: number;
    organicScore: number;
    buyVolumeSol: number;
    buyVelocity: number;
    hsiScore: number;
    pumpScore: number;
    podScore: number;
    washTradingPct: number;
    clusterConcentration: number;
    liquiditySol: number;
    mcapSol: number;
    devHoldingPct: number;
    txAcceleration: number;
    ageSec: number;
    networkCongestion: number;
    featureNovelty: number;
    memorySampleCount: number;
    dataHealthConfidence: number;
    preferredRoute?: 'STANDARD' | 'PRIORITY' | 'JITO';
  }): MultiModelPredictionBundle {
    const alpha = this.alphaModel.predict({
      organicScore: params.organicScore,
      buyVolumeSol: params.buyVolumeSol,
      buyVelocity: params.buyVelocity,
      hsiScore: params.hsiScore,
      pumpScore: params.pumpScore,
      mcapSol: params.mcapSol,
    });

    const failure = this.failureModel.predict({
      podScore: params.podScore,
      washTradingPct: params.washTradingPct,
      clusterConcentration: params.clusterConcentration,
      liquiditySol: params.liquiditySol,
      devHoldingPct: params.devHoldingPct,
    });

    const timing = this.timingModel.predict({
      txAcceleration: params.txAcceleration,
      ageSec: params.ageSec,
      alphaP50: alpha.pPlus50,
      failurePRug: failure.pRug,
    });

    const execution = this.executionModel.predict({
      liquiditySol: params.liquiditySol,
      orderSizeSol: 1.0, // baseline 1 SOL sizing probe
      networkCongestionFactor: params.networkCongestion,
      routeType: params.preferredRoute || 'JITO',
    });

    const uncertainty = this.uncertaintyModel.assess({
      featureNoveltyScore: params.featureNovelty,
      sampleCount: params.memorySampleCount,
      calibrationBrier: 0.12,
      alphaScore: alpha.pPlus50,
      failureScore: failure.pRug,
      regimeMatchScore: 0.85,
      dataHealthConfidence: params.dataHealthConfidence,
    });

    // Contradiction detection: e.g. PumpScore very high but Capital exiting or Rug very high
    let contradictionDetected = false;
    let contradictionReason: string | undefined;

    if (alpha.pPlus50 > 0.6 && failure.pRug > 0.45) {
      contradictionDetected = true;
      contradictionReason = 'HIGH_ALPHA_BUT_HIGH_RUG_RISK';
    } else if (params.pumpScore > 80 && params.organicScore < 0.2) {
      contradictionDetected = true;
      contradictionReason = 'HIGH_PUMP_SCORE_CONTRADICTS_LOW_ORGANIC_SCORE';
    } else if (alpha.pPlus25 > 0.7 && execution.executionViabilityScore < 30) {
      contradictionDetected = true;
      contradictionReason = 'THEORETICAL_EDGE_DESTROYED_BY_ILLIQUID_EXECUTION';
    }

    return {
      mint: params.mint,
      timestampMs: params.timestampMs,
      modelVersion: 'v2.4.0-decoupled-suite',
      alpha,
      failure,
      timing,
      execution,
      uncertainty,
      contradictionDetected,
      contradictionReason,
    };
  }
}
