import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FranklinControlledExperimentationEngine
} from '../../dist/intelligence/experimentation/franklin-experiment.js';

describe('Franklin Controlled Experimentation Security & Anti-Replay Fencing', () => {
  it('rejects promotion evaluation when metrics contain NaN, Infinity, or out of range values', () => {
    const franklin = new FranklinControlledExperimentationEngine();
    const exp = franklin.registerExperiment({
      name: 'nan_slippage_test',
      hypothesis: 'Test that NaN cannot bypass safety',
      rollback_version: '1.0.0'
    });

    // 1. NaN in drawdown
    const resNaN = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 50,
      sharpe: 2.0,
      win_rate: 0.6,
      drawdown_pct: NaN,
      brier_score: 0.1
    });
    assert.equal(resNaN.promoted, false);
    assert.ok(resNaN.rejection_reason?.includes('Non-finite or NaN'));
    assert.ok(resNaN.certificate.certificate_id.startsWith('PROMO-CERT-'));

    // 2. Infinity in sharpe
    const resInf = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 50,
      sharpe: Infinity,
      win_rate: 0.6,
      drawdown_pct: 5.0,
      brier_score: 0.1
    });
    assert.equal(resInf.promoted, false);
    assert.ok(resInf.rejection_reason?.includes('Non-finite or NaN'));

    // 3. Out of bounds win_rate (> 1)
    const resWin = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 50,
      sharpe: 2.0,
      win_rate: 1.5,
      drawdown_pct: 5.0,
      brier_score: 0.1
    });
    assert.equal(resWin.promoted, false);
    assert.ok(resWin.rejection_reason?.includes('Win rate'));

    // 4. Negative drawdown
    const resNegDD = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 50,
      sharpe: 2.0,
      win_rate: 0.6,
      drawdown_pct: -5.0,
      brier_score: 0.1
    });
    assert.equal(resNegDD.promoted, false);
    assert.ok(resNegDD.rejection_reason?.includes('cannot be negative'));
  });

  it('rejects evidence root replay and issues tamper-resistant promotion certificate', () => {
    const franklin = new FranklinControlledExperimentationEngine();
    const exp = franklin.registerExperiment({
      name: 'replay_test_exp',
      hypothesis: 'Test that evidence root replay is strictly blocked',
      target_sample_size: 50,
      rollback_version: '1.0.0'
    });

    const fixedEvidenceRoot = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    // First promotion succeeds
    const promo1 = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 50,
      sharpe: 2.5,
      win_rate: 0.7,
      drawdown_pct: 4.0,
      brier_score: 0.08,
      evidence_root: fixedEvidenceRoot
    });

    assert.equal(promo1.promoted, true);
    assert.equal(promo1.next_stage, 'STAGE_2_OFFLINE');
    assert.ok(promo1.certificate);
    assert.equal(promo1.certificate.promoted, true);
    assert.equal(promo1.certificate.from_stage, 'STAGE_1_HYPOTHESIS');
    assert.equal(promo1.certificate.to_stage, 'STAGE_2_OFFLINE');
    assert.equal(promo1.certificate.evidence_root, fixedEvidenceRoot);

    // Second promotion attempting to reuse the same evidence root must fail closed
    const promoReplay = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 50,
      sharpe: 2.8,
      win_rate: 0.72,
      drawdown_pct: 3.5,
      brier_score: 0.07,
      evidence_root: fixedEvidenceRoot
    });

    assert.equal(promoReplay.promoted, false);
    assert.ok(promoReplay.rejection_reason?.includes('already consumed; stage replay rejected'));
    assert.equal(promoReplay.certificate.promoted, false);
  });

  it('proves promotion evidence lifecycle and automatic demotion on gap recovery supersession (REQ-029)', () => {
    const franklin = new FranklinControlledExperimentationEngine();
    const exp = franklin.registerExperiment({
      name: 'lifecycle_advancement_model',
      hypothesis: 'Prove multi-stage advancement and gap recovery reconciliation',
      target_sample_size: 100,
      rollback_version: 'v0.9.0'
    });

    // 1. Advance from STAGE_1_HYPOTHESIS -> STAGE_2_OFFLINE
    const root1 = 'evidence_root_stage1_to_stage2_0000000000000000000000000000000000000';
    const promo1 = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 30,
      sharpe: 2.2,
      win_rate: 0.65,
      drawdown_pct: 4.5,
      brier_score: 0.12,
      evidence_root: root1,
      slot_range: { start: 1000, end: 1100 }
    });
    assert.equal(promo1.promoted, true);
    assert.equal(promo1.next_stage, 'STAGE_2_OFFLINE');

    // 2. Advance from STAGE_2_OFFLINE -> STAGE_3_ATLAS_REPLAY
    const root2 = 'evidence_root_stage2_to_stage3_0000000000000000000000000000000000000';
    const promo2 = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 60,
      sharpe: 2.4,
      win_rate: 0.68,
      drawdown_pct: 3.8,
      brier_score: 0.10,
      evidence_root: root2,
      slot_range: { start: 1101, end: 1200 }
    });
    assert.equal(promo2.promoted, true);
    assert.equal(promo2.next_stage, 'STAGE_3_ATLAS_REPLAY');

    // Verify candidate is at STAGE_3_ATLAS_REPLAY
    const current = franklin.getExperiment(exp.experiment_id);
    assert.equal(current?.current_stage, 'STAGE_3_ATLAS_REPLAY');
    assert.equal(franklin.getExperimentEvidenceRoots(exp.experiment_id).length, 2);

    // 3. Process gap recovery certificate covering slot range 1050-1150 (overlaps root1 & root2)
    const recoveryResult = franklin.handleRecoveryCertificate({
      gapId: 'GAP-RECOVERY-001',
      startSlot: 1050,
      endSlot: 1150,
      supersededEvidenceRoots: [root2]
    });

    // Experiment must be demoted back to STAGE_2_OFFLINE
    assert.ok(recoveryResult.demotedExperiments.includes(exp.experiment_id));
    const demoted = franklin.getExperiment(exp.experiment_id);
    assert.equal(demoted?.current_stage, 'STAGE_2_OFFLINE');
    assert.equal(franklin.isEvidenceRootSuperseded(root2), true);

    // 4. Attempting to promote using superseded root fails closed
    const promoBlocked = franklin.evaluatePromotion(exp.experiment_id, {
      samples: 70,
      sharpe: 2.5,
      win_rate: 0.70,
      drawdown_pct: 3.0,
      brier_score: 0.08,
      evidence_root: root2
    });
    assert.equal(promoBlocked.promoted, false);
    assert.ok(promoBlocked.rejection_reason?.includes('superseded by historical gap reconciliation'));
  });
});
