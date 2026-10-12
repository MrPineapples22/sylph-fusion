import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapitalKernel,
  CryptographicRecoveryVerifier,
  getAuthorityRank,
} from '../../dist/intelligence/capital/capital-kernel.js';

test('REQ-011: CapitalKernel Proof-Backed RecoveryCertificate & Authority Reconstitution', async (t) => {
  await t.test('1. Unverified caller-asserted recovery certificate fails closed without verifier', () => {
    const kernel = new CapitalKernel({
      maxOpenPositions: 3,
      maxUnknownCapitalSol: 5.0,
      initialAuthority: 'A5_NORMAL',
    });
    kernel.downgradeAuthority('A2_REDUCE_ONLY', 'Emergency circuit trip');
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

    const callerCert = {
      recovery_id: 'rec_caller_unverified',
      cause: 'Self-asserted recovery',
      previous_authority: 'A2_REDUCE_ONLY',
      target_authority: 'A5_NORMAL',
      capital_state_root: 'capital_root_valid_12345678',
      position_reconciliation_hash: 'recon_hash_987654321',
      provider_status: 'HEALTHY',
      market_freshness_ms: 50,
      revocation_epoch: 1,
      control_epoch: 1,
      signer_state: 'READY',
      settlement_state: 'CLEAN',
      timestamp_ms: Date.now(),
      evidence_hashes: ['evidence_hash_1', 'evidence_hash_2'],
      verification_result: true,
    };

    const restored = kernel.restoreAuthorityWithCertificate(callerCert);
    assert.equal(restored, false, 'Caller-asserted certificate must fail closed without verifier');
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

    // Overloaded restoreAuthority must also fail closed
    assert.equal(kernel.restoreAuthority(callerCert), false);
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');
  });

  await t.test('2. Tampered, forged, or missing cryptographic proof fails closed', () => {
    const verifier = new CryptographicRecoveryVerifier({
      secretKey: 'authorized-institution-secret-key-42',
      authorizedIssuer: 'astra-risk-audit',
    });

    const kernel = new CapitalKernel({
      initialAuthority: 'A2_REDUCE_ONLY',
      recoveryVerifier: verifier,
    });

    const certTemplate = {
      recovery_id: 'rec_forged_proof_test',
      cause: 'Quorum partition resolved',
      previous_authority: 'A2_REDUCE_ONLY',
      target_authority: 'A4_LIMITED_INCREASE',
      capital_state_root: 'valid_capital_root_hash_001',
      position_reconciliation_hash: 'recon_hash_verified_001',
      provider_status: 'HEALTHY',
      market_freshness_ms: 120,
      revocation_epoch: 2,
      control_epoch: 2,
      signer_state: 'READY',
      settlement_state: 'CLEAN',
      timestamp_ms: Date.now(),
      evidence_hashes: ['prov_audit_01', 'prov_audit_02'],
      verification_result: true,
    };

    // Missing proof
    assert.equal(kernel.restoreAuthorityWithCertificate(certTemplate), false);
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

    // Forged proof
    assert.equal(kernel.restoreAuthorityWithCertificate(certTemplate, 'bad_hex_signature_deadbeef'), false);
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

    // Tampered field after valid signing
    const signed = verifier.sign(certTemplate);
    const tampered = { ...signed.certificate, capital_state_root: 'tampered_state_root_evil' };
    assert.equal(kernel.restoreAuthorityWithCertificate(tampered, signed.proof), false);
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');
  });

  await t.test('3. Verification rules reject degraded state even with valid signature', () => {
    const verifier = new CryptographicRecoveryVerifier();
    const kernel = new CapitalKernel({
      initialAuthority: 'A2_REDUCE_ONLY',
      recoveryVerifier: verifier,
    });

    const createAndSign = (overrides) => {
      const base = {
        recovery_id: 'rec_rule_test',
        cause: 'Test rule validation',
        previous_authority: 'A2_REDUCE_ONLY',
        target_authority: 'A4_LIMITED_INCREASE',
        capital_state_root: 'capital_state_root_12345678',
        position_reconciliation_hash: 'recon_hash_12345678',
        provider_status: 'HEALTHY',
        market_freshness_ms: 100,
        revocation_epoch: 1,
        control_epoch: 1,
        signer_state: 'READY',
        settlement_state: 'CLEAN',
        timestamp_ms: Date.now(),
        evidence_hashes: ['hash_1'],
        verification_result: true,
        ...overrides,
      };
      return verifier.sign(base);
    };

    // Unhealthy provider
    const badProvider = createAndSign({ provider_status: 'DEGRADED' });
    assert.equal(kernel.restoreAuthorityWithCertificate(badProvider.certificate, badProvider.proof), false);

    // Unclean settlement
    const uncleanSettlement = createAndSign({ settlement_state: 'UNCLEAN' });
    assert.equal(kernel.restoreAuthorityWithCertificate(uncleanSettlement.certificate, uncleanSettlement.proof), false);

    // Unavailable signer
    const unavailableSigner = createAndSign({ signer_state: 'UNAVAILABLE' });
    assert.equal(kernel.restoreAuthorityWithCertificate(unavailableSigner.certificate, unavailableSigner.proof), false);

    // Stale market data (> 30s)
    const staleMarket = createAndSign({ market_freshness_ms: 35_000 });
    assert.equal(kernel.restoreAuthorityWithCertificate(staleMarket.certificate, staleMarket.proof), false);

    // Short / malformed capital state root (< 16 chars)
    const shortRoot = createAndSign({ capital_state_root: 'too_short' });
    assert.equal(kernel.restoreAuthorityWithCertificate(shortRoot.certificate, shortRoot.proof), false);

    // Non-monotonic target authority (equal or downgrade)
    const nonMonotonic = createAndSign({ target_authority: 'A1_CANCEL_ONLY' });
    assert.equal(kernel.restoreAuthorityWithCertificate(nonMonotonic.certificate, nonMonotonic.proof), false);

    // Mismatched previous authority
    const wrongPrev = createAndSign({ previous_authority: 'A0_OBSERVE_ONLY' });
    assert.equal(kernel.restoreAuthorityWithCertificate(wrongPrev.certificate, wrongPrev.proof), false);

    // Empty evidence hashes
    const emptyHashes = createAndSign({ evidence_hashes: [] });
    assert.equal(kernel.restoreAuthorityWithCertificate(emptyHashes.certificate, emptyHashes.proof), false);

    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');
  });

  await t.test('4. Cryptographically signed RecoveryCertificate restores authority sequentially', () => {
    const verifier = new CryptographicRecoveryVerifier({
      secretKey: 'institution-level-master-recovery-seed',
      authorizedIssuer: 'astra-verification-authority',
    });

    const kernel = new CapitalKernel({
      initialAuthority: 'A2_REDUCE_ONLY',
      recoveryVerifier: verifier,
    });
    assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

    // Step 1: Promote A2_REDUCE_ONLY -> A4_LIMITED_INCREASE
    const certStep1 = {
      recovery_id: 'rec_provenance_step_1',
      cause: 'RPC network healed & state verified',
      previous_authority: 'A2_REDUCE_ONLY',
      target_authority: 'A4_LIMITED_INCREASE',
      capital_state_root: '0x4f128ab83719c89012389abcdef12345',
      position_reconciliation_hash: 'recon_state_root_hash_alpha_99',
      provider_status: 'HEALTHY',
      market_freshness_ms: 250,
      revocation_epoch: 4,
      control_epoch: 4,
      signer_state: 'READY',
      settlement_state: 'CLEAN',
      timestamp_ms: Date.now(),
      evidence_hashes: ['census_hash_01', 'galileo_recon_02', 'double_entry_03'],
      verification_result: true,
    };

    const signedStep1 = verifier.sign(certStep1);
    const restoredStep1 = kernel.restoreAuthorityWithCertificate(signedStep1.certificate, signedStep1.proof);
    assert.equal(restoredStep1, true, 'Cryptographically verified certificate must restore authority');
    assert.equal(kernel.getAuthorityMode(), 'A4_LIMITED_INCREASE');

    // Step 2: Promote A4_LIMITED_INCREASE -> A5_NORMAL via restoreAuthority overload
    const certStep2 = {
      recovery_id: 'rec_provenance_step_2',
      cause: 'Post-restoration soak test clean and zero defects',
      previous_authority: 'A4_LIMITED_INCREASE',
      target_authority: 'A5_NORMAL',
      capital_state_root: '0x7e88231940bc27814a0912beefca9981',
      position_reconciliation_hash: 'recon_state_root_hash_beta_100',
      provider_status: 'HEALTHY',
      market_freshness_ms: 80,
      revocation_epoch: 5,
      control_epoch: 5,
      signer_state: 'READY',
      settlement_state: 'CLEAN',
      timestamp_ms: Date.now(),
      evidence_hashes: ['census_hash_04', 'soak_pass_evidence_05'],
      verification_result: true,
    };

    const signedStep2 = verifier.sign(certStep2);
    const restoredStep2 = kernel.restoreAuthority(signedStep2.certificate, signedStep2.proof);
    assert.equal(restoredStep2, true, 'Overloaded restoreAuthority must restore authority when verified');
    assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');
  });

  await t.test('5. getAuthorityRank helper provides strict monotonicity', () => {
    assert.equal(getAuthorityRank('A0_OBSERVE_ONLY'), 0);
    assert.equal(getAuthorityRank('A1_CANCEL_ONLY'), 1);
    assert.equal(getAuthorityRank('A2_REDUCE_ONLY'), 2);
    assert.equal(getAuthorityRank('A3_MAINTAIN'), 3);
    assert.equal(getAuthorityRank('A4_LIMITED_INCREASE'), 4);
    assert.equal(getAuthorityRank('A5_NORMAL'), 5);
  });
});
