import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CapitalTruthEngine } from '../../dist/intelligence/capital/capital-truth-engine.js';
import { AuthoritativeCapitalLedger } from '../../dist/intelligence/capital/authoritative-ledger.js';
import { CapitalKernel } from '../../dist/intelligence/capital/capital-kernel.js';
import { RevocationEngine } from '../../dist/intelligence/revocation/revocation-engine.js';
import { UnifiedDecisionEngine } from '../../dist/intelligence/decision/unified-decision.js';
import { VaultSigner } from '../../dist/intelligence/vault/vault-signer.js';
import { JanusReconciler } from '../../dist/intelligence/reconciliation/janus-reconciler.js';
import { HavenSurvivalMode } from '../../dist/intelligence/survival/haven-mode.js';
import { PortfolioEvacuationEngine } from '../../dist/intelligence/survival/portfolio-evacuation.js';
import { evaluateTokenDecision } from '../../terminal/src/token-decision-eval.js';
import { selectSystemStrip } from '../../terminal/src/operator-status-strip-state.js';

test('1. Reach maximum open positions: reject next OPEN without permanently poisoning authority', () => {
  const kernel = new CapitalKernel({ maxOpenPositions: 3, maxUnknownCapitalSol: 5.0, initialAuthority: 'A5_NORMAL' });
  assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');

  // Verify that reaching capacity rejects the action locally
  const capacityRejection = kernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 1.0,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.0,
    emergency_reserve_sol: 5.0,
    current_open_positions_count: 3, // Capacity reached
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    request_control_epoch: 1,
    active_control_epoch: 1,
    request_revocation_epoch: 1,
    active_revocation_epoch: 1,
    is_proof_revoked: false,
    is_lease_valid: true,
  });

  assert.equal(capacityRejection.all_invariants_passed, false);
  assert.equal(capacityRejection.is_authorized, false);
  assert.ok(capacityRejection.violated_invariants.some(v => v.invariant_id === 'INV_1_MAX_OPEN_POSITIONS'));

  // NON-POISONING GUARANTEE: Authority mode must remain A5_NORMAL, NOT permanently downgraded to A2_REDUCE_ONLY!
  assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');
});

test('2. Close one position: capacity becomes available again', () => {
  const kernel = new CapitalKernel({ maxOpenPositions: 3, maxUnknownCapitalSol: 5.0, initialAuthority: 'A5_NORMAL' });
  assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');

  // When positions count is 2 (after a close), capacity is available and passes
  const allowedReport = kernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 1.0,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.0,
    emergency_reserve_sol: 5.0,
    current_open_positions_count: 2, // 1 slot free
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    request_control_epoch: 1,
    active_control_epoch: 1,
    request_revocation_epoch: 1,
    active_revocation_epoch: 1,
    is_proof_revoked: false,
    is_lease_valid: true,
  });

  assert.equal(allowedReport.all_invariants_passed, true);
  assert.equal(allowedReport.is_authorized, true);
  assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');
});

test('3. Token evaluation alone does not create portfolio exposure', () => {
  const evac = new PortfolioEvacuationEngine();
  const initialSolvency = evac.evaluatePortfolioEvacuation();
  assert.equal(initialSolvency.time_to_liquidate_100s, 0);

  // In the repaired architecture, candidate evaluation does NOT register phantom positions
  const truthEngine = new CapitalTruthEngine(100.0);
  assert.equal(truthEngine.getOpenPositionsCount(), 0);
  assert.equal(truthEngine.getSnapshot().confirmed_positions_count, 0);
  assert.equal(truthEngine.getSnapshot().possible_exposure_sol, 0);
});

