/**
 * SYLPH FUSION — WAVE 0: REPOSITORY TRUTH & GAP AUDITOR
 * Inspects all modules in src/, classifies runtime-connected vs shadow vs research vs test,
 * identifies duplicate authorities, and generates the initial gap matrix.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = resolvePath('src');

function resolvePath(dir) {
  return join(process.cwd(), dir);
}

function getAllFiles(dir, exts = ['.ts', '.js', '.mjs']) {
  const files = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

const allSrcFiles = getAllFiles(SRC_ROOT);
console.log(`Audited ${allSrcFiles.length} source files in src/`);

// 1. Identify October 4 modules
const oct4Modules = [
  'src/intelligence/alpha-reality',
  'src/intelligence/signal-ecology',
  'src/intelligence/reality-gap',
  'src/intelligence/execution-adaptation',
  'src/intelligence/survival/evacuation-x',
  'src/intelligence/opportunity-market',
  'src/intelligence/control/capital-orchestrator-x',
  'src/intelligence/economics/profit-compiler',
  'src/intelligence/profit-frontier',
  'src/intelligence/certification/safe-canary',
  'src/platform/pipeline/unified-unit.ts',
];

const moduleClassification = {};

for (const mod of oct4Modules) {
  const full = join(process.cwd(), mod);
  const exists = existsSync(full);
  if (!exists) {
    moduleClassification[mod] = 'MISSING';
    continue;
  }
  // Check how it is imported in primary runtime (src/fusion.ts)
  const fusionContent = readFileSync(join(process.cwd(), 'src/fusion.ts'), 'utf-8');
  const modBasename = mod.split('/').pop().replace(/\.ts$/, '');
  const importedInFusion = fusionContent.includes(modBasename);

  // Check how it is imported in unified-unit.ts
  const unifiedContent = readFileSync(join(process.cwd(), 'src/platform/pipeline/unified-unit.ts'), 'utf-8');
  const importedInUnified = unifiedContent.includes(modBasename);

  // Check tests
  const testFiles = getAllFiles(resolvePath('test'));
  const testedInTests = testFiles.some((tf) => readFileSync(tf, 'utf-8').includes(modBasename));

  if (importedInFusion) {
    moduleClassification[mod] = 'RUNTIME_CONNECTED';
  } else if (importedInUnified) {
    moduleClassification[mod] = 'SHADOW (Connected via UnifiedPipelineUnit)';
  } else if (testedInTests) {
    moduleClassification[mod] = 'TEST_ONLY';
  } else {
    moduleClassification[mod] = 'RESEARCH_ONLY';
  }
}

console.log('\n--- OCTOBER 4 MODULE CLASSIFICATION ---');
for (const [mod, cls] of Object.entries(moduleClassification)) {
  console.log(`- ${mod}: ${cls}`);
}

// 2. Identify duplicate authorities
console.log('\n--- POTENTIAL DUPLICATE AUTHORITIES ---');
const authorityFiles = allSrcFiles.filter((f) => /authority|kernel|ledger|store|clearing/i.test(f));
for (const af of authorityFiles) {
  console.log(`- ${relative(process.cwd(), af).replace(/\\/g, '/')}`);
}
