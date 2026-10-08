/**
 * SYLPH FUSION — STATIC CONNECTIVITY COMPILER (STEP 1)
 * Specifications: Blueprint Sections 4, 5, 6, 7, 8, 23, 24, 25, 63
 *
 * Responsibilities:
 * 1. Load tsconfig.json and create TypeScript Program + TypeChecker.
 * 2. Inventory all project source files in src/.
 * 3. Compute deterministic source hashes using SHA-256 and Canonicalization V10.
 * 4. Resolve module imports and build reverse `importedBy` graph.
 * 5. Inspect symbols (exported classes, interfaces, types, functions, variables).
 * 6. Identify producer/consumer relationships.
 * 7. Identify mutation surfaces (balance mutations, DB writes, journal writes, signing).
 * 8. Identify authority declarations & detect authority collisions.
 * 9. Detect wall-clock usage, randomness, network calls, and synthetic evidence markers.
 * 10. Classify components according to Section 6 taxonomy:
 *     ECONOMIC_AUTHORITATIVE | ECONOMIC_ADVISORY | SHADOW | RESEARCH |
 *     OBSERVABILITY | UI_ONLY | TEST_ONLY | LEGACY | ORPHAN
 * 11. Detect orphan modules (zero incoming imports, excluding designated entry points).
 * 12. Emit explicit machine-readable authorityRequirements.
 * 13. Produce C0–C4 scorecard with strict static analysis ceiling (C5–C10 strictly UNPROVEN).
 * 14. Emit all required artifacts in artifacts/connectivity/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import {
  canonicalJsonV10,
  hashCanonicalV10,
} from './canonicalization-v10.mjs';
import { evaluateStaticConnectivity } from './connectivity-static-core.mjs';
import { readAndVerifyTestRunReceipt } from './test-run-receipt.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const SRC_DIR = resolve(ROOT_DIR, 'src');
const ARTIFACTS_DIR = resolve(ROOT_DIR, 'artifacts', 'connectivity');

// Designated system entry points that are not orphans despite 0 incoming internal imports
const KNOWN_ENTRY_POINTS = new Set([
  'src/fusion.ts',
  'src/app.ts',
  'src/db-worker.ts',
  'src/rpc.ts',
  'src/ui-demo.ts',
  'src/config.ts',
  'src/feed.ts',
  'src/execution.ts',
]);

// Target Exclusive Authorities per Section 5 of Blueprint
const AUTHORITY_SYMBOLS = {
  canonicalStateWriter: 'reduceFusionTransition',
  economicStateWriter: 'EconomicAuthorityStore',
  decisionIssuer: 'UnifiedDecisionEngine',
  terminalityIssuer: 'TerminalityAuthority',
};

/**
 * Normalizes filesystem path to forward slashes relative to root.
 * @param {string} p
 * @returns {string}
 */
function toRelPath(p) {
  return relative(ROOT_DIR, p).replace(/\\/g, '/');
}

/**
 * Computes deterministic SHA-256 of raw file bytes.
 * @param {string} filePath
 * @returns {string}
 */
function computeSourceHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Classifies a module according to the Blueprint Section 6 taxonomy.
 * @param {string} relPath
 * @param {object} analysis
 * @returns {{ classification: string, rationale: string }}
 */
