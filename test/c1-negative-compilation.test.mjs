import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Feed } from '../dist/feed.js';
import { CanonicalIngress, DefaultFusionEnvelopeCompiler, DefaultTruthValidator, InMemoryIngressJournal } from '../dist/platform/ingress/canonical-ingress.js';

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
  }));
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

  await assert.rejects(
    () => ingress.submit(mockObs),
    /DURABILITY_BARRIER_VIOLATION/
  );
});
