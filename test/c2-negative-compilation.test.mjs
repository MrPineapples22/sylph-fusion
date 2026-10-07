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

  const virtualFileName = resolve(projectRoot, 'src', '__virtual_negative_test_snippet__.ts');

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

test('NEGATIVE COMPILATION 1: Mutating readonly fields on FusionStateRootV2 is rejected by TS compiler', () => {
  const snippet = `
    import { CanonicalReducer, type FusionStateRootV2 } from './platform/reducer/index.js';

    function attemptMutation(state: FusionStateRootV2) {
      // @ts-expect-error mutating readonly property
      state.observedSlot = 999_999n;
    }
  `;

  const diagnostics = compileSnippet(snippet.replace('// @ts-expect-error mutating readonly property', ''));
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when mutating observedSlot on FusionStateRootV2');
  const hasReadonlyDiag = diagnostics.some(d => d.code === 2540 || /read-only|readonly/i.test(d.message));
  assert.ok(hasReadonlyDiag, `Expected TS2540 read-only diagnostic, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 2: Mutating stateRoot on FusionStateRootV2 is rejected by TS compiler', () => {
  const snippet = `
    import { type FusionStateRootV2 } from './platform/reducer/index.js';

    function attemptRootMutation(state: FusionStateRootV2) {
      state.stateRoot = 'bad_state_root' as any;
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when mutating stateRoot on FusionStateRootV2');
  const hasReadonlyDiag = diagnostics.some(d => d.code === 2540 || /read-only|readonly/i.test(d.message));
  assert.ok(hasReadonlyDiag, `Expected TS2540 read-only diagnostic, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 3: Forging FusionStateRootV2 without CanonicalReducer is rejected by TS compiler', () => {
  const snippet = `
    import { type FusionStateRootV2 } from './platform/reducer/index.js';
    import { type FusionStateRootFieldsV2 } from './platform/pipeline/state-root-v2.js';

    // Plain object attempting to cast as FusionStateRootV2
    const fakeState: FusionStateRootV2 = {
      economicFactId: 'fake',
      traceId: 'fake',
      state: 'OBSERVED',
      revision: 0n,
      cluster: 'mainnet',
      observedSlot: 0n,
      bankFingerprint: '0',
      blockhash: '0',
      lastValidBlockHeight: 0n,
      evidenceRoot: '0',
      coverageCertificateRoot: '0',
      sourceIndependenceRoot: '0',
      semanticStateRoot: '0',
      tokenSemanticsRoot: '0',
      programEpochRoot: '0',
      accountResolutionRoot: '0',
      marketStateRoot: '0',
      authenticityRoot: '0',
      actorGraphRoot: '0',
      featureSnapshotRoot: '0',
      hypothesisRoot: '0',
      alphaRealityRoot: '0',
      portfolioRiskRoot: '0',
      exitabilityRoot: '0',
      systemicRiskRoot: '0',
      survivalRoot: '0',
      evacuationRoot: '0',
      safetyCapacityRoot: '0',
      resourceReservationId: '0',
      capitalStateRoot: '0',
      capitalReservationId: '0',
      authorityEpoch: 0,
      fenceEpoch: 0,
      revocationEpoch: 0,
      executionGenerationId: '0',
      executionPermitId: '0',
      effectSpecHash: '0',
      messageHash: '0',
      transactionSignature: '0',
      transportAttemptRoot: '0',
      chainOutcomeRoot: '0',
      terminalityCertificateRoot: '0',
      economicOutcomeRoot: '0',
      configRoot: '0',
      policyRoot: '0',
      releaseRoot: '0',
      proofGraphRoot: '0',
      stateRoot: '0' as any,
    };
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when forging FusionStateRootV2');
  const hasBrandDiag = diagnostics.some(d => /_fusionStateRootV2Brand/i.test(d.message) || d.code === 2741 || d.code === 2322);
  assert.ok(hasBrandDiag, `Expected nominal brand diagnostic, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 4: Forging StateTransitionProof without CanonicalReducer is rejected by TS compiler', () => {
  const snippet = `
    import { type StateTransitionProof } from './platform/reducer/index.js';

    const fakeProof: StateTransitionProof = {
      journalSeq: 1n,
      envelopeHash: '0' as any,
      stateRootBefore: '0' as any,
      stateRootAfter: '0' as any,
      reducerVersion: 'v2',
      transitionHash: '0' as any,
    };
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when forging StateTransitionProof');
  const hasBrandDiag = diagnostics.some(d => /_stateTransitionProofBrand/i.test(d.message) || d.code === 2741 || d.code === 2322);
  assert.ok(hasBrandDiag, `Expected nominal brand diagnostic, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 5: Passing uncommitted envelope to CanonicalReducer.reduce is rejected by TS compiler', () => {
  const snippet = `
    import { CanonicalReducer, type FusionStateRootV2 } from './platform/reducer/index.js';
    import { type ValidatedFusionEnvelope } from './platform/ingress/types.js';

    function attemptUncommittedReduce(state: FusionStateRootV2, val: ValidatedFusionEnvelope) {
      // @ts-expect-error ValidatedFusionEnvelope is not CommittedEnvelope
      CanonicalReducer.reduce(state, val as any as ValidatedFusionEnvelope);
    }
  `;

  const diagnostics = compileSnippet(snippet.replace('// @ts-expect-error ValidatedFusionEnvelope is not CommittedEnvelope', ''));
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when passing ValidatedFusionEnvelope to CanonicalReducer.reduce');
  const hasTypeDiag = diagnostics.some(d => d.code === 2345 || /not assignable to parameter of type 'CommittedEnvelope'/i.test(d.message));
  assert.ok(hasTypeDiag, `Expected TS2345 type mismatch diagnostic, got: ${JSON.stringify(diagnostics)}`);
});
