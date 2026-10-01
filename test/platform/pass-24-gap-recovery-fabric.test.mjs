import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  CertifiedLiveExecutionCoordinator,
} from '../../dist/platform/execution/certified-live-coordinator.js';
import {
  IngestionGapReconciler,
} from '../../dist/platform/ingestion/gap-reconciler.js';
import {
  PointInTimeStateEngine,
} from '../../dist/intelligence/truth/point-in-time-state.js';
import {
  CensusRJournalAuthority,
} from '../../dist/platform/ingestion/census-r.js';
import {
  TemporalEvidenceGraph,
} from '../../dist/intelligence/graph/temporal-evidence-graph.js';

test('PASS-24 REQ-1 (Invariant 7): CertifiedLiveExecutionCoordinator strictly rejects non-LIVE ProcessingIntent', async () => {
  const mockKeypair = Keypair.generate();
  const liveCfg = { MODE: 'live' };
  const mockRpc = { endpoints: [{ url: 'http://127.0.0.1:8899', confirmed: true }] };
  const mockMarket = {};
  const signerGateway = {
    publicKey: mockKeypair.publicKey,
    signTransactionMessage: async (bytes) => new Uint8Array([...bytes, 255]),
  };

  const coordinator = new CertifiedLiveExecutionCoordinator(
    liveCfg,
    mockRpc,
    mockMarket,
    signerGateway
  );

  // 1. Repair intent must be immediately rejected at the execution firewall boundary
  const repairIntent = {
    intentId: 'intent-repair-001',
    callerPublicKey: mockKeypair.publicKey,
    poolAddress: Keypair.generate().publicKey,
    baseMint: Keypair.generate().publicKey,
    quoteMint: Keypair.generate().publicKey,
    side: 'BUY',
    amountLamportsOrTokens: 1_500_000_000n,
    maxSlippageBps: 100,
    processingIntent: 'HISTORICAL_REPAIR',
  };

  assert.throws(
    () => {
      coordinator.validateEconomicIntent(repairIntent);
    },
    (err) => {
      assert.match(err.message, /ECONOMIC_AUTHORITY_DENIED: ProcessingIntent must be LIVE/);
      return true;
    }
  );

  // 2. Deterministic replay intent must also be rejected
  const replayIntent = {
    ...repairIntent,
    intentId: 'intent-replay-002',
    processingIntent: 'DETERMINISTIC_REPLAY',
  };

  assert.throws(
    () => {
      coordinator.validateEconomicIntent(replayIntent);
    },
    (err) => {
      assert.match(err.message, /ECONOMIC_AUTHORITY_DENIED: ProcessingIntent must be LIVE/);
      return true;
    }
  );

  // 3. Intent with authorityEnvelope that is not LIVE must also be rejected
  const envelopeWithShadowIntent = {
    ...repairIntent,
    intentId: 'intent-envelope-003',
    processingIntent: 'LIVE',
    authorityEnvelope: {
      decisionId: 'dec-003',
      strategyId: 'strat-alpha',
      evidenceSetHash: 'hash-abc',
      coverageFrontierRoot: 'cov-root',
      modelPromotionHash: 'promo-root',
      processingIntent: 'SHADOW_REPLAY',
      issuedAtMs: Date.now(),
    },
  };

  assert.throws(
    () => {
      coordinator.validateEconomicIntent(envelopeWithShadowIntent);
    },
    (err) => {
      assert.match(err.message, /ECONOMIC_AUTHORITY_DENIED: Authority envelope processingIntent must be LIVE/);
      return true;
    }
  );
});

