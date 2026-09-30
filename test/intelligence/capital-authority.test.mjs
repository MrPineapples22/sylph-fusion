import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CapitalTruthEngine } from '../../dist/intelligence/capital/capital-truth-engine.js';
import { AuthoritativeCapitalLedger } from '../../dist/intelligence/capital/authoritative-ledger.js';
import { CapitalKernel } from '../../dist/intelligence/capital/capital-kernel.js';
import { HierarchicalReservationEngine } from '../../dist/intelligence/capital/reservations.js';
import { VeritasTransactionDecoder } from '../../dist/intelligence/vault/effect-spec.js';
import { VaultSigner } from '../../dist/intelligence/vault/vault-signer.js';
import { PositionSurvivalCore } from '../../dist/intelligence/survival/survival-core.js';
import { PortfolioEvacuationEngine } from '../../dist/intelligence/survival/portfolio-evacuation.js';
import { SurvivalProofEngine } from '../../dist/intelligence/survival/survival-proof-engine.js';
import { RevocationEngine } from '../../dist/intelligence/revocation/revocation-engine.js';
import { HavenSurvivalMode } from '../../dist/intelligence/survival/haven-mode.js';
import { JanusReconciler } from '../../dist/intelligence/reconciliation/janus-reconciler.js';
import { ForensicFlightRecorder } from '../../dist/intelligence/flight-recorder/flight-recorder.js';

test('Capital Truth Engine: Double-Entry Conservation & Append-Only Hash-Chaining', () => {
  const engine = new CapitalTruthEngine(100.0);

  // 1. Initial snapshot & double-entry verification
  const initialReport = engine.getDoubleEntryReport();
  assert.equal(initialReport.is_conservation_valid, true);
  assert.equal(initialReport.principal_sol, 100.0);

  // 2. Reserve capital
  const res = engine.reserveCapital({
    reservation_id: 'res_alpha',
    owner_id: 'strat_breakout_v1',
    amount_sol: 2.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expected_state_version: engine.getSnapshot().state_version,
    slot: 100,
  });
  assert.equal(res.success, true);

  // 3. Write Commit Certificate
  const cert = engine.writeCommitCertificate({
    intent_id: 'intent_alpha_1',
    reservation_id: 'res_alpha',
    survival_proof_root: 'surv_root_123',
    production_root: 'prod_root_123',
    max_sol_debit: 2.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 250,
    commit_generation: 1,
    slot: 101,
  });
  assert.equal(cert.is_durable_committed, true);
  assert.ok(cert.certificate_hash.length > 0);

  // 4. Settle execution
  engine.settleExecution({
    intent_id: 'intent_alpha_1',
    reservation_id: 'res_alpha',
    mint: 'mint_xyz_pump',
    actual_sol_spent: 1.95,
    base_fee_sol: 0.000005,
    priority_fee_sol: 0.0005,
    jito_tip_sol: 0.0001,
    slot: 102,
  });

  // 5. Post-settlement double-entry conservation
  const postReport = engine.getDoubleEntryReport();
  assert.equal(postReport.is_conservation_valid, true);
  assert.ok(postReport.total_accounted_sol >= 99.999);

  // 6. Cryptographic event hash chain validation
  const ledger = engine.getEventLedger();
  assert.ok(ledger.length >= 4);
  for (let i = 1; i < ledger.length; i++) {
    assert.equal(ledger[i].previous_event_hash, ledger[i - 1].event_hash);
  }
});

