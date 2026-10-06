import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { encode, instructionHash, traceHash as referenceTraceHash } from '../oracles/cpi-trace-normalizer-v1-reference.mjs';

const { normalizeSimulationCpiTrace, verifyNormalizedCpiTrace } = await import('../../dist/platform/simulation/cpi-trace-normalizer.js');
const programId = SystemProgram.programId.toBase58();
const programId2 = new PublicKey('11111111111111111111111111111112').toBase58();
const partial = (stackHeight, patch = {}) => ({
  accounts: [], data: '', programId, ...(stackHeight === Symbol.for('missing') ? {} : { stackHeight }), ...patch,
});
const parsed = (stackHeight, patch = {}) => ({
  parsed: { info: { amount: '1' }, type: 'transfer' }, program: 'system', programId,
  ...(stackHeight === Symbol.for('missing') ? {} : { stackHeight }), ...patch,
});
const group = (index, heights) => ({ index, instructions: heights.map(height => partial(height)) });

const traceHash = value => { const { traceHash: _old, ...payload } = value; return referenceTraceHash(payload); };

test('normalizes missing, null, unrequested, and requested-empty response states to exact hashes', () => {
  const cases = [
    [false, undefined, 'MISSING', 'UNAVAILABLE', 'bd2bb19867a010cbe324e4918193c1d27da0b01e114eaa99db573bfba8f0991d'],
    [true, undefined, 'MISSING', 'UNAVAILABLE', '86f1175c9f209037ad24464820c9e0d012a84eaaef60bdf29daf4198a2868e7a'],
    [true, null, 'NULL', 'UNAVAILABLE', 'c3facf6df6fb7e69e58ae2cccb52106bfdc001923aa3e676a5691d7b06b8cce1'],
    [false, [], 'ARRAY', 'UNAVAILABLE', '82406e65d7de1615e7b63776dd5416925995d0815aab944c5c9c5cfd03b16ef2'],
    [true, [], 'ARRAY', 'STRUCTURALLY_VALID', '595744ff14a2554c8c73d76b4d32a6851a79f81509d96c92e313ca2b52b9808f'],
  ];
  for (const [requested, response, responseFieldState, status, expectedHash] of cases) {
    const trace = normalizeSimulationCpiTrace(requested, 1, response);
    assert.equal(trace.responseFieldState, responseFieldState);
    assert.equal(trace.status, status);
    assert.deepEqual(trace.groups, []);
    assert.equal(trace.traceHash, expectedHash);
  }
});

test('reconstructs deterministic index parents across nested calls, siblings, and unwinds', () => {
  const trace = normalizeSimulationCpiTrace(true, 3, [
    { index: 0, instructions: [2, 3, 4, 2, 3].map(height => partial(height)) },
    { index: 2, instructions: [2, 2].map(height => parsed(height)) },
  ]);
  assert.equal(trace.status, 'STRUCTURALLY_VALID');
  assert.deepEqual(trace.groups[0].instructions.map(node => node.parent), [
    { kind: 'TOP_LEVEL', topLevelIndex: 0 },
    { kind: 'INNER', topLevelIndex: 0, innerIndex: 0 },
    { kind: 'INNER', topLevelIndex: 0, innerIndex: 1 },
    { kind: 'TOP_LEVEL', topLevelIndex: 0 },
    { kind: 'INNER', topLevelIndex: 0, innerIndex: 3 },
  ]);
  assert.deepEqual(trace.groups[1].instructions.map(node => node.parent), [
    { kind: 'TOP_LEVEL', topLevelIndex: 2 }, { kind: 'TOP_LEVEL', topLevelIndex: 2 },
  ]);
  assert.ok(Object.isFrozen(trace) && Object.isFrozen(trace.groups) && Object.isFrozen(trace.groups[0].instructions[0].parent));
  assert.equal(verifyNormalizedCpiTrace(trace), true);
});

