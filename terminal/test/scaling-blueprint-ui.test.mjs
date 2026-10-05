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
  'components/RuntimeDivergenceInspector.jsx',
  'components/HotPathProofCapsuleMonitor.jsx',
  'components/RealizedEdgeBreakdownPanel.jsx',
  'components/DynamicReserveGauge.jsx',
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

after(() => rmSync(temp, {recursive: true, force: true}));

test('EconomicFlightRecorderDrawer: defines all 15 stages of the real-world execution lifecycle', () => {
  assert.equal(FLIGHT_RECORDER_STAGES.length, 15);
  const expectedStageIds = [
    'DISCOVERY',
    'PREFLIGHT_QUALITY',
    'VETO_EVALUATION',
    'CANDIDATE_FILTER',
    'POSITION_SIZING',
    'OPERATING_ENVELOPE',
    'PROOF_CAPSULE_ASSEMBLY',
    'EXECUTABLE_QUOTE_BINDING',
    'BLOCKHASH_LEASE_VERIFICATION',
    'TRANSACTION_BUILD',
    'JITO_TIP_COMPUTATION',
    'ROUTING_BROADCAST',
    'INCLUSION_LANDING',
    'POST_FILL_ACCOUNTING',
    'ATTRIBUTION_AUTOPSY',
  ];
  for (const id of expectedStageIds) {
    assert.ok(FLIGHT_RECORDER_STAGES.some(s => s.id === id), `Missing stage ${id}`);
  }
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
  assert.match(html, /15-STAGE LIFECYCLE/);
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
