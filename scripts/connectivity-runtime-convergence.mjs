/**
 * SYLPH FUSION — RUNTIME CONVERGENCE ENGINE (STEP 6)
 * Specifications: Blueprint Sections 8, 9, 10, 11, 32
 *
 * Responsibilities:
 * 1. Strict sequential evaluation from C4 to C10:
 *    - Start at C4 (Static Integration)
 *    - Verify C5 (Observed Runtime): if fail -> STOP at C4
 *    - Verify C6 (Cryptographic Continuity): if fail -> STOP at C5
 *    - Verify C7 (Authoritative Effect): if fail -> STOP at C6
 *    - Verify C8 (Deterministic Replay): if fail -> STOP at C7
 *    - Verify C9 (Fault Containment): if fail -> STOP at C8
 *    - Verify C10 (Real Mandatory Canary): if fail -> STOP at C9
 * 2. Never jumps a failed level.
 * 3. Enforces Dual-Mode verification:
 *    - `--mode test`: Can evaluate test fixtures and synthetic evidence for negative-controls.
 *    - `--mode certify`: Strictly rejects SYNTHETIC, TEST_FIXTURE, and UNKNOWN. Requires physical evidence.
 * 4. Emits detailed Convergence Report with highestProvenLevel, explicit award/denial reasons, and convergenceRoot.
 * 5. Saves report to artifacts/connectivity/RUNTIME_CONVERGENCE_REPORT.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJsonV10,
  hashCanonicalV10,
  EMPTY_SHA256_HEX,
} from './canonicalization-v10.mjs';
import { verifyCanaryCampaign } from './canary-campaign-verifier.mjs';
import { loadRuntimeTelemetryEvidence } from './runtime-telemetry-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT_DIR, 'artifacts', 'connectivity');
const SCORECARD_PATH = resolve(ARTIFACTS_DIR, 'c0-c10-scorecard.json');
const OUTPUT_PATH = resolve(ARTIFACTS_DIR, 'RUNTIME_CONVERGENCE_REPORT.json');

const CERTIFY_ELIGIBLE = new Set([
  'REAL_RUNTIME',
  'REAL_REPLAY',
  'REAL_FAULT_INJECTION',
  'REAL_CANARY',
]);

/**
 * Runs sequential convergence evaluation from C4 up to C10.
 * @param {object} [evidenceBundle={}] Optional candidate runtime evidence
 * @param {object} [options={}]
 * @param {'test' | 'certify'} [options.mode='test']
 * @returns {object} Convergence evaluation report
 */
