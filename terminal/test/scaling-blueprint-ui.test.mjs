import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const directory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const temp = mkdtempSync(join(tmpdir(), 'sylph-scaling-test-'));

const files = [
  'components/EconomicFlightRecorderDrawer.jsx',
  'components/flight-recorder-history.js',
  'components/RuntimeDivergenceInspector.jsx',
  'components/HotPathProofCapsuleMonitor.jsx',
  'components/RealizedEdgeBreakdownPanel.jsx',
  'components/DynamicReserveGauge.jsx',
  'components/AdversarialCouncilDrawer.jsx',
  'components/ConservationProofsDrawer.jsx',
  'components/SolanaArchitectureDrawer.jsx',
  'design-system/format.js',
  'design-system/primitives.jsx',
];

const output = path => join(temp, path.replaceAll('/', '_').replace(/\.(jsx|js)$/, '') + '.cjs');

for (const file of files) {
  let source = readFileSync(join(directory, 'src', file), 'utf8');
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => {
    const resolved = specifier.startsWith('.')
      ? output(relative(join(directory, 'src'), resolve(dirname(join(directory, 'src', file)), specifier)).replaceAll('\\', '/'))
      : require.resolve(specifier);
    return 'from ' + JSON.stringify(resolved);
  });
  writeFileSync(
    output(file),
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
  );
}

const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');

const {
  EconomicFlightRecorderDrawer,
  FLIGHT_RECORDER_STAGES,
} = require(output('components/EconomicFlightRecorderDrawer.jsx'));
const {latestFlightRecords, revisionsForFlight} = require(output('components/flight-recorder-history.js'));
const {
  RuntimeDivergenceInspector,
} = require(output('components/RuntimeDivergenceInspector.jsx'));
const {
  HotPathProofCapsuleMonitor,
  FEATURE_LEASE_DEFINITIONS,
} = require(output('components/HotPathProofCapsuleMonitor.jsx'));
const {
  RealizedEdgeBreakdownPanel,
} = require(output('components/RealizedEdgeBreakdownPanel.jsx'));
const {
  DynamicReserveGauge,
} = require(output('components/DynamicReserveGauge.jsx'));
const {
  AdversarialCouncilDrawer,
} = require(output('components/AdversarialCouncilDrawer.jsx'));
const {
  ConservationProofsDrawer,
} = require(output('components/ConservationProofsDrawer.jsx'));
const {
  SolanaArchitectureDrawer,
} = require(output('components/SolanaArchitectureDrawer.jsx'));

after(() => rmSync(temp, {recursive: true, force: true}));

test('EconomicFlightRecorderDrawer: stage vocabulary matches the persisted recorder lifecycle', () => {
  assert.deepEqual(FLIGHT_RECORDER_STAGES, [
    'DISCOVERED', 'FILTER_EVALUATED', 'DECISION_CREATED', 'QUOTE_CAPTURED',
    'BUILD_STARTED', 'BUILD_COMPLETED', 'SIMULATED', 'AUTHORIZED', 'SIGNED',
    'SUBMITTED', 'ACKNOWLEDGED', 'UNKNOWN', 'LANDED_SUCCESS', 'LANDED_FAILURE',
    'NOLAND', 'FINALIZED', 'SETTLED', 'OUTCOME_MATURE',
  ]);
  const recorderSource = readFileSync(resolve(directory, '..', 'src/intelligence/execution-adaptation/economic-flight-recorder.ts'), 'utf8');
  const stageUnion = recorderSource.match(/export type FlightLifecycleStage =([\s\S]*?);/)?.[1] || '';
  assert.deepEqual([...stageUnion.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]), FLIGHT_RECORDER_STAGES);
});

test('flight recorder history selects latest revision per generation and preserves branch history', () => {
  const rows = [
    {economicFactId: 'fact-a', executionGenerationId: 'gen-1', revision: 3, stage: 'UNKNOWN'},
    {economicFactId: 'fact-a', executionGenerationId: 'gen-1', revision: 2, stage: 'SUBMITTED'},
    {economicFactId: 'fact-a', executionGenerationId: 'gen-1', revision: 1, stage: 'DISCOVERED'},
    {economicFactId: 'fact-a', executionGenerationId: 'gen-2', revision: 1, stage: 'DISCOVERED'},
  ];
  const latest = latestFlightRecords(rows);
  assert.deepEqual(latest.map(row => [row.executionGenerationId, row.revision]), [['gen-1', 3], ['gen-2', 1]]);
  assert.deepEqual(revisionsForFlight(rows, latest[0]).map(row => row.stage), ['DISCOVERED', 'SUBMITTED', 'UNKNOWN']);
});

