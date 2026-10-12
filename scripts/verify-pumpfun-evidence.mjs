import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileStem = (programId) => sha256(programId).slice(0, 16);

async function verifyJsonLines(path, { programId, kind }) {
  let count = 0;
  const signatures = new Set();
  const issues = [];
  if (!existsSync(path)) return { count, signatures, issues: kind === 'UNRESOLVED' ? [] : [`${kind}_FILE_MISSING`] };

  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { issues.push(`${kind}_INVALID_JSON_LINE_${lineNumber}`); continue; }
    if (!record || record.programId !== programId || typeof record.signature !== 'string' || typeof record.sha256 !== 'string') {
      issues.push(`${kind}_INVALID_RECORD_${lineNumber}`);
      continue;
    }
    const { sha256: recordedHash, ...payload } = record;
    if (sha256(JSON.stringify(payload)) !== recordedHash) issues.push(`${kind}_HASH_MISMATCH_${lineNumber}`);
    if (kind === 'EVIDENCE') {
      if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.slot) || !record.transaction || typeof record.transaction !== 'object') {
        issues.push(`EVIDENCE_INVALID_PAYLOAD_${lineNumber}`);
      }
      if (signatures.has(record.signature)) issues.push(`EVIDENCE_DUPLICATE_SIGNATURE_${lineNumber}`);
      signatures.add(record.signature);
    }
    count += 1;
  }
  return { count, signatures, issues };
}

/** Independently checks stored JSONL hashes and cursor state; it does not certify coverage. */
export async function verifyEvidence(outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new Error('INVALID_OUTPUT_DIR');
  const manifestPath = join(outputDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('MANIFEST_MISSING');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = [];
  if (manifest?.schemaVersion !== 1 || manifest?.coverage !== 'PARTIAL_UNVERIFIED' ||
      manifest?.decoderStatus !== 'NOT_DECODED' || manifest?.liveAuthority !== 'BLOCKED' ||
      !manifest.programs || typeof manifest.programs !== 'object' || Array.isArray(manifest.programs) ||
      Object.keys(manifest.programs).length === 0) {
    errors.push('MANIFEST_CONTRACT_INVALID');
  }

  const programs = {};
  let transactionCount = 0;
  let unresolvedCount = 0;
  let complete = true;
  for (const [programId, summary] of Object.entries(manifest.programs ?? {})) {
    if (!programId || !summary || typeof summary !== 'object') {
      errors.push('PROGRAM_SUMMARY_INVALID');
      continue;
    }
    const stem = fileStem(programId);
    const evidence = await verifyJsonLines(join(outputDir, `${stem}.transactions.jsonl`), { programId, kind: 'EVIDENCE' });
    const unresolved = await verifyJsonLines(join(outputDir, `${stem}.unresolved.jsonl`), { programId, kind: 'UNRESOLVED' });
    const checkpointPath = join(outputDir, `${stem}.checkpoint.json`);
    let checkpoint;
    try {
      checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      if (!checkpoint || (checkpoint.before !== null && typeof checkpoint.before !== 'string') ||
          !Number.isSafeInteger(checkpoint.pages) || checkpoint.pages < 0 || typeof checkpoint.completed !== 'boolean') {
        throw new Error('BAD_CHECKPOINT');
      }
    } catch {
      errors.push(`CHECKPOINT_INVALID_${stem}`);
    }

    errors.push(...evidence.issues.map((issue) => `${stem}_${issue}`));
    errors.push(...unresolved.issues.map((issue) => `${stem}_${issue}`));
    if (!Number.isSafeInteger(summary.storedTransactions) || summary.storedTransactions !== evidence.count) errors.push(`EVIDENCE_COUNT_MISMATCH_${stem}`);
    if (checkpoint && (summary.pagesTotal !== checkpoint.pages || summary.completed !== checkpoint.completed)) errors.push(`CHECKPOINT_MANIFEST_MISMATCH_${stem}`);
    if (!checkpoint || !checkpoint.completed || unresolved.count > 0) complete = false;
    transactionCount += evidence.count;
    unresolvedCount += unresolved.count;
    programs[programId] = {
      transactions: evidence.count,
      unresolved: unresolved.count,
      checkpointCompleted: checkpoint?.completed === true,
      checkpointPages: checkpoint?.pages ?? null,
    };
  }

  return {
    integrity: errors.length === 0 ? 'PASS' : 'FAIL',
    datasetCompleteness: complete && errors.length === 0 ? 'UNVERIFIED_COMPLETE_CANDIDATE' : 'INCOMPLETE_OR_UNVERIFIED',
    authority: 'BLOCKED',
    transactionCount,
    unresolvedCount,
    errors,
    programs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('Usage: node scripts/verify-pumpfun-evidence.mjs OUTPUT_DIRECTORY');
    process.exit(2);
  }
  try {
    const report = await verifyEvidence(outputDir);
    console.log(JSON.stringify(report, null, 2));
    if (report.integrity !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(`VERIFY_BLOCKED: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`);
    process.exitCode = 1;
  }
}
