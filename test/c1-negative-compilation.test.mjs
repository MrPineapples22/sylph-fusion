import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Feed } from '../dist/feed.js';
import { CanonicalIngress, DefaultFusionEnvelopeCompiler, DefaultTruthValidator, InMemoryIngressJournal, StoreIngressJournal } from '../dist/platform/ingress/canonical-ingress.js';
import { Store } from '../dist/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

/**
 * Compiles a virtual TypeScript snippet against the project's tsconfig and source files.
 * Returns the diagnostic messages produced by the TypeScript semantic checker.
 */
function compileSnippet(snippetSource) {
  const configFile = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configFile) {
    throw new Error('tsconfig.json not found in project root: ' + projectRoot);
  }

  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(config, ts.sys, projectRoot);

  const virtualFileName = resolve(projectRoot, 'src', '__virtual_negative_test_snippet__.ts');

  // Create virtual host intercepting the snippet file
  const originalHost = ts.createCompilerHost(parsedConfig.options);
  const customHost = {
    ...originalHost,
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (resolve(fileName) === virtualFileName) {
        return ts.createSourceFile(virtualFileName, snippetSource, languageVersion, true);
      }
      return originalHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
    fileExists: (fileName) => {
      if (resolve(fileName) === virtualFileName) return true;
      return originalHost.fileExists(fileName);
    },
    readFile: (fileName) => {
      if (resolve(fileName) === virtualFileName) return snippetSource;
      return originalHost.readFile(fileName);
    },
  };

  const rootNames = [...parsedConfig.fileNames, virtualFileName];
  const program = ts.createProgram(rootNames, parsedConfig.options, customHost);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(program.getSourceFile(virtualFileName)),
    ...program.getSemanticDiagnostics(program.getSourceFile(virtualFileName)),
  ];

  return diagnostics.map(d => ({
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }), /Cannot read private member #ingress/);
}

test('C1 Negative Compilation: new Feed with arbitrary consumer callback fails compilation', () => {
  const snippet = `
    import { Feed } from './feed.js';
    import { Engine } from './fusion.js';
    import type { Config } from './config.js';
    import type { Connection } from '@solana/web3.js';

    declare const cfg: Config;
    declare const connection: Connection;
    declare const engine: Engine;

    // FORBIDDEN: Arbitrary callback bypass
    new Feed(cfg, connection, (event: any) => engine.onEvent(event));
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'NEGATIVE_GUARD_FAILURE: new Feed with arbitrary callback unexpectedly compiled!');

  const hasExpectedError = diagnostics.some(d =>
    d.message.includes('not assignable to parameter of type') ||
    d.message.includes('ObservationIngressPort') ||
    d.message.includes('submit')
  );
  assert.ok(hasExpectedError, 'Expected diagnostic regarding ObservationIngressPort parameter mismatch, got: ' + JSON.stringify(diagnostics));
});

test('C1 Negative Compilation: engine.onEvent(rawObservation) fails compilation', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    import type { UnvalidatedObservation } from './platform/ingress/types.js';

    declare const engine: Engine;
    declare const rawObservation: UnvalidatedObservation;

    // FORBIDDEN: Raw observation directly to engine
    engine.onEvent(rawObservation);
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'NEGATIVE_GUARD_FAILURE: engine.onEvent(rawObservation) unexpectedly compiled!');

  const hasExpectedError = diagnostics.some(d =>
    d.message.includes("Property 'onEvent' does not exist on type 'Engine'")
  );
  assert.ok(hasExpectedError, 'Expected diagnostic regarding non-existent onEvent on Engine, got: ' + JSON.stringify(diagnostics));
});

test('C1 Negative Compilation: external engine.onCommitted access fails compilation', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    import type { CommittedEnvelope } from './platform/ingress/types.js';
    declare const engine: Engine;
    declare const forged: CommittedEnvelope;
    engine.onCommitted(forged);
  `;
  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.some(d => d.message.includes("Property 'onCommitted' does not exist")), JSON.stringify(diagnostics));
});

test('C1 Negative Compilation: Engine does not expose its ingress authority', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    declare const engine: Engine;
    engine.ingress;
  `;
  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.some(d => d.message.includes("Property 'ingress' does not exist")), JSON.stringify(diagnostics));
});

test('C1 Negative Compilation: UnvalidatedObservation cannot satisfy ValidatedFusionEnvelope', () => {
  const snippet = `
    import type { UnvalidatedObservation, ValidatedFusionEnvelope } from './platform/ingress/types.js';

    function processValidated(envelope: ValidatedFusionEnvelope): void {}

    declare const unvalidated: UnvalidatedObservation;

    // FORBIDDEN: Type-state collapse Unvalidated -> Validated
    processValidated(unvalidated);
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'NEGATIVE_GUARD_FAILURE: UnvalidatedObservation satisfied ValidatedFusionEnvelope!');

  const hasExpectedError = diagnostics.some(d =>
    d.message.includes('not assignable to parameter of type') ||
    d.message.includes('ValidatedFusionEnvelope')
  );
  assert.ok(hasExpectedError, 'Expected type-state brand failure, got: ' + JSON.stringify(diagnostics));
});