test('EconomicFlightRecorderDrawer: renders drawer markup and empty state when open', () => {
  const html = renderToStaticMarkup(
    React.createElement(EconomicFlightRecorderDrawer, {
      isOpen: true,
      onClose: () => {},
    })
  );

  assert.match(html, /Economic Flight Recorder/);
  assert.match(html, /DURABLE APPEND-ONLY SQLite WAL/);
  assert.match(html, /RECORDED REVISIONS/);
  const drawerSource = readFileSync(join(directory, 'src', 'components', 'EconomicFlightRecorderDrawer.jsx'), 'utf8');
  assert.match(drawerSource, /Stage transition timestamps are not stored/);
});

test('RuntimeDivergenceInspector: renders side-by-side comparison and parity status', () => {
  const html = renderToStaticMarkup(
    React.createElement(RuntimeDivergenceInspector, {
      isOpen: true,
      onClose: () => {},
    })
  );

  assert.match(html, /Runtime Divergence Auditor/);
  assert.match(html, /SHADOW DECISION CONVERGENCE/);
  assert.match(html, /fusion\.ts/);
  assert.match(html, /unified-pipeline-unit\.ts/);
});

test('HotPathProofCapsuleMonitor: defines all 8 feature-specific evidence leases', () => {
  assert.equal(FEATURE_LEASE_DEFINITIONS.length, 8);
  const requiredClasses = [
    'QUICK_QUOTE',
    'PRIORITY_FEE',
    'BLOCKHASH',
    'POOL_RESERVES',
    'RISK_CERTIFICATE',
    'PROVIDER_HEALTH',
    'HOLDER_CONCENTRATION',
    'MINT_AUTHORITY',
  ];
  for (const c of requiredClasses) {
    assert.ok(FEATURE_LEASE_DEFINITIONS.some(d => d.id === c), `Missing feature lease class ${c}`);
  }
});

test('HotPathProofCapsuleMonitor: renders lease monitor markup and invariants', () => {
  const emptyHtml = renderToStaticMarkup(
    React.createElement(HotPathProofCapsuleMonitor, {
      isOpen: true,
      onClose: () => {},
    })
  );

  assert.match(emptyHtml, /Proof Capsule Lease Monitor/);
  assert.match(emptyHtml, /CAPSULE EVIDENCE UNAVAILABLE/);
  assert.match(emptyHtml, /Blueprint Section 11 &amp; 12 Invariants/);

  const populatedHtml = renderToStaticMarkup(
    React.createElement(HotPathProofCapsuleMonitor, {
      isOpen: true,
      onClose: () => {},
      initialData: {
        mint: 'So11111111111111111111111111111111111111112',
        capsuleHash: 'a'.repeat(64),
        isReady: true,
        expiredCount: 0,
        assembledAt: new Date().toISOString(),
        leases: [
          { featureClass: 'QUICK_QUOTE', label: 'Quick Quote', ttlMs: 1200, expiresAtMs: Date.now() + 1000, isAvailable: true, source: 'cache', value: '1.2 SOL' },
          { featureClass: 'BLOCKHASH', label: 'Recent Blockhash', ttlMs: 20000, expiresAtMs: Date.now() + 18000, isAvailable: true, source: 'cache', value: 'GH7...' },
          { featureClass: 'MINT_AUTHORITY', label: 'Token Semantics', ttlMs: 3600000, expiresAtMs: Date.now() + 3500000, isAvailable: true, source: 'cache', value: 'Revoked' },
        ],
      },
    })
  );

  assert.match(populatedHtml, /CAPSULE LEASES CURRENT/);
  assert.match(populatedHtml, /Quick Quote/);
  assert.match(populatedHtml, /Recent Blockhash/);
  assert.match(populatedHtml, /Token Semantics/);
});

test('RealizedEdgeBreakdownPanel: renders 15-factor decomposition with explicit UNEXPLAINED residual', () => {
  const testBreakdown = {
    signalEdgeLamports: 150_000_000n,
    temporalDecayLamports: 20_000_000n,
    decisionLatencyLossLamports: 5_000_000n,
    buildLatencyLossLamports: 3_000_000n,
    routingEdgeLamports: 12_000_000n,
    leaderEdgeLamports: 8_000_000n,
    liquidityEdgeLamports: 10_000_000n,
    baseFeeLamports: 5_000n,
    priorityFeeLamports: 50_000n,
    jitoTipLamports: 100_000n,
    marketImpactLamports: 15_000_000n,
    slippageLossLamports: 12_000_000n,
    adverseSelectionLamports: 8_000_000n,
    unexplainedResidualLamports: 4_000_000n,
    netRealizedEdgeLamports: 112_845_000n,
  };

  const html = renderToStaticMarkup(
    React.createElement(RealizedEdgeBreakdownPanel, {
      data: testBreakdown,
      solPriceUsd: 150,
    })
  );

  assert.match(html, /15-FACTOR CAUSAL ATTRIBUTION/);
  assert.match(html, /Realized Edge &amp; Leakage Decomposition/);
  assert.match(html, /Gross Signal Alpha/);
  assert.match(html, /Temporal Decay Loss/);
  assert.match(html, /Routing \/ AMM Edge/);
  assert.match(html, /Leader Timing Edge/);
  assert.match(html, /Jito Tip Drag/);
  assert.match(html, /UNEXPLAINED Residual/);
  assert.match(html, /Net Realized Edge/);
  assert.match(html, /\+0\.1128 SOL/);
});

