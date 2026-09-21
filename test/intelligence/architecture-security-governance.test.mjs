import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BabbageIntegrationCompiler } from '../../dist/intelligence/compiler/babbage-compiler.js';
import { SentinelSecurityZonesEngine } from '../../dist/intelligence/security/sentinel-zones.js';
import { HypatiaObjectiveAlignmentEngine, HypatiaObjectiveLevel } from '../../dist/intelligence/governance/hypatia-alignment.js';
import { FaradayResilienceEngine } from '../../dist/intelligence/resilience/faraday-recovery.js';
import { WatsonSystemDiagnosisEngine } from '../../dist/intelligence/diagnosis/watson-diagnosis.js';

test('Layer 2 - Babbage Integration Compiler', () => {
  const compiler = new BabbageIntegrationCompiler();

  compiler.registerModule({
    module_id: 'mendeleev',
    name: 'Mendeleev Ontology',
    layer: 1,
    version: '1.0.0',
    inputs: ['raw_market_events'],
    outputs: ['canonical_features'],
    dependencies: [],
    consumers: ['gauss'],
    permissions: ['READ_DATA'],
    prohibitions: ['SIGN_TRANSACTION'],
    freshness_max_ms: 10000,
    failure_mode: 'FAIL_CLOSED'
  });

  compiler.registerModule({
    module_id: 'gauss',
    name: 'Gauss Integrity',
    layer: 1,
    version: '1.0.0',
    inputs: ['mendeleev.canonical_features'],
    outputs: ['verified_features'],
    dependencies: ['mendeleev'],
    consumers: ['atlas'],
    permissions: ['READ_DATA'],
    prohibitions: ['SIGN_TRANSACTION'],
    freshness_max_ms: 5000,
    failure_mode: 'FAIL_CLOSED'
  });

  const report = compiler.compileAndAudit();
  assert.equal(report.is_valid, true);
  assert.equal(report.illegal_authorization_paths.length, 0);

  // Detect illegal bypass
  compiler.registerModule({
    module_id: 'rogue_ai',
    name: 'Rogue Predictor',
    layer: 3, // Layer 3 is Intelligence
    version: '1.0.0',
    inputs: [],
    outputs: [],
    dependencies: [],
    consumers: [],
    permissions: ['SIGN_TRANSACTION'], // Forbidden!
    prohibitions: [],
    freshness_max_ms: 1000,
    failure_mode: 'PASS_THROUGH'
  });

  const badReport = compiler.compileAndAudit();
  assert.equal(badReport.is_valid, false);
  assert.ok(badReport.illegal_authorization_paths.some(p => p.includes('Cannot directly sign or execute')));
});

test('Layer 2 - Sentinel Security Zones & Telemetry Sanitization', () => {
  // Telemetry sanitization
  const dummyKey = '5MaiiCavjCmn9HsA3g3EkP1jY6Y5qg8k9m4jK1P2Q3R4S5T6U7V8W9X1Y2Z3A4B5C6D7E8F9G1H2J3K4L5M';
  const leaked = `Error in execution with key: ${dummyKey} on mint ABC`;
  const sanitized = SentinelSecurityZonesEngine.sanitizeTelemetry(leaked);
  assert.ok(!sanitized.includes(dummyKey));
  assert.ok(sanitized.includes('[REDACTED_SECRET_KEY]'));

  // Zone access boundary assertions
  assert.throws(() => {
    SentinelSecurityZonesEngine.assertZoneAccess('ZONE_3_INTELLIGENCE', 'ZONE_0_SIGNING', 'SIGN_TRANSACTION');
  }, /AI != SIGNER/);

  assert.throws(() => {
    SentinelSecurityZonesEngine.assertZoneAccess('ZONE_5_RESEARCH', 'ZONE_1_EXECUTION', 'SUBMIT_TRANSACTION');
  }, /Unauthorized bypass/);

  // Execution permit verification
  const validPermit = {
    permit_id: 'p_1',
    token_mint: 'MINT_1',
    action: 'BUY',
    max_amount_lamports: 100_000_000,
    max_slippage_bps: 150,
    authorized_by_guardian: true,
    issued_at_ms: Date.now() - 1000,
    expires_at_ms: Date.now() + 5000,
    thesis_id: 'th_1',
    signature_token: 'sig_ok'
  };
  assert.equal(SentinelSecurityZonesEngine.verifyExecutionPermit(validPermit).is_valid, true);

  const expiredPermit = { ...validPermit, expires_at_ms: Date.now() - 500 };
  const expCheck = SentinelSecurityZonesEngine.verifyExecutionPermit(expiredPermit);
  assert.equal(expCheck.is_valid, false);
  assert.ok(expCheck.reason?.includes('expired'));
});

