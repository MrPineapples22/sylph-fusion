import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  const virtualFileName = resolve(projectRoot, 'src', '__virtual_negative_c3_snippet__.ts');

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

test('NEGATIVE COMPILATION 1: Passing MarketEvent to Engine.evaluate is rejected by TS compiler', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    import { type MarketEvent } from './feed.js';

    function testEval(engine: Engine, event: MarketEvent) {
      engine.evaluate(event);
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when passing MarketEvent to Engine.evaluate');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected TS2345 argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 2: Passing UnvalidatedObservation to Engine.evaluate is rejected by TS compiler', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    import { type UnvalidatedObservation } from './platform/ingress/types.js';

    function testEval(engine: Engine, obs: UnvalidatedObservation) {
      engine.evaluate(obs);
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when passing UnvalidatedObservation to Engine.evaluate');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected TS2345 argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 3: Passing CompiledFusionEnvelope to Engine.evaluate is rejected by TS compiler', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    import { type CompiledFusionEnvelope } from './platform/ingress/types.js';

    function testEval(engine: Engine, env: CompiledFusionEnvelope) {
      engine.evaluate(env);
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when passing CompiledFusionEnvelope to Engine.evaluate');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected TS2345 argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 4: Passing ValidatedFusionEnvelope to Engine.evaluate is rejected by TS compiler', () => {
  const snippet = `
    import { Engine } from './fusion.js';
    import { type ValidatedFusionEnvelope } from './platform/ingress/types.js';

    function testEval(engine: Engine, env: ValidatedFusionEnvelope) {
      engine.evaluate(env);
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when passing ValidatedFusionEnvelope to Engine.evaluate');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected TS2345 argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 5: Forging VerifiedDecision without ProvenanceVerifier is rejected by TS compiler', () => {
  const snippet = `
    import { type VerifiedDecision, type AuthoritativeDecision } from './intelligence/provenance/types.js';

    function forgeVerified(decision: AuthoritativeDecision): VerifiedDecision {
      return {
        decision,
        verificationHash: 'fake_hash',
        verifiedAtMs: 1_000,
        canonicalBranch: 'main',
      };
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when forging VerifiedDecision without ProvenanceVerifier');
  const hasBrandError = diagnostics.some(d => d.code === 2322 || /not assignable|missing/i.test(d.message));
  assert.ok(hasBrandError, `Expected TS2322 nominal brand error, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 6: Missing required provenance fields in DecisionProvenance is rejected by TS compiler', () => {
  const snippet = `
    import { type DecisionProvenance } from './intelligence/provenance/types.js';

    // Missing releaseRoot, controlRoot, reducerVersion, intelligenceVersion
    const incompleteProvenance: DecisionProvenance = {
      journalSeq: 1n,
      envelopeHash: 'abc',
      stateRootBefore: 'def',
      stateRootAfter: 'ghi',
      featureRoot: 'jkl',
      decisionId: 'mno',
      decisionHash: 'pqr',
    } as any;
  `;

  // Without 'as any'
  const realSnippet = snippet.replace('} as any;', '};');
  const diagnostics = compileSnippet(realSnippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when DecisionProvenance misses required roots');
  const hasMissingProps = diagnostics.some(d => d.code === 2739 || d.code === 2322 || /missing the following properties/i.test(d.message));
  assert.ok(hasMissingProps, `Expected TS missing properties diagnostic, got: ${JSON.stringify(diagnostics)}`);
});
