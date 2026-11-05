import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RuntimeDivergenceAuditor } from '../../dist/platform/pipeline/runtime-divergence.js';
import { CapitalBarrierKernel } from '../../dist/intelligence/capital/capital-barrier-kernel.js';
import { PaperPortfolio } from '../../dist/paper.js';
import { SqliteFusionJournalStore } from '../../dist/platform/pipeline/fusion-journal-store.js';

test('missing independent shadow evaluation cannot count as parity', () => {
  const audit = new RuntimeDivergenceAuditor();
  const gap = audit.recordNotEvaluated({
    mint: 'test-mint', candidateGenerationId: 'test-generation',
    stage: 'ENTRY_ATTEMPT', reason: 'INDEPENDENT_SHADOW_DECISION_NOT_RUN',
    evaluatedAt: '2026-11-05T00:00:00.000Z',
  });
  assert.equal(gap.status, 'NOT_EVALUATED');
  assert.equal(audit.getAllEvaluations().length, 0);
  assert.equal(audit.getDivergenceCount(), 0);
  assert.equal(audit.getUnassessed().length, 1);
  assert.equal(gap.recordHash.length, 64);
  const other = audit.recordNotEvaluated({
    mint: 'test-mint', candidateGenerationId: 'test-generation',
    stage: 'RESTRICTION', reason: 'INDEPENDENT_SHADOW_DECISION_NOT_RUN',
    evaluatedAt: '2026-11-05T00:00:00.000Z',
  });
  assert.notEqual(other.recordHash, gap.recordHash);
});

const base = {
  proposedSizeSol: 0.01, totalBankrollSol: 2,
  currentDrawdownPct: 0, dailyRealizedLossSol: 0,
  maxDailyLossSol: 0.2, creatorClusterExposureSol: 0,
  maxCreatorExposureSol: 0.5, routeExposureSol: 0,
  maxRouteExposureSol: 1, stressedExitCapacitySol: 0.5,
  modelUncertainty: 0.1, executionReliability: 0.9, truthDebtCount: 0,
};
const riskKeys = [
  'proposedSizeSol', 'totalBankrollSol', 'currentDrawdownPct',
  'dailyRealizedLossSol', 'maxDailyLossSol', 'creatorClusterExposureSol',
  'maxCreatorExposureSol', 'routeExposureSol', 'maxRouteExposureSol',
  'stressedExitCapacitySol', 'modelUncertainty', 'executionReliability',
  'truthDebtCount',
];
const recompute = (inputs, verdict) => createHash('sha256').update(JSON.stringify({
  schemaVersion: 2,
  inputs: riskKeys.map(k => [k, String(inputs[k])]),
  status: verdict.status,
  authorizedSize: String(verdict.authorizedSizeSol),
  evaluatedAtMs: verdict.evaluatedAtMs,
})).digest('hex');

test('capital barrier cryptographically binds all its inputs', () => {
  const original = CapitalBarrierKernel.evaluateCapitalBarrier(base);
  assert.equal(original.capitalBarrierHash, recompute(base, original));
  for (const key of riskKeys) {
    const changed = { ...base, [key]: base[key] + 0.0001 };
    const verdict = CapitalBarrierKernel.evaluateCapitalBarrier(changed);
    assert.equal(verdict.capitalBarrierHash, recompute(changed, verdict), key);
  }
});

test('capital barrier fails closed when a critical numeric input is unavailable or invalid', () => {
  for (const inputs of [
    { ...base, stressedExitCapacitySol: Number.NaN },
    { ...base, totalBankrollSol: 0 },
    { ...base, modelUncertainty: Number.POSITIVE_INFINITY },
    { ...base, executionReliability: -1 },
    { ...base, truthDebtCount: 0.5 },
  ]) {
    const result = CapitalBarrierKernel.evaluateCapitalBarrier(inputs);
    assert.equal(result.status, 'DENIED');
    assert.deepEqual(result.denialReasons, ['INVALID_CAPITAL_BARRIER_INPUT']);
  }
});

test('existing corrupt paper snapshots cannot silently reinitialize funds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-p0-paper-'));
  try {
    const file = join(dir, 'paper.json');
    await new PaperPortfolio(file).start(); // missing file is a new account
    await writeFile(file, '{truncated', 'utf8');
    await assert.rejects(new PaperPortfolio(file).start(), /PAPER_SNAPSHOT_UNREADABLE/);
    assert.equal(await readFile(file, 'utf8'), '{truncated');
    await writeFile(file, JSON.stringify({ version: 1, cash: '500', fills: [], positions: null }));
    await assert.rejects(new PaperPortfolio(file).start(), /PAPER_SNAPSHOT_INVALID/);
    await writeFile(file, 'null');
    await assert.rejects(new PaperPortfolio(file).start(), /PAPER_SNAPSHOT_INVALID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('SQLite Fusion journal commits and recovers atomic revisions and hash-chain head', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-p0-fusion-store-'));
  const file = join(dir, 'fusion.sqlite');
  const transition = {
    economicFactId: 'economic-fact-A',
    expectedRevision: 0n,
    newRevision: 1n,
    fromState: 'OBSERVED',
    toState: 'EVIDENCE_CERTIFIED',
    previousStateRoot: 'root-before',
    nextStateRoot: 'root-after',
    transitionPayloadRoot: 'payload',
    certificate: 'certificate',
    certificateHash: 'certificate-hash',
    journalEntryId: 'entry-A',
    envelopeId: 'envelope-A',
    envelopeRoot: 'envelope-root',
    observedAt: '2026-11-05T00:00:00.000Z',
  };
  let store;
  try {
    assert.throws(() => new SqliteFusionJournalStore(':memory:'), /DURABLE_PATH_REQUIRED/);
    store = new SqliteFusionJournalStore(file);
    const first = await store.appendTransitionAtomic(transition);
    assert.equal(first.sequence, 1n);
    assert.equal((await store.loadHead()).lastEntryHash, first.entryHash);
    store.close(); store = null;

    store = new SqliteFusionJournalStore(file);
    assert.equal((await store.loadHead()).sequence, 1n);
    assert.equal((await store.readByEconomicFact('economic-fact-A'))[0].entryHash, first.entryHash);
    await assert.rejects(store.appendTransitionAtomic(transition), /STALE_PROPOSAL/);
    await assert.rejects(store.compareAndSwapRevision('economic-fact-A', 1n, 2n), /REQUIRES_ATOMIC_TRANSITION/);

    const second = await store.appendTransitionAtomic({
      ...transition,
      expectedRevision: 1n,
      newRevision: 2n,
      journalEntryId: 'entry-B',
      fromState: 'EVIDENCE_CERTIFIED',
      toState: 'TEMPORALLY_VALID',
      previousStateRoot: 'root-after',
      nextStateRoot: 'root-final',
    });
    assert.equal(second.previousEntryHash, first.entryHash);
    assert.equal((await store.readFromSequence(1n)).length, 2);
    assert.equal((await store.loadHead()).totalEntries, 2);
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
