import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey } from '@solana/web3.js';
import { CertifiedLiveExecutionCoordinator } from '../../dist/platform/execution/certified-live-coordinator.js';
import { DurableGenerationFenceAuthority } from '../../dist/platform/execution/durable-generation-fence.js';
import { NoLandVerificationAuthority } from '../../dist/platform/execution/no-land-certificate.js';
import { HierarchicalReservationEngine } from '../../dist/intelligence/capital/reservations.js';

const identity = { intentId: 'held-intent', generation: 1, signature: 'observed-signature', lastValidBlockHeight: 1000 };
const publicKey = new PublicKey(new Uint8Array(32).fill(1));

for (const observation of [
  { name: 'missing transaction with expired blockhash', result: null, height: 2000 },
  { name: 'missing transaction with maximum block height', result: null, height: Number.MAX_SAFE_INTEGER },
  { name: 'missing transaction with current blockhash', result: null, height: 999 },
  { name: 'missing transaction with unavailable height provider', result: null, heightError: true },
  { name: 'RPC rejection', error: new Error('provider response unavailable') },
  { name: 'missing transaction result', result: undefined },
  { name: 'response with no slot', result: {} },
  { name: 'response with zero slot', result: { slot: 0 } },
  { name: 'present transaction with null metadata', result: { slot: 1, meta: null } },
  { name: 'present transaction with no metadata', result: { slot: 1 } },
  { name: 'present transaction with missing balances', result: { slot: 1, meta: { err: null, fee: 5000 } } },
  { name: 'present transaction with mismatched balances', result: { slot: 1, meta: { err: null, fee: 5000, preBalances: [6000], postBalances: [] } } },
  { name: 'present transaction with fractional slot', result: { slot: 1.5, meta: {} } },
  { name: 'present transaction with negative slot', result: { slot: -1, meta: {} } },
  { name: 'present transaction with string slot', result: { slot: '1', meta: {} } },
  { name: 'present transaction with nonfinite slot', result: { slot: NaN, meta: {} } },
  { name: 'present instruction error with incomplete effects', result: { slot: 1, meta: { err: { InstructionError: [0, 'failure'] }, fee: 5000 } } },
  { name: 'superficially complete transaction with unrelated signature', result: {
    slot: 1, transaction: { signatures: ['unrelated-signature'] },
    meta: { err: null, fee: 5000, preBalances: [6000], postBalances: [1000], preTokenBalances: [], postTokenBalances: [] },
  } },
  { name: 'superficially complete transaction still lacks trusted scope', result: {
    slot: 1, transaction: { signatures: [identity.signature] },
    meta: { err: null, fee: 5000, preBalances: [6000], postBalances: [1000], preTokenBalances: [], postTokenBalances: [] },
  } },
]) {
  test(`reconciliation retains unknown authority: ${observation.name}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'sylph-noland-'));
    try {
      const storage = join(folder, 'generation.json');
      const generations = new DurableGenerationFenceAuthority(storage);
      const reservations = new HierarchicalReservationEngine();
      let lookups = 0;
      let heights = 0;
      let terminalTransitions = 0;
      const rpc = {
        // The pool cannot honestly attribute a request to this nominal endpoint.
        endpoints: [{ get rpcEndpoint() { throw new Error('must not fabricate provider attribution'); } }],
        connection: {
          async getTransaction(signature, options) {
            lookups++;
            assert.equal(signature, identity.signature);
            assert.equal(options.commitment, 'finalized');
            if (observation.error) throw observation.error;
            return observation.result;
          },
          async getBlockHeight() {
            heights++;
            if (observation.heightError) throw new Error('height unavailable');
            return observation.height;
          },
        },
      };
      const coordinator = new CertifiedLiveExecutionCoordinator(
        { MODE: 'live' }, rpc, {},
        { publicKey, async signTransactionMessage() { throw new Error('must not sign'); } },
        reservations, generations,
      );
      coordinator.acquireDurableReservation({
        intentId: identity.intentId, portfolioId: 'p', strategyId: 's', mint: publicKey,
        callerPublicKey: publicKey, side: 'buy', amountLamportsOrTokens: 1_000_000n,
        maxSlippageBps: 100, createdAt: 0,
      }, 1);
      await coordinator.allocateExecutionGeneration(identity.intentId, identity.signature, identity.lastValidBlockHeight);
      const persistedBefore = await readFile(storage, 'utf8');
      const reservationBefore = structuredClone(reservations.getIntent(identity.intentId));
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(
          coordinator.reconcileFinalChainOutcome(identity).then(certificate => {
            terminalTransitions++;
            return generations.advanceGeneration(identity.intentId, 'next-signature', 3000, certificate);
          }),
          /TRANSACTION_OUTCOME_UNKNOWN/,
        );
      }
      assert.equal(lookups, 2);
      assert.equal(heights, 0, 'height cannot resolve historical absence');
      assert.equal(terminalTransitions, 0);
      assert.equal(await readFile(storage, 'utf8'), persistedBefore);
      assert.equal((await generations.getActiveGeneration(identity.intentId)).generation, 1);
      assert.deepEqual(reservations.getIntent(identity.intentId), reservationBefore);
      assert.equal(reservations.getCapability(identity.intentId).is_released, false);
      assert.equal(reservations.getActiveIntentCount(), 1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}

test('directly constructed and restored checksum-valid no-land records cannot advance a generation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-noland-forged-'));
  try {
    const storage = join(folder, 'generation.json');
    const fence = new DurableGenerationFenceAuthority(storage);
    await fence.acquireInitialGeneration(identity.intentId, identity.signature, identity.lastValidBlockHeight);
    const before = await readFile(storage, 'utf8');
    for (const observedBlockHeight of [999, 1001, 1033, Number.MAX_SAFE_INTEGER]) {
      const fields = { ...identity, observedBlockHeight, finalizedSlot: 2000, rpcEndpoint: 'https://nominal.invalid' };
      const forged = {
        ...fields, certificateType: 'NO_LAND_CERTIFICATE', verifiedAt: Date.now(),
        proofDigest: NoLandVerificationAuthority.computeNoLandDigest(fields),
      };
      // Checksums remain diagnostics; this explicitly proves they confer no authority.
      assert.equal(NoLandVerificationAuthority.validateCertificateDigest(forged), true);
      for (const record of [forged, JSON.parse(JSON.stringify(forged))]) {
        await assert.rejects(
          new DurableGenerationFenceAuthority(storage).advanceGeneration(identity.intentId, 'next', 3000, record),
          /NO_LAND_CERTIFICATION_UNAVAILABLE/,
        );
      }
      assert.equal(await readFile(storage, 'utf8'), before);
      for (const claimedSearch of [true, false]) {
        assert.throws(() => NoLandVerificationAuthority.certifyNoLand({
          ...fields, searchHistoryConfirmedNotFound: claimedSearch,
        }), /NO_LAND_CERTIFICATION_UNAVAILABLE/);
      }
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