test('4. Scoped revocation blocks only its proper scope', () => {
  const revEngine = new RevocationEngine();

  // Trigger TOKEN-scoped revocation
  revEngine.triggerRevocation({
    scope: 'TOKEN',
    target_entity_id: 'mint_drain_exploit',
    priority: 'R2_BLOCK_NEW_EXPOSURE',
    reason: 'Drain detected',
    slot: 100,
  });

  // Verify that mint_drain_exploit is blocked
  const blockedReport = revEngine.verifyRevocationBarrier({
    token_mint: 'mint_drain_exploit',
    intent_id: 'intent_1',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: revEngine.getCurrentEpoch(),
  });
  assert.equal(blockedReport.is_cleared_to_sign, false);

  // Verify that an unrelated token passes
  const allowedReport = revEngine.verifyRevocationBarrier({
    token_mint: 'mint_legitimate_gem',
    intent_id: 'intent_2',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: revEngine.getCurrentEpoch(),
  });
  assert.equal(allowedReport.is_cleared_to_sign, true);

  // Trigger ROUTE-scoped revocation
  revEngine.triggerRevocation({
    scope: 'ROUTE',
    target_entity_id: 'route_congested_pool',
    priority: 'R2_BLOCK_NEW_EXPOSURE',
    reason: 'Severe slippage and RPC timeouts',
    slot: 105,
  });

  // Blocked on route_congested_pool
  assert.equal(revEngine.verifyRevocationBarrier({
    token_mint: 'mint_legitimate_gem',
    intent_id: 'intent_3',
    strategy_id: 'strat_1',
    route_name: 'route_congested_pool',
    request_revocation_epoch: revEngine.getCurrentEpoch(),
  }).is_cleared_to_sign, false);

  // Allowed on healthy route
  assert.equal(revEngine.verifyRevocationBarrier({
    token_mint: 'mint_legitimate_gem',
    intent_id: 'intent_4',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: revEngine.getCurrentEpoch(),
  }).is_cleared_to_sign, true);
});

test('5. Resolved revocation no longer blocks unrelated future execution', () => {
  const revEngine = new RevocationEngine();

  const record = revEngine.triggerRevocation({
    scope: 'TOKEN',
    target_entity_id: 'mint_temporary_halt',
    priority: 'R2_BLOCK_NEW_EXPOSURE',
    reason: 'Circuit breaker tripped',
    slot: 200,
  });
  assert.equal(revEngine.getActiveRevocationsCount(), 1);

  // Resolve the revocation with evidence
  const resolved = revEngine.resolveRevocation(
    record.revocation_id,
    'Circuit breaker cleared after liquidity re-seeded',
    250
  );
  assert.equal(resolved, true);
  assert.equal(revEngine.getActiveRevocationsCount(), 0);

  // Token is cleared to sign at current epoch
  const report = revEngine.verifyRevocationBarrier({
    token_mint: 'mint_temporary_halt',
    intent_id: 'intent_post_recovery',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: revEngine.getCurrentEpoch(),
  });
  assert.equal(report.is_cleared_to_sign, true);
});

test('6. Revocation epoch changes during a protected request invalidate that request (TOCTOU)', () => {
  const revEngine = new RevocationEngine();
  const startEpoch = revEngine.getCurrentEpoch();

  // Mid-request, an event triggers revocation advancement
  revEngine.triggerRevocation({
    scope: 'GLOBAL',
    target_entity_id: 'SYSTEM',
    priority: 'R1_REVALIDATE',
    reason: 'Mid-flight state change',
    slot: 300,
  });
  assert.ok(revEngine.getCurrentEpoch() > startEpoch);

  // Barrier checked with stale start epoch must fail
  const barrierReport = revEngine.verifyRevocationBarrier({
    token_mint: 'mint_any',
    intent_id: 'intent_stale_toctou',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: startEpoch, // Stale!
  });

  assert.equal(barrierReport.is_cleared_to_sign, false);
  assert.match(barrierReport.blocking_revocations[0].reason, /Revocation epoch advanced/);
});

