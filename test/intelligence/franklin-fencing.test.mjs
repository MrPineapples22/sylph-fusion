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
});
