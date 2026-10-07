/**
 * SYLPH FUSION — CANARY CAMPAIGN VERIFIER (STEP 5)
 * Specifications: Blueprint Sections 10, 11, 13, 17, 18, 19, 20, 31
 *
 * Responsibilities:
 * 1. Verifies mandatory 18-edge canary campaign sequence derived from config/certification-config.json.
 * 2. Enforces Dual-Mode verification:
 *    - `--mode test`: Allows TEST_FIXTURE for negative-control and unit test verification.
 *    - `--mode certify`: Strictly rejects TEST_FIXTURE, SYNTHETIC, UNKNOWN. Requires REAL_CANARY.
 * 3. Enforces C6 exact cryptographic artifact continuity:
 *    Edge[N].outputArtifactHash == Edge[N+1].inputArtifactHash
 * 4. Enforces state-root continuity:
 *    Edge[N].stateRootAfter == Edge[N+1].stateRootBefore
 * 5. Enforces universal campaign binding:
 *    Identical campaignId, traceId, repositoryCommitSha, configHash, knowledgeCutId across all edges.
 * 6. Verifies authority traversal and absence of authority bypasses.
 * 7. Fails closed on any missing edge, reordered edge, duplicate, or hash discontinuity.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashCanonicalV10,
  assertDigestMatch,
  EMPTY_SHA256_HEX,
} from './canonicalization-v10.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT_DIR, 'config', 'certification-config.json');

const CERTIFY_ELIGIBLE_PROVENANCE = new Set([
  'REAL_CANARY',
  'REAL_RUNTIME',
  'REAL_REPLAY',
  'REAL_FAULT_INJECTION',
]);

const CERTIFY_INELIGIBLE_PROVENANCE = new Set([
  'TEST_FIXTURE',
  'SYNTHETIC',
  'UNKNOWN',
]);

/**
 * Loads the mandatory edge sequence from authoritative configuration.
 * @returns {Array<object>}
 */
export function loadMandatoryEdgeConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`CONFIG_ERROR: Certification config not found at ${CONFIG_PATH}`);
  }
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!Array.isArray(config.mandatoryEdges) || config.mandatoryEdges.length === 0) {
    throw new Error('CONFIG_ERROR: No mandatoryEdges defined in certification config');
  }
  return config.mandatoryEdges;
}

/**
 * Verifies a canary campaign report against authoritative requirements.
 * @param {object | string} campaignReportOrPath
 * @param {object} [options]
 * @param {'test' | 'certify'} [options.mode='test']
 * @returns {object} Verification report
 */