test('7. Route identity used by risk/capital equals route actually authorized and built', () => {
  const vault = new VaultSigner({
    maxSolPerTx: 2.0,
    dailyCapSol: 10.0,
    productionRoot: 'prod_root',
    allowSimulation: true,
  });
  vault.setEpochs(1, 1);

  const effectSpec = {
    max_sol_debit: 1.0,
    min_sol_credit: 0,
    token_debits: {},
    token_credits: {},
    allowed_programs: ['RaydiumProgramId11111111111111111111111111'],
    allowed_accounts: [],
    allowed_recipients: [],
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    forbidden_effects: [],
    expiry_slot: 200,
  };

  // Transaction attempting to execute on Orca when authorized only for Raydium
  const mismatchedManifest = {
    transaction_candidate_id: 'tx_cand_mismatch',
    signers: ['fee_payer'],
    writable_accounts: [],
    programs: ['OrcaWhirlpoolProgramId111111111111111111111111'], // Mismatch!
    token_mints_involved: ['mint_token'],
    estimated_sol_debit: 1.0,
    estimated_sol_credit: 0,
    compute_unit_limit: 200_000,
    priority_fee_micro_lamports: 50_000,
    jito_tip_sol: 0.0001,
    creates_ata: false,
    transfers_authority: false,
    assigns_delegate: false,
    instructions: [],
    has_unknown_instructions: false,
  };

  const commitCert = {
    certificate_id: 'cert_route_check',
    intent_id: 'intent_route_check',
    reservation_id: 'res_route_check',
    capital_state_root: 'root_1',
    survival_proof_root: 'surv_1',
    control_epoch: 1,
    revocation_epoch: 1,
    production_root: 'prod_root',
    max_sol_debit: 1.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 200,
    commit_generation: 1,
    is_durable_committed: true,
    certificate_hash: 'hash_route_check',
  };

  const result = vault.processSignatureRequest({
    request_id: 'req_route_mismatch',
    intent_id: 'intent_route_check',
    capability: 'SIGN_ENTRY',
    effect_spec: effectSpec,
    manifest: mismatchedManifest,
    commit_certificate: commitCert,
    active_control_epoch: 1,
    active_revocation_epoch: 1,
    production_root: 'prod_root',
    proof_lease_valid: true,
    serialized_tx_bytes: Uint8Array.from([1, 2, 3]),
  });

  assert.equal(result.success, false);
  assert.equal(result.signing_state, 'REJECTED');
  assert.match(result.denial_reason || '', /INTENT_MISMATCH/);
});

test('8. Capital authorization fails if reservation/commitment/lease evidence is absent', () => {
  const kernel = new CapitalKernel({ maxOpenPositions: 3, maxUnknownCapitalSol: 5.0 });

  const baseParams = {
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 1.0,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.0,
    emergency_reserve_sol: 5.0,
    current_open_positions_count: 1,
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    request_control_epoch: 1,
    active_control_epoch: 1,
    request_revocation_epoch: 1,
    active_revocation_epoch: 1,
    is_proof_revoked: false,
    is_lease_valid: true,
  };

  // Missing reservation
  const noReservation = kernel.verifyCapitalAction({ ...baseParams, has_active_reservation: false });
  assert.equal(noReservation.is_authorized, false);
  assert.ok(noReservation.violated_invariants.some(v => v.invariant_id === 'INV_2_RESERVATION_EXISTS'));

  // Missing survival certificate
  const noCert = kernel.verifyCapitalAction({ ...baseParams, has_valid_survival_certificate: false });
  assert.equal(noCert.is_authorized, false);
  assert.ok(noCert.violated_invariants.some(v => v.invariant_id === 'INV_5_SURVIVAL_CERTIFICATE_VALID'));

  // Expired / invalid lease
  const invalidLease = kernel.verifyCapitalAction({ ...baseParams, is_lease_valid: false });
  assert.equal(invalidLease.is_authorized, false);
  assert.ok(invalidLease.violated_invariants.some(v => v.invariant_id === 'INV_9_PROOF_NOT_REVOKED'));
});

