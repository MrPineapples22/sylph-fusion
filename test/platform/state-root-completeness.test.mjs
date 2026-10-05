/**
 * SYLPH FUSION — PROPERTY TEST: STATE ROOT COMPLETENESS
 * Specifications: Blueprint Section 10
 *
 * Proves that for EVERY protected field in FusionStateRootV2:
 * Mutating that single field produces a different state root.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStateRootV2 } from '../../dist/platform/pipeline/state-root-v2.js';

test('FusionStateRootV2 — Every protected field is bound to the root', () => {
  const baseFields = {
    economicFactId: 'fact_solana_1001',
    traceId: 'trace_audit_001',
    state: 'OBSERVED',
    revision: 1n,
    cluster: 'mainnet-beta',
    observedSlot: 310_000_000n,
    bankFingerprint: 'bank_fp_abc',
    blockhash: '5wVv5Gj2E7W3m1Q8nF5x4T7k9m2p1v0',
    lastValidBlockHeight: 310_000_300n,
    evidenceRoot: 'ev_root_111',
    coverageCertificateRoot: 'cov_cert_root',
    sourceIndependenceRoot: 'src_indep_root',
    semanticStateRoot: 'sem_state_root',
    tokenSemanticsRoot: 'tok_sem_root',
    programEpochRoot: 'prog_epoch_root',
    accountResolutionRoot: 'acct_res_root',
    marketStateRoot: 'mkt_state_root',
    authenticityRoot: 'auth_root',
    actorGraphRoot: 'actor_graph_root',
    featureSnapshotRoot: 'feat_snap_root',
    hypothesisRoot: 'hypo_root',
    alphaRealityRoot: 'alpha_real_root',
    portfolioRiskRoot: 'port_risk_root',
    exitabilityRoot: 'exit_root',
    systemicRiskRoot: 'sys_risk_root',
    survivalRoot: 'surv_root',
    evacuationRoot: 'evac_root',
    safetyCapacityRoot: 'safety_cap_root',
    resourceReservationId: 'res_res_001',
    capitalStateRoot: 'cap_state_root',
    capitalReservationId: 'cap_res_001',
    authorityEpoch: 1,
    fenceEpoch: 1,
    revocationEpoch: 1,
    executionGenerationId: 'gen_001',
    executionPermitId: 'permit_001',
    effectSpecHash: 'eff_spec_hash',
    messageHash: 'msg_hash',
    transactionSignature: 'tx_sig_111',
    transportAttemptRoot: 'trans_att_root',
    chainOutcomeRoot: 'chain_out_root',
    terminalityCertificateRoot: 'term_cert_root',
    economicOutcomeRoot: 'econ_out_root',
    configRoot: 'cfg_root',
    policyRoot: 'pol_root',
    releaseRoot: 'rel_root',
    proofGraphRoot: 'proof_graph_root',
  };

  const originalRoot = computeStateRootV2(baseFields);
  assert.equal(typeof originalRoot, 'string');
  assert.equal(originalRoot.length, 64);

  // Iterate over every key and verify mutation
  for (const [key, value] of Object.entries(baseFields)) {
    const mutated = { ...baseFields };
    if (typeof value === 'string') {
      mutated[key] = value + '_mutated';
    } else if (typeof value === 'bigint') {
      mutated[key] = value + 1n;
    } else if (typeof value === 'number') {
      mutated[key] = value + 1;
    }

    const mutatedRoot = computeStateRootV2(mutated);
    assert.notEqual(
      mutatedRoot,
      originalRoot,
      `State root failed to change when mutating field: ${key}`
    );
  }
});