test('C1 Negative Compilation: UnvalidatedObservation cannot satisfy CommittedEnvelope', () => {
  const snippet = `
    import type { UnvalidatedObservation, CommittedEnvelope } from './platform/ingress/types.js';

    function processCommitted(envelope: CommittedEnvelope): void {}

    declare const unvalidated: UnvalidatedObservation;

    // FORBIDDEN: Type-state collapse Unvalidated -> Committed
    processCommitted(unvalidated);
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'NEGATIVE_GUARD_FAILURE: UnvalidatedObservation satisfied CommittedEnvelope!');

  const hasExpectedError = diagnostics.some(d =>
    d.message.includes('not assignable to parameter of type') ||
    d.message.includes('CommittedEnvelope')
  );
  assert.ok(hasExpectedError, 'Expected type-state brand failure, got: ' + JSON.stringify(diagnostics));
});

test('C1 Negative Compilation: ValidatedFusionEnvelope cannot satisfy CommittedEnvelope without journal durability', () => {
  const snippet = `
    import type { ValidatedFusionEnvelope, CommittedEnvelope } from './platform/ingress/types.js';

    function processCommitted(envelope: CommittedEnvelope): void {}

    declare const validated: ValidatedFusionEnvelope;

    // FORBIDDEN: Type-state collapse Validated -> Committed (durability bypass)
    processCommitted(validated);
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'NEGATIVE_GUARD_FAILURE: ValidatedFusionEnvelope satisfied CommittedEnvelope without journal!');

  const hasExpectedError = diagnostics.some(d =>
    d.message.includes('not assignable to parameter of type') ||
    d.message.includes('CommittedEnvelope')
  );
  assert.ok(hasExpectedError, 'Expected type-state brand failure, got: ' + JSON.stringify(diagnostics));
});

test('C1 Runtime Guard: new Feed with function callback throws FEED_CALLBACK_BYPASS_FORBIDDEN', () => {
  assert.throws(
    () => {
      new Feed({}, {}, (e) => {});
    },
    /FEED_CALLBACK_BYPASS_FORBIDDEN/
  );
});