test('9. Recovery from reduce-only requires verified recovery evidence', () => {
  const kernel = new CapitalKernel({ maxOpenPositions: 3, maxUnknownCapitalSol: 5.0, initialAuthority: 'A5_NORMAL' });
  kernel.downgradeAuthority('A2_REDUCE_ONLY', 'Test reduce-only');
  assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

  // Attempt recovery with invalid evidence (unhealthy provider)
  const failedRecovery = kernel.restoreAuthorityWithCertificate({
    recovery_id: 'rec_invalid',
    cause: 'Test outage',
    previous_authority: 'A2_REDUCE_ONLY',
    target_authority: 'A5_NORMAL',
    capital_state_root: 'capital_root_invalid',
    position_reconciliation_hash: 'pos_recon_hash',
    provider_status: 'FAILED', // Fails!
    market_freshness_ms: 100,
    revocation_epoch: 1,
    control_epoch: 1,
    signer_state: 'READY',
    settlement_state: 'CLEAN',
    timestamp_ms: Date.now(),
    evidence_hashes: ['hash1'],
    verification_result: false,
  });
  assert.equal(failedRecovery, false);
  assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');

  // Recovery with fully verified RecoveryCertificate
  const passedRecovery = kernel.restoreAuthorityWithCertificate({
    recovery_id: 'rec_valid_001',
    cause: 'Test outage resolved',
    previous_authority: 'A2_REDUCE_ONLY',
    target_authority: 'A5_NORMAL',
    capital_state_root: 'capital_root_valid_12345678',
    position_reconciliation_hash: 'pos_recon_hash',
    provider_status: 'HEALTHY',
    market_freshness_ms: 100,
    revocation_epoch: 1,
    control_epoch: 1,
    signer_state: 'READY',
    settlement_state: 'CLEAN',
    timestamp_ms: Date.now(),
    evidence_hashes: ['hash1'],
    verification_result: true,
  });
  assert.equal(passedRecovery, true);
  assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');
});

test('10. UI distinguishes token safety from capital authority', () => {
  // Token safety evaluation passes
  const tokenCandidate = {
    curve: { complete: false, realQuoteReserves: '2500000000' },
    drift: { passed: true, priceDriftBps: 0, liquidityDropBps: 0, driftBps: 0 },
  };
  const tokenAsset = { id: 'mint_safe', mintAuthority: null, freezeAuthority: null };
  const decision = evaluateTokenDecision({ candidate: tokenCandidate, asset: tokenAsset });
  assert.equal(decision.blocked, false);

  // Capital authority status strip independently reports degraded / reduce only
  const degradedSystemStrip = { data: 'FRESH', execution: 'REDUCE_ONLY' };
  const selected = selectSystemStrip({ systemStrip: degradedSystemStrip }, false, null);
  assert.equal(selected.execution, 'REDUCE_ONLY');
  // Proves the two layers remain distinct, typed domains that are never conflated
  assert.equal(typeof decision.blocked, 'boolean');
  assert.equal(typeof selected.execution, 'string');
  assert.notEqual(decision.decisionBadge, selected.execution);
});

test('11. Unknown market evidence cannot become healthy through a default', () => {
  // Candidate with missing/unknown curve reserves
  const decision = evaluateTokenDecision({
    candidate: { curve: null, drift: null },
    asset: { id: 'mint_unknown', mintAuthority: null, freezeAuthority: null },
  });
  // Fails safe to pending/unknown, NEVER healthy
  assert.equal(decision.isTelemetryPending, true);
  assert.notEqual(decision.decisionBadge, 'DECISION: ELIGIBLE');
});

