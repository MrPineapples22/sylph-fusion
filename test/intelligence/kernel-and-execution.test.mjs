import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IntegrationKernel } from '../../dist/intelligence/kernel/integration-kernel.js';
import { DecisionTrace } from '../../dist/intelligence/kernel/decision-trace.js';
import { PriorityBackpressureController } from '../../dist/intelligence/kernel/backpressure.js';
import { TokenProgramInspector } from '../../dist/intelligence/execution/token-inspector.js';
import { ExecutionStateMachine } from '../../dist/intelligence/execution/execution-state-machine.js';

test('IntegrationKernel: tracks component lifecycle and verifies data passage', () => {
  const kernel = new IntegrationKernel();

  kernel.registerComponent({
    componentId: 'feed-ingest',
    layer: 'data_truth',
    downstreamConsumers: ['token-state'],
  });

  kernel.registerComponent({
    componentId: 'token-state',
    layer: 'state',
    upstreamDependencies: ['feed-ingest'],
    downstreamConsumers: ['decision-kernel'],
  });

  kernel.recordDataPassage('feed-ingest', 'RECEIVE');
  kernel.recordDataPassage('feed-ingest', 'PRODUCE');

  kernel.recordDataPassage('token-state', 'RECEIVE');
  kernel.recordDataPassage('token-state', 'PROCESS');
  kernel.recordDataPassage('token-state', 'CONSUME');
  kernel.updateLifecycleState('token-state', 'VERIFIED');

  const scorecard = kernel.generateIntegrationScorecard();
  assert.equal(scorecard.totalComponents, 2);
  assert.equal(scorecard.activeCount, 2);
  assert.equal(scorecard.fullyVerifiedCount, 1);
});

test('DecisionTrace & Backpressure: propagates correlation IDs and preserves P0 during overload', () => {
  const trace = new DecisionTrace({
    eventId: 'evt-100',
    mint: 'Mint11111111111111111111111111111111111111',
  });

  trace.recordStep({
    stepName: 'token_audit',
    componentId: 'token-inspector',
    durationMs: 5,
    inputs: { mint: 'Mint111' },
    outputs: { riskScore: 10 },
    status: 'PASS',
  });

  const serialized = trace.serializeTrace();
  assert.equal(serialized.steps.length, 1);
  assert.equal(serialized.overallStatus, 'PASS');
  assert.match(serialized.steps[0].inputsHash, /^[a-f0-9]{64}$/);

  // Finalize and seal the trace
  const finalized = trace.finalize();
  assert.equal(trace.isSealed(), true);
  assert.match(finalized.traceHash, /^[a-f0-9]{64}$/);
  assert.equal(trace.getTraceHash(), finalized.traceHash);

  // Attempting to record step on sealed trace must throw
  assert.throws(() => {
    trace.recordStep({
      stepName: 'illegal_post_finalize_step',
      componentId: 'token-inspector',
      durationMs: 1,
      inputs: {},
      outputs: {},
      status: 'FAIL',
    });
  }, /sealed against mutation/);

  // Priority Backpressure
  const bp = new PriorityBackpressureController(10); // Small limit to test shedding

  // Enqueue 15 P4 analytics items (limit 5) -> sheds oldest
  for (let i = 0; i < 15; i++) {
    bp.enqueue({
      id: `p4-${i}`,
      priority: 'P4_ANALYTICS',
      payload: { idx: i },
      enqueuedAtMs: Date.now(),
    });
  }

  // Enqueue 2 P0 safety items
  bp.enqueue({ id: 'p0-1', priority: 'P0_SAFETY_EXECUTION', payload: { act: 'halt' }, enqueuedAtMs: Date.now() });
  bp.enqueue({ id: 'p0-2', priority: 'P0_SAFETY_EXECUTION', payload: { act: 'exit' }, enqueuedAtMs: Date.now() });

  const stats = bp.getStats();
  assert.ok(stats.totalShed > 0, 'P4 items should be shed during queue saturation');
  assert.equal(stats.depths.P0_SAFETY_EXECUTION, 2, 'P0 safety items must never be shed');

  // Dequeue returns P0 first
  const firstOut = bp.dequeue();
  assert.equal(firstOut?.priority, 'P0_SAFETY_EXECUTION');
  assert.equal(firstOut?.id, 'p0-1');
});

test('TokenProgramInspector & ExecutionStateMachine: detects backdoors and enforces assertions', () => {
  const inspector = new TokenProgramInspector();

  // Rogue token with active freeze authority and permanent delegate backdoor
  const rogueReport = inspector.inspect({
    mint: 'Rogue111111111111111111111111111111111111',
    programOwner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    mintAuthority: null,
    freezeAuthority: 'AttackerFreezeAuthority1111111111111111',
    hasPermanentDelegate: true,
    transferFeeBps: 1000, // 10% fee
    hasTransferHook: true,
    isNonTransferable: false,
    hasCpiGuard: false,
    defaultAccountFrozen: false,
  });

  assert.equal(rogueReport.isAllowed, false);
  assert.equal(rogueReport.hardDisqualifiers.includes('active_freeze_authority'), true);
  assert.equal(rogueReport.hardDisqualifiers.includes('permanent_delegate_backdoor'), true);
  assert.equal(rogueReport.hardDisqualifiers.includes('excessive_transfer_fee_1000bps'), true);

  // Clean token
  const cleanReport = inspector.inspect({
    mint: 'Clean111111111111111111111111111111111111',
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    mintAuthority: null,
    freezeAuthority: null,
    hasPermanentDelegate: false,
    transferFeeBps: null,
    hasTransferHook: false,
    isNonTransferable: false,
    hasCpiGuard: false,
    defaultAccountFrozen: false,
  });

  assert.equal(cleanReport.isAllowed, true);
  assert.equal(cleanReport.hardDisqualifiers.length, 0);

  // Execution State Machine
  let state = ExecutionStateMachine.transition('CREATED', 'VALIDATED');
  state = ExecutionStateMachine.transition(state, 'BUILT');
  state = ExecutionStateMachine.transition(state, 'SIGNED');
  state = ExecutionStateMachine.transition(state, 'SUBMITTED');
  state = ExecutionStateMachine.transition(state, 'CONFIRMED');
  assert.equal(state, 'CONFIRMED');

  // Pre-Execution Assertion: Fails on stale quote
  assert.throws(() => {
    ExecutionStateMachine.assertPreExecution({
      cashBalanceLamports: 10_000_000_000n,
      orderCostLamports: 1_000_000_000n,
      quoteAgeMs: 5000,
      maxQuoteAgeMs: 1500, // Quote is too old!
      blockhashValid: true,
      riskAuthorized: true,
      capitalReserved: true,
    });
  }, /Quote is stale/);

  // Post-Execution Assertion: Fails on non-positive buy fill
  assert.throws(() => {
    ExecutionStateMachine.assertPostExecution({
      signature: 'validSignature1111111111111111111111111111111111111111111111111111111111111111',
      chainConfirmed: true,
      tokenDelta: 0n, // Invalid fill!
      solDelta: -1_000_000_000n,
      expectedSide: 'buy',
    });
  }, /Buy execution resulted in non-positive token delta/);
});