test('matches independent nested-instruction and one-node trace hash vectors', () => {
  const trace = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [{
    parsed: { info: { amount: '1' }, type: 'transfer' }, program: 'system', programId, stackHeight: 2,
  }] }]);
  assert.equal(trace.groups[0].instructions[0].instructionHash, '70b1682c183cd398c6b74bd6831e61926c7913d876384e115c757ae339bf2e5a');
  assert.equal(trace.traceHash, 'bbdcec13f54e0e1e16ab5973bc047857352f57fa0702fa60be2911c484c9ed8b');
  assert.equal(trace.traceHash, traceHash(trace));
  assert.equal(verifyNormalizedCpiTrace(trace), true);
  const partialTrace = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [partial(2)] }]);
  assert.deepEqual({ ...partialTrace.groups[0].instructions[0].sourceFields }, {
    kind: 'PARTIALLY_DECODED', accounts: [], data: '', programId,
  });
  assert.equal(partialTrace.groups[0].instructions[0].instructionHash,
    'a0a29cf5d8c92827988e11f647c11f01441563b50ea019bc962c862f37dd8f90');
  assert.equal(partialTrace.traceHash, 'da7bb9c7eed849691161d4c78b8221f8a066bdf7f805d1f057f3f874e51a6b48');
  assert.equal(partialTrace.traceHash, traceHash(partialTrace));
  assert.equal(verifyNormalizedCpiTrace(partialTrace), true);
});

test('verifies source fields, instruction digests, status, parents, and full trace hash from contents', () => {
  const valid = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2)] }]);
  assert.equal(verifyNormalizedCpiTrace(valid), true);
  const badSourceKind = structuredClone(valid); badSourceKind.groups[0].instructions[0].sourceKind = 'PARTIALLY_DECODED';
  badSourceKind.traceHash = traceHash(badSourceKind);
  assert.equal(verifyNormalizedCpiTrace(badSourceKind), false);
  const badProgramId = structuredClone(valid); badProgramId.groups[0].instructions[0].programId = programId2;
  badProgramId.traceHash = traceHash(badProgramId);
  assert.equal(verifyNormalizedCpiTrace(badProgramId), false);
  const badDigest = structuredClone(valid); badDigest.groups[0].instructions[0].instructionHash = '0'.repeat(64);
  badDigest.traceHash = traceHash(badDigest);
  assert.equal(verifyNormalizedCpiTrace(badDigest), false);
  const changedSource = structuredClone(valid); changedSource.groups[0].instructions[0].sourceFields.parsed.info.amount = '2';
  changedSource.traceHash = traceHash(changedSource);
  assert.equal(verifyNormalizedCpiTrace(changedSource), false);
  const badParent = structuredClone(valid); badParent.groups[0].instructions[0].parent.topLevelIndex = 1;
  badParent.traceHash = traceHash(badParent);
  assert.equal(verifyNormalizedCpiTrace(badParent), false);
  const badStatus = structuredClone(valid); badStatus.status = 'PARTIAL'; badStatus.traceHash = traceHash(badStatus);
  assert.equal(verifyNormalizedCpiTrace(badStatus), false);

  // Unkeyed hashes prove only self-consistency: an author can replace source
  // content, recompute its instruction digest and trace hash, and still pass.
  const selfConsistentForgery = structuredClone(valid);
  const forgedNode = selfConsistentForgery.groups[0].instructions[0];
  forgedNode.sourceFields.parsed.info.amount = '999';
  forgedNode.instructionHash = instructionHash(forgedNode.sourceFields);
  selfConsistentForgery.traceHash = traceHash(selfConsistentForgery);
  assert.equal(verifyNormalizedCpiTrace(selfConsistentForgery), true);
});

test('normalized trace verification rejects accessors before reading source fields', () => {
  const valid = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2)] }]);
  const untrusted = structuredClone(valid);
  const sourceFields = { parsed: { info: { amount: '1' }, type: 'transfer' }, program: 'system', programId };
  let getterCalls = 0;
  Object.defineProperty(sourceFields, 'kind', { enumerable: true, get() { getterCalls += 1; return 'PARSED'; } });
  untrusted.groups[0].instructions[0].sourceFields = sourceFields;
  assert.equal(verifyNormalizedCpiTrace(untrusted), false);
  assert.equal(getterCalls, 0);
});

