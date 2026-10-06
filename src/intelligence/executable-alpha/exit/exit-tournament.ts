/**
 * SYLPH FUSION — EXIT POLICY TOURNAMENT ENGINE
 * Section XXI & LI: Counterfactual Exit Tournament
 *
 * Runs competing exit policies in parallel against the exact same market path:
 * 1 authoritative policy + N shadow policies.
 *
 * Competing policies:
 * - legacy-ladder-shadow
 * - early-risk-reduction
 * - principal-recovery-2x, 3x, 5x, 10x
 * - structural-runner
 * - committor-runner
 * - liquidity-runner
 * - dynamic-stopping
 * - emergency-liquidation
 *
 * Generates canonical ExitAttemptRecord for persistent audit.
 */

import { createHash } from 'node:crypto';
import type {
  ExitAttemptRecord,
  ExitProposal,
  LiquidationSurface,
} from '../types.js';
import type { ExitPolicy, PositionState, ResearchExitContext } from './exit-policy-interface.js';
import { PrincipalRecoveryEngine } from './principal-recovery.js';
import { DynamicStoppingEngine } from './dynamic-stopping.js';

export class ExitPolicyTournament {
  private readonly policies: Map<string, ExitPolicy> = new Map();
  private authoritativePolicyId: string;

  constructor(authoritativePolicyId = 'dynamic-stopping') {
    this.authoritativePolicyId = authoritativePolicyId;
    this.registerStandardPolicies();
  }

  private registerStandardPolicies(): void {
    // 1. Dynamic Stopping (current default authoritative)
    this.policies.set('dynamic-stopping', new DynamicStoppingEngine());

    // 2. Legacy ladder shadow (1.12x, 1.25x, 1.50x, 2.00x)
    this.policies.set('legacy-ladder-shadow', {
      policyId: 'legacy-ladder-shadow',
      evaluate(pos, research, liq): ExitProposal {
        if (pos.currentMultiple >= 2.0) {
          return {
            policyId: 'legacy-ladder-shadow',
            action: 'FULL_LIQUIDATION',
            targetFraction: 1.0,
            expectedProceedsUsd: liq.currentMarkUsd,
            expectedImpactBps: 1000,
            urgency: 'NORMAL',
            rationale: 'Legacy ladder 2.00x final target reached',
          };
        }
        if (pos.currentMultiple >= 1.5) {
          return {
            policyId: 'legacy-ladder-shadow',
            action: 'PARTIAL_REDUCE',
            targetFraction: 0.33,
            expectedProceedsUsd: liq.currentMarkUsd * 0.33,
            expectedImpactBps: 500,
            urgency: 'NORMAL',
            rationale: 'Legacy ladder 1.50x rung',
          };
        }
        return {
          policyId: 'legacy-ladder-shadow',
          action: 'HOLD',
          targetFraction: 0,
          expectedProceedsUsd: 0,
          expectedImpactBps: 0,
          urgency: 'LOW',
          rationale: 'Below legacy ladder rungs',
        };
      },
    });

    // 3. Early Risk Reduction
    this.policies.set('early-risk-reduction', {
      policyId: 'early-risk-reduction',
      evaluate(pos, research, liq): ExitProposal {
        if (pos.currentMultiple >= 1.30) {
          return {
            policyId: 'early-risk-reduction',
            action: 'PARTIAL_REDUCE',
            targetFraction: 0.40,
            expectedProceedsUsd: liq.currentMarkUsd * 0.40,
            expectedImpactBps: 400,
            urgency: 'NORMAL',
            rationale: 'Early risk reduction at 1.30x threshold',
          };
        }
        return {
          policyId: 'early-risk-reduction',
          action: 'HOLD',
          targetFraction: 0,
          expectedProceedsUsd: 0,
          expectedImpactBps: 0,
          urgency: 'LOW',
          rationale: 'Waiting for 1.30x',
        };
      },
    });

    // 4. Principal recovery variants
    this.policies.set('principal-recovery-2x', PrincipalRecoveryEngine.createPolicy(2.0));
    this.policies.set('principal-recovery-3x', PrincipalRecoveryEngine.createPolicy(3.0));
    this.policies.set('principal-recovery-5x', PrincipalRecoveryEngine.createPolicy(5.0));
    this.policies.set('principal-recovery-10x', PrincipalRecoveryEngine.createPolicy(10.0));

    // 5. Committor runner
    this.policies.set('committor-runner', {
      policyId: 'committor-runner',
      evaluate(pos, research, liq): ExitProposal {
        if (research.qFail > 0.50) {
          return {
            policyId: 'committor-runner',
            action: 'FULL_LIQUIDATION',
            targetFraction: 1.0,
            expectedProceedsUsd: liq.stressedExitCapacityUsd,
            expectedImpactBps: 1500,
            urgency: 'HIGH',
            rationale: `Committor failure risk elevated: qFail=${research.qFail.toFixed(2)}`,
          };
        }
        return {
          policyId: 'committor-runner',
          action: 'HOLD',
          targetFraction: 0,
          expectedProceedsUsd: 0,
          expectedImpactBps: 0,
          urgency: 'LOW',
          rationale: 'Runner committor favorable',
        };
      },
    });

    // 6. Liquidity runner
    this.policies.set('liquidity-runner', {
      policyId: 'liquidity-runner',
      evaluate(pos, research, liq): ExitProposal {
        if (liq.stressedExitCapacityUsd < pos.principalInvestedUsd * 0.75) {
          return {
            policyId: 'liquidity-runner',
            action: 'FULL_LIQUIDATION',
            targetFraction: 1.0,
            expectedProceedsUsd: liq.stressedExitCapacityUsd,
            expectedImpactBps: 2000,
            urgency: 'HIGH',
            rationale: 'Liquidity depth breached exit capacity floor',
          };
        }
        return {
          policyId: 'liquidity-runner',
          action: 'HOLD',
          targetFraction: 0,
          expectedProceedsUsd: 0,
          expectedImpactBps: 0,
          urgency: 'LOW',
          rationale: 'Liquidity depth sufficient',
        };
      },
    });

    // 7. Emergency liquidation
    this.policies.set('emergency-liquidation', {
      policyId: 'emergency-liquidation',
      evaluate(pos, research, liq): ExitProposal {
        if (research.isEmergencyStopTriggered || research.creatorDumpRisk) {
          return {
            policyId: 'emergency-liquidation',
            action: 'EMERGENCY_DUMP',
            targetFraction: 1.0,
            expectedProceedsUsd: liq.stressedExitCapacityUsd,
            expectedImpactBps: 3000,
            urgency: 'EMERGENCY',
            rationale: 'Emergency liquidation triggered',
          };
        }
        return {
          policyId: 'emergency-liquidation',
          action: 'HOLD',
          targetFraction: 0,
          expectedProceedsUsd: 0,
          expectedImpactBps: 0,
          urgency: 'LOW',
          rationale: 'No emergency',
        };
      },
    });
  }

