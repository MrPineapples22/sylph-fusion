/**
 * SYLPH Goal Loop Health Monitor
 * 
 * Tracks the continuous operational goal loop stages:
 *   INGESTION → FRESHNESS → EVALUATION → RECONCILIATION → RENDER
 * 
 * Each stage records its last-fired timestamp. The monitor reports
 * unhealthy status when any stage exceeds its expected cadence.
 */

const STAGES = ['INGESTION', 'FRESHNESS', 'EVALUATION', 'RECONCILIATION', 'RENDER'];

const DEFAULT_CADENCE_MS = {
  INGESTION: 2000,
  FRESHNESS: 5000,
  EVALUATION: 3000,
  RECONCILIATION: 5000,
  RENDER: 2000,
};

export class GoalLoopMonitor {
  /** @type {Map<string, number>} */
  #timestamps = new Map();
  /** @type {Map<string, number>} */
  #cadences = new Map();
  #healthCheckIntervalMs;
  #lastHealthCheck = 0;
  #consecutiveHealthyChecks = 0;
  #consecutiveUnhealthyChecks = 0;

  /**
   * @param {Object} [options]
   * @param {number} [options.healthCheckIntervalMs=1000] How often isHealthy() should be considered a fresh check.
   * @param {Object} [options.cadences] Override per-stage cadence thresholds in ms.
   */
  constructor(options = {}) {
    this.#healthCheckIntervalMs = options.healthCheckIntervalMs ?? 1000;
    for (const stage of STAGES) {
      this.#cadences.set(stage, options.cadences?.[stage] ?? DEFAULT_CADENCE_MS[stage]);
    }
  }

  /**
   * Record that a goal loop stage has fired.
   * @param {string} stage One of INGESTION, FRESHNESS, EVALUATION, RECONCILIATION, RENDER.
   * @param {number} [now] Optional timestamp override for testing.
   */
  recordStage(stage, now) {
    if (!STAGES.includes(stage)) return;
    this.#timestamps.set(stage, now ?? Date.now());
  }

  /**
   * Returns per-stage health status.
   * @param {number} [now] Optional timestamp for testing.
   * @returns {{ stages: Object[], healthy: boolean, lastCheckMs: number, consecutiveHealthy: number, consecutiveUnhealthy: number }}
   */
  getHealth(now) {
    const t = now ?? Date.now();
    const stages = STAGES.map(stage => {
      const lastFired = this.#timestamps.get(stage);
      const cadence = this.#cadences.get(stage);
      const ageMs = lastFired != null ? t - lastFired : null;
      const fresh = ageMs != null && ageMs <= cadence;
      return {
        stage,
        lastFiredMs: lastFired ?? null,
        ageMs,
        cadenceMs: cadence,
        fresh,
      };
    });
    const healthy = stages.every(s => s.fresh);
    if (healthy) {
      this.#consecutiveHealthyChecks++;
      this.#consecutiveUnhealthyChecks = 0;
    } else {
      this.#consecutiveUnhealthyChecks++;
      this.#consecutiveHealthyChecks = 0;
    }
    this.#lastHealthCheck = t;
    return {
      stages,
      healthy,
      lastCheckMs: t,
      consecutiveHealthy: this.#consecutiveHealthyChecks,
      consecutiveUnhealthy: this.#consecutiveUnhealthyChecks,
    };
  }

  /**
   * Quick boolean health check.
   * @param {number} [now] Optional timestamp for testing.
   * @returns {boolean}
   */
  isHealthy(now) {
    return this.getHealth(now).healthy;
  }

  /**
   * Returns the expected health check interval.
   * @returns {number}
   */
  get healthCheckIntervalMs() {
    return this.#healthCheckIntervalMs;
  }

  /**
   * Returns the list of monitored stages.
   * @returns {string[]}
   */
  static get STAGES() {
    return [...STAGES];
  }
}

/** Singleton instance for the terminal process. */
export const globalGoalLoopMonitor = new GoalLoopMonitor();