test('PASS-24 REQ-2 (Invariant 6): PointInTimeStateEngine eliminates lookahead bias via SYLPH_AS_KNOWN perspective', () => {
  const engine = new PointInTimeStateEngine();
  const mint = 'MintBitemporal11111111111111111111111111111';

  // Event 1: Original event at T=1000, received at T=1002
  engine.ingestEvent({
    eventId: 'evt-orig-1',
    eventType: 'BUY',
    mint,
    wallet: 'WalletAlpha1111111111111111111111111111111111',
    source: 'yellowstone_grpc',
    sourceTimestampMs: 1000,
    receivedTimestampMs: 1002,
    slot: 100,
    commitment: 'confirmed',
    chainState: 'CONFIRMED',
    payload: { amountSol: 1.0, priceSol: 0.05, liquiditySol: 20 },
    sourceConfidence: 1.0,
  });

  // Event 2: Repaired event that happened at T=1050 on Solana, but was discovered/repaired at T=2000!
  engine.ingestEvent({
    eventId: 'evt-repair-2',
    eventType: 'BUY',
    mint,
    wallet: 'WalletBeta11111111111111111111111111111111111',
    source: 'historical_repair',
    sourceTimestampMs: 1050,
    receivedTimestampMs: 2000, // Learned much later!
    slot: 105,
    commitment: 'finalized',
    chainState: 'FINAL',
    payload: { amountSol: 10.0, priceSol: 0.50, liquiditySol: 50 },
    sourceConfidence: 1.0,
  });

  // Decision made at T=1500 (between event 1 and discovery of repair):
  // Perspective 1: SYLPH_AS_KNOWN (Default: what SYLPH actually knew when making the decision at T=1500)
  const knownState = engine.get_token_state(mint, 1500, 200, { perspective: 'SYLPH_AS_KNOWN' });
  assert.ok(knownState, 'State must exist');
  assert.strictEqual(knownState.totalTxCount, 1, 'Repaired event known at T=2000 must NOT leak into T=1500 decision state');
  assert.strictEqual(knownState.priceSol, 0.05, 'Price at T=1500 must reflect only what was known at T=1500');
  assert.strictEqual(knownState.buyVolumeSol, 1.0, 'Volume must not include late-repaired trade');

  // Perspective 2: MARKET_AS_WAS (Physical historical truth on-chain)
  const marketState = engine.get_token_state(mint, 1500, 200, { perspective: 'MARKET_AS_WAS' });
  assert.ok(marketState, 'Market state must exist');
  assert.strictEqual(marketState.totalTxCount, 2, 'Market as-was reconstructs true physical ledger state');
  assert.strictEqual(marketState.priceSol, 0.50, 'Market as-was reflects on-chain execution');
  assert.strictEqual(marketState.buyVolumeSol, 11.0, 'Market as-was reflects total on-chain volume');
});

test('PASS-24 REQ-3 (Invariant 4): CensusRJournalAuthority completeness-gated sealing min(finalized, verifiedContinuous)', () => {
  const census = new CensusRJournalAuthority();
  const bankHash = 'bank-hash-001';

  // Ingest batch at slot 100
  census.commitTransactionBatch({
    slot: 100,
    bankHash,
    txHash: 'tx-100',
    providerId: 'provider-1',
    providerTimestampMs: 1000,
    events: [{ eventType: 'SWAP', payload: { id: 1 } }],
  });

  // Ingest batch at slot 150 (there is an unobserved gap from 101 to 149)
  census.commitTransactionBatch({
    slot: 150,
    bankHash,
    txHash: 'tx-150',
    providerId: 'provider-1',
    providerTimestampMs: 1500,
    events: [{ eventType: 'SWAP', payload: { id: 2 } }],
  });

  // Chain finalized slot is 200, but verified continuous observation only reaches slot 100!
  const sealed = census.sealUpToSlot(200, 100);
  assert.strictEqual(sealed, 1, 'Only slot 100 events should seal; slot 150 must NOT seal across unverified gap');

  const watermark = census.getWatermark();
  assert.strictEqual(watermark.highestSealedSlot, 100, 'Highest sealed slot must be capped by verifiedCompletenessThroughSlot');

  // Once gap is repaired and continuous completeness reaches slot 150:
  const sealedRest = census.sealUpToSlot(200, 150);
  assert.strictEqual(sealedRest, 1, 'Slot 150 can now seal');
  assert.strictEqual(census.getWatermark().highestSealedSlot, 150);
});