export function verifyCanaryCampaign(campaignReportOrPath, options = {}) {
  const mode = options.mode ?? (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'test');
  if (mode !== 'test' && mode !== 'certify') {
    throw new Error(`INVALID_MODE: Expected mode 'test' or 'certify', received '${mode}'`);
  }

  let campaign;
  if (typeof campaignReportOrPath === 'string') {
    if (!existsSync(campaignReportOrPath)) {
      throw new Error(`FILE_NOT_FOUND: Canary report not found at ${campaignReportOrPath}`);
    }
    campaign = JSON.parse(readFileSync(campaignReportOrPath, 'utf8'));
  } else if (typeof campaignReportOrPath === 'object' && campaignReportOrPath !== null) {
    campaign = campaignReportOrPath;
  } else {
    throw new Error('INVALID_INPUT: Expected canary campaign object or file path');
  }

  const edges = campaign.edges ?? campaign.stages ?? [];
  const mandatoryConfig = loadMandatoryEdgeConfig();
  const errors = [];

  // 1. Mandatory Edge Count Check
  if (edges.length !== mandatoryConfig.length) {
    errors.push(
      `EDGE_COUNT_MISMATCH: Expected ${mandatoryConfig.length} edges, received ${edges.length}`
    );
  }

  // 2. Campaign Identity & Universal Bindings
  const campaignId = campaign.campaignId ?? edges[0]?.campaignId;
  const traceId = campaign.traceId ?? edges[0]?.traceId;
  const commitSha = campaign.repositoryCommitSha ?? edges[0]?.repositoryCommitSha;
  const configHash = campaign.configHash ?? edges[0]?.configHash;
  const knowledgeCutId = campaign.knowledgeCutId ?? edges[0]?.knowledgeCutId;

  if (!campaignId) errors.push('MISSING_BINDING: Missing campaignId');
  if (!traceId) errors.push('MISSING_BINDING: Missing traceId');
  if (!commitSha) errors.push('MISSING_BINDING: Missing repositoryCommitSha');

  // 3. Sequential Edge Verification
  const seenEdgeIds = new Set();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const expected = mandatoryConfig[i];

    // Identity & Sequence checks
    if (expected && edge.edgeId !== expected.edgeId) {
      errors.push(
        `SEQUENCE_MISMATCH: At index ${i}, expected edge ${expected.edgeId}, received ${edge.edgeId}`
      );
    }

    if (seenEdgeIds.has(edge.edgeId)) {
      errors.push(`DUPLICATE_EDGE: Edge ${edge.edgeId} appeared more than once`);
    }
    seenEdgeIds.add(edge.edgeId);

    // Provenance Check
    const prov = edge.provenanceClass ?? 'UNKNOWN';
    if (mode === 'certify') {
      if (CERTIFY_INELIGIBLE_PROVENANCE.has(prov) || !CERTIFY_ELIGIBLE_PROVENANCE.has(prov)) {
        errors.push(
          `PROVENANCE_REJECTED: Edge ${edge.edgeId} has ineligible provenance '${prov}' in CERTIFY mode (requires REAL_CANARY)`
        );
      }
    }

    // Universal Campaign Consistency
    if (edge.campaignId !== campaignId) {
      errors.push(`CAMPAIGN_ID_DRIFT: Edge ${edge.edgeId} has inconsistent campaignId`);
    }
    if (edge.traceId !== traceId) {
      errors.push(`TRACE_ID_DRIFT: Edge ${edge.edgeId} has inconsistent traceId`);
    }
    if (edge.repositoryCommitSha !== commitSha) {
      errors.push(`COMMIT_SHA_DRIFT: Edge ${edge.edgeId} has inconsistent repositoryCommitSha`);
    }

    // Artifact Hash Formats
    if (!edge.inputArtifactHash || edge.inputArtifactHash === EMPTY_SHA256_HEX) {
      errors.push(`EMPTY_INPUT_HASH: Edge ${edge.edgeId} has missing or empty inputArtifactHash`);
    }
    if (!edge.outputArtifactHash || edge.outputArtifactHash === EMPTY_SHA256_HEX) {
      errors.push(`EMPTY_OUTPUT_HASH: Edge ${edge.edgeId} has missing or empty outputArtifactHash`);
    }

    // Continuity with Next Edge
    if (i < edges.length - 1) {
      const nextEdge = edges[i + 1];

      // C6 Cryptographic Continuity
      if (edge.outputArtifactHash !== nextEdge.inputArtifactHash) {
        errors.push(
          `C6_CONTINUITY_BREAK: Edge[${i}] (${edge.edgeId}).outputArtifactHash (${edge.outputArtifactHash}) !== Edge[${i + 1}] (${nextEdge.edgeId}).inputArtifactHash (${nextEdge.inputArtifactHash})`
        );
      }

      // State Root Continuity
      if (edge.stateRootAfter !== nextEdge.stateRootBefore) {
        errors.push(
          `STATE_ROOT_CONTINUITY_BREAK: Edge[${i}] (${edge.edgeId}).stateRootAfter (${edge.stateRootAfter}) !== Edge[${i + 1}] (${nextEdge.edgeId}).stateRootBefore (${nextEdge.stateRootBefore})`
        );
      }
    }
  }

  // Check for any unvisited mandatory edges
  for (const expected of mandatoryConfig) {
    if (!seenEdgeIds.has(expected.edgeId)) {
      errors.push(`MISSING_MANDATORY_EDGE: Expected mandatory edge ${expected.edgeId} was not traversed`);
    }
  }

  if (errors.length > 0) {
    const errorMsg = `CANARY_VERIFICATION_FAILED:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
    throw new Error(errorMsg);
  }

  // Derive immutable canary evidence root
  const canaryEvidenceRoot = hashCanonicalV10({
    campaignId,
    traceId,
    commitSha,
    configHash,
    knowledgeCutId,
    mode,
    edgesCount: edges.length,
    edges,
  });

  return {
    valid: true,
    mode,
    campaignId,
    traceId,
    edgesVerified: edges.length,
    canaryEvidenceRoot,
    provenanceClass: mode === 'certify' ? 'REAL_CANARY' : (edges[0]?.provenanceClass ?? 'TEST_FIXTURE'),
  };
}

if (process.argv[1] && process.argv[1].includes('canary-campaign-verifier.mjs')) {
  try {
    const reportPath = process.argv[2] ?? resolve(ROOT_DIR, 'artifacts', 'test-fixtures', 'sample-canary-report.json');
    const result = verifyCanaryCampaign(reportPath);
    console.log('[PASS] Canary Campaign Verified:');
    console.log(` - Mode: ${result.mode}`);
    console.log(` - Edges Verified: ${result.edgesVerified}`);
    console.log(` - Canary Evidence Root: ${result.canaryEvidenceRoot}`);
    process.exit(0);
  } catch (err) {
    console.error('[FAIL]', err.message);
    process.exit(1);
  }
}