  public setAuthoritativePolicy(policyId: string): void {
    if (!this.policies.has(policyId)) {
      throw new Error(`Policy ${policyId} is not registered in tournament`);
    }
    this.authoritativePolicyId = policyId;
  }

  public evaluateTournament(params: {
    position: PositionState;
    research: ResearchExitContext;
    liquidation: LiquidationSurface;
    slot: bigint;
    decisionAtMs?: number;
    evidenceRoot: string;
    stateRoot: string;
    previousRecordHash?: string;
  }): ExitAttemptRecord {
    const {
      position,
      research,
      liquidation,
      slot,
      decisionAtMs = Date.now(),
      evidenceRoot,
      stateRoot,
      previousRecordHash,
    } = params;

    const authPolicy = this.policies.get(this.authoritativePolicyId)!;
    const authoritativeAction = authPolicy.evaluate(position, research, liquidation);

    const shadowActions: ExitProposal[] = [];
    for (const [id, policy] of this.policies.entries()) {
      if (id !== this.authoritativePolicyId) {
        shadowActions.push(policy.evaluate(position, research, liquidation));
      }
    }

    const attemptId = `exit-${position.positionId}-${slot}`;
    const recordPayload = [
      attemptId,
      position.positionId,
      position.mint,
      this.authoritativePolicyId,
      authoritativeAction.action,
      authoritativeAction.targetFraction.toFixed(4),
      liquidation.currentMarkUsd.toFixed(4),
      slot.toString(),
      decisionAtMs.toString(),
      previousRecordHash || 'GENESIS',
    ].join('::');

    const recordHash = createHash('sha256').update(recordPayload).digest('hex');

    return {
      attemptId,
      positionId: position.positionId,
      mint: position.mint,
      evidenceRoot,
      stateRoot,
      authoritativePolicyId: this.authoritativePolicyId,
      authoritativeAction,
      shadowActions,
      executablePositionValueUsd: liquidation.currentMarkUsd,
      stressedExitCapacityUsd: liquidation.stressedExitCapacityUsd,
      decisionAt: decisionAtMs,
      slot,
      runnerState: position.runnerState,
      previousRecordHash,
      recordHash,
    };
  }
}
