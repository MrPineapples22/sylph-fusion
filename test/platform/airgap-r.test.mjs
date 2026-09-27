import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AirgapRAuthority,
  AirgapSecurityViolationError
} from '../../dist/platform/security/airgap-r.js';

describe('AIRGAP-R: Hard Research / Production Authority Separation (Upgrade 9)', () => {
  it('strictly forbids research and AI models from signing or reserving capital', () => {
    // 1. Research can generate advisory signals and train models
    assert.doesNotThrow(() => {
      AirgapRAuthority.assertAuthority('SYLPH_RESEARCH', 'GENERATE_ADVISORY_SIGNAL');
      AirgapRAuthority.assertAuthority('SYLPH_RESEARCH', 'TRAIN_OFFLINE_MODEL');
    });

    // 2. Research CANNOT sign transactions
    assert.throws(
      () => AirgapRAuthority.assertAuthority('SYLPH_RESEARCH', 'SIGN_TRANSACTION_KMS'),
      AirgapSecurityViolationError,
      'Research domain cannot sign transactions'
    );

    // 3. AI runtime CANNOT reserve capital
    assert.throws(
      () => AirgapRAuthority.assertAuthority('SYLPH_INTELLIGENCE_RUNTIME', 'RESERVE_CAPITAL'),
      AirgapSecurityViolationError,
      'AI runtime cannot reserve capital'
    );

    // 4. Execution authority CANNOT settle deltas (settlement separation)
    assert.throws(
      () => AirgapRAuthority.assertAuthority('SYLPH_EXECUTION_AUTHORITY', 'SETTLE_DELTAS'),
      AirgapSecurityViolationError,
      'Execution authority cannot settle deltas'
    );
  });

  it('enforces canonical pipeline integrity and blocks AI execution bypasses', () => {
    // Valid canonical sequence
    const validPipeline = [
      'SYLPH_INTELLIGENCE_RUNTIME',
      'SYLPH_CAPITAL_AUTHORITY',
      'SYLPH_EXECUTION_AUTHORITY',
      'SYLPH_SIGNER',
      'SYLPH_SETTLEMENT'
    ];
    assert.equal(AirgapRAuthority.assertPipelineIntegrity(validPipeline), true);

    // Corrupted sequence: AI runtime jumps directly to Signer bypassing Capital Authority
    const bypassedPipeline = [
      'SYLPH_INTELLIGENCE_RUNTIME',
      'SYLPH_SIGNER',
      'SYLPH_SETTLEMENT'
    ];
    assert.throws(
      () => AirgapRAuthority.assertPipelineIntegrity(bypassedPipeline),
      /PIPELINE_INTEGRITY_BREACH/
    );
  });
});
