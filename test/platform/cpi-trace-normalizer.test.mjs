import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';

const { normalizeSimulationCpiTrace } = await import('../../dist/platform/simulation/cpi-trace-normalizer.js');
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
