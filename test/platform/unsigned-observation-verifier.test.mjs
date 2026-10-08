import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports, createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PublicKey, SystemProgram, ComputeBudgetProgram, TransactionMessage, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
const ts = createRequire(import.meta.url)('typescript');
const source = new URL('../../src/platform/simulation/unsigned-observation-verifier.ts', import.meta.url);
// Test-only lexical exposure in an in-memory module; no runtime test factory.
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/src/platform/') && specifier.endsWith('.js')) {
      const candidate = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.includes('/src/platform/') && url.endsWith('.ts')) {
      const raw = readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(raw +
        (url === source.href ? '\nexport { composeUnsignedObservationRoot as testRoot };' : ''),
      { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
    }
    return next(url, context);
  },
});
const { testRoot } = await import(source.href);
hook.deregister();
const payer = new PublicKey(new Uint8Array(32).fill(7));
const dest = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const other = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const healthy = { journalHealthy: true, killSwitchClear: true, providerHealthy: true, disclosureAllowed: true };
function config() { return { endpoint: 'https://pinned.invalid/rpc', expectedGenesis: payer.toBase58(), cluster: 'devnet',
  audience: 'offline-observer', configurationRevision: 'v1', credentialRevision: 'credential-v1', commitment: 'confirmed', timeoutMs: 100,
  maxResponseBytes: 10000, maxUnits: 1000, maxLifetimeMs: 5000,
  policy: { version: '1', hash: 'policy', allowedPrograms: [SystemProgram.programId.toBase58(), ComputeBudgetProgram.programId.toBase58()],
    allowedFeePayers: [payer.toBase58()], maxAmountLamports: 100n, maxSlippageBps: 0,
    maxPriorityFeeLamports: 100n, expectedMint: '', expectedDestination: dest.toBase58(), mainnetEnabled: false } }; }
function bytes(instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 2000 }),
  SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: 10 })], legacy = false) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: payer.toBase58(), instructions });
  return (legacy ? message.compileToLegacyMessage() : message.compileToV0Message()).serialize();
}
function request(overrides = {}) { return { messageBytes: bytes(), intentId: 'intent', generation: 1,
  signer: payer.toBase58(), stage: 'FINAL', minContextSlot: 10, expiresAt: Date.now() + 2000, ...overrides }; }
function root(cfg = config()) { const r = testRoot(cfg); r.updateControls(healthy); return r; }
const good = () => ({ context: { slot: 12 }, value: { err: null, unitsConsumed: 1000 } });
// Intercept the concrete HTTPS boundary. No production module parameter supplies
// mocks. Any request is captured; no socket/network/signing operation is possible.
function transport(t, handler = () => good()) {
  const calls = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = body => {
      const parsed = JSON.parse(body);
      const call = { url: url.href, options, body, parsed }; calls.push(call);
      queueMicrotask(async () => {
        const response = await handler(call, calls.length);
        if (req.destroyed || response === 'hang') return;
        if (response?.event === 'request-error') { req.emit('error', new Error('fixture request failure')); return; }
        const res = new EventEmitter(); res.statusCode = response?.http ?? 200; res.resume = () => {};
        callback(res);
        if (response?.event === 'response-error') { res.emit('error', new Error('fixture response failure')); return; }
        if (response?.event === 'response-aborted') { res.emit('aborted'); return; }
        const payload = response?.raw ?? JSON.stringify({ jsonrpc: '2.0', id: parsed.id,
          result: parsed.method === 'getGenesisHash' ? (response?.genesis ?? payer.toBase58()) : response });
        res.emit('data', Buffer.from(payload)); res.emit('end');
      });
    };
    return req;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}