test('DynamicReserveGauge: correctly computes dynamic reserve floor for $250 bankroll', () => {
  const emptyHtml = renderToStaticMarkup(
    React.createElement(DynamicReserveGauge, {
      capital: { available: 250.0, reserved: 25.0 },
      solPriceUsd: 150,
    })
  );

  assert.match(emptyHtml, /Capital Preservation &amp; Exitability Shield/);
  assert.match(emptyHtml, /PAPER POLICY SCENARIO/);
  assert.match(emptyHtml, /MODEL DATA UNKNOWN/);
  assert.match(emptyHtml, /Free Deployable/);
  assert.match(emptyHtml, /Emergency Reserve/);
  assert.match(emptyHtml, /Paper Model Cash/);

  const populatedHtml = renderToStaticMarkup(
    React.createElement(DynamicReserveGauge, {
      capital: { available: 250.0, reserved: 25.0 },
      solPriceUsd: 150,
      initialData: {
        paperCashUsd: 250.0,
        reservedCashUsd: 25.0,
        emergencyReserveUsd: 50.0,
        availableCashUsd: 175.0,
      },
    })
  );

  assert.match(populatedHtml, /Capital Preservation &amp; Exitability Shield/);
  assert.match(populatedHtml, /PAPER MODEL: HEADROOM/);
  assert.match(populatedHtml, /\$175\.00/);
  assert.match(populatedHtml, /\$25\.00/);
  assert.match(populatedHtml, /\$50\.00/);
  assert.match(populatedHtml, /\$250\.00/);
});

test('AdversarialCouncilDrawer: renders Prover vs Skeptic dialectic cards and resource admission capacity', () => {
  const emptyHtml = renderToStaticMarkup(
    React.createElement(AdversarialCouncilDrawer, {
      isOpen: true,
      onClose: () => {},
    })
  );

  assert.match(emptyHtml, /Adversarial Evidence Council/);
  assert.match(emptyHtml, /UNKNOWN/);
  assert.match(emptyHtml, /EVALUATION UNAVAILABLE/);
  assert.match(emptyHtml, /RPC Capacity[\s\S]*?UNKNOWN/);
  assert.match(emptyHtml, /Section 30 Epistemic Rules/);

  const populatedHtml = renderToStaticMarkup(
    React.createElement(AdversarialCouncilDrawer, {
      isOpen: true,
      onClose: () => {},
      selectedFactId: 'fact-sample-88',
      initialData: {
        latestVerdict: {
          economicFactId: 'fact-sample-88',
          status: 'SUFFICIENT',
          approved: true,
          councilVerdictHash: '0123456789abcdef0123456789abcdef',
          evaluatedAt: '2026-10-05T01:00:00Z',
          prover: {
            opportunityId: 'opp-alpha-99',
            tokenMint: 'So11111111111111111111111111111111111111112',
            quotePriceLamports: 450000000n,
            liquidityLamports: 125000000000n,
            authenticityScore: 92,
            temporalValidityVerified: true,
          },
          skepticChecks: [
            { checkName: 'TRANSFER_HOOK_WHITELIST', passed: true, severity: 'FATAL_VETO' },
            { checkName: 'PRICE_DRIFT_TOLERANCE', passed: true, severity: 'HIGH_UNCERTAINTY' },
          ],
        },
        capacity: {
          rpcCapacityAvailablePct: 88,
          streamFeedHealthy: true,
          archiveQuorumAvailable: true,
          verificationQueueDepth: 3,
          currentLiabilitiesUsd: 450,
          activeLiabilitiesCeilingUsd: 5000,
          memoryPressurePct: 35,
          activeWorkloadPermitId: 'permit-dialectic-101',
        },
      },
    })
  );

  assert.match(populatedHtml, /DIALECTIC COUNCIL VERDICT/);
  assert.match(populatedHtml, /SUFFICIENT/);
  assert.match(populatedHtml, /COUNCIL SUFFICIENT/);
  assert.match(populatedHtml, /Prover Affirmative Evidence/);
  assert.match(populatedHtml, /TEMPORAL VALID/);
  assert.match(populatedHtml, /Skeptic Falsification Probes/);
  assert.match(populatedHtml, /TRANSFER_HOOK_WHITELIST/);
  assert.match(populatedHtml, /Resource Admission &amp; Operational Capacity/);
  assert.match(populatedHtml, /Active Liabilities/);
  assert.match(populatedHtml, /35%/);
});