test('Layer 2 - Hypatia Objective Alignment Engine', () => {
  // Good action: Level 7 opportunity that preserves higher levels
  const benignAction = {
    action_id: 'act_1',
    primary_benefit: HypatiaObjectiveLevel.OPPORTUNITY,
    potential_impacts: [
      { level: HypatiaObjectiveLevel.OPPORTUNITY, delta_score: +10, justification: 'High volume breakout' },
      { level: HypatiaObjectiveLevel.CAPITAL_PRESERVATION, delta_score: +2, justification: 'Sized below 1% portfolio' }
    ]
  };
  const eval1 = HypatiaObjectiveAlignmentEngine.evaluateAction(benignAction);
  assert.equal(eval1.is_aligned, true);

  // Goodhart violation: Seeking opportunity but harming Hard Risk
  const toxicAction = {
    action_id: 'act_2',
    primary_benefit: HypatiaObjectiveLevel.OPPORTUNITY,
    potential_impacts: [
      { level: HypatiaObjectiveLevel.OPPORTUNITY, delta_score: +50, justification: '100x potential pump' },
      { level: HypatiaObjectiveLevel.HARD_RISK, delta_score: -30, justification: 'Bypasses max drawdown limit' }
    ]
  };
  const eval2 = HypatiaObjectiveAlignmentEngine.evaluateAction(toxicAction);
  assert.equal(eval2.is_aligned, false);
  assert.ok(eval2.blocking_violation?.includes('Goodhart Violation'));
});

test('Layer 2 - Faraday Resilience & Watson Diagnostics', () => {
  const faraday = new FaradayResilienceEngine();
  faraday.registerSubsystem('guardian', 'P0_SAFETY');
  faraday.registerSubsystem('sentinel', 'P0_SAFETY');
  faraday.registerSubsystem('von_neumann', 'P1_EXECUTION');
  faraday.registerSubsystem('bohr', 'P2_INTELLIGENCE');

  // Nominal state
  let status = faraday.evaluateSystemMode();
  assert.equal(status.mode, 'NORMAL');

  // P0 Safety failure -> EXECUTION_HALT
  faraday.reportHeartbeat('guardian', 12, 'RPC connection severed');
  status = faraday.evaluateSystemMode();
  assert.equal(status.mode, 'EXECUTION_HALT');
  assert.ok(status.reason.includes('P0 Safety Failure'));

  // Watson diagnosis
  const watson = new WatsonSystemDiagnosisEngine();
  watson.recordTrace({
    trace_id: 'tr_101',
    token_id: 'MINT_TEST',
    event_id: 'ev_1',
    timestamp_ms: Date.now(),
    phase: 'GUARDIAN_CHECK',
    outcome: 'FILTERED',
    explanation: 'Liquidity 2.1 SOL is below required minimum threshold 5.0 SOL.',
    metadata: { remedy: 'Wait for pool LP deposit' }
  });

  const diag = watson.diagnose('MINT_TEST', 'WHY_FILTERED');
  assert.ok(diag.root_cause.includes('below required minimum threshold'));
  assert.equal(diag.confidence, 0.95);
});
