/**
 * SYLPH FUSION — SYNTHETIC AUTHORITY CI AUDITOR
 * Specifications: Blueprint Section 5 (scripts/audit-synthetic-authority.mjs)
 *
 * Scans all production source files in src/platform/ and src/intelligence/
 * for synthetic authority, unverified defaults, or self-attestation.
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanContentForSyntheticAuthority } from '../dist/platform/assurance/no-synthetic-authority.js';

function getProductionFiles(dir, files = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry !== 'test' && entry !== 'tests' && entry !== 'fixtures') {
        getProductionFiles(full, files);
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

const targetDirs = [
  join(process.cwd(), 'src', 'platform'),
  join(process.cwd(), 'src', 'intelligence'),
];

let totalViolations = 0;
const violationReport = [];

for (const dir of targetDirs) {
  const files = getProductionFiles(dir);
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const violations = scanContentForSyntheticAuthority(content, file);
    if (violations.length > 0) {
      totalViolations += violations.length;
      violationReport.push(...violations);
    }
  }
}

if (totalViolations > 0) {
  console.error(`\x1b[31m[SYNTHETIC_AUTHORITY_AUDIT_FAILED]\x1b[0m Found ${totalViolations} untagged synthetic authority occurrences:`);
  for (const v of violationReport) {
    console.error(`  - ${v.filePath}:${v.lineNumber} matches [${v.matchedPattern}] => "${v.contextSnippet}"`);
  }
  process.exit(1);
} else {
  console.log('\x1b[32m[PASS]\x1b[0m Synthetic authority audit passed: zero untagged self-attestation in production authority paths.');
}