function classifyComponent(relPath, analysis) {
  // 1. Check ORPHAN
  if (analysis.importedBy.length === 0 && !KNOWN_ENTRY_POINTS.has(relPath)) {
    return {
      classification: 'ORPHAN',
      rationale: 'Module has 0 incoming internal imports and is not a designated system entry point.',
    };
  }

  // 2. Check ECONOMIC_AUTHORITATIVE
  if (Object.values(AUTHORITY_SYMBOLS).some((symbol) => analysis.exportedSymbols.includes(symbol))) {
    return {
      classification: 'ECONOMIC_AUTHORITATIVE',
      rationale: 'Exports one of the explicitly configured authority symbols; this establishes a declaration, not runtime exclusivity or effect.',
    };
  }
  if (analysis.hasBalanceMutations || analysis.hasSigningInvocations) {
    return {
      classification: 'ECONOMIC_ADVISORY',
      rationale: 'Static AST heuristic found a cash-like assignment or signing call; review is required before assigning economic authority.',
    };
  }

  // 3. Check UI_ONLY
  if (
    relPath.startsWith('terminal/') ||
    relPath.includes('ui-state') ||
    relPath.includes('ui-demo')
  ) {
    return {
      classification: 'UI_ONLY',
      rationale: 'Presentation, visual state, or operator dashboard projection only.',
    };
  }

  // 4. Check SHADOW
  if (
    relPath.includes('shadow') ||
    relPath.includes('counterfactual') ||
    analysis.hasSyntheticFindings && relPath.includes('simulation')
  ) {
    return {
      classification: 'SHADOW',
      rationale: 'Shadow execution, counterfactual comparison, or offline emulation without financial authority.',
    };
  }

  // 5. Check RESEARCH
  if (
    relPath.includes('backtest') ||
    relPath.includes('research') ||
    relPath.includes('forensics') ||
    relPath.includes('cohort')
  ) {
    return {
      classification: 'RESEARCH',
      rationale: 'Offline exploratory research, calibration, or non-authoritative analytics.',
    };
  }

  // 6. Check OBSERVABILITY
  if (
    relPath.includes('flight-recorder') ||
    relPath.includes('telemetry') ||
    relPath.includes('audit') ||
    relPath.includes('sentinel') ||
    relPath.includes('diagnostics') ||
    relPath.includes('health')
  ) {
    return {
      classification: 'OBSERVABILITY',
      rationale: 'Logging, health monitoring, telemetry, or passive audit projection.',
    };
  }

  // 7. Check LEGACY
  if (
    relPath.includes('/v0') ||
    relPath.includes('/v1') ||
    relPath.includes('legacy')
  ) {
    return {
      classification: 'LEGACY',
      rationale: 'Deprecated schema or superseded historical adapter.',
    };
  }

  // 8. Check ECONOMIC_ADVISORY
  if (
    relPath.startsWith('src/intelligence/') ||
    relPath.includes('signal') ||
    relPath.includes('alpha') ||
    relPath.includes('model') ||
    relPath.includes('belief') ||
    relPath.includes('opportunity') ||
    relPath.includes('regime') ||
    relPath.includes('bayes')
  ) {
    return {
      classification: 'ECONOMIC_ADVISORY',
      rationale: 'Provides signals, predictions, regime estimates, or sizing recommendations without execution authority.',
    };
  }

  // Default platform/infrastructure module
  return {
    classification: 'ECONOMIC_ADVISORY',
    rationale: 'Platform orchestration or adapter providing advisory infrastructure to the decision pipeline.',
  };
}

/**
 * Main compilation and analysis engine.
 */
