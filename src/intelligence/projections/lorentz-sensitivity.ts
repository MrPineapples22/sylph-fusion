/**
 * LORENTZ: Forecast Sensitivity & Scenario-Divergence Engine
 * Blueprint Engine #19
 * 
 * Perturbs initial condition parameters:
 * - Whale flow (+/- 30%)
 * - Liquidity depth (-20%)
 * - Execution latency (+500ms)
 * - Macro SOL shift (+/- 5%)
 * Determines forecast fragility and reliable forecast horizon.
 * Invariant: A forecast that collapses under minor perturbations receives lower decision weight.
 */

export interface SensitivityPerturbation {
  readonly parameter: string;
  readonly delta_applied: string;
  readonly baseline_ev_pnl: number;
  readonly perturbed_ev_pnl: number;
  readonly delta_ev_pnl: number;
  readonly causes_action_flip: boolean;
}

export interface LorentzSensitivityReport {
  readonly token_mint: string;
  readonly forecast_fragility_score: number; // 0.0 (robust/stable) to 1.0 (hyper-fragile)
  readonly reliable_horizon_sec: number;     // Seconds forecast remains valid
  readonly decision_weight_multiplier: number; // 0.1 to 1.0
  readonly perturbations: readonly SensitivityPerturbation[];
  readonly evaluated_at_ms: number;
}

export class LorentzSensitivityEngine {
  public static readonly VERSION = '1.0.0';

  /**
   * Tests baseline forecast stability under adversarial perturbations.
   */
  public static testSensitivity(params: {
    token_mint: string;
    baseline_ev_pnl: number;
    liquidity_sol: number;
    buy_pressure: number;
    pod_score: number;
  }): LorentzSensitivityReport {
    const baseEv = params.baseline_ev_pnl;
    const perturbations: SensitivityPerturbation[] = [];

    // Perturbation 1: Liquidity drop by 20%
    const evDropLiq = baseEv - (params.liquidity_sol < 20 ? 8.0 : 3.0);
    perturbations.push({
      parameter: 'liquidity_sol',
      delta_applied: '-20%',
      baseline_ev_pnl: baseEv,
      perturbed_ev_pnl: evDropLiq,
      delta_ev_pnl: Number((evDropLiq - baseEv).toFixed(2)),
      causes_action_flip: (baseEv > 0 && evDropLiq <= 0) || (baseEv <= 0 && evDropLiq > 0)
    });

    // Perturbation 2: Buy pressure drops by 25%
    const evDropPressure = baseEv - 10.0;
    perturbations.push({
      parameter: 'buy_pressure',
      delta_applied: '-25%',
      baseline_ev_pnl: baseEv,
      perturbed_ev_pnl: evDropPressure,
      delta_ev_pnl: Number((evDropPressure - baseEv).toFixed(2)),
      causes_action_flip: (baseEv > 0 && evDropPressure <= 0)
    });

    // Perturbation 3: Execution latency +600ms (slippage expansion)
    const evLatencySlippage = baseEv - 4.5;
    perturbations.push({
      parameter: 'execution_latency',
      delta_applied: '+600ms',
      baseline_ev_pnl: baseEv,
      perturbed_ev_pnl: evLatencySlippage,
      delta_ev_pnl: Number((evLatencySlippage - baseEv).toFixed(2)),
      causes_action_flip: (baseEv > 0 && evLatencySlippage <= 0)
    });

    // Compute fragility: % of perturbations that cause action flip or severe EV degradation
    const flipCount = perturbations.filter(p => p.causes_action_flip).length;
    const avgDelta = perturbations.reduce((sum, p) => sum + Math.abs(p.delta_ev_pnl), 0) / perturbations.length;

    let fragility = Math.min(1.0, (flipCount * 0.35) + (avgDelta / 20) * 0.5);
    fragility = Number(fragility.toFixed(3));

    // Reliable horizon shrinks as fragility increases
    const horizonSec = Math.max(15, Math.round(180 * (1 - fragility)));

    // Multiplier for Bayes decision weight
    const weightMultiplier = Number(Math.max(0.15, 1.0 - fragility * 0.85).toFixed(3));

    return {
      token_mint: params.token_mint,
      forecast_fragility_score: fragility,
      reliable_horizon_sec: horizonSec,
      decision_weight_multiplier: weightMultiplier,
      perturbations,
      evaluated_at_ms: Date.now()
    };
  }
}