test('PASS-24 REQ-4 (Engine Reversibility): TemporalEvidenceGraph tracks exact edge contributions and rolls back cleanly', () => {
  const graph = new TemporalEvidenceGraph();
  const walletA = 'WalletA1111111111111111111111111111111111111';
  const walletB = 'WalletB1111111111111111111111111111111111111';

  graph.addNode(walletA, 'Wallet');
  graph.addNode(walletB, 'Wallet');

  // Contribution 1 at slot 50: 2.0 SOL
  graph.addOrUpdateEdge({
    sourceNode: walletA,
    targetNode: walletB,
    relationship: 'TRANSFERRED_TO',
    evidenceClass: 'FACT',
    slot: 50,
    amountSol: 2.0,
    supportingEventId: 'evt-slot-50',
  });

  // Contribution 2 at slot 60: 3.5 SOL
  graph.addOrUpdateEdge({
    sourceNode: walletA,
    targetNode: walletB,
    relationship: 'TRANSFERRED_TO',
    evidenceClass: 'FACT',
    slot: 60,
    amountSol: 3.5,
    supportingEventId: 'evt-slot-60',
  });

  const heatBefore = graph.getHeat(walletA);
  assert.strictEqual(heatBefore.capitalFlowSol, 5.5, 'Total flow must be 5.5 SOL');
  assert.strictEqual(heatBefore.recentActivityCount, 3, 'Activity count before rollback (1 initial + 2 contributions)');

  // Rollback slot 60 (reorg / invalidation of slot 60)
  const rolledBackCount = graph.rollbackSlotEdges(60);
  assert.strictEqual(rolledBackCount, 1, 'One edge contribution rolled back');

  const heatAfter = graph.getHeat(walletA);
  assert.strictEqual(heatAfter.capitalFlowSol, 2.0, 'Flow must exactly subtract slot 60 (5.5 - 3.5 = 2.0 SOL)');
  assert.strictEqual(heatAfter.recentActivityCount, 2, 'Activity count must be decremented');

  // Rollback remaining slot 50
  graph.rollbackSlotEdges(50);
  const heatFinal = graph.getHeat(walletA);
  assert.strictEqual(heatFinal.capitalFlowSol, 0, 'Flow must be 0 after rolling back all slots');
  assert.strictEqual(heatFinal.recentActivityCount, 1, 'Activity count back to initial node creation');
});

test('PASS-24 REQ-5 (Invariants 1, 2, 5 & 8): IngestionGapReconciler dynamic interval shrinking, splitting & RecoveryCertificate', () => {
  const reconciler = new IngestionGapReconciler();

  // Register slot 100
  reconciler.registerSlot(100, 1, true, { providerId: 'prov-a' });

  // Jump to slot 110 -> creates gap [101, 109]
  reconciler.registerSlot(110, 1, true, {
    providerId: 'prov-a',
    classification: 'MISSING_OBSERVATION',
    lane: 'CHAIN_BLOCK',
  });

  let unresolved = reconciler.getUnresolvedGaps();
  assert.strictEqual(unresolved.length, 1);
  assert.strictEqual(unresolved[0].startSlot, 101);
  assert.strictEqual(unresolved[0].endSlot, 109);
  assert.strictEqual(unresolved[0].classification, 'MISSING_OBSERVATION');
  assert.ok(unresolved[0].gapId);

  // Late-arriving slot 105 lands inside [101, 109] -> splits into [101, 104] and [106, 109]!
  reconciler.registerSlot(105, 1, true, { providerId: 'prov-b' });
  unresolved = reconciler.getUnresolvedGaps();
  assert.strictEqual(unresolved.length, 2, 'Gap should split into two intervals around slot 105');
  assert.strictEqual(unresolved[0].startSlot, 101);
  assert.strictEqual(unresolved[0].endSlot, 104);
  assert.strictEqual(unresolved[1].startSlot, 106);
  assert.strictEqual(unresolved[1].endSlot, 109);

  // Mark gap [106, 109] resolved with structured RecoveryCertificate
  const gapId = unresolved[1].gapId;
  const cert = {
    certificateId: 'cert-gap-001',
    gapId,
    fromSlot: 106,
    toSlot: 109,
    providerId: 'archival-helios-1',
    recoveredEventIds: ['evt-106-1', 'evt-107-1', 'evt-108-1', 'evt-109-1'],
    skippedSlots: [],
    deadForkSlots: [],
    coverageRoot: 'cov-root-hash-999',
    stateRoot: 'state-root-hash-888',
    resolvedAtMs: Date.now(),
    signature: 'sig-cert-ed25519-valid',
  };

  reconciler.markGapResolved(106, 109, cert);

  // Remaining unresolved gap is [101, 104]
  assert.strictEqual(reconciler.getUnresolvedGaps().length, 1);
  assert.strictEqual(reconciler.getUnresolvedGaps()[0].startSlot, 101);
  assert.strictEqual(reconciler.getUnresolvedGaps()[0].endSlot, 104);

  // Durable certificate retrieved
  const storedCert = reconciler.getRecoveryCertificate(gapId);
  assert.ok(storedCert);
  assert.strictEqual(storedCert.certificateId, 'cert-gap-001');
  assert.strictEqual(storedCert.stateRoot, 'state-root-hash-888');
  assert.strictEqual(reconciler.getAllRecoveryCertificates().length, 1);
});