export function evaluateRuntimeConvergence(evidenceBundle = {}, options = {}) {
  const mode = options.mode ?? (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'test');
  if (mode !== 'test' && mode !== 'certify') {
    throw new Error(`INVALID_MODE: Mode must be 'test' or 'certify', received '${mode}'`);
  }

  // 1. Verify C0–C4 baseline
  let staticScorecard = null;
  if (existsSync(SCORECARD_PATH)) {
    staticScorecard = JSON.parse(readFileSync(SCORECARD_PATH, 'utf8'));
  }

  const baselineLevel = options.baselineLevel ?? staticScorecard?.systemScore?.highestProvenLevel ?? 'C0';
  const baselinePass = baselineLevel === 'C4';

  const ladder = {
    C0: { awarded: true, reason: 'Source components exist.' },
    C1: { awarded: ['C1', 'C2', 'C3', 'C4'].includes(baselineLevel), reason: 'TypeScript compilation passed cleanly.' },
    C2: { awarded: ['C2', 'C3', 'C4'].includes(baselineLevel), reason: 'Unit test suite passed.' },
    C3: { awarded: ['C3', 'C4'].includes(baselineLevel), reason: 'Structural producer/consumer connections declared.' },
    C4: { awarded: baselinePass, reason: baselinePass ? 'AST TypeChecker static integration validated.' : 'UNPROVEN: Static C4 integration not yet fully achieved.' },
    C5: { awarded: false, reason: 'UNPROVEN: Awaiting eligible runtime telemetry.' },
    C6: { awarded: false, reason: 'UNPROVEN: Awaiting cryptographic hash continuity.' },
    C7: { awarded: false, reason: 'UNPROVEN: Awaiting authoritative downstream effect.' },
    C8: { awarded: false, reason: 'UNPROVEN: Awaiting deterministic replay evidence.' },
    C9: { awarded: false, reason: 'UNPROVEN: Awaiting controlled fault containment evidence.' },
    C10: { awarded: false, reason: 'UNPROVEN: Awaiting complete mandatory canary campaign.' },
  };

  let highestProvenLevel = baselineLevel;
  let stopReason = '';
  let runtimeTelemetryRoot = null;

  if (!baselinePass) {
    stopReason = `C4_GATE_HALT: Static scorecard level is '${baselineLevel}'. C4 static integration is required before C5-C10 can be evaluated.`;
  }

  // Helper to validate provenance against mode
  function isProvenanceEligible(provenance) {
    if (mode === 'test') {
      return Boolean(provenance);
    }
    return CERTIFY_ELIGIBLE.has(provenance);
  }

  // === Sequential Evaluation ===
  if (baselinePass) {
    // LEVEL C5: OBSERVED RUNTIME
    const loadedC5 = mode === 'certify' ? loadRuntimeTelemetryEvidence() : null;
    const c5Evidence = mode === 'certify' ? loadedC5?.evidence : evidenceBundle.runtimeTelemetry;
    if (!c5Evidence || !c5Evidence.spans || c5Evidence.spans.length === 0) {
      stopReason = mode === 'certify'
        ? `C5_HALT: ${loadedC5?.reason ?? 'C5_DURABLE_RUNTIME_EVIDENCE_MISSING'}. Static evidence ceiling is C4.`
        : 'C5_HALT: No eligible runtime telemetry spans provided. Static evidence ceiling is C4.';
      ladder.C5.reason = stopReason;
    } else if (mode === 'certify' && !loadedC5?.valid) {
      stopReason = `C5_HALT: ${loadedC5?.reason ?? 'C5_DURABLE_RUNTIME_EVIDENCE_INVALID'}.`;
      ladder.C5.reason = stopReason;
    } else if (mode !== 'certify' && !isProvenanceEligible(c5Evidence.provenanceClass)) {
      stopReason = `C5_HALT: Ineligible runtime telemetry provenance '${c5Evidence.provenanceClass}' in ${mode} mode.`;
      ladder.C5.reason = stopReason;
    } else {
      ladder.C5.awarded = true;
      ladder.C5.reason = `Physical runtime telemetry observed with ${c5Evidence.spans.length} spans. Provenance: ${c5Evidence.provenanceClass}.`;
      highestProvenLevel = 'C5';
      runtimeTelemetryRoot = mode === 'certify' ? loadedC5.evidenceHash : null;

    // LEVEL C6: CRYPTOGRAPHIC CONTINUITY
    const c6Evidence = evidenceBundle.artifactContinuity;
    if (!c6Evidence || !Array.isArray(c6Evidence.pairs) || c6Evidence.pairs.length === 0) {
      stopReason = 'C6_HALT: Missing artifact continuity evidence pairs.';
      ladder.C6.reason = stopReason;
    } else {
      let c6Passed = true;
      for (const pair of c6Evidence.pairs) {
        if (!pair.outputHash || !pair.inputHash || pair.outputHash !== pair.inputHash) {
          stopReason = `C6_HALT: Hash continuity break between ${pair.producer} and ${pair.consumer}: output (${pair.outputHash}) != input (${pair.inputHash}).`;
          ladder.C6.reason = stopReason;
          c6Passed = false;
          break;
        }
      }
      if (c6Passed) {
        ladder.C6.awarded = true;
        ladder.C6.reason = `Cryptographic continuity proven across ${c6Evidence.pairs.length} artifact transitions.`;
        highestProvenLevel = 'C6';

        // LEVEL C7: AUTHORITATIVE EFFECT
        const c7Evidence = evidenceBundle.authoritativeEffect;
        if (!c7Evidence) {
          stopReason = 'C7_HALT: Missing authoritative effect evidence.';
          ladder.C7.reason = stopReason;
        } else if (
          !c7Evidence.stateRootBefore ||
          !c7Evidence.stateRootAfter ||
          c7Evidence.stateRootBefore === c7Evidence.stateRootAfter ||
          !c7Evidence.journalRecordHash
        ) {
          stopReason = 'C7_HALT: Execution failed to demonstrate authoritative state transition or journal evidence.';
          ladder.C7.reason = stopReason;
        } else {
          ladder.C7.awarded = true;
          ladder.C7.reason = `Authoritative downstream effect verified: state transition ${c7Evidence.stateRootBefore.slice(0, 8)}... -> ${c7Evidence.stateRootAfter.slice(0, 8)}... committed to journal.`;
          highestProvenLevel = 'C7';

          // LEVEL C8: DETERMINISTIC REPLAY
          const c8Evidence = evidenceBundle.deterministicReplay;
          if (!c8Evidence) {
            stopReason = 'C8_HALT: Missing deterministic replay evidence.';
            ladder.C8.reason = stopReason;
          } else if (c8Evidence.originalRoot !== c8Evidence.replayedRoot) {
            stopReason = `C8_HALT: Replay divergence detected: original (${c8Evidence.originalRoot}) != replayed (${c8Evidence.replayedRoot}).`;
            ladder.C8.reason = stopReason;
          } else {
            ladder.C8.awarded = true;
            ladder.C8.reason = `Deterministic replay verified: identical roots reproduced under bound commit and KnowledgeCut.`;
            highestProvenLevel = 'C8';

            // LEVEL C9: FAULT CONTAINMENT
            const c9Evidence = evidenceBundle.faultContainment;
            if (!c9Evidence || !Array.isArray(c9Evidence.faults) || c9Evidence.faults.length === 0) {
              stopReason = 'C9_HALT: Missing fault injection containment evidence.';
              ladder.C9.reason = stopReason;
            } else {
              let c9Passed = true;
              for (const f of c9Evidence.faults) {
                if (!f.failClosedObserved || f.escapedContainment) {
                  stopReason = `C9_HALT: Fault '${f.faultType}' escaped containment without fail-closed termination.`;
                  ladder.C9.reason = stopReason;
                  c9Passed = false;
                  break;
                }
              }
              if (c9Passed) {
                ladder.C9.awarded = true;
                ladder.C9.reason = `Controlled fault containment verified across ${c9Evidence.faults.length} injected fault scenarios.`;
                highestProvenLevel = 'C9';

                // LEVEL C10: REAL MANDATORY CANARY
                const c10Evidence = evidenceBundle.canaryCampaign;
                if (!c10Evidence) {
                  stopReason = 'C10_HALT: Missing complete canary campaign evidence.';
                  ladder.C10.reason = stopReason;
                } else {
                  try {
                    const canaryResult = verifyCanaryCampaign(c10Evidence, { mode });
                    ladder.C10.awarded = true;
                    ladder.C10.reason = `Complete mandatory canary campaign verified across ${canaryResult.edgesVerified} edges. Provenance: ${canaryResult.provenanceClass}.`;
                    highestProvenLevel = 'C10';
                  } catch (err) {
                    stopReason = `C10_HALT: Canary verifier rejected candidate: ${err.message}`;
                    ladder.C10.reason = stopReason;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  }

  const certifiedPayload = {
    mode,
    highestProvenLevel,
    runtimeTelemetryRoot,
    evaluatedAt: new Date().toISOString(),
    ladder,
    stopReason: stopReason || 'ALL_LEVELS_PASSED',
    isFullyCertified: highestProvenLevel === 'C10' && mode === 'certify',
  };

  const convergenceRoot = hashCanonicalV10(certifiedPayload);

  const report = {
    schemaVersion: '1.0.0',
    convergenceRoot,
    certifiedPayload,
  };

  writeFileSync(OUTPUT_PATH, canonicalJsonV10(report), 'utf8');

  console.log(`[CONVERGENCE_ENGINE] Evaluation Completed in '${mode}' mode:`);
  console.log(` - Highest Proven Level: ${highestProvenLevel}`);
  console.log(` - Stop / Boundary Reason: ${stopReason || 'C10 achieved'}`);
  console.log(` - Convergence Root: ${convergenceRoot}`);

  return report;
}

if (process.argv[1] && process.argv[1].includes('connectivity-runtime-convergence.mjs')) {
  try {
    const report = evaluateRuntimeConvergence();
    process.exit(0);
  } catch (err) {
    console.error('[CONVERGENCE_ENGINE] Evaluation failed:', err);
    process.exit(1);
  }
}
