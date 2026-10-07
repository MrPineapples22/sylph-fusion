import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../../dist/store.js';
import {IngestionGapReconciler} from '../../dist/platform/ingestion/gap-reconciler.js';

test('backfill certificates persist through the production Store before gap resolution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-recovery-pipeline-'));
  const databasePath = join(directory, 'state.sqlite');
  const store = new Store(databasePath);
  const secondStore = new Store(databasePath);
  const reconciler = new IngestionGapReconciler(100);
  let certifiedGapId;
  try {
    reconciler.setRecoveryCertificateJournal(store);
    reconciler.setBackfillHandler(async gap => {
      certifiedGapId = gap.gapId;
      return Object.freeze({
      certificateId: `pipeline-certificate-${gap.gapId}`,
      gapId: gap.gapId,
      startSlot: gap.startSlot,
      endSlot: gap.endSlot,
      providerId: gap.providerId ?? 'pipeline-provider',
      classification: gap.classification ?? 'UNKNOWN',
      lane: gap.lane ?? 'CHAIN_BLOCK',
      recoveredEventIds: Object.freeze([]),
      perSlotStatus: Object.freeze(Object.fromEntries(
        Array.from({length: gap.endSlot - gap.startSlot + 1}, (_, index) => [gap.startSlot + index, 'EMPTY']),
      )),
      stateRoot: 'a'.repeat(64),
      coverageRoot: 'b'.repeat(64),
      isVerified: true,
      certifiedAtMs: Date.now(),
      });
    });

    reconciler.registerSlot(1, 1, true, {providerId: 'pipeline-provider'});
    reconciler.registerSlot(3, 1, true, {providerId: 'pipeline-provider'});
    for (let retry = 0; retry < 100 && reconciler.hasUnresolvedGaps(); retry++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    assert.equal(reconciler.hasUnresolvedGaps(), false, JSON.stringify(reconciler.getReport()));
    const certificate = reconciler.getRecoveryCertificate(certifiedGapId);
    assert.ok(certificate, 'the accepted proof remains available from the reconciler snapshot');
    assert.equal(JSON.stringify(await store.getVerifiedRecoveryCertificate(certificate.certificateId)), JSON.stringify(certificate));
    await secondStore.saveVerifiedRecoveryCertificate(certificate);
    assert.equal(JSON.stringify(await secondStore.getVerifiedRecoveryCertificate(certificate.gapId)), JSON.stringify(certificate));
  } finally {
    await Promise.all([store.close(), secondStore.close()]);
    await rm(directory, {recursive: true, force: true});
  }
});
