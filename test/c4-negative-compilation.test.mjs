/**
 * SYLPH FUSION — C4 NEGATIVE COMPILATION GUARDS TEST SUITE
 * Specifications: Frozen Architecture Execution Prompt (Sections 30, 31, 32, 33, 34, 35)
 *
 * Verifies compile-time type-system negative guards:
 * 1. Direct construction of ActionProofBundle fails TypeScript compilation (nominal brand protection).
 * 2. Caller-asserted plain string releaseRoot without ReleaseAuthorityProof fails compilation.
 * 3. Caller-asserted plain string controlRoot without ControlAuthorityProof fails compilation.
 * 4. Unverified risk object passed to CanonicalEconomicAuthority.reserveCapital fails compilation.
 * 5. Forging VerifiedRiskAuthorization without CanonicalRiskAuthority fails compilation.
 * 6. Forging CapitalReservation without CanonicalEconomicAuthority fails compilation.
 * 7. Forging ReleaseAuthorityProof without CanonicalReleaseAuthorityStore fails compilation.
 * 8. Forging ControlAuthorityProof without CanonicalControlAuthorityStore fails compilation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

function compileSnippet(snippetSource) {
  const configFile = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configFile) {
    throw new Error('tsconfig.json not found in project root: ' + projectRoot);
  }

  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(config, ts.sys, projectRoot);

  const virtualFileName = resolve(projectRoot, 'src', '__virtual_negative_c4_snippet__.ts');

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

test('NEGATIVE COMPILATION 1: Direct construction of ActionProofBundle fails compilation', () => {
  const snippet = `
    import { type ActionProofBundle } from './platform/assurance/action-proof-bundle.js';

    function forgeBundle(): ActionProofBundle {
      return {
        actionId: 'fake_action',
        exactActionHash: 'a'.repeat(64),
        exactTransactionHash: 'b'.repeat(64),
        marketTruthCertificate: {} as any,
        tokenSemanticsCertificate: {} as any,
        alphaRealityCertificate: {} as any,
        signalPortfolioCertificate: {} as any,
        executionPolicyCertificate: {} as any,
        simulationCertificate: {} as any,
        exitabilityCertificate: {} as any,
        portfolioEvacuationCertificate: {} as any,
        capitalAllocationCertificate: {} as any,
        reservationCertificate: {} as any,
        survivalCertificate: {} as any,
        twinTrustCertificate: {} as any,
        releaseVSA: 'c'.repeat(64),
        configVSA: 'd'.repeat(64),
        policyVSA: 'e'.repeat(64),
        governorVSA: 'f'.repeat(64),
        controlEpoch: 1,
        fenceEpoch: 1,
        revocationRoot: '0'.repeat(64),
        validUntilSlot: 100n,
        validUntilTime: 1000,
        proofGraphRoot: '1'.repeat(64),
      };
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when directly constructing ActionProofBundle');
  const hasBrandError = diagnostics.some(d => d.code === 2322 || /not assignable|missing/i.test(d.message));
  assert.ok(hasBrandError, `Expected TS2322 nominal brand error, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 2: Caller-asserted plain string releaseRoot without proof fails compilation', () => {
  const snippet = `
    import { ActionProofBundleBuilder, type BuildBundleParams } from './platform/assurance/authority-ancestry.js';

    function testCallerAssertedRelease(params: BuildBundleParams) {
      ActionProofBundleBuilder.build({
        ...params,
        releaseProof: 'plain_caller_asserted_release_root_string', // Illegal plain string
      } as any as { releaseProof: string });
    }
  `;

  // Without 'as any'
  const realSnippet = snippet.replace('} as any as { releaseProof: string });', '});');
  const diagnostics = compileSnippet(realSnippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when caller asserts plain string releaseRoot');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2322 || d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 3: Caller-asserted plain string controlRoot without proof fails compilation', () => {
  const snippet = `
    import { ActionProofBundleBuilder, type BuildBundleParams } from './platform/assurance/authority-ancestry.js';

    function testCallerAssertedControl(params: BuildBundleParams) {
      ActionProofBundleBuilder.build({
        ...params,
        controlProof: 'plain_caller_asserted_control_root_string', // Illegal plain string
      } as any as { controlProof: string });
    }
  `;

  // Without 'as any'
  const realSnippet = snippet.replace('} as any as { controlProof: string });', '});');
  const diagnostics = compileSnippet(realSnippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when caller asserts plain string controlRoot');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2322 || d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 4: Unverified risk object passed to EconomicAuthorityStore reserveCapital fails compilation', () => {
  const snippet = `
    import { CanonicalEconomicAuthority } from './platform/assurance/authority-ancestry.js';
    import { EconomicAuthorityStore } from './intelligence/capital/economic-authority-store.js';

    function testUnverifiedRiskToCapital(store: EconomicAuthorityStore) {
      const unverifiedRisk = {
        riskAuthId: 'unverified_001',
        decisionId: 'dec_001',
        maxAllocationLamports: 10_000n,
      };

      // Illegal: unverifiedRisk lacks VerifiedRiskAuthorization brand
      CanonicalEconomicAuthority.reserveCapital(unverifiedRisk as any as { riskAuthId: string }, store, 100n);
    }
  `;

  const realSnippet = snippet.replace('unverifiedRisk as any as { riskAuthId: string }', 'unverifiedRisk');
  const diagnostics = compileSnippet(realSnippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when passing unverified risk to capital reservation');
  const hasTypeMismatch = diagnostics.some(d => d.code === 2345 || /not assignable/i.test(d.message));
  assert.ok(hasTypeMismatch, `Expected argument type mismatch, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 5: Forging VerifiedRiskAuthorization without CanonicalRiskAuthority fails compilation', () => {
  const snippet = `
    import { type VerifiedRiskAuthorization } from './platform/assurance/authority-ancestry.js';

    function forgeRiskAuth(): VerifiedRiskAuthorization {
      return {
        riskAuthId: 'fake_risk',
        decisionId: 'dec_fake',
        decisionHash: 'a'.repeat(64),
        journalSeq: 1n,
        envelopeHash: 'b'.repeat(64),
        stateRootAfter: 'c'.repeat(64),
        featureRoot: 'd'.repeat(64),
        targetMint: 'fake_mint',
        action: 'BUY',
        maxAllocationLamports: 1_000n,
        maxSlippageBps: 10,
        riskScore: 90,
        authorizedAtMs: 1000,
        expiresAtMs: 2000,
        riskAssessmentHash: 'e'.repeat(64),
      };
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when forging VerifiedRiskAuthorization');
  const hasBrandError = diagnostics.some(d => d.code === 2322 || /not assignable|missing/i.test(d.message));
  assert.ok(hasBrandError, `Expected TS2322 nominal brand error, got: ${JSON.stringify(diagnostics)}`);
});

test('NEGATIVE COMPILATION 6: Forging CapitalReservation without CanonicalEconomicAuthority fails compilation', () => {
  const snippet = `
    import { type CapitalReservation } from './platform/assurance/authority-ancestry.js';

    function forgeReservation(): CapitalReservation {
      return {
        reservationId: 'fake_res',
        intentId: 'intent_fake',
        decisionId: 'dec_fake',
        riskAuthId: 'risk_fake',
        journalSeq: 1n,
        envelopeHash: 'b'.repeat(64),
        stateRootAfter: 'c'.repeat(64),
        reservedLamports: 1_000n,
        expirationSlot: 100n,
        acquiredAtMs: 1000,
        isConsumed: false,
        reservationHash: 'f'.repeat(64),
      };
    }
  `;

  const diagnostics = compileSnippet(snippet);
  assert.ok(diagnostics.length > 0, 'Expected compilation failure when forging CapitalReservation');
  const hasBrandError = diagnostics.some(d => d.code === 2322 || /not assignable|missing/i.test(d.message));
  assert.ok(hasBrandError, `Expected TS2322 nominal brand error, got: ${JSON.stringify(diagnostics)}`);
});