test('normalized trace verification rejects oversized malformed parents before canonical encoding', () => {
  const trace = structuredClone(normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2)] }]));
  trace.groups[0].instructions[0].parent = {
    kind: 'INNER', topLevelIndex: 0, innerIndex: 0,
    payload: ['x'.repeat(800_000), 'y'.repeat(800_000), 'z'.repeat(800_000)],
  };
  assert.equal(verifyNormalizedCpiTrace(trace), false);
});

test('a trace preimage just under the byte ceiling verifies even when its hash envelope crosses it', () => {
  const first = 'x'.repeat(999_900);
  let low = 0;
  let high = 999_999;
  let best;
  while (low <= high) {
    const secondLength = Math.floor((low + high) / 2);
    let candidate;
    try {
      candidate = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2, {
        parsed: { first, second: 'y'.repeat(secondLength) },
      })] }]);
    } catch {
      high = secondLength - 1;
      continue;
    }
    const { traceHash: _hash, ...preimage } = candidate;
    if (Buffer.byteLength(encode(preimage), 'utf8') <= 2_000_000) {
      best = candidate;
      low = secondLength + 1;
    } else high = secondLength - 1;
  }
  assert.ok(best, 'a valid near-limit trace is constructed');
  const { traceHash: _hash, ...preimage } = best;
  assert.ok(Buffer.byteLength(encode(preimage), 'utf8') > 1_999_800);
  assert.ok(Buffer.byteLength(encode(best), 'utf8') > 2_000_000);
  assert.equal(verifyNormalizedCpiTrace(best), true);
});

test('normalized trace verification preflights aggregate node, instruction, and byte limits', () => {
  const parsedProperties = Object.fromEntries(Array.from({ length: 40 }, (_v, index) => [`field${index}`, 'x']));
  const manyNodeFields = { kind: 'PARSED', parsed: parsedProperties, program: 'system', programId };
  const manyNode = { programId, stackHeight: 2, sourceKind: 'PARSED', sourceFields: manyNodeFields,
    instructionHash: '0'.repeat(64), parent: { kind: 'TOP_LEVEL', topLevelIndex: 0 } };
  const nodeHeavyTrace = { normalizationVersion: 1, status: 'STRUCTURALLY_VALID', coverage: 'REPORTED_NODES_ONLY',
    recordingRequested: true, responseFieldState: 'ARRAY', topLevelInstructionCount: 9,
    groups: Array.from({ length: 9 }, (_v, index) => ({ topLevelIndex: index,
      instructions: Array.from({ length: 100 }, () => ({ ...manyNode, parent: { kind: 'TOP_LEVEL', topLevelIndex: index } })) })),
    traceHash: '0'.repeat(64) };
  assert.equal(verifyNormalizedCpiTrace(nodeHeavyTrace), false);

  const largeSourceFields = { kind: 'PARSED', parsed: { payload: 'x'.repeat(700_000) }, program: 'system', programId };
  const byteHeavyTrace = { normalizationVersion: 1, status: 'STRUCTURALLY_VALID', coverage: 'REPORTED_NODES_ONLY',
    recordingRequested: true, responseFieldState: 'ARRAY', topLevelInstructionCount: 3,
    groups: Array.from({ length: 3 }, (_v, index) => ({ topLevelIndex: index, instructions: [{
      programId, stackHeight: 2, sourceKind: 'PARSED', sourceFields: largeSourceFields,
      instructionHash: '0'.repeat(64), parent: { kind: 'TOP_LEVEL', topLevelIndex: index },
    }] })), traceHash: '0'.repeat(64) };
  assert.equal(verifyNormalizedCpiTrace(byteHeavyTrace), false);

  const tooManyInstructions = { normalizationVersion: 1, status: 'STRUCTURALLY_VALID', coverage: 'REPORTED_NODES_ONLY',
    recordingRequested: true, responseFieldState: 'ARRAY', topLevelInstructionCount: 2,
    groups: [0, 1].map(index => ({ topLevelIndex: index,
      instructions: Array.from({ length: 10_000 }, () => ({ ...manyNode, parent: { kind: 'TOP_LEVEL', topLevelIndex: index } })) })),
    traceHash: '0'.repeat(64) };
  assert.equal(verifyNormalizedCpiTrace(tooManyInstructions), false);
});