test('Capital authorities reject invalid reservation and settlement amounts without mutation', () => {
  const engine = new CapitalTruthEngine(100);
  const initial = engine.getSnapshot();
  for (const amount_sol of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = engine.reserveCapital({
      reservation_id: `invalid-${String(amount_sol)}`,
      owner_id: 'strategy', amount_sol, max_fee_sol: 0, max_tip_sol: 0,
      expected_state_version: initial.state_version, slot: 10,
    });
    assert.equal(result.success, false);
    assert.equal(engine.getSnapshot().reserved_cash_sol, 0);
    assert.equal(engine.getSnapshot().state_version, initial.state_version);
  }
  const zero = engine.reserveCapital({
    reservation_id: 'zero', owner_id: 'strategy', amount_sol: 0, max_fee_sol: 0, max_tip_sol: 0,
    expected_state_version: initial.state_version, slot: 10,
  });
  assert.equal(zero.success, false);
  const reserved = engine.reserveCapital({
    reservation_id: 'valid', owner_id: 'strategy', amount_sol: 1, max_fee_sol: 0.1, max_tip_sol: 0.1,
    expected_state_version: initial.state_version, slot: 10,
  });
  assert.equal(reserved.success, true);
  const beforeSettlement = engine.getSnapshot();
  assert.throws(() => engine.settleExecution({
    intent_id: 'intent', reservation_id: 'valid', mint: 'mint', actual_sol_spent: Number.NaN,
    base_fee_sol: 0, priority_fee_sol: 0, jito_tip_sol: 0, slot: 11,
  }), /INVALID_SETTLEMENT_INPUT/);
  assert.equal(engine.getSnapshot().reserved_cash_sol, beforeSettlement.reserved_cash_sol);
  assert.throws(() => engine.settleExecution({
    intent_id: 'intent', reservation_id: 'valid', mint: 'mint', actual_sol_spent: 2,
    base_fee_sol: 0, priority_fee_sol: 0, jito_tip_sol: 0, slot: 11,
  }), /SETTLEMENT_EXCEEDS_RESERVATION/);
  assert.equal(engine.getSnapshot().capital_state_root, beforeSettlement.capital_state_root);

  const ledger = new AuthoritativeCapitalLedger();
  const beforeLedger = ledger.auditExposures();
  for (const amount of [-1n, 0n, 100_000_000_001n]) {
    assert.equal(ledger.reserveCapital(amount), false);
    assert.deepEqual(ledger.auditExposures(), beforeLedger);
  }
  assert.equal(ledger.reserveCapital(1_000_000_000n), true);
  assert.equal(ledger.auditExposures().availableCashLamports, 99_000_000_000n);
  assert.equal(ledger.auditExposures().reservedCapitalLamports, 1_000_000_000n);
});

test('Capital Kernel: Formal Invariants & Authority Lattice Enforcement', () => {
  const kernel = new CapitalKernel({ maxOpenPositions: 3, maxUnknownCapitalSol: 5.0 });

  // Initial state: A5 NORMAL
  assert.equal(kernel.getAuthorityMode(), 'A5_NORMAL');

  // Verify safe capital action
  const passReport = kernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 1.5,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.5,
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
  assert.equal(passReport.all_invariants_passed, true);
  assert.equal(passReport.is_authorized, true);

  // Invariant Trip: Stale Revocation Epoch
  const failReport = kernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 1.5,
    confirmed_cash_sol: 50.0,
    reserved_cash_sol: 1.5,
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
    active_revocation_epoch: 2, // STALE!
    is_proof_revoked: false,
    is_lease_valid: true,
  });
  assert.equal(failReport.all_invariants_passed, false);
  assert.equal(failReport.is_authorized, false);
  // Auto-downgrade to A2_REDUCE_ONLY
  assert.equal(kernel.getAuthorityMode(), 'A2_REDUCE_ONLY');
});