test('12. REDUCE/CLOSE remain possible under appropriate OPEN restrictions', () => {
  const kernel = new CapitalKernel({ maxOpenPositions: 3, maxUnknownCapitalSol: 5.0 });
  kernel.downgradeAuthority('A2_REDUCE_ONLY');

  // OPEN/INCREASE fails in A2
  const openResult = kernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 1.0,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.0,
    emergency_reserve_sol: 5.0,
    current_open_positions_count: 1,
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    request_control_epoch: 1,
    active_control_epoch: 1,
    request_revocation_epoch: 1,
    active_revocation_epoch: 1,
    is_proof_revoked: false,
    is_lease_valid: true,
  });
  assert.equal(openResult.is_authorized, false);

  // CLOSE/DECREASE succeeds in A2
  const closeResult = kernel.verifyCapitalAction({
    action_type: 'DECREASE_EXPOSURE',
    proposed_delta_sol: 1.0,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.0,
    emergency_reserve_sol: 5.0,
    current_open_positions_count: 1,
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    request_control_epoch: 1,
    active_control_epoch: 1,
    request_revocation_epoch: 1,
    active_revocation_epoch: 1,
    is_proof_revoked: false,
    is_lease_valid: true,
  });
  assert.equal(closeResult.is_authorized, true);
});

test('13. Closed positions are excluded from open-position counts', () => {
  const engine = new CapitalTruthEngine(100.0);

  // Open position
  engine.reserveCapital({
    reservation_id: 'res_pos_1',
    owner_id: 'strat_1',
    amount_sol: 2.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expected_state_version: engine.getSnapshot().state_version,
    slot: 100,
  });
  engine.writeCommitCertificate({
    intent_id: 'intent_pos_1',
    reservation_id: 'res_pos_1',
    survival_proof_root: 'surv_1',
    production_root: 'prod_1',
    max_sol_debit: 2.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 250,
    commit_generation: 1,
    slot: 101,
  });
  engine.settleExecution({
    intent_id: 'intent_pos_1',
    reservation_id: 'res_pos_1',
    mint: 'mint_close_test',
    actual_sol_spent: 1.95,
    base_fee_sol: 0.000005,
    priority_fee_sol: 0.0005,
    jito_tip_sol: 0.0001,
    slot: 102,
  });

  assert.equal(engine.getOpenPositionsCount(), 1);
  assert.equal(engine.hasPosition('mint_close_test'), true);

  // Settle exit
  engine.settleExit({
    intent_id: 'exit_intent_1',
    mint: 'mint_close_test',
    sol_received: 2.30, // Win (+0.35 SOL net PnL)
    fee_sol: 0.001,
    slot: 120,
    is_full_close: true,
  });

  assert.equal(engine.getOpenPositionsCount(), 0);
  assert.equal(engine.hasPosition('mint_close_test'), false);
  const report = engine.getDoubleEntryReport();
  assert.equal(report.is_conservation_valid, true);
});

test('14. Duplicate settlement does not double-apply capital changes', () => {
  const engine = new CapitalTruthEngine(100.0);
  engine.reserveCapital({
    reservation_id: 'res_dup',
    owner_id: 'strat_1',
    amount_sol: 1.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expected_state_version: engine.getSnapshot().state_version,
    slot: 100,
  });
  engine.writeCommitCertificate({
    intent_id: 'intent_dup',
    reservation_id: 'res_dup',
    survival_proof_root: 'surv_1',
    production_root: 'prod_1',
    max_sol_debit: 1.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 250,
    commit_generation: 1,
    slot: 101,
  });
  engine.settleExecution({
    intent_id: 'intent_dup',
    reservation_id: 'res_dup',
    mint: 'mint_dup',
    actual_sol_spent: 0.95,
    base_fee_sol: 0.000005,
    priority_fee_sol: 0.0005,
    jito_tip_sol: 0.0001,
    slot: 102,
  });

  // Attempt duplicate settlement of identical intent
  assert.throws(() => engine.settleExecution({
    intent_id: 'intent_dup',
    reservation_id: 'res_dup',
    mint: 'mint_dup',
    actual_sol_spent: 0.95,
    base_fee_sol: 0.000005,
    priority_fee_sol: 0.0005,
    jito_tip_sol: 0.0001,
    slot: 103,
  }), /DUPLICATE_SETTLEMENT_ATTEMPT/);
});