test('source has no runtime exports, signer dependency or injected authority API', () => {
  const raw = readFileSync(source, 'utf8');
  const js = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  assert.doesNotMatch(js, /export\s+(function|class|const|\{[^}]+\})/);
  assert.doesNotMatch(raw, /from ['"].*(durable-live-signer|execution\.js|rpc\.js)/);
  const r = root();
  assert.deepEqual(Object.keys(r.client).sort(), ['inspect', 'observe']);
});
test('default controls and forged permits deny without disclosure', async t => {
  const calls = transport(t);
  const r = testRoot(config());
  assert.throws(() => r.issueDisclosure(request()), /AUTHORITY_UNAVAILABLE/);
  await assert.rejects(r.client.observe({}), /PERMIT_INVALID/);
  assert.equal(calls.length, 0);
});
test('canonical exact unsigned request and repeated non-authorizing audit inspection', async t => {
  const calls = transport(t);
  const r = root(); const input = request(); const original = Buffer.from(input.messageBytes);
  const permit = r.issueDisclosure(input); input.messageBytes.fill(255); input.stage = 'ESTIMATE';
  const receipt = await r.client.observe(permit);
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.url === 'https://pinned.invalid/rpc'));
  const sim = calls[1].parsed; const tx = VersionedTransaction.deserialize(Buffer.from(sim.params[0], 'base64'));
  assert.deepEqual(Buffer.from(tx.message.serialize()), original); assert.ok(tx.signatures.every(s => s.every(b => b === 0)));
  assert.deepEqual(sim.params[1], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false,
    commitment: 'confirmed', minContextSlot: 10, innerInstructions: true });
  const view = r.client.inspect(receipt); assert.equal(view.authorizesSigning, false); assert.equal(view.metadata.stage, 'FINAL');
  assert.equal(view.metadata.requestHash, createHash('sha256').update(calls[1].body).digest('hex'));
  assert.equal(view.metadata.unitsConsumed, 1000); assert.deepEqual(r.client.inspect(receipt), view);
  assert.ok(Object.isFrozen(view.metadata));
  r.updateControls(healthy); assert.equal(r.client.inspect(receipt).epochChanged, true);
  assert.throws(() => r.client.inspect({ ...receipt }), /UNKNOWN/);
  assert.throws(() => root().client.inspect(receipt), /UNKNOWN/);
  await assert.rejects(r.client.observe(permit), /PERMIT_INVALID/);
});
test('permit reuse is atomic under concurrent observations and across instances', async t => {
  const calls = transport(t); const r = root(); const p = r.issueDisclosure(request());
  await assert.rejects(root().client.observe(p), /PERMIT_INVALID/);
  const results = await Promise.allSettled([r.client.observe(p), r.client.observe(p)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(calls.filter(c => c.parsed.method === 'simulateTransaction').length, 1);
});
test('bootstrap rejects missing trust configuration, insecure endpoints and mainnet', () => {
  for (const change of [{ endpoint: 'http://pinned.invalid' }, { endpoint: 'https://user:pass@pinned.invalid' },
    { expectedGenesis: '' }, { configurationRevision: '' }, { credentialRevision: '' }, { cluster: 'mainnet-beta' }, { timeoutMs: Infinity },
    { maxUnits: NaN }, { commitment: 'processed' }]) assert.throws(() => root({ ...config(), ...change }));
});
test('bootstrap arrays and endpoint copies cannot switch a provider or policy midflight', async t => {
  const cfg = config(); const r = root(cfg); const p = r.issueDisclosure(request());
  const calls = transport(t, () => { cfg.endpoint = 'https://other.invalid'; cfg.policy.allowedPrograms.length = 0; return good(); });
  await r.client.observe(p); assert.ok(calls.every(c => c.url === 'https://pinned.invalid/rpc'));
});
test('explicit canonical compute limit is required in both stages and legacy/v0', t => {
  const calls = transport(t);
  const transfer = SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: 1 });
  for (const stage of ['ESTIMATE', 'FINAL']) for (const legacy of [true, false]) {
    for (const instructions of [[transfer], [ComputeBudgetProgram.setComputeUnitLimit({ units: 0 }), transfer],
      [ComputeBudgetProgram.setComputeUnitLimit({ units: 100 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 100 }), transfer]]) {
      assert.throws(() => root().issueDisclosure(request({ stage, messageBytes: bytes(instructions, legacy) })), /COMPUTE_LIMIT/);
    }
    const malformed = Buffer.concat([bytes(undefined, legacy), Buffer.from([255])]);
    assert.throws(() => root().issueDisclosure(request({ messageBytes: malformed })), /ROUNDTRIP/);
  }
  assert.equal(calls.length, 0);
});
test('real firewall denies wrong recipient, unknown allowed Jupiter and Pump discriminator before disclosure', t => {
  const calls = transport(t);
  const jupiter = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  const pump = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  for (const ix of [SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 }),
    new TransactionInstruction({ programId: jupiter, keys: [], data: Buffer.from([255]) }),
    new TransactionInstruction({ programId: pump, keys: [], data: Buffer.from([184,23,238,97,103,197,211,61]) })]) {
    const cfg = config(); cfg.policy.allowedPrograms.push(jupiter.toBase58(), pump.toBase58());
    const b = bytes([ComputeBudgetProgram.setComputeUnitLimit({ units: 2000 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: 1 }), ix]);
    assert.throws(() => root(cfg).issueDisclosure(request({ messageBytes: b })), /POLICY_PRECHECK_DENIED/);
  }
  assert.equal(calls.length, 0);
});
for (const phase of ['getGenesisHash', 'simulateTransaction']) for (const field of Object.keys(healthy)) {
  test(`revocation during ${phase}: ${field} prevents receipt`, async t => {
    const r = root(); const p = r.issueDisclosure(request());
    const calls = transport(t, c => { if (c.parsed.method === phase) { r.updateControls({ ...healthy, [field]: false }); r.updateControls(healthy); } return good(); });
    await assert.rejects(r.client.observe(p), /AUTHORITY_UNAVAILABLE/);
    assert.equal(calls.length, phase === 'getGenesisHash' ? 1 : 2);
  });
}
const invalidResponses = [
  ['null result', null], ['missing context', { value: { err: null, unitsConsumed: 1 } }],
  ['null context', { context: null, value: { err: null, unitsConsumed: 1 } }],
  ['missing value', { context: { slot: 12 } }], ['null value', { context: { slot: 12 }, value: null }],
  ['missing err', { context: { slot: 12 }, value: { unitsConsumed: 1 } }],
  ...[{}, false, '', 0].map(err => [`err ${JSON.stringify(err)}`, { context: { slot: 12 }, value: { err, unitsConsumed: 1 } }]),
  ...[null, '12', -1, 9, 10.5, Number.MAX_SAFE_INTEGER + 1].map(slot => [`slot ${slot}`, { context: { slot }, value: { err: null, unitsConsumed: 1 } }]),
  ...[null, '1', -1, 0, 1.5, 1001, Number.MAX_SAFE_INTEGER + 1].map(unitsConsumed => [`units ${unitsConsumed}`, { context: { slot: 12 }, value: { err: null, unitsConsumed } }]),
  ['replacement', { context: { slot: 12 }, value: { err: null, unitsConsumed: 1, replacementBlockhash: {} } }],
];
for (const [label, value] of invalidResponses) test(`response rejects ${label}`, async t => {
  transport(t, () => value); const r = root(); await assert.rejects(r.client.observe(r.issueDisclosure(request())), /SIMULATION_RESPONSE_INVALID/);
});
test('compute lower boundary and decoded-message upper bound are enforced', async t => {
  let units = 1; transport(t, () => ({ context: { slot: 10 }, value: { err: null, unitsConsumed: units, replacementBlockhash: null } }));
  const r = root(); const input = request({ messageBytes: bytes([ComputeBudgetProgram.setComputeUnitLimit({ units: 500 }),
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: 1 })]) });
  await r.client.observe(r.issueDisclosure(input)); units = 500; await r.client.observe(r.issueDisclosure(input));
  units = 501; await assert.rejects(r.client.observe(r.issueDisclosure(input)), /SIMULATION_RESPONSE_INVALID/);
});
test('simulation explicitly requests and records bounded RPC inner-instruction trace coverage', async t => {
  const trace = [{ index: 1, instructions: [
    { programId: SystemProgram.programId.toBase58(), accounts: [payer.toBase58()], data: 'abc', stackHeight: 2 },
    { parsed: { type: 'transfer', info: {} }, program: 'system', programId: other.toBase58(), stackHeight: 3 },
  ] }];
  let mode = 'complete';
  const calls = transport(t, () => ({ context: { slot: 12 }, value: { err: null, unitsConsumed: 1000,
    ...(mode === 'complete' ? { innerInstructions: trace } : mode === 'partial' ? {
      innerInstructions: [{ index: 1, instructions: [{ programId: other.toBase58(), accounts: [], data: '', stackHeight: null }] }],
    } : {}) } }));
  const r = root(); const receipt = await r.client.observe(r.issueDisclosure(request()));
  const simulation = calls.find(call => call.parsed.method === 'simulateTransaction');
  assert.equal(simulation.parsed.params[1].innerInstructions, true);
  assert.equal(simulation.parsed.params[1].sigVerify, false);
  assert.equal(simulation.parsed.params[1].replaceRecentBlockhash, false);
  const metadata = r.client.inspect(receipt).metadata;
  assert.equal(metadata.innerInstructionTraceStatus, 'STRUCTURALLY_VALID');
  assert.equal(metadata.innerInstructionGroupCount, 1);
  assert.equal(metadata.innerInstructionCount, 2);
  assert.match(metadata.innerInstructionsHash, /^[a-f0-9]{64}$/);
  assert.match(metadata.responseHash, /^[a-f0-9]{64}$/);

  mode = 'partial';
  const partial = root();
  const partialReceipt = await partial.client.observe(partial.issueDisclosure(request()));
  assert.equal(partial.client.inspect(partialReceipt).metadata.innerInstructionTraceStatus, 'PARTIAL');

  mode = 'unavailable';
  const unavailable = root();
  const unavailableReceipt = await unavailable.client.observe(unavailable.issueDisclosure(request()));
  assert.equal(unavailable.client.inspect(unavailableReceipt).metadata.innerInstructionTraceStatus, 'UNAVAILABLE');
  assert.equal(unavailable.client.inspect(unavailableReceipt).metadata.innerInstructionCount, 0);
});
for (const trace of [
  'not-an-array', [{ index: 2, instructions: [] }], [{ index: 1, instructions: [] }, { index: 1, instructions: [] }],
  [{ index: 1, instructions: [{ programId: other.toBase58(), accounts: [], data: '', stackHeight: 4 }] }],
  [{ index: 1, instructions: [{ programId: '', accounts: [], stackHeight: 2 }] }],
  [{ index: 1, instructions: [{ programId: other.toBase58(), accounts: [], stackHeight: 1 }] }],
  [{ index: 1, instructions: [{ programId: other.toBase58(), stackHeight: 2 }] }],
  [{ index: 1, instructions: [{ programId: other.toBase58(), accounts: ['not-a-pubkey'], data: '', stackHeight: 2 }] }],
]) test('malformed inner-instruction evidence is rejected', async t => {
  transport(t, () => ({ context: { slot: 12 }, value: { err: null, unitsConsumed: 1000, innerInstructions: trace } }));
  const r = root();
  await assert.rejects(r.client.observe(r.issueDisclosure(request())), /CPI_TRACE_/);
});
test('genesis mismatch and redirect never fail over', async t => {
  let mode = 'genesis'; const calls = transport(t, () => mode === 'genesis' ? { genesis: other.toBase58() } : { http: 302 });
  const r = root(); await assert.rejects(r.client.observe(r.issueDisclosure(request())), /GENESIS_MISMATCH/);
  mode = 'redirect'; await assert.rejects(r.client.observe(r.issueDisclosure(request())), /RPC_HTTP_ERROR/);
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.url === 'https://pinned.invalid/rpc'));
});
test('wrong JSON-RPC id, explicit error, malformed JSON and oversized response fail closed', async t => {
  let raw = ''; transport(t, c => c.parsed.method === 'getGenesisHash' ? good() : { raw });
  const r = root();
  for (raw of ['{', JSON.stringify({ jsonrpc: '2.0', id: 'wrong', result: good() }),
    JSON.stringify({ jsonrpc: '2.0', id: 'wrong', error: null, result: good() }), ' '.repeat(10001)]) {
    await assert.rejects(r.client.observe(r.issueDisclosure(request())), /RPC_(ENVELOPE_INVALID|RESPONSE_TOO_LARGE)/);
  }
});
test('timeout burns permit and cancellation produces no observation', async t => {
  const calls = transport(t, () => 'hang'); const cfg = config(); cfg.timeoutMs = 5;
  const r = root(cfg); const p = r.issueDisclosure(request());
  await assert.rejects(r.client.observe(p), /RPC_TIMEOUT/);
  await assert.rejects(r.client.observe(p), /PERMIT_INVALID/);
  const c = new AbortController(); const pending = r.client.observe(r.issueDisclosure(request()), c.signal); c.abort();
  await assert.rejects(pending, /CANCELLED/); assert.equal(calls.length, 2);
});
test('expiry, stale epoch and malformed requests deny before dispatch', async t => {
  const calls = transport(t); const r = root();
  for (const change of [{ expiresAt: NaN }, { expiresAt: Infinity }, { minContextSlot: null }, { generation: -1 }, { stage: 'FINAL_FAKE' }]) {
    assert.throws(() => r.issueDisclosure(request(change)), /REQUEST_INVALID/);
  }
  const p = r.issueDisclosure(request()); r.updateControls(healthy);
  await assert.rejects(r.client.observe(p), /AUTHORITY_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});
test('receipt audit remains repeatable after expiry without approving any stage or signer', async t => {
  let time = 10000; t.mock.method(Date, 'now', () => time);
  transport(t); const r = root();
  const receipt = await r.client.observe(r.issueDisclosure(request({ stage: 'ESTIMATE' })));
  assert.equal(r.client.inspect(receipt).metadata.stage, 'ESTIMATE');
  time += 3000;
  assert.equal(r.client.inspect(receipt).expired, true);
  assert.equal(r.client.inspect(receipt).authorizesSigning, false);
  assert.deepEqual(r.client.inspect(receipt), r.client.inspect(receipt));
  assert.equal(r.client.consume, undefined); assert.equal(r.client.authorizeSigning, undefined);
});
for (const phase of ['getGenesisHash', 'simulateTransaction']) test(`expiry across ${phase} rejects observation`, async t => {
  let time = 10000; t.mock.method(Date, 'now', () => time);
  const calls = transport(t, c => { if (c.parsed.method === phase) time += 3000; return good(); });
  const r = root(); await assert.rejects(r.client.observe(r.issueDisclosure(request())), /AUTHORITY_UNAVAILABLE/);
  assert.equal(calls.length, phase === 'getGenesisHash' ? 1 : 2);
});
test('request-scoped approving client, fingerprint and gates do not authorize disclosure', async t => {
  const calls = transport(t); const r = testRoot(config());
  assert.throws(() => r.issueDisclosure(request({ simulationPassed: true, provider: 'trusted',
    firewall: { evaluate: () => ({ approved: true }) }, gates: healthy, fetch: () => good() })), /AUTHORITY_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});
test('matching response id with explicit JSON-RPC error is still rejected', async t => {
  transport(t, c => c.parsed.method === 'getGenesisHash' ? good() : { raw: JSON.stringify({
    jsonrpc: '2.0', id: c.parsed.id, result: good(), error: null }) });
  const r = root(); await assert.rejects(r.client.observe(r.issueDisclosure(request())), /RPC_ENVELOPE_INVALID/);
});
test('concurrent endpoint instances never share provenance or accept each other permits', async t => {
  const cfgB = config(); cfgB.endpoint = 'https://other.invalid/rpc'; cfgB.configurationRevision = 'v2';
  const a = root(); const b = root(cfgB); const calls = transport(t);
  const [ra, rb] = await Promise.all([a.client.observe(a.issueDisclosure(request())), b.client.observe(b.issueDisclosure(request()))]);
  assert.notEqual(a.client.inspect(ra).metadata.provider, b.client.inspect(rb).metadata.provider);
  assert.equal(calls.filter(c => c.url === 'https://pinned.invalid/rpc').length, 2);
  assert.equal(calls.filter(c => c.url === 'https://other.invalid/rpc').length, 2);
  assert.throws(() => a.client.inspect(rb), /UNKNOWN/);
});
test('explicit TLS verification survives insecure environment without overriding hostname verification', async t => {
  const prior = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  t.after(() => { if (prior === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prior; });
  const calls = transport(t); const r = root(); await r.client.observe(r.issueDisclosure(request()));
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.rejectUnauthorized, true);
    assert.equal(Object.hasOwn(call.options, 'checkServerIdentity'), false);
    assert.equal(Object.hasOwn(call.options, 'servername'), false);
  }
});
test('provider identity excludes secret URL path/query while exact transport preserves them', async t => {
  const calls = transport(t);
  const aCfg = config(); aCfg.endpoint = 'https://pinned.invalid/path/SECRET_A?api-key=SECRET_A&network=test';
  const bCfg = config(); bCfg.endpoint = 'https://pinned.invalid/other/SECRET_B?api-key=SECRET_B&network=test';
  const a = root(aCfg), b = root(bCfg);
  const av = a.client.inspect(await a.client.observe(a.issueDisclosure(request()))).metadata;
  const bv = b.client.inspect(await b.client.observe(b.issueDisclosure(request()))).metadata;
  // Same explicit revisions intentionally yield the same public identity:
  // bootstrap must advance them on route/credential changes, not hash secrets.
  const expected = createHash('sha256').update(JSON.stringify(['https://pinned.invalid', aCfg.configurationRevision,
    aCfg.credentialRevision, aCfg.cluster, aCfg.expectedGenesis, aCfg.commitment, aCfg.timeoutMs, aCfg.maxResponseBytes])).digest('hex');
  assert.equal(av.provider, expected); assert.equal(bv.provider, expected);
  assert.deepEqual(calls.map(c => c.url), [aCfg.endpoint, aCfg.endpoint, bCfg.endpoint, bCfg.endpoint]);
  assert.doesNotMatch(JSON.stringify([av, bv]), /SECRET_A|SECRET_B|api-key|\/path\/|\/other\//);
  const rotatedCfg = { ...bCfg, credentialRevision: 'credential-v2' }; const rotated = root(rotatedCfg);
  const rv = rotated.client.inspect(await rotated.client.observe(rotated.issueDisclosure(request()))).metadata;
  assert.notEqual(rv.provider, av.provider); assert.equal(rv.credentialRevision, 'credential-v2');
});
test('missing result in matching JSON-RPC envelope fails before normalization', async t => {
  transport(t, c => c.parsed.method === 'getGenesisHash' ? good() : { raw: JSON.stringify({ jsonrpc: '2.0', id: c.parsed.id }) });
  const r = root(); await assert.rejects(r.client.observe(r.issueDisclosure(request())), /RPC_ENVELOPE_INVALID/);
});
for (const phase of ['getGenesisHash', 'simulateTransaction']) for (const [response, error] of [
  [{ event: 'request-error' }, 'RPC_TRANSPORT_ERROR'], [{ event: 'response-error' }, 'RPC_RESPONSE_ERROR'],
  [{ event: 'response-aborted' }, 'RPC_RESPONSE_ABORTED'], [{ http: 500 }, 'RPC_HTTP_ERROR'],
]) test(`${phase} ${error} denies and burns permit`, async t => {
  const calls = transport(t, c => c.parsed.method === phase ? response : good());
  const r = root(); const p = r.issueDisclosure(request());
  await assert.rejects(r.client.observe(p), new RegExp(error));
  await assert.rejects(r.client.observe(p), /PERMIT_INVALID/);
  assert.equal(calls.length, phase === 'getGenesisHash' ? 1 : 2);
});
test('timeout specifically after genesis during simulation burns permit', async t => {
  const calls = transport(t, c => c.parsed.method === 'simulateTransaction' ? 'hang' : good());
  const cfg = config(); cfg.timeoutMs = 10; const r = root(cfg); const p = r.issueDisclosure(request());
  await assert.rejects(r.client.observe(p), /RPC_TIMEOUT/);
  await assert.rejects(r.client.observe(p), /PERMIT_INVALID/);
  assert.deepEqual(calls.map(c => c.parsed.method), ['getGenesisHash', 'simulateTransaction']);
});
test('cancellation specifically after genesis during simulation burns permit', async t => {
  const controller = new AbortController();
  const calls = transport(t, c => { if (c.parsed.method === 'simulateTransaction') { controller.abort(); return 'hang'; } return good(); });
  const r = root(); const p = r.issueDisclosure(request());
  await assert.rejects(r.client.observe(p, controller.signal), /CANCELLED/);
  await assert.rejects(r.client.observe(p), /PERMIT_INVALID/);
  assert.deepEqual(calls.map(c => c.parsed.method), ['getGenesisHash', 'simulateTransaction']);
});