test('VAULT: Custody Isolation & Atomic Signature Gate', () => {
  const vault = new VaultSigner({
    maxSolPerTx: 2.0,
    dailyCapSol: 10.0,
    productionRoot: 'prod_hash_123',
    allowSimulation: true,
  });
  vault.setEpochs(2, 3);

  const validEffect = {
    max_sol_debit: 1.5,
    min_sol_credit: 0,
    token_debits: {},
    token_credits: {},
    allowed_programs: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'],
    allowed_accounts: [],
    allowed_recipients: [],
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    forbidden_effects: [],
    expiry_slot: 200,
  };

  const validManifest = {
    transaction_candidate_id: 'tx_cand_1',
    signers: ['fee_payer'],
    writable_accounts: [],
    programs: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'],
    token_mints_involved: ['mint_abc'],
    estimated_sol_debit: 1.5,
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
    certificate_id: 'cert_1',
    intent_id: 'intent_1',
    reservation_id: 'res_1',
    capital_state_root: 'root_1',
    survival_proof_root: 'surv_root_1',
    control_epoch: 2,
    revocation_epoch: 3,
    production_root: 'prod_hash_123',
    max_sol_debit: 1.5,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 200,
    commit_generation: 1,
    is_durable_committed: true,
    certificate_hash: 'cert_hash_1',
  };

  // 1. Authorized signature
  const signResp = vault.processSignatureRequest({
    request_id: 'req_1',
    intent_id: 'intent_1',
    capability: 'SIGN_ENTRY',
    effect_spec: validEffect,
    manifest: validManifest,
    commit_certificate: commitCert,
    active_control_epoch: 2,
    active_revocation_epoch: 3,
    production_root: 'prod_hash_123',
    proof_lease_valid: true,
    serialized_tx_bytes: Uint8Array.from([1, 2, 3, 4]),
  });
  assert.equal(signResp.success, true);
  assert.equal(signResp.signing_state, 'RELEASED');
  assert.ok(signResp.signature_base58);

  // 2. Reject arbitrary transfer capability
  const badCapResp = vault.processSignatureRequest({
    request_id: 'req_2',
    intent_id: 'intent_2',
    capability: 'ARBITRARY_TRANSFER',
    effect_spec: validEffect,
    manifest: validManifest,
    commit_certificate: commitCert,
    active_control_epoch: 2,
    active_revocation_epoch: 3,
    production_root: 'prod_hash_123',
    proof_lease_valid: true,
    serialized_tx_bytes: Uint8Array.from([1, 2, 3]),
  });
  assert.equal(badCapResp.success, false);
  assert.equal(badCapResp.signing_state, 'REJECTED');
});

test('VAULT: synthetic signing is unavailable unless a test explicitly enables it', () => {
  const vault = new VaultSigner();
  const response = vault.processSignatureRequest({ intent_id: 'blocked', request_id: 'blocked', capability: 'SIGN_ENTRY' });
  assert.equal(response.success, false);
  assert.match(response.denial_reason, /SIGNER_UNAVAILABLE/);
});

test('Survival Core & Evacuation: Dual Admission & Tranche Safety Envelope', () => {
  const survivalCore = new PositionSurvivalCore();
  const evacuation = new PortfolioEvacuationEngine();

  // 1. Evaluate survival for safe token
  const cert = survivalCore.evaluateSurvival({
    mint: 'mint_safe_token',
    position_size_sol: 1.0,
    pool_liquidity_sol: 50.0,
    has_freeze_authority: false,
    has_mint_authority: false,
    independent_routes_count: 2,
    current_slot: 500,
  });
  assert.equal(cert.is_valid, true);
  assert.equal(cert.exit_proof_level, 'E5_MULTIPLE_INDEPENDENT_ROUTES');
  assert.equal(cert.exit_health, 'HEALTHY');

  // 2. Reject entry if freeze authority active
  const badCert = survivalCore.evaluateSurvival({
    mint: 'mint_honeypot',
    position_size_sol: 1.0,
    pool_liquidity_sol: 50.0,
    has_freeze_authority: true, // Freeze active!
    has_mint_authority: false,
    current_slot: 501,
  });
  assert.equal(badCert.is_valid, false);
  assert.equal(badCert.exit_proof_level, 'E0_UNKNOWN');

  // 2b. Reject / fail-closed if no verified route exists
  const noRouteCert = survivalCore.evaluateSurvival({
    mint: 'mint_no_route',
    position_size_sol: 1.0,
    pool_liquidity_sol: 50.0,
    has_freeze_authority: false,
    has_mint_authority: false,
    route_name: 'UNKNOWN_ROUTE',
    current_slot: 502,
  });
  assert.equal(noRouteCert.is_valid, false);
  assert.equal(noRouteCert.exit_proof_level, 'E0_UNKNOWN');

  // 3. Register position in Evacuation Engine
  evacuation.registerPosition({
    mint: 'mint_safe_token',
    size_sol: 1.0,
    route: 'Raydium_Main',
    pool_liquidity_sol: 50.0,
    current_evacuated_pct: 0,
    last_evacuated_slot: 0,
  });

  const metrics = evacuation.evaluatePortfolioEvacuation();
  assert.equal(metrics.current_exit_coverage_pct, 100);
  assert.ok(metrics.evacuation_solvency_ratio >= 1.0);

  // 4. Plan tranche: verifies Evacuation Safety Envelope
  const tranchePlan = evacuation.planNextTranche('mint_safe_token', 510);
  assert.equal(typeof tranchePlan, 'object');
  if ('can_evacuate' in tranchePlan) assert.fail('Failed to plan tranche');
  assert.equal(tranchePlan.tranche_fraction_pct, 25);
  assert.ok(tranchePlan.max_allowed_post_risk_score <= tranchePlan.pre_risk_score + 0.01);
});

