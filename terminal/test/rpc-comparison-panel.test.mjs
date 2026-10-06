import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const terminalDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sylph-rpc-comparison-'));
const componentSource = readFileSync(join(terminalDirectory, 'src/components/RpcComparisonPanel.jsx'), 'utf8')
  .replace(/from ['"]([^'"]+)['"]/g, (_, specifier) =>
    `from ${JSON.stringify(specifier.startsWith('.')
      ? new URL(specifier, new URL('../src/components/RpcComparisonPanel.jsx', import.meta.url)).pathname
      : require.resolve(specifier))}`);
const componentPath = join(temporaryDirectory, 'RpcComparisonPanel.cjs');
writeFileSync(componentPath, ts.transpileModule(componentSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText);

const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {RpcComparisonPanel} = require(componentPath);
const render = props => renderToStaticMarkup(React.createElement(RpcComparisonPanel, props));

after(() => rmSync(temporaryDirectory, {recursive: true, force: true}));

test('RPC panel reports local throttle totals separately from provider 429s and soak drops', () => {
  const html = render({
    rpcEndpoints: [{
      index: 0,
      url: 'RPC (rpc.example)',
      currentSlot: 10,
      latencyMs: 20,
      calls: 70,
      localRateLimitDenials: 7,
      drops: 0,
      errorCount: 0,
      http429Count: 0,
      lastSuccessAt: Date.now(),
      active: true,
      status: 'active',
    }],
    rpcHealth: {gatePassed: true},
  });

  assert.match(html, /Local throttles \(process total\): 7/);
  assert.match(html, /7 local request throttles since process start/);
  assert.match(html, /separate from provider HTTP 429s and the 24-hour candidate-drop rate/);
  assert.match(html, /24H GATE: PASSED/);
  assert.match(html, />Operational</);
});

test('RPC panel renders absent local throttle and soak-gate evidence as unverified', () => {
  const html = render({
    rpcEndpoints: [{
      index: 0,
      url: 'RPC (rpc.example)',
      currentSlot: 0,
      latencyMs: 0,
      calls: 0,
      drops: 0,
      errorCount: 0,
      http429Count: 0,
      lastSuccessAt: null,
      active: true,
      status: 'active',
    }],
  });

  assert.match(html, /Local throttles \(process total\): Unknown/);
  assert.match(html, /Local request-throttle telemetry is unavailable for 1 endpoint/);
  assert.match(html, /24H GATE: UNVERIFIED/);
  assert.doesNotMatch(html, /24H GATE: PASSED/);
});

test('RPC panel preserves observed zero and labels an explicit blocked gate without inventing its cause', () => {
  const html = render({
    rpcEndpoints: [{
      index: 0,
      url: 'RPC (rpc.example)',
      currentSlot: 0,
      latencyMs: 0,
      calls: 0,
      localRateLimitDenials: 0,
      drops: 0,
      errorCount: 0,
      http429Count: 0,
      lastSuccessAt: null,
      active: true,
      status: 'active',
    }],
    rpcHealth: {gatePassed: false},
  });

  assert.match(html, /Local throttles \(process total\): 0/);
  assert.doesNotMatch(html, /local request throttles since process start/);
  assert.match(html, /24H GATE: BLOCKED/);
  assert.doesNotMatch(html, /24H GATE: BLOCKED \(&gt;5% 429s\)/);
});

test('RPC panel marks aggregate throttle counts partial when endpoint telemetry is missing or malformed', () => {
  const html = render({
    rpcEndpoints: [
      {
        index: 0,
        url: 'RPC (rpc-a.example)',
        currentSlot: 0,
        latencyMs: 0,
        localRateLimitDenials: 3,
        http429Count: 0,
        errorCount: 0,
        lastSuccessAt: null,
        active: true,
        status: 'active',
      },
      {
        index: 1,
        url: 'RPC (rpc-b.example)',
        currentSlot: 0,
        latencyMs: 0,
        localRateLimitDenials: '5',
        http429Count: 0,
        errorCount: 0,
        lastSuccessAt: null,
        active: false,
        status: 'standby',
      },
    ],
  });

  assert.match(html, /At least 3 local request throttles since process start; telemetry is unavailable for 1 endpoint/);
  assert.match(html, /Local throttles \(process total\): 3/);
  assert.match(html, /Local throttles \(process total\): Unknown/);
  assert.match(html, /24H GATE: UNVERIFIED/);
});

test('RPC panel never infers operational health from an unsupported endpoint status', () => {
  const html = render({
    rpcEndpoints: [{
      index: 0,
      url: 'RPC (rpc.example)',
      currentSlot: 0,
      latencyMs: 0,
      localRateLimitDenials: 0,
      http429Count: 0,
      errorCount: 0,
      lastSuccessAt: null,
      active: false,
      status: 'offline',
    }],
    rpcHealth: {gatePassed: false},
  });

  assert.match(html, />Unknown</);
  assert.doesNotMatch(html, />Operational</);
});