test('normalized trace verification preflights full-payload nodes before rebuilding groups', () => {
  const sourceFields = { kind: 'PARTIALLY_DECODED', accounts: [], data: '', programId };
  const trace = { normalizationVersion: 1, status: 'STRUCTURALLY_VALID', coverage: 'REPORTED_NODES_ONLY',
    recordingRequested: true, responseFieldState: 'ARRAY', topLevelInstructionCount: 40,
    groups: Array.from({ length: 40 }, (_v, topLevelIndex) => ({ topLevelIndex,
      instructions: Array.from({ length: 100 }, () => ({ programId, stackHeight: 2, sourceKind: 'PARTIALLY_DECODED',
        sourceFields, instructionHash: '0'.repeat(64), parent: { kind: 'TOP_LEVEL', topLevelIndex } })) })),
    traceHash: '0'.repeat(64) };
  // Source fields, bytes, and instruction count are individually below their
  // caps; wrapper fields push the complete normalized payload over 65,536 nodes.
  assert.equal(verifyNormalizedCpiTrace(trace), false);
});

test('unknown heights preserve feasible partial paths but suppress every edge in that group', () => {
  for (const heights of [[2, null, 4], [null, 3, 4], [2, 3, 4, null, 2, null, 4], [2, 3, 4, null, 2]]) {
    const trace = normalizeSimulationCpiTrace(true, 1, [group(0, heights)]);
    assert.equal(trace.status, 'PARTIAL', JSON.stringify(heights));
    assert.ok(trace.groups[0].instructions.every(node => !Object.hasOwn(node, 'parent')));
  }
  const mixed = normalizeSimulationCpiTrace(true, 2, [group(0, [2, null, 3]), group(1, [2, 3])]);
  assert.equal(mixed.status, 'PARTIAL');
  assert.ok(mixed.groups[0].instructions.every(node => !Object.hasOwn(node, 'parent')));
  assert.ok(mixed.groups[1].instructions.every(node => Object.hasOwn(node, 'parent')));
});

test('rejects impossible known heights across unknown nodes and malformed stack values', () => {
  for (const heights of [
    [null, 4], [2, null, 5], [2, 3, 4, null, 2, null, 5],
    [3], [2, 4], [2, 3, 2, 4], [1, null], [2, null, -1], [2, null, 1.5], [2, null, 33],
  ]) {
    assert.throws(() => normalizeSimulationCpiTrace(true, 1, [group(0, heights)]), /CPI_TRACE_/ , JSON.stringify(heights));
  }
  const path32 = Array.from({ length: 31 }, (_value, index) => index + 2);
  assert.equal(normalizeSimulationCpiTrace(true, 1, [group(0, path32)]).status, 'STRUCTURALLY_VALID');
});

test('requires ordered sparse nonempty groups with indexes bound to top-level count', () => {
  assert.deepEqual(normalizeSimulationCpiTrace(true, 4, [group(1, [2]), group(3, [2])]).groups.map(item => item.topLevelIndex), [1, 3]);
  for (const groups of [
    [{ index: 2, instructions: [partial(2)] }, { index: 1, instructions: [partial(2)] }],
    [{ index: 1, instructions: [partial(2)] }, { index: 1, instructions: [partial(2)] }],
    [{ index: 4, instructions: [partial(2)] }],
    [{ index: 0, instructions: [] }],
  ]) assert.throws(() => normalizeSimulationCpiTrace(true, 4, groups), /CPI_TRACE_/);
  assert.throws(() => normalizeSimulationCpiTrace(true, 0, [{ index: 0, instructions: [partial(2)] }]), /CPI_TRACE_/);
});