test('Revocation Engine & Pre-Sign Revocation Barrier', () => {
  const revEngine = new RevocationEngine();
  assert.equal(revEngine.getCurrentEpoch(), 1);

  // 1. Normal pre-sign barrier passes
  const clearReport = revEngine.verifyRevocationBarrier({
    token_mint: 'token_alpha',
    intent_id: 'intent_1',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: 1,
  });
  assert.equal(clearReport.is_cleared_to_sign, true);

  // 2. Trigger selective token revocation
  revEngine.triggerRevocation({
    scope: 'TOKEN',
    target_entity_id: 'token_alpha',
    priority: 'R2_BLOCK_NEW_EXPOSURE',
    reason: 'Liquidity drain detected on-chain',
    slot: 600,
  });
  assert.equal(revEngine.getCurrentEpoch(), 2);

  // 3. Revocation barrier blocks token_alpha
  const blockedReport = revEngine.verifyRevocationBarrier({
    token_mint: 'token_alpha',
    intent_id: 'intent_2',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: 2,
  });
  assert.equal(blockedReport.is_cleared_to_sign, false);
  assert.ok(blockedReport.blocking_revocations.length > 0);

  // 4. Unrelated token_beta passes
  const unrelatedReport = revEngine.verifyRevocationBarrier({
    token_mint: 'token_beta',
    intent_id: 'intent_3',
    strategy_id: 'strat_1',
    route_name: 'route_orca',
    request_revocation_epoch: 2,
  });
  assert.equal(unrelatedReport.is_cleared_to_sign, true);
});

test('JANUS Reconciliation & Haven Survival Mode', () => {
  const janus = new JanusReconciler();
  const haven = new HavenSurvivalMode();

  janus.registerSubmittedTransaction({
    intent_id: 'intent_99',
    signature: 'sig_solana_99',
    submitted_slot: 1000,
    expiration_slot: 1150,
  });

  // 1. Timeout within valid blockhash: DO NOT release reservation!
  const timeoutRecon = janus.reconcileTransaction({
    signature: 'sig_solana_99',
    current_slot: 1050, // slot < 1150
    rpc_status: 'TIMEOUT',
  });
  assert.equal(timeoutRecon.should_retain_reservation, true);
  assert.equal(timeoutRecon.should_resend_exact_signature, true);
  assert.equal(timeoutRecon.should_rebuild_new_transaction, false);

  // 2. Haven Mode activation and recovery progression
  haven.activateHavenMode('Critical RPC quorum split');
  assert.equal(haven.isEntryPermitted(), false);
  assert.equal(haven.isReductionPermitted(), true);

  // Advance recovery step-by-step
  const r1 = haven.advanceRecoveryStep('CANARY');
  assert.equal(r1.success, true);
  const r2 = haven.advanceRecoveryStep('NORMAL');
  assert.equal(r2.success, true);
  assert.equal(haven.isEntryPermitted(), true);
});
