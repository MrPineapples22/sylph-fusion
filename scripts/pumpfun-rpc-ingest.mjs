import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function rpc(url, method, params, fetcher = fetch) {
  let safeErrorCode = 'NETWORK_ERROR';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.json();
      if (body?.error) throw new Error(`RPC_${body.error.code ?? 'ERROR'}`);
      if (!Object.hasOwn(body ?? {}, 'result')) throw new Error('RPC_RESULT_MISSING');
      return body.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      safeErrorCode = /^(HTTP_\d{3}|RPC_[A-Z0-9_-]+|RPC_RESULT_MISSING)$/.test(message) ? message : 'NETWORK_ERROR';
      if (attempt === 3) throw new Error(`${method}_${safeErrorCode}`);
      await delay(250 * (2 ** attempt));
    }
  }
  throw new Error('RPC_RETRIES_EXHAUSTED');
}

function readCheckpoint(path) {
  if (!existsSync(path)) return { before: null, pages: 0, completed: false };
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (!state || (state.before !== null && typeof state.before !== 'string') || !Number.isSafeInteger(state.pages) || state.pages < 0 || typeof state.completed !== 'boolean') {
    throw new Error('INVALID_CHECKPOINT');
  }
  return state;
}

function readSavedSignatures(path) {
  const signatures = new Set();
  if (!existsSync(path)) return signatures;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const record = JSON.parse(line);
    if (typeof record.signature !== 'string') throw new Error('INVALID_EVIDENCE_RECORD');
    signatures.add(record.signature);
  }
  return signatures;
}

function readUnresolved(path, programId) {
  const unresolved = new Map();
  if (!existsSync(path)) return unresolved;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const record = JSON.parse(line);
    if (record?.programId !== programId || typeof record.signature !== 'string' ||
        !Number.isSafeInteger(record.slot) || typeof record.reason !== 'string' ||
        typeof record.sha256 !== 'string') throw new Error('INVALID_UNRESOLVED_RECORD');
    const { sha256: recordedHash, ...payload } = record;
    if (sha256(JSON.stringify(payload)) !== recordedHash) throw new Error('UNRESOLVED_HASH_MISMATCH');
    unresolved.set(record.signature, record);
  }
  return unresolved;
}

function makeUnresolved(payload) {
  const record = { ...payload };
  record.sha256 = sha256(JSON.stringify(record));
  return record;
}

function makeEvidence({ programId, signature, slot, blockTime, transaction }) {
  const record = { schemaVersion: 1, programId, signature, slot, blockTime, transaction };
  record.sha256 = sha256(JSON.stringify(record));
  return record;
}

function writeUnresolved(path, unresolved) {
  const temporary = `${path}.tmp`;
  const contents = [...unresolved.values()].map(record => JSON.stringify(record)).join('\n');
  writeFileSync(temporary, contents ? `${contents}\n` : '', { flag: 'w' });
  renameSync(temporary, path);
}

function writeCheckpoint(path, state) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'w' });
  // Rename is atomic within this output directory on supported local filesystems.
  renameSync(temporary, path);
}

function validateConfig(config) {
  if (!config || typeof config.rpcUrl !== 'string' || !config.rpcUrl.startsWith('https://') ||
      !Array.isArray(config.programIds) || config.programIds.length === 0 ||
      config.programIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      typeof config.outputDir !== 'string' || !config.outputDir.trim()) throw new Error('INVALID_CONFIG');

  const startMs = Date.parse(config.start ?? '2025-10-01T00:00:00Z');
  const endMs = Date.parse(config.endExclusive ?? '2026-10-13T00:00:00Z');
  const pageSize = config.pageSize ?? 1000;
  const maxPagesPerProgram = config.maxPagesPerProgram ?? 1;
  const maxTransactions = config.maxTransactions ?? 100;
  const requestDelayMs = config.requestDelayMs ?? 250;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 ||
      !Number.isSafeInteger(maxPagesPerProgram) || maxPagesPerProgram < 1 ||
      !Number.isSafeInteger(maxTransactions) || maxTransactions < 1 ||
      !Number.isFinite(requestDelayMs) || requestDelayMs < 0) throw new Error('INVALID_CONFIG');
  return { startMs, endMs, pageSize, maxPagesPerProgram, maxTransactions, requestDelayMs };
}