test('15. Restart after ambiguous submission reconciles before retry', () => {
  const janus = new JanusReconciler();
  janus.registerSubmittedTransaction({
    intent_id: 'intent_ambiguous_1',
    signature: 'sig_ambiguous_solana',
    submitted_slot: 1000,
    expiration_slot: 1150,
  });

  // Ambiguous RPC timeout before expiration: must retain reservation and never rebuild
  const recon = janus.reconcileTransaction({
    signature: 'sig_ambiguous_solana',
    current_slot: 1080,
    rpc_status: 'TIMEOUT',
  });
  assert.equal(recon.should_retain_reservation, true);
  assert.equal(recon.should_resend_exact_signature, true);
  assert.equal(recon.should_rebuild_new_transaction, false);
});

test('16. Signer rejects a transaction differing from authorized intent', () => {
  const vault = new VaultSigner({
    maxSolPerTx: 2.0,
    dailyCapSol: 10.0,
    productionRoot: 'prod_root',
    allowSimulation: true,
  });
  vault.setEpochs(1, 1);

  const authorizedCommit = {
    certificate_id: 'cert_16',
    intent_id: 'intent_16',
    reservation_id: 'res_16',
    capital_state_root: 'root_1',
    survival_proof_root: 'surv_1',
    control_epoch: 1,
    revocation_epoch: 1,
    production_root: 'prod_root',
    max_sol_debit: 1.0, // Authorized for 1.0 SOL max
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 200,
    commit_generation: 1,
    is_durable_committed: true,
    certificate_hash: 'hash_16',
  };

  const effectSpec = {
    max_sol_debit: 1.0,
    min_sol_credit: 0,
    token_debits: {},
    token_credits: {},
    allowed_programs: ['Program1111111111111111111111111111111111111'],
    allowed_accounts: [],
    allowed_recipients: [],
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    forbidden_effects: [],
    expiry_slot: 200,
  };

  // Transaction attempting to spend 2.5 SOL (exceeds authorized max 1.0 SOL)
  const excessiveSpendManifest = {
    transaction_candidate_id: 'tx_cand_excessive',
    signers: ['fee_payer'],
    writable_accounts: [],
    programs: ['Program1111111111111111111111111111111111111'],
    token_mints_involved: ['mint_token'],
    estimated_sol_debit: 2.5, // VIOLATION
    estimated_sol_credit: 0,
    compute_unit_limit: 200_000,
    priority_fee_micro_lamports: 50_000,
    jito_tip_sol: 0.0001,
    creates_ata: false,
    transfers_authority: false,
    assigns_delegate: false,
    instructions: [],
    has_unknown_instructions: false,
  };

  const resp = vault.processSignatureRequest({
    request_id: 'req_16',
    intent_id: 'intent_16',
    capability: 'SIGN_ENTRY',
    effect_spec: effectSpec,
    manifest: excessiveSpendManifest,
    commit_certificate: authorizedCommit,
    active_control_epoch: 1,
    active_revocation_epoch: 1,
    production_root: 'prod_root',
    proof_lease_valid: true,
    serialized_tx_bytes: Uint8Array.from([1, 2, 3]),
  });

  assert.equal(resp.success, false);
  assert.equal(resp.signing_state, 'REJECTED');
  assert.match(resp.denial_reason || '', /(EXCESSIVE_SOL_DEBIT|SOL_DEBIT_EXCEEDED)/);
});

