import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutablePaperSimulator } from '../../dist/platform/paper/executable-paper-simulator.js';
import { LiveExecutionAuthority } from '../../dist/platform/execution/authority.js';
import { LiveReadinessEvaluator } from '../../dist/platform/execution/live-readiness.js';

const params = {
  side: 'SELL',
  mint: 'test-mint',
  poolAddress: 'test-pool',
  positionSizeLamports: 1_000_000n,
  tokenQuantityRaw: 10_000_000n,
  decisionTimestamp: 0,
  currentTimestamp: 0,
  currentSlot: 100n,
  route: 'RAYDIUM_AMM',
  reserves: { base: 1_000_000n, quote: 1_000_000_000n },
  priorityFeeLamports: 10_000n,
  jitoTipLamports: 20_000n,
  maxSlippageBps: 500,
  simulatedLatencyMs: 200,
  blockhashAgeMs: 0,
};

test('unexitable paper sell must neither debit inventory nor credit SOL proceeds', () => {
  const result = new ExecutablePaperSimulator().simulateExecution(params);
  assert.equal(result.outcome, 'SIMULATED_UNEXITABLE');
  assert.equal(result.reason, 'CATASTROPHIC_EXIT_IMPACT_UNEXITABLE');
  assert.equal(result.tokenDeltaRaw, 0n);
  assert.equal(result.solDeltaLamports, 0n);
  assert.equal(result.priorityFeePaidLamports, 0n);
  assert.equal(result.jitoTipPaidLamports, 0n);
  assert.equal(result.networkFeePaidLamports, 0n);
});

test('unlanded and expired simulations do not invent on-chain network charges', () => {
  const simulator = new ExecutablePaperSimulator();
  for (const input of [
    { ...params, transportCondition: 'DROPPING' },
    { ...params, blockhashAgeMs: 65_000 },
    { ...params, reserves: { base: 0n, quote: 1_000_000_000n } },
  ]) {
    const result = simulator.simulateExecution(input);
    assert.ok(['SIMULATED_NOLAND','SIMULATED_EXPIRED','SIMULATED_UNEXITABLE'].includes(result.outcome));
    assert.equal(result.tokenDeltaRaw, 0n);
    assert.equal(result.solDeltaLamports, 0n);
    assert.equal(result.networkFeePaidLamports, 0n);
  }
});

test('legacy quarantined live adapter cannot advertise execution authority', () => {
  assert.equal(LiveExecutionAuthority.prototype.canExecuteLive.call({}), false);
});

test('caller-asserted all-green readiness is diagnostic only', () => {
  const assessed = LiveReadinessEvaluator.evaluate({
    hasIsolatedSigner: true,
    signerPublicKeyBase58: '11111111111111111111111111111111',
    hasActiveProtocolLease: true,
    protocolLeaseExpired: false,
    exactBytesAuthorityReady: true,
    terminalityWitnessCount: 3,
    noLandSearchEngineReady: true,
    reservationEngineReady: true,
    reconciliationLedgerClean: true,
    executionHurdleCalibrated: true,
    canaryRiskLimitsEnforced: true,
    releaseCertificateVerified: true,
    releaseRootDigest: 'a'.repeat(64),
  });
  assert.equal(assessed.reportedPrerequisitesPass, true);
  assert.equal(assessed.liveReady, false);
  assert.equal(assessed.authorizesSigningOrBroadcast, false);
  assert.equal(assessed.liveSigningUnavailable, true);
  assert.equal(assessed.productionCapitalAuthorityBlocked, true);
});