test('C1 Runtime Guard: Engine rejects forged and replayed committed envelopes', async t => {
  const { Engine } = await import('../dist/fusion.js');
  const dir = await mkdtemp(join(tmpdir(), 'c1-engine-authority-'));
  const store = new Store(join(dir, 'state.sqlite'));
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const ingress = new CanonicalIngress({ compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(), journal: new StoreIngressJournal(store) });
  const engine = new Engine({ MODE: 'paper_standard' }, { connection: {} }, {}, {}, store, { mode: 'paper_standard' }, undefined, undefined, 'deterministic_only', undefined, undefined, undefined, ingress);
  assert.throws(
    () => new Engine({ MODE: 'paper_standard' }, { connection: {} }, {}, {}, {}, { mode: 'paper_standard' }),
    /INGRESS_DURABLE_JOURNAL_REQUIRED/,
    'Engine must not silently create an in-memory production journal'
  );
  const inMemoryIngress = new CanonicalIngress({ compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(), journal: new InMemoryIngressJournal() });
  assert.throws(
    () => new Engine({ MODE: 'paper_standard' }, { connection: {} }, {}, {}, store, { mode: 'paper_standard' }, undefined, undefined, 'deterministic_only', undefined, undefined, undefined, inMemoryIngress),
    /INGRESS_DURABLE_JOURNAL_REQUIRED/,
    'an explicitly supplied in-memory journal must not be accepted as FSYNC authority'
  );

  const { Feed } = await import('../dist/feed.js');
  const feedWithIngress = new Feed({ MODE: 'paper_standard', FEED_STALE_MS: 1000, MIN_AGE_MS: 0 }, { connection: {} }, ingress);
  const otherDir = await mkdtemp(join(tmpdir(), 'c1-other-'));
  const otherStore = new Store(join(otherDir, 'other.sqlite'));
  t.after(async () => { await otherStore.close(); await rm(otherDir, { recursive: true, force: true }); });
  const otherIngress = new CanonicalIngress({ compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(), journal: new StoreIngressJournal(otherStore) });
  const feedOther = new Feed({ MODE: 'paper_standard', FEED_STALE_MS: 1000, MIN_AGE_MS: 0 }, { connection: {} }, otherIngress);

  assert.throws(
    () => new Engine({ MODE: 'paper_standard' }, { connection: {} }, {}, {}, store, { mode: 'paper_standard' }, undefined, undefined, 'deterministic_only', undefined, undefined, undefined, ingress, feedOther),
    /FEED_INGRESS_MISMATCH/,
    'Engine must reject Feed bound to a different ingress'
  );
  assert.throws(
    () => new Engine({ MODE: 'paper_standard' }, { connection: {} }, {}, {}, store, { mode: 'paper_standard' }, undefined, undefined, 'deterministic_only', undefined, undefined, undefined, undefined, feedWithIngress),
    /FEED_REQUIRES_COMPOSITION_INGRESS/,
    'Engine must reject Feed injected without its corresponding CanonicalIngress'
  );
  const injDir = await mkdtemp(join(tmpdir(), 'c1-inj-'));
  const injStore = new Store(join(injDir, 'inj.sqlite'));
  t.after(async () => { await injStore.close(); await rm(injDir, { recursive: true, force: true }); });
  const injIngress = new CanonicalIngress({ compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(), journal: new StoreIngressJournal(injStore) });
  const injFeed = new Feed({ MODE: 'paper_standard', FEED_STALE_MS: 1000, MIN_AGE_MS: 0 }, { connection: {} }, injIngress);

  const injectedEngine = new Engine({ MODE: 'paper_standard' }, { connection: {} }, {}, {}, injStore, { mode: 'paper_standard' }, undefined, undefined, 'deterministic_only', undefined, undefined, undefined, injIngress, injFeed);
  assert.equal(injectedEngine.feedOwnership, 'RUNTIME_COMPOSITION_INJECTED');
  assert.equal(engine.feedOwnership, 'ENGINE_LOCAL_FALLBACK');
  assert.equal(injectedEngine.feed.isIngressBound(injIngress), true);
  assert.equal(injectedEngine.feed.isIngressBound(otherIngress), false);

  const forged = {
    journalSeq: 1n, envelopeHash: 'a'.repeat(64), durability: 'FSYNC_COMMITTED', committedAtMs: Date.now(),
    validatedEnvelope: { compiledEnvelope: { decodedEvents: [] } },
  };
  assert.equal(engine.onCommitted, undefined, 'Engine must not expose a JavaScript-callable delivery handler');
  assert.equal(engine.ingress, undefined, 'Engine must not expose its dispatcher to caller-controlled subscriptions');
  assert.equal(engine['#onCommitted'], undefined, 'a captured envelope cannot reach the private dispatch method by property lookup');
  assert.equal(engine.feed.ingress, undefined, 'Feed must not expose a replaceable JavaScript ingress property');
  assert.equal(engine.feed['#ingress'], undefined, 'Feed ingress is held in a JavaScript private field');
  assert.equal(typeof ingress.registerAuthenticForTesting, 'undefined');
  assert.equal(ingress.authenticCommittedEnvelopes, undefined, 'runtime issuer WeakSet must remain JavaScript private');
  assert.equal(ingress.issued(forged), false);
  let captured;
  ingress.subscribe(committed => { captured = committed; });
  const { createUnvalidatedObservation } = await import('../dist/platform/ingress/observation-factory.js');
  const receipt = await ingress.submit(createUnvalidatedObservation({
    sourceId: 'runtime-test', providerId: 'runtime-test', transport: 'test_feed',
    receivedAtMs: Date.now(), slot: 1, commitment: 'confirmed', signature: 'captured-test',
    transactionVersion: 0, rawPayload: Buffer.from('[]'), schemaVersion: 'test-v1', processingIntent: 'LIVE',
  }));
  assert.equal(receipt.status, 'ACCEPTED', `durable Store-backed subscriber should accept fixture event: ${receipt.reason}`);
  assert.equal(ingress.issued(captured), true, 'the captured object is genuinely issued by ingress');
  assert.equal(engine.onCommitted, undefined, 'capturing an authentic envelope does not create a replay entrypoint');
});

import { createUnvalidatedObservation } from '../dist/platform/ingress/observation-factory.js';

test('C1 Runtime Guard: CanonicalIngress rejects non-FSYNC_COMMITTED durability barrier', async () => {
  const compiler = new DefaultFusionEnvelopeCompiler();
  const validator = new DefaultTruthValidator();
  const journal = new InMemoryIngressJournal();

  const ingress = new CanonicalIngress({
    compiler,
    validator,
    journal,
    durability: 'QUEUED', // Forbidden non-durable mode
  });

  const rawPayload = Buffer.from(JSON.stringify(['Program 1111 success']));
  const mockObs = createUnvalidatedObservation({
    sourceId: 'src-1',
    providerId: 'prov-1',
    transport: 'mock',
    receivedAtMs: Date.now(),
    rawPayload,
    schemaVersion: 'test-v1',
    processingIntent: 'LIVE',
  });

  const receipt = await ingress.submit(mockObs);
  assert.equal(receipt.status, 'REJECTED');
  assert.match(receipt.reason, /DURABLE_STORE_INGRESS_JOURNAL_REQUIRED/);
});