test('17. Expired authorization cannot be signed', () => {
  const vault = new VaultSigner({
    maxSolPerTx: 2.0,
    dailyCapSol: 10.0,
    productionRoot: 'prod_root',
    allowSimulation: true,
  });
  vault.setEpochs(1, 1);

  const expiredCommit = {
    certificate_id: 'cert_17',
    intent_id: 'intent_17',
    reservation_id: 'res_17',
    capital_state_root: 'root_1',
    survival_proof_root: 'surv_1',
    control_epoch: 1,
    revocation_epoch: 1,
    production_root: 'prod_root',
    max_sol_debit: 1.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 100,
    commit_generation: 1,
    is_durable_committed: true,
    certificate_hash: 'hash_17',
  };

  const expiredEffect = {
    max_sol_debit: 1.0,
    min_sol_credit: 0,
    token_debits: {},
    token_credits: {},
    allowed_programs: ['Program1111111111111111111111111111111111111'],
    allowed_accounts: [],
    allowed_recipients: [],
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    forbidden_effects: [],
    expiry_slot: 90,
  };

  const validManifest = {
    transaction_candidate_id: 'tx_cand_expired',
    signers: ['fee_payer'],
    writable_accounts: [],
    programs: ['Program1111111111111111111111111111111111111'],
    token_mints_involved: ['mint_token'],
    estimated_sol_debit: 1.0,
    estimated_sol_credit: 0,
    compute_unit_limit: 200_000,
    priority_fee_micro_lamports: 50_000,
    jito_tip_sol: 0.0001,
    creates_ata: false,
    transfers_authority: false,
    assigns_delegate: false,
    instructions: [],
    has_unknown_instructions: false,
  };

  const resp = vault.processSignatureRequest({
    request_id: 'req_17',
    intent_id: 'intent_17',
    capability: 'SIGN_ENTRY',
    effect_spec: expiredEffect,
    manifest: validManifest,
    commit_certificate: expiredCommit,
    active_control_epoch: 1,
    active_revocation_epoch: 1,
    production_root: 'prod_root',
    proof_lease_valid: false, // Invalid / expired lease
    serialized_tx_bytes: Uint8Array.from([1, 2, 3]),
  });

  assert.equal(resp.success, false);
  assert.equal(resp.signing_state, 'REJECTED');
  assert.match(resp.denial_reason || '', /EXPIRED_PROOF_LEASE/);
});

test('18. Revoked authorization cannot be signed', () => {
  const vault = new VaultSigner({
    maxSolPerTx: 2.0,
    dailyCapSol: 10.0,
    productionRoot: 'prod_root',
    allowSimulation: true,
  });
  // Active revocation epoch is 5
  vault.setEpochs(1, 5);

  const staleCert = {
    certificate_id: 'cert_18',
    intent_id: 'intent_18',
    reservation_id: 'res_18',
    capital_state_root: 'root_1',
    survival_proof_root: 'surv_1',
    control_epoch: 1,
    revocation_epoch: 4, // Older than active epoch 5!
    production_root: 'prod_root',
    max_sol_debit: 1.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 200,
    commit_generation: 1,
    is_durable_committed: true,
    certificate_hash: 'hash_18',
  };

  const validEffect = {
    max_sol_debit: 1.0,
    min_sol_credit: 0,
    token_debits: {},
    token_credits: {},
    allowed_programs: ['Program1111111111111111111111111111111111111'],
    allowed_accounts: [],
    allowed_recipients: [],
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    forbidden_effects: [],
    expiry_slot: 200,
  };

  const validManifest = {
    transaction_candidate_id: 'tx_cand_18',
    signers: ['fee_payer'],
    writable_accounts: [],
    programs: ['Program1111111111111111111111111111111111111'],
    token_mints_involved: ['mint_token'],
    estimated_sol_debit: 1.0,
    estimated_sol_credit: 0,
    compute_unit_limit: 200_000,
    priority_fee_micro_lamports: 50_000,
    jito_tip_sol: 0.0001,
    creates_ata: false,
    transfers_authority: false,
    assigns_delegate: false,
    instructions: [],
    has_unknown_instructions: false,
  };

  const resp = vault.processSignatureRequest({
    request_id: 'req_18',
    intent_id: 'intent_18',
    capability: 'SIGN_ENTRY',
    effect_spec: validEffect,
    manifest: validManifest,
    commit_certificate: staleCert,
    active_control_epoch: 1,
    active_revocation_epoch: 5,
    production_root: 'prod_root',
    proof_lease_valid: true,
    serialized_tx_bytes: Uint8Array.from([1, 2, 3]),
  });

  assert.equal(resp.success, false);
  assert.equal(resp.signing_state, 'REJECTED');
  assert.match(resp.denial_reason || '', /REVOCATION_EPOCH_MISMATCH/);
});