export function runConnectivityCompiler(options = {}) {
  console.log('[CONNECTIVITY_COMPILER] Initializing TypeScript Compiler & AST Program...');

  const configPath = ts.findConfigFile(ROOT_DIR, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('CONFIG_ERROR: tsconfig.json not found');
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT_DIR);
  const program = ts.createProgram(parsedConfig.fileNames, { ...parsedConfig.options, noEmit: true });
  const checker = program.getTypeChecker();
  // A constructed Program is not proof of compilation; diagnostics are.
  const compileDiagnostics = [
    ...parsedConfig.errors,
    ...ts.getPreEmitDiagnostics(program),
  ];

  const sourceFiles = program.getSourceFiles().filter((f) => {
    return !f.isDeclarationFile && (f.fileName.includes('/src/') || f.fileName.includes('\\src\\'));
  });

  console.log(`[CONNECTIVITY_COMPILER] Found ${sourceFiles.length} project source files in src/`);


  // 1. Inventory & Hashes
  const inventory = new Map();
  const fileMapByRel = new Map();

  for (const sf of sourceFiles) {
    const relPath = toRelPath(sf.fileName);
    const absPath = sf.fileName;
    const sourceHash = computeSourceHash(absPath);
    const sizeBytes = readFileSync(absPath).length;

    const fileMeta = {
      relPath,
      absPath,
      sourceHash,
      sizeBytes,
      sourceFile: sf,
      imports: [],
      importedBy: [],
      exportedSymbols: [],
      producerOf: [],
      consumerOf: [],
      wallClockUsage: [],
      randomnessUsage: [],
      networkUsage: [],
      syntheticFindings: [],
      mutationSurfaces: [],
      authorityDeclarations: [],
      hasBalanceMutations: false,
      hasSigningInvocations: false,
    };

    inventory.set(relPath, fileMeta);
    fileMapByRel.set(relPath, fileMeta);
  }

  // 2. AST Inspection & Import Resolution
  for (const [relPath, meta] of inventory.entries()) {
    const sf = meta.sourceFile;
    const fileDir = dirname(sf.fileName);

    function visit(node) {
      // Imports
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('.')) {
          const moduleSymbol = checker.getSymbolAtLocation(node.moduleSpecifier);
          const symbolFile = moduleSymbol?.declarations?.[0]?.getSourceFile().fileName;
          const resolution = ts.resolveModuleName(specifier, sf.fileName, parsedConfig.options, ts.sys).resolvedModule;
          const targetPath = (symbolFile || resolution?.resolvedFileName) && toRelPath(symbolFile || resolution.resolvedFileName);
          if (targetPath && inventory.has(targetPath)) {
            meta.imports.push({ specifier, target: targetPath, typeOnly: ts.isImportDeclaration(node) && !!node.importClause?.isTypeOnly, kind: ts.isExportDeclaration(node) ? 'RE_EXPORT' : 'IMPORT' });
          } else {
            meta.unresolvedImports = meta.unresolvedImports ?? [];
            meta.unresolvedImports.push({ specifier, resolved: targetPath || null });
          }
        } else {
          meta.imports.push({ specifier, external: true });
        }
      }

      // Exports / Symbols
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name
      ) {
        const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExported) {
          const symbolName = node.name.text;
          meta.exportedSymbols.push(symbolName);
          meta.producerOf.push(symbolName);
        }
      }

      // Variable statements with exports
      if (ts.isVariableStatement(node)) {
        const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExported) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              meta.exportedSymbols.push(decl.name.text);
              meta.producerOf.push(decl.name.text);
            }
          }
        }
      }

      // Calls & expressions analysis
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sf);

        // Wall clock
        if (text.includes('Date.now') || text.includes('performance.now') || text.includes('process.hrtime')) {
          meta.wallClockUsage.push({
            type: text,
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }

        // Randomness
        if (text.includes('Math.random') || text.includes('randomUUID') || text.includes('randomBytes')) {
          meta.randomnessUsage.push({
            type: text,
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }

        // Network
        if (text === 'fetch' || text.includes('fetch(') || text.includes('http.request') || text.includes('https.request')) {
          meta.networkUsage.push({
            type: text,
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }

        // Signing
        if (text.includes('signTransaction') || text.includes('signMessage') || text.includes('durableSign')) {
          meta.hasSigningInvocations = true;
          meta.mutationSurfaces.push({
            type: 'TRANSACTION_SIGNING',
            expression: text,
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }
      }

      // New expressions
      if (ts.isNewExpression(node)) {
        const text = node.expression.getText(sf);
        if (text === 'Date') {
          meta.wallClockUsage.push({
            type: 'new Date',
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }
        if (text === 'WebSocket') {
          meta.networkUsage.push({
            type: 'new WebSocket',
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }
      }

      // Binary expressions (mutations, assignments)
      if (ts.isBinaryExpression(node)) {
        const isAssignment =
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken;

        if (isAssignment) {
          const leftText = node.left.getText(sf);
          if (
            leftText.includes('confirmedCashLamports') ||
            leftText.includes('reservedCashLamports') ||
            leftText.includes('reservedCapitalLamports')
          ) {
            meta.hasBalanceMutations = true;
            meta.mutationSurfaces.push({
              type: 'BALANCE_MUTATION',
              target: leftText,
              pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
            });
          }
        }
      }

      // String literals (synthetic evidence check)
      if (ts.isStringLiteral(node)) {
        const str = node.text.toLowerCase();
        if (
          (str.includes('synthetic') ||
            str.includes('mock_') ||
            str.includes('fixture_') ||
            str.includes('fake_')) &&
          !relPath.includes('test') &&
          !relPath.includes('adversarial')
        ) {
          meta.syntheticFindings.push({
            text: node.text,
            pos: sf.getLineAndCharacterOfPosition(node.getStart(sf)),
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  const sourceManifest = [...inventory.values()]
    .map(({ relPath, sourceHash, sizeBytes }) => ({ relPath, sourceHash, sizeBytes }))
    .sort((left, right) => left.relPath.localeCompare(right.relPath));
  const sourceInventoryRoot = hashCanonicalV10(sourceManifest);
  const testRunReceipt = readAndVerifyTestRunReceipt(sourceInventoryRoot, options.receiptPath);

  // 3. Build reverse `importedBy` and consumerOf links
  for (const [relPath, meta] of inventory.entries()) {
    for (const imp of meta.imports) {
      if (imp.target && inventory.has(imp.target)) {
        const targetMeta = inventory.get(imp.target);
        targetMeta.importedBy.push(relPath);
        meta.consumerOf.push(imp.target);
      }
    }
  }

  // 4. Authority Declarations & Collision Detection
  const authorityCollisions = [];
  const detectedAuthorities = Object.fromEntries(Object.keys(AUTHORITY_SYMBOLS).map((key) => [key, []]));

  for (const [relPath, meta] of inventory.entries()) {
    for (const [authority, symbol] of Object.entries(AUTHORITY_SYMBOLS)) {
      if (meta.exportedSymbols.includes(symbol)) detectedAuthorities[authority].push(relPath);
    }
  }

  // Assert exclusive authority compliance
  for (const [authKey, symbol] of Object.entries(AUTHORITY_SYMBOLS)) {
    const claimants = detectedAuthorities[authKey] || [];
    if (claimants.length > 1) {
      authorityCollisions.push({
        authorityDimension: authKey,
        targetExclusiveAuthority: symbol,
        duplicateExportingModules: claimants,
        severity: 'CRITICAL_COLLISION',
      });
    }
  }

  // 5. Component Classifications & Orphan Detection
  const classifications = [];
  const orphanModules = [];
  const syntheticEvidenceFindings = [];

  for (const [relPath, meta] of inventory.entries()) {
    const { classification, rationale } = classifyComponent(relPath, meta);
    classifications.push({
      file: relPath,
      classification,
      rationale,
      sourceHash: meta.sourceHash,
      sizeBytes: meta.sizeBytes,
      importedByCount: meta.importedBy.length,
      maxCeiling: 'C4',
    });

    if (classification === 'ORPHAN') {
      orphanModules.push({
        file: relPath,
        sourceHash: meta.sourceHash,
        sizeBytes: meta.sizeBytes,
        importsCount: meta.imports.length,
      });
    }

    if (meta.syntheticFindings.length > 0) {
      syntheticEvidenceFindings.push({
        file: relPath,
        findingsCount: meta.syntheticFindings.length,
        samples: meta.syntheticFindings.slice(0, 5),
      });
    }
  }

  // 6. Static Graph & Evidence Graph Construction
  const staticGraphNodes = [];
  const staticGraphEdges = [];

  for (const [relPath, meta] of inventory.entries()) {
    staticGraphNodes.push({
      id: relPath,
      sourceHash: meta.sourceHash,
      sizeBytes: meta.sizeBytes,
      exportedSymbols: meta.exportedSymbols,
      importedBy: meta.importedBy,
      imports: meta.imports.map((i) => (i.target ? i.target : i.specifier)),
    });

    for (const imp of meta.imports) {
      if (imp.target) {
        staticGraphEdges.push({
          from: relPath,
          to: imp.target,
          type: 'IMPORT',
        });
      }
    }
  }

  const requiredAuthorityModules = Object.keys(AUTHORITY_SYMBOLS).map((authority) => ({
    authority,
    module: detectedAuthorities[authority][0] ?? null,
  }));
  const staticConnectivity = evaluateStaticConnectivity({
    sourceCount: inventory.size,
    compileDiagnostics: compileDiagnostics.length,
    testRunPassed: testRunReceipt,
    declaredEdges: staticGraphEdges,
    entryPoint: 'src/fusion.ts',
    requiredAuthorityModules,
  });

  // 7. C0–C10 Scorecard Construction
  const scorecard = {
    metadata: {
      generatedAt: new Date().toISOString(),
      generator: 'scripts/connectivity-compiler.mjs',
      enforcedCeiling: 'C4',
      ceilingReason: 'STATIC_ANALYSIS_CEILING: Static analysis cannot exceed C4. Physical runtime evidence required for C5-C10.',
      totalModulesAudited: inventory.size,
      sourceInventoryRoot,
      inventoryScope: 'TypeScript files included by tsconfig under src/; terminal JS/MJS, scripts, Rust, generated dist, and external services are excluded.',
      diagnosticCount: compileDiagnostics.length,
      testRunEvidence: testRunReceipt.verified
        ? `PASS: Source-bound test receipt verified (${testRunReceipt.receiptHash}); integrity evidence only, not a signature or independent trusted execution attestation.`
        : `UNPROVEN: ${testRunReceipt.reason}; no valid current-source test receipt was verified.`,
      testRunReceipt: testRunReceipt.verified ? testRunReceipt : null,
      connectivityEvidence: 'Static imports/re-exports resolved from TypeScript compiler module resolution; edges are observed references, not runtime proof.',
    },
    systemScore: { ...staticConnectivity },
    compileDiagnostics: compileDiagnostics.map((d) => ({
      code: d.code,
      category: ts.DiagnosticCategory[d.category],
      file: d.file ? toRelPath(d.file.fileName) : null,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    })),
    modules: {},
  };

  for (const [relPath, meta] of inventory.entries()) {
    const c0 = true;
    const c1 = compileDiagnostics.length === 0;
    const c2 = false;
    const c3Observed = meta.imports.length > 0 || meta.importedBy.length > 0 || KNOWN_ENTRY_POINTS.has(relPath);
    const c3 = c2 && c3Observed;
    const c4 = false;

    scorecard.modules[relPath] = {
      C0_exists: c0,
      C1_compiles: c1,
      C2_unit_tested: c2,
      C3_declared_connection: c3,
      C3_staticEdgesObserved: c3Observed,
      C4_static_integration: c4,
      C5_observed_runtime: false,
      C6_cryptographic_continuity: false,
      C7_authoritative_effect: false,
      C8_deterministic_replay: false,
      C9_fault_containment: false,
      C10_real_canary: false,
      highestProvenLevel: c1 ? 'C1' : 'C0',
      ceilingEnforced: 'C4',
    };
  }

  // 8. Output Artifacts Generation
  if (!existsSync(ARTIFACTS_DIR)) {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  // Classification JSON & CSV
  writeFileSync(
    join(ARTIFACTS_DIR, 'intelligence-classification.json'),
    canonicalJsonV10(classifications),
    'utf8'
  );

  const csvRows = ['File,Classification,Rationale,SourceHash,SizeBytes,ImportedByCount,MaxCeiling'];
  for (const c of classifications) {
    csvRows.push(
      `"${c.file}","${c.classification}","${c.rationale.replace(/"/g, '""')}","${c.sourceHash}",${c.sizeBytes},${c.importedByCount},"${c.maxCeiling}"`
    );
  }
  writeFileSync(join(ARTIFACTS_DIR, 'intelligence-classification.csv'), csvRows.join('\n'), 'utf8');

  // Static Graph JSON
  const staticGraph = {
    schemaVersion: '1.0.0',
    ceiling: 'C4',
    sourceInventoryRoot,
    nodesCount: staticGraphNodes.length,
    edgesCount: staticGraphEdges.length,
    nodes: staticGraphNodes,
    edges: staticGraphEdges,
  };
  writeFileSync(
    join(ARTIFACTS_DIR, 'static-graph.json'),
    canonicalJsonV10(staticGraph),
    'utf8'
  );

  // Authority Graph JSON
  const authorityGraph = {
    schemaVersion: '1.0.0',
    ceiling: 'C4',
    exclusiveAuthorities: AUTHORITY_SYMBOLS,
    detectedAuthorities,
    observedExportSymbols: AUTHORITY_SYMBOLS,
    collisionCheckSemantics: 'Detects duplicate exact exported symbol declarations only; does not establish indirect authority, runtime exclusivity, or economic effect.',
    authorityCollisions,
    authorityRequirements: {
      canonicalStateWriter: 'FusionReducer',
      canonicalStateWriterObservedExport: AUTHORITY_SYMBOLS.canonicalStateWriter,
      economicStateWriter: 'EconomicAuthorityStore',
      decisionIssuer: 'UnifiedDecisionEngine',
      terminalityIssuer: 'TerminalityAuthority',
      requiredForSystemCertification: true,
      requiredConnectivityLevel: 'C10',
    },
  };
  writeFileSync(
    join(ARTIFACTS_DIR, 'authority-graph.json'),
    canonicalJsonV10(authorityGraph),
    'utf8'
  );

  // Evidence Graph JSON
  const evidenceGraph = {
    schemaVersion: '1.0.0',
    ceiling: 'C4',
    observedStaticImportEdges: staticGraphEdges,
    staticEvidenceLinksCount: staticGraphEdges.length,
    configuredEvidenceSpine: false,
    runtimeEvidenceStatus: 'UNPROVEN_AT_STATIC_LEVEL',
  };
  writeFileSync(
    join(ARTIFACTS_DIR, 'evidence-graph.json'),
    canonicalJsonV10(evidenceGraph),
    'utf8'
  );

  // Authority Collisions JSON
  writeFileSync(
    join(ARTIFACTS_DIR, 'authority-collisions.json'),
    canonicalJsonV10(authorityCollisions),
    'utf8'
  );

  // Synthetic Evidence Findings JSON
  writeFileSync(
    join(ARTIFACTS_DIR, 'synthetic-evidence-findings.json'),
    canonicalJsonV10(syntheticEvidenceFindings),
    'utf8'
  );

  // Orphan Modules JSON
  writeFileSync(
    join(ARTIFACTS_DIR, 'orphan-modules.json'),
    canonicalJsonV10(orphanModules),
    'utf8'
  );

  // C0–C10 Scorecard JSON
  writeFileSync(
    join(ARTIFACTS_DIR, 'c0-c10-scorecard.json'),
    canonicalJsonV10(scorecard),
    'utf8'
  );

  // Markdown Summary Audit
  const markdownAudit = `# SYLPH FUSION — SYSTEM CONNECTIVITY AUDIT (STATIC C0–C4)

**Generated:** ${scorecard.metadata.generatedAt}
**Enforced Ceiling:** C4 (STATIC ANALYSIS CAN NEVER EXCEED C4)
**Total Source Modules Audited:** ${inventory.size}
**Static Graph Nodes:** ${staticGraphNodes.length}
**Static Graph Edges:** ${staticGraphEdges.length}

---

## 1. Static Analysis Ceiling Law

\`\`\`
STATIC EVIDENCE → MAXIMUM C4.
C5–C10 REQUIRE PHYSICAL RUNTIME EVIDENCE.
NO PHYSICAL EVIDENCE → NO CERTIFICATION.
\`\`\`

All static analysis is bounded at Level C4 (Static Integration). C5 (Observed Runtime), C6 (Cryptographic Continuity), C7 (Authoritative Effect), C8 (Deterministic Replay), C9 (Fault Containment), and C10 (Real Mandatory Canary) cannot be awarded through static inspection or test fixtures alone.

---

## 2. Classification Breakdown

| Classification | Count | Description |
|---|---|---|
| ECONOMIC_AUTHORITATIVE | ${classifications.filter((c) => c.classification === 'ECONOMIC_AUTHORITATIVE').length} | Direct exclusive authority over cash, signing, or terminality |
| ECONOMIC_ADVISORY | ${classifications.filter((c) => c.classification === 'ECONOMIC_ADVISORY').length} | Generates alpha, regime, or sizing recommendations without execution authority |
| SHADOW | ${classifications.filter((c) => c.classification === 'SHADOW').length} | Shadow execution, counterfactual comparison, or offline emulation |
| RESEARCH | ${classifications.filter((c) => c.classification === 'RESEARCH').length} | Offline exploratory research, backtests, or calibration |
| OBSERVABILITY | ${classifications.filter((c) => c.classification === 'OBSERVABILITY').length} | Telemetry, logging, flight recording, or passive audit projections |
| UI_ONLY | ${classifications.filter((c) => c.classification === 'UI_ONLY').length} | Terminal views and presentation interfaces |
| LEGACY | ${classifications.filter((c) => c.classification === 'LEGACY').length} | Deprecated or superseded historical adapters |
| ORPHAN | ${classifications.filter((c) => c.classification === 'ORPHAN').length} | Unreferenced modules outside designated entry points |

---

## 3. Authority Model & Collision Audit

- **Canonical State Writer**: Target \`FusionReducer\` — Status: ${detectedAuthorities.canonicalStateWriter.length > 0 ? 'BOUND' : 'UNBOUND'}
- **Economic State Writer**: Target \`EconomicAuthorityStore\` — Status: ${detectedAuthorities.economicStateWriter.length > 0 ? 'BOUND' : 'UNBOUND'}
- **Decision Issuer**: Target \`UnifiedDecisionEngine\` — Status: ${detectedAuthorities.decisionIssuer.length > 0 ? 'BOUND' : 'UNBOUND'}
- **Terminality Issuer**: Target \`TerminalityAuthority\` — Status: ${detectedAuthorities.terminalityIssuer.length > 0 ? 'BOUND' : 'UNBOUND'}

**Duplicate configured authority exports detected:** ${authorityCollisions.length}
${
  authorityCollisions.length === 0
    ? 'No duplicate declarations of the configured authority export symbols were found. This does not prove runtime exclusivity or effect.'
    : authorityCollisions.map((c) => `- ${c.authorityDimension}: duplicate exporters: ${c.duplicateExportingModules.join(', ')}`).join('\n')
}

---

## 4. Orphan Modules (${orphanModules.length})

${
  orphanModules.length === 0
    ? 'No unreferenced orphan modules detected.'
    : orphanModules.slice(0, 20).map((o) => `- \`${o.file}\` (${o.sizeBytes} bytes, hash: \`${o.sourceHash.slice(0, 16)}...\`)`).join('\n')
}
${orphanModules.length > 20 ? `\n*(...and ${orphanModules.length - 20} more. See \`artifacts/connectivity/orphan-modules.json\`)*` : ''}

---

## 5. Scorecard Summary

- **C0 (Exists)**: ${staticConnectivity.C0_exists ? 'PASS' : 'FAIL'} (${inventory.size} audited TS modules)
- **C1 (Compiles)**: ${staticConnectivity.C1_compiles ? 'PASS' : 'FAIL'} (${compileDiagnostics.length} compiler/config diagnostics)
- **C2 (Unit Tested)**: ${staticConnectivity.C2_unit_tested ? 'PASS' : 'UNPROVEN'} (requires a verified source-bound test receipt)
- **C3 (Declared Connection)**: ${staticConnectivity.C3_declared_connection ? 'PASS' : 'UNPROVEN'} (${staticGraphEdges.length} static import/re-export edges observed)
- **C4 (Static Integration)**: ${staticConnectivity.C4_static_integration ? 'PASS' : 'UNPROVEN'} (${Object.values(staticConnectivity.authorityReachability).filter((item) => item.reachable).length}/${Object.keys(staticConnectivity.authorityReachability).length} configured authority paths reachable; sequential evidence gates apply)
- **C5–C10**: UNPROVEN (Gated by runtime execution)

**Current Certification Result:** NOT_CERTIFIED (Max proven level: ${staticConnectivity.highestProvenLevel})

## 6. Scope and Limits

${scorecard.metadata.inventoryScope}
${scorecard.metadata.testRunEvidence}
${scorecard.metadata.connectivityEvidence}
`;

  writeFileSync(
    join(ARTIFACTS_DIR, 'SYSTEM_CONNECTIVITY_AUDIT.md'),
    markdownAudit,
    'utf8'
  );

  console.log('[CONNECTIVITY_COMPILER] Successfully generated all C0–C4 static artifacts:');
  console.log(` - ${join(ARTIFACTS_DIR, 'intelligence-classification.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'intelligence-classification.csv')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'static-graph.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'authority-graph.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'evidence-graph.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'authority-collisions.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'synthetic-evidence-findings.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'orphan-modules.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'c0-c10-scorecard.json')}`);
  console.log(` - ${join(ARTIFACTS_DIR, 'SYSTEM_CONNECTIVITY_AUDIT.md')}`);
  console.log('[CONNECTIVITY_COMPILER] Static C4 ceiling strictly enforced.');

  return {
    success: true,
    modulesAudited: inventory.size,
    nodesCount: staticGraphNodes.length,
    edgesCount: staticGraphEdges.length,
    authorityCollisionsCount: authorityCollisions.length,
    orphanCount: orphanModules.length,
    highestProvenLevel: staticConnectivity.highestProvenLevel,
  };
}

if (process.argv[1] && process.argv[1].includes('connectivity-compiler.mjs')) {
  try {
    const result = runConnectivityCompiler();
    process.exit(0);
  } catch (err) {
    console.error('[CONNECTIVITY_COMPILER] Execution failed:', err);
    process.exit(1);
  }
}
