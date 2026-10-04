import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableGenerationFenceAuthority } from '../../dist/platform/execution/durable-generation-fence.js';
import { NoLandProofAuthority } from '../../dist/platform/execution/no-land-proof.js';

test('unverified no-land prototype output cannot advance or rewrite a durable generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-noland-prototype-'));
  try {
    const storage = join(directory, 'generation.json');
    const fence = new DurableGenerationFenceAuthority(storage);
    const initial = await fence.acquireInitialGeneration('intent-noland-prototype', 'observed-signature', 1100);
    const before = await readFile(storage, 'utf8');

    // These provider fields are caller assertions, not authenticated RPC evidence.
    const claimed = NoLandProofAuthority.evaluateProof({
      signature: 'observed-signature',
      cluster: 'mainnet-beta',
      transactionLifetime: {
        blockhash: 'claimed-blockhash',
        startSlot: 1000n,
        lastValidBlockHeight: 1100n,
        lastValidSlot: 1150n,
      },
      searchRange: { searchStartSlot: 990n, searchEndSlot: 1200n },
      commitmentLevel: 'finalized',
      providerResults: [
        {
          providerEndpoint: 'https://archive-a.invalid',
          providerType: 'ARCHIVE_RPC',
          isHealthy: true,
          archiveCoverageStartSlot: 900n,
          archiveCoverageEndSlot: 1300n,
          signatureFound: false,
          queriedAt: '2026-10-04T00:00:00.000Z',
          latencyMs: 1,
        },
        {
          providerEndpoint: 'https://archive-b.invalid',
          providerType: 'ARCHIVE_RPC',
          isHealthy: true,
          archiveCoverageStartSlot: 900n,
          archiveCoverageEndSlot: 1300n,
          signatureFound: false,
          queriedAt: '2026-10-04T00:00:00.000Z',
          latencyMs: 1,
        },
      ],
    });
    assert.equal(claimed.certified, true);
    if (!claimed.certified) return;

    await assert.rejects(
      fence.advanceGeneration('intent-noland-prototype', 'replacement-signature', 1300, claimed.certificate),
      /TERMINAL_TRANSITION_UNAVAILABLE/,
    );
    assert.deepEqual(await fence.getActiveGeneration('intent-noland-prototype'), initial);
    assert.equal(await readFile(storage, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
