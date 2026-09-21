import { VaultLifecycleState } from '../vault/types.js';

export type LifecyclePhase = 'PHASE_1_NORMAL' | 'PHASE_2_PRESERVATION' | 'PHASE_3_HARVEST' | 'PHASE_4_SETTLEMENT_PREP';

export interface LifecyclePhaseConfig {
  phase1NormalEndSec: number;        // Default: 48 * 3600 = 172,800s (0-48h)
  phase2PreservationEndSec: number;  // Default: 60 * 3600 = 216,000s (48-60h)
  phase3HarvestEndSec: number;       // Default: 68 * 3600 = 244,800s (60-68h)
  phase4SettlementPrepEndSec: number;// Default: 72 * 3600 = 259,200s (68-72h)
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecyclePhaseConfig = {
  phase1NormalEndSec: 48 * 3600,
  phase2PreservationEndSec: 60 * 3600,
  phase3HarvestEndSec: 68 * 3600,
  phase4SettlementPrepEndSec: 72 * 3600,
};

export interface VaultCycleClock {
  cycleId: string;
  vaultId: string;
  authoritativeStartedAtMs: number;
  scheduledEndAtMs: number;
  totalCycleDurationSec: number;
  phaseConfig: LifecyclePhaseConfig;
}

export interface PhaseEvaluation {
  phase: LifecyclePhase;
  elapsedSec: number;
  remainingSec: number;
  allowNewEntries: boolean;
  maxHoldHorizonSec: number;
  exposureMultiplier: number; // e.g. 1.0 in Phase 1, 0.5 in Phase 2, 0.0 in Phase 3/4
  liquidityFloorMultiplier: number; // e.g. 1.0 in Phase 1, 1.5 in Phase 2, 2.5 in Phase 3
  reason: string;
}