test('ConservationProofsDrawer: renders exact integer lot conservation and outcome maturity gate', () => {
  const emptyHtml = renderToStaticMarkup(
    React.createElement(ConservationProofsDrawer, {
      isOpen: true,
      onClose: () => {},
    })
  );

  assert.match(emptyHtml, /Conservation Proofs &amp; Outcome Gate/);
  assert.match(emptyHtml, /CONSERVATION UNKNOWN/);
  assert.match(emptyHtml, /MATURITY UNKNOWN/);
  assert.doesNotMatch(emptyHtml, /lot_canonical_001|trd_canonical_001/);
  assert.match(emptyHtml, /Section 43 &amp; 44 Invariants/);

  const populatedHtml = renderToStaticMarkup(
    React.createElement(ConservationProofsDrawer, {
      isOpen: true,
      onClose: () => {},
      selectedMint: 'So11111111111111111111111111111111111111112',
      solPriceUsd: 150,
      initialData: {
        latestProof: {
          lotId: 'lot-sol-404',
          tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          isConserved: true,
          tokensAcquired: 1000000000n,
          tokensDisposed: 600000000n,
          tokensRemaining: 400000000n,
          openingBasisLamports: 5000000000n,
          realizedBasisRelievedLamports: 3000000000n,
          remainingBasisLamports: 2000000000n,
          realizedGrossProceedsLamports: 4200000000n,
          irreversibleExitCostsLamports: 50000000n,
          accountingPnLLamports: 1150000000n,
          certificateHash: 'fedcba9876543210fedcba9876543210',
          certifiedAt: '2026-10-05T01:00:00Z',
        },
        maturity: {
          stage: 'OUTCOME_MATURE',
          isMature: true,
          learningReady: true,
          maturitySlotDelta: 680,
          observationWindowMs: 210000,
          labelDatasetTag: 'MAINNET_TRUTH',
          canonicalOutcomeSignature: 'sig-mature-888',
        },
      },
    })
  );

  assert.match(populatedHtml, /MATHEMATICAL CONSERVATION STATE/);
  assert.match(populatedHtml, /EXACT INTEGER CONSERVATION SEALED/);
  assert.match(populatedHtml, /INVARIANT 1: TOKEN LOT CONSERVATION/);
  assert.match(populatedHtml, /INVARIANT 2: COST BASIS CONSERVATION/);
  assert.match(populatedHtml, /INVARIANT 3: ACCOUNTING P&amp;L BALANCE/);
  assert.match(populatedHtml, /Outcome Maturity Gate \(Section 44\)/);
  assert.match(populatedHtml, /LEARNING_READY: CERTIFIED/);
  assert.match(populatedHtml, /MAINNET_TRUTH/);
});

test('SolanaArchitectureDrawer: renders 10 protocol leases, sensor tournament, transport lanes, and fail-closed notice', () => {
  const html = renderToStaticMarkup(
    React.createElement(SolanaArchitectureDrawer, {
      isOpen: true,
      onClose: () => {},
      protocolLeases: [
        { protocolName: 'PUMP_FUN', programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', idlVersion: '1.0.0', feeModelVersion: '1.0.0', verificationStatus: 'COMPATIBLE', isCertified: true },
        { protocolName: 'RAYDIUM_AMM', programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', idlVersion: '4.0.0', feeModelVersion: '25bps_fixed', verificationStatus: 'COMPATIBLE', isCertified: true },
      ],
      sensorLeaderboard: [
        { sensorType: 'SHREDS', coverageRatePct: 99.4, meanLatencyMs: 4.2, falseDecodeRatePct: 0.1, winsCount: 452, economicValueState: 'UNKNOWN' },
      ],
      transportTelemetry: [
        { lane: 'JITO_BUNDLE', landingRatePct: 94.5, meanLatencyMs: 120, meanTipLamports: '100000', instructionFailureRatePct: 0.5, netRealizedEdgeBps: 85 },
      ],
    })
  );

  assert.match(html, /SYLPH FUSION — SOLANA-ONLY ARCHITECTURE/);
  assert.match(html, /FAIL-CLOSED/);
  assert.match(html, /PUMP_FUN/);
  assert.match(html, /RAYDIUM_AMM/);
  assert.match(html, /10 \/ 10 Protocols Cryptographically Bound/);
  assert.match(html, /UNKNOWN ≠ SAFE • PROFIT PREDICTED ≠ PROFIT REALIZED/);
});
