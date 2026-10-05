/**
 * SYLPH FUSION — SYNTHETIC AUTHORITY AUDITOR & GATE
 * Specifications: Blueprint Section 5 (Eliminate Synthetic Authority)
 *
 * Invariant: Production authority paths must not contain self-attested,
 * hard-coded favorable assumptions, fake roots, or unverified defaults.
 */

export interface SyntheticAuthorityViolation {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly matchedPattern: string;
  readonly contextSnippet: string;
}

export type PermittedContextTag = 'TEST_FIXTURE' | 'PAPER_SIMULATION' | 'RESEARCH_PRIOR';

export const SUSPICIOUS_SYNTHETIC_PATTERNS: readonly RegExp[] = Object.freeze([
  /\?\?\s*true\b/g,
  /\bwalkForwardVerified\s*:\s*true\b/g,
  /\bauthenticityProven\s*:\s*true\b/g,
  /\brealizedPnl\s*=\s*predictedPnl\b/g,
  /\bsurvivalProbability\s*:\s*0\.9\d*\b/g,
  /\bfake_proof_root\b/gi,
  /\bfake_signature\b/gi,
  /\bsig_paper_attestation\b/gi,
  /\bnetRealizedReturnBps\s*:\s*150\b/g,
]);

export function scanContentForSyntheticAuthority(
  content: string,
  filePath: string
): readonly SyntheticAuthorityViolation[] {
  // If file contains explicit permitted tags, skip flagged sections
  const lines = content.split('\n');
  const violations: SyntheticAuthorityViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Ignore comment lines
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
      continue;
    }

    // Check if line or preceding line has a permitted exemption tag

    const hasTag =
      line.includes('TEST_FIXTURE') ||
      line.includes('PAPER_SIMULATION') ||
      line.includes('RESEARCH_PRIOR') ||
      (i > 0 &&
        (lines[i - 1].includes('TEST_FIXTURE') ||
          lines[i - 1].includes('PAPER_SIMULATION') ||
          lines[i - 1].includes('RESEARCH_PRIOR')));

    if (hasTag) {
      continue;
    }

    for (const pattern of SUSPICIOUS_SYNTHETIC_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          filePath,
          lineNumber: i + 1,
          matchedPattern: pattern.source,
          contextSnippet: line.trim(),
        });
      }
    }
  }

  return violations;
}