/** Research-only archival RPC capture. It does not decode events or authorize trading. */
export async function ingest(config, { fetcher = fetch } = {}) {
  const limits = validateConfig(config);
  mkdirSync(config.outputDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    coverage: 'PARTIAL_UNVERIFIED',
    decoderStatus: 'NOT_DECODED',
    liveAuthority: 'BLOCKED',
    period: { start: config.start ?? '2025-10-01T00:00:00Z', endExclusive: config.endExclusive ?? '2026-10-13T00:00:00Z' },
    programs: {},
  };
  let fetchedThisRun = 0;

  for (const programId of [...new Set(config.programIds)]) {
    const stem = join(config.outputDir, sha256(programId).slice(0, 16));
    const checkpointPath = `${stem}.checkpoint.json`;
    const evidencePath = `${stem}.transactions.jsonl`;
    const unresolvedPath = `${stem}.unresolved.jsonl`;
    const checkpoint = readCheckpoint(checkpointPath);
    const seen = readSavedSignatures(evidencePath);
    const unresolved = readUnresolved(unresolvedPath, programId);
    let pagesThisRun = 0;

    // Retry prior misses before resuming the exclusive signature cursor. Limit
    // retries per run so a large unavailable archive window cannot starve paging.
    const retryBudget = Math.min(limits.maxTransactions, 100);
    let retriedSignaturesThisRun = 0;
    for (const [signature, prior] of unresolved) {
      if (retriedSignaturesThisRun >= retryBudget || fetchedThisRun >= limits.maxTransactions) break;
      if (seen.has(signature)) { unresolved.delete(signature); continue; }
      retriedSignaturesThisRun += 1;

      let blockTime = prior.blockTime;
      if (prior.reason === 'BLOCK_TIME_UNAVAILABLE') {
        const recoveredBlockTime = await rpc(config.rpcUrl, 'getBlockTime', [prior.slot], fetcher);
        await delay(limits.requestDelayMs);
        if (!Number.isSafeInteger(recoveredBlockTime)) continue;
        blockTime = recoveredBlockTime;
        const observedAt = blockTime * 1000;
        if (observedAt < limits.startMs || observedAt >= limits.endMs) {
          unresolved.delete(signature);
          continue;
        }
      } else if (prior.reason !== 'TRANSACTION_UNAVAILABLE') {
        throw new Error('INVALID_UNRESOLVED_REASON');
      }

      const transaction = await rpc(config.rpcUrl, 'getTransaction', [signature, {
        encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0,
      }], fetcher);
      await delay(limits.requestDelayMs);
      if (transaction === null) {
        unresolved.set(signature, makeUnresolved({
          programId, signature, slot: prior.slot,
          ...(blockTime === undefined ? {} : { blockTime }),
          reason: 'TRANSACTION_UNAVAILABLE',
        }));
        continue;
      }
      appendFileSync(evidencePath, `${JSON.stringify(makeEvidence({ programId, signature, slot: prior.slot, blockTime, transaction }))}\n`, { flag: 'a' });
      seen.add(signature);
      fetchedThisRun += 1;
      unresolved.delete(signature);
    }

    while (!checkpoint.completed && pagesThisRun < limits.maxPagesPerProgram && fetchedThisRun < limits.maxTransactions) {
      const options = { limit: limits.pageSize, commitment: 'finalized' };
      if (checkpoint.before) options.before = checkpoint.before;
      const page = await rpc(config.rpcUrl, 'getSignaturesForAddress', [programId, options], fetcher);
      if (!Array.isArray(page)) throw new Error('INVALID_SIGNATURE_PAGE');
      if (page.length === 0) checkpoint.completed = true;
      else {
        let olderThanWindow = false;
        let stoppedAtLimit = false;
        let nextBefore = page.at(-1).signature;
        for (let index = 0; index < page.length; index += 1) {
          const item = page[index];
          if (typeof item?.signature !== 'string' || !Number.isSafeInteger(item.slot)) throw new Error('INVALID_SIGNATURE_ENTRY');
          if (!Number.isSafeInteger(item.blockTime)) {
            unresolved.set(item.signature, makeUnresolved({ programId, signature: item.signature, slot: item.slot, reason: 'BLOCK_TIME_UNAVAILABLE' }));
            continue;
          }
          const observedAt = item.blockTime * 1000;
          if (observedAt < limits.startMs) { olderThanWindow = true; continue; }
          if (observedAt >= limits.endMs || seen.has(item.signature)) continue;
          if (fetchedThisRun >= limits.maxTransactions) {
            // Keep this item eligible on the next run. `before` is exclusive.
            nextBefore = index === 0 ? checkpoint.before : page[index - 1].signature;
            stoppedAtLimit = true;
            break;
          }

          const transaction = await rpc(config.rpcUrl, 'getTransaction', [item.signature, {
            encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0,
          }], fetcher);
          if (transaction === null) {
            unresolved.set(item.signature, makeUnresolved({ programId, signature: item.signature, slot: item.slot, blockTime: item.blockTime, reason: 'TRANSACTION_UNAVAILABLE' }));
            continue;
          }
          const record = makeEvidence({ programId, signature: item.signature, slot: item.slot, blockTime: item.blockTime, transaction });
          appendFileSync(evidencePath, `${JSON.stringify(record)}\n`, { flag: 'a' });
          seen.add(item.signature);
          fetchedThisRun += 1;
          await delay(limits.requestDelayMs);
        }
        // Save the cursor only after evidence writes. If a crash occurs between an
        // evidence append and this checkpoint, the next run deduplicates from JSONL.
        checkpoint.before = nextBefore;
        checkpoint.pages += 1;
        pagesThisRun += 1;
        if (!stoppedAtLimit && (olderThanWindow || page.length < limits.pageSize)) checkpoint.completed = true;
      }
      // Persist unresolved state before advancing the cursor past this page.
      writeUnresolved(unresolvedPath, unresolved);
      writeCheckpoint(checkpointPath, checkpoint);
      await delay(limits.requestDelayMs);
    }

    manifest.programs[programId] = {
      pagesThisRun,
      pagesTotal: checkpoint.pages,
      storedTransactions: seen.size,
      completed: checkpoint.completed,
      checkpointFile: checkpointPath,
      evidenceFile: evidencePath,
      unresolvedFile: unresolvedPath,
    };
    writeUnresolved(unresolvedPath, unresolved);
  }

  manifest.fetchedThisRun = fetchedThisRun;
  const manifestPath = join(config.outputDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: node scripts/pumpfun-rpc-ingest.mjs CONFIG.json');
    process.exit(2);
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    console.log(JSON.stringify(await ingest(config), null, 2));
  } catch (error) {
    console.error(`INGEST_BLOCKED: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`);
    process.exitCode = 1;
  }
}
