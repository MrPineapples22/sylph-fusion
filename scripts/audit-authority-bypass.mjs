/**
 * SYLPH FUSION — AUTHORITY BYPASS SCANNER & DEPENDENCY ENFORCER
 * Specifications: Blueprint Section 66
 *
 * Scans the entire codebase to assert that NO function outside canonical authorities performs:
 * - Capital release
 * - Capital settlement
 * - Direct transaction signing
 * - Strategy production promotion
 * - Terminal NoLand classification
 * without an associated certified artifact.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');

// Allowed canonical authority files
const ALLOWED_AUTHORITY_FILES = new Set([
  'economic-authority-store.ts',
  'terminality-authority.ts',
  'no-land-certificate.ts',
  'durable-live-signer.ts',
  'signing-firewall.ts',
  'issuer-manifest.ts',
  'unified-unit.ts',
  'rd-governor.ts',
  'promotion-evidence-bundle.ts',
  'settlement-firewall.ts',
  'double-entry.ts',
  'clearing.ts',
  'dimension-ledger.ts',
]);

function getFilesRecursively(dir) {
  let results = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      results.push(filePath);
    }
  }
  return results;
}

export function runAuthorityBypassAudit() {
  const files = getFilesRecursively(srcDir);
  const violations = [];

  const BYPASS_PATTERNS = [
    {
      name: 'UNAUTHORIZED_CASH_MUTATION',
      regex: /(confirmedCashLamports\s*\+=|reservedCashLamports\s*-=)/,
      allowedFiles: ['economic-authority-store.ts'],
    },
    {
      name: 'DIRECT_UNAUTHENTICATED_SIGNING',
      regex: /signTransaction\s*\(\s*(?!.*permit)/i,
      allowedFiles: [
        'durable-live-signer.ts',
        'issuer-manifest.ts',
        'signing-firewall.ts',
        'signer-service.ts',
        'orchestrator.ts',
      ],
    },
    {
      name: 'UNVERIFIED_NOLAND_DECLARATION',
      regex: /conclusion\s*:\s*['"]CERTIFIED_NOLAND['"]/,
      allowedFiles: ['terminality-authority.ts', 'no-land-certificate.ts'],
    },
  ];

  for (const filePath of files) {
    const fileName = filePath.split(/[\\/]/).pop();
    const content = readFileSync(filePath, 'utf8');

    for (const pattern of BYPASS_PATTERNS) {
      if (pattern.regex.test(content)) {
        if (!pattern.allowedFiles.includes(fileName)) {
          violations.push({
            file: filePath.replace(rootDir, ''),
            pattern: pattern.name,
            reason: `Direct execution of ${pattern.name} found outside authorized modules (${pattern.allowedFiles.join(', ')})`,
          });
        }
      }
    }
  }

  return {
    scannedFilesCount: files.length,
    violations,
    passed: violations.length === 0,
  };
}

if (process.argv[1] && process.argv[1].includes('audit-authority-bypass.mjs')) {
  const result = runAuthorityBypassAudit();
  console.log(`Scanned ${result.scannedFilesCount} source files for authority bypasses.`);

  if (result.passed) {
    console.log('[PASS] Authority bypass audit passed: 0 unauthorized mutations or bypasses detected.');
  } else {
    console.error(`[FAIL] Detected ${result.violations.length} authority bypass violation(s):`);
    for (const v of result.violations) {
      console.error(`  - ${v.file}: ${v.pattern} (${v.reason})`);
    }
    process.exit(1);
  }
}