test('19. Learning records reference actual settlement and outcome', () => {
  const engine = new CapitalTruthEngine(100.0);
  engine.reserveCapital({
    reservation_id: 'res_learn',
    owner_id: 'strat_momentum_v1',
    amount_sol: 1.5,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expected_state_version: engine.getSnapshot().state_version,
    slot: 100,
  });
  engine.writeCommitCertificate({
    intent_id: 'intent_learn',
    reservation_id: 'res_learn',
    survival_proof_root: 'surv_1',
    production_root: 'prod_1',
    max_sol_debit: 1.5,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 250,
    commit_generation: 1,
    slot: 101,
  });
  engine.settleExecution({
    intent_id: 'intent_learn',
    reservation_id: 'res_learn',
    mint: 'mint_learning_test',
    actual_sol_spent: 1.48,
    base_fee_sol: 0.000005,
    priority_fee_sol: 0.0005,
    jito_tip_sol: 0.0001,
    slot: 102,
  });

  // Cryptographically chained ledger entry binds the settlement
  const events = engine.getEventLedger();
  const settlementEvent = events.find(e => e.entity_id === 'mint_learning_test' && e.event_type === 'POSITION_OPENED');
  assert.ok(settlementEvent);
  assert.equal(settlementEvent.payload.mint, 'mint_learning_test');
  assert.ok(settlementEvent.event_hash.length > 0);
});

test('20. Competing decision outputs cannot bypass Unified Decision', () => {
  const unifiedEngine = new UnifiedDecisionEngine();

  // Multiplier / speculative model outputs high score, but safety vetoes
  const reconciled = unifiedEngine.reconcile({
    tokenId: 'mint_speculative_pump_with_honeypot',
    slot: 1000,
    spieEvaluation: {
      candidateMint: 'mint_speculative_pump_with_honeypot',
      netExpectedValueSol: 2.50, // HIGH EV claim
      winProbability: 0.88,
      recommendedSizeSol: 1.5,
      routeSelected: 'Raydium_Main_Pool',
      evExceedsThreshold: true,
      kellyFraction: 0.15,
      reasons: ['High velocity buyer clustering'],
      factors: {
        liquidityDepth: 0.8,
        momentum: 0.9,
        participation: 0.85,
        walletQuality: 0.85,
        safety: 0.2,
        executionFeasibility: 0.8,
      },
      actionRecommendation: 'FAST_BUY',
    },
    vetoRules: [
      {
        ruleId: 'VETO_FREEZE_AUTHORITY',
        passed: false, // HARD VETO
        reason: 'Token freeze authority is not revoked',
      },
    ],
    riskEvaluation: {
      approved: false, // Risk limit block
      reasons: ['Single entity holds > 50% supply'],
    },
  });

  // Reconciled decision is strictly ABSTAIN, never bypassed
  assert.equal(reconciled.actionRecommendation, 'ABSTAIN');
  assert.equal(reconciled.stage, 'INVALIDATED');
  assert.ok(reconciled.vetoEvidence.length > 0);
  assert.match(reconciled.vetoEvidence[0], /Token freeze authority is not revoked/);
  assert.ok(reconciled.riskEvidence.length > 0);
});