test('accepts only the two exact simulation instruction unions and canonicalizes nested parsed fields', () => {
  const left = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2)] }]);
  const right = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [{
    programId, program: 'system', stackHeight: 2, parsed: { type: 'transfer', info: { amount: '1' } },
  }] }]);
  assert.equal(left.groups[0].instructions[0].instructionHash, right.groups[0].instructions[0].instructionHash);
  const omittedHeight = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [{ accounts: [], data: '', programId }] }]);
  assert.equal(omittedHeight.status, 'PARTIAL');
  assert.equal(omittedHeight.groups[0].instructions[0].stackHeight, null);
  for (const instruction of [
    { accounts: [], data: '', programId, parsed: {}, program: 'system', stackHeight: 2 },
    { accounts: [], data: '', programId, compiled: true, stackHeight: 2 },
    { parsed: {}, program: 'system', programId, accounts: [], stackHeight: 2 },
    { parsed: [], program: 'system', programId, stackHeight: 2 },
    { parsed: {}, program: '', programId, stackHeight: 2 },
    { accounts: ['not-a-public-key'], data: '', programId, stackHeight: 2 },
    { accounts: [], data: '', programId, stackHeight: undefined },
  ]) assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [instruction] }]), /CPI_TRACE_/);
});

test('rejects proxies, getters, sparse arrays, symbols, cycles, and non-JSON primitives without coercion', () => {
  let getterCalls = 0;
  const getterInstruction = { accounts: [], data: '', programId };
  Object.defineProperty(getterInstruction, 'stackHeight', { enumerable: true, get() { getterCalls += 1; return 2; } });
  const sparse = new Array(1);
  for (const response of [
    new Proxy([], {}), [{ index: 0, instructions: [new Proxy(partial(2), {})] }],
    [{ index: 0, instructions: [getterInstruction] }],
    [{ index: 0, instructions: sparse }],
    Object.assign([{ index: 0, instructions: [partial(2)] }], { extra: true }),
  ]) assert.throws(() => normalizeSimulationCpiTrace(true, 1, response), /CPI_TRACE_/);
  assert.equal(getterCalls, 0);
  const cyclicParsed = {}; cyclicParsed.self = cyclicParsed;
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2, { parsed: cyclicParsed })] }]), /CPI_TRACE_/);
  assert.throws(() => normalizeSimulationCpiTrace('true', 1, []), /CPI_TRACE_REQUEST_INVALID/);
  assert.throws(() => normalizeSimulationCpiTrace(true, '1', []), /CPI_TRACE_REQUEST_INVALID/);
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, {}), /CPI_TRACE_RESPONSE_INVALID/);
});

test('enforces bounded instruction, group, account, and top-level counts', () => {
  assert.throws(() => normalizeSimulationCpiTrace(true, 257, []), /CPI_TRACE_REQUEST_INVALID/);
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: Array(16_385).fill(partial(2)) }]), /CPI_TRACE_/);
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [partial(2, { accounts: Array(257).fill(programId) })] }]), /CPI_TRACE_/);
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, Array(257).fill({ index: 0, instructions: [partial(2)] })), /CPI_TRACE_/);
});

test('enforces aggregate source and full-trace UTF-8 byte budgets and recursive depth', () => {
  const multibyteAtLimit = normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2, {
    parsed: { payload: 'é'.repeat(500_000) },
  })] }]);
  assert.equal(multibyteAtLimit.status, 'STRUCTURALLY_VALID');
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2, {
    parsed: { payload: 'é'.repeat(500_001) },
  })] }]), /CPI_TRACE_STRING_TOO_LARGE/);

  const aggregateOver = Array.from({ length: 3 }, (_value, index) => ({
    index,
    instructions: [parsed(2, { parsed: { payload: `${index}${'x'.repeat(900_000)}` } })],
  }));
  assert.throws(() => normalizeSimulationCpiTrace(true, 3, aggregateOver), /CPI_TRACE_TOO_LARGE/);

  let deeplyNested = 'leaf';
  for (let depth = 0; depth < 33; depth += 1) deeplyNested = { child: deeplyNested };
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2, {
    parsed: deeplyNested,
  })] }]), /CPI_TRACE_TOO_COMPLEX/);

  const nearLimitParsed = { first: 'x'.repeat(999_700), second: 'y'.repeat(999_700) };
  assert.throws(() => normalizeSimulationCpiTrace(true, 1, [{ index: 0, instructions: [parsed(2, { parsed: nearLimitParsed })] }]), /CPI_TRACE_TOO_LARGE/);
});
