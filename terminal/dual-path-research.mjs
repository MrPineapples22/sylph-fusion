import {DualPathReconciliationEngine} from '../dist/platform/ingestion/dual-path-reconciler.js';

const MAX_BODY_BYTES = 16_384;
const MAX_CHAIN_AMOUNT_U64 = (1n << 64n) - 1n;

async function readBoundedResearchJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('JSON content type required'), {status: 415});
  }
  const chunks = [];
  let size = 0;
  const stream = typeof req.iterator === 'function' ? req.iterator({destroyOnReturn: false}) : req;
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) {
      req.resume?.();
      throw Object.assign(new Error('Research evidence body exceeds 16 KiB'), {status: 413});
    }
    chunks.push(Buffer.from(chunk));
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
    return parsed;
  } catch (error) {
    throw Object.assign(new Error(error?.message === 'Expected a JSON object' ? error.message : 'Invalid JSON body'), {status: 400});
  }
}

function normalizeResearchAmount(value, field, optional = false) {
  if (value === undefined && optional) return undefined;
  if (value === null && optional) return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) {
    throw Object.assign(new Error(`${field} must be an unsigned decimal string`), {status: 400});
  }
  const amount = BigInt(value);
  if (amount > MAX_CHAIN_AMOUNT_U64) throw Object.assign(new Error(`${field} exceeds the u64 range`), {status: 400});
  return amount;
}

function normalizeDualPathInput(input, kind) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error(`${kind} must be an object or null`), {status: 400});
  }
  if (kind === 'instruction') {
    return {
      protocol: input.protocol,
      programId: input.programId,
      instructionIndex: input.instructionIndex,
      ...(input.innerInstructionIndex !== undefined ? {innerInstructionIndex: input.innerInstructionIndex} : {}),
      tokenMint: input.tokenMint,
      userPubkey: input.userPubkey,
      discriminator: input.discriminator,
      ...(input.rawAmountIn !== undefined ? {rawAmountIn: normalizeResearchAmount(input.rawAmountIn, 'instruction.rawAmountIn')} : {}),
      ...(input.rawAmountOut !== undefined ? {rawAmountOut: normalizeResearchAmount(input.rawAmountOut, 'instruction.rawAmountOut')} : {}),
      slot: input.slot,
      signature: input.signature,
      isSuccess: input.isSuccess,
    };
  }
  return {
    protocol: input.protocol,
    programId: input.programId,
    logIndex: input.logIndex,
    tokenMint: input.tokenMint,
    ...(input.userPubkey !== undefined ? {userPubkey: input.userPubkey} : {}),
    ...(input.logDiscriminator !== undefined ? {logDiscriminator: input.logDiscriminator} : {}),
    ...(input.rawAmountIn !== undefined ? {rawAmountIn: normalizeResearchAmount(input.rawAmountIn, 'log.rawAmountIn', true)} : {}),
    ...(input.rawAmountOut !== undefined ? {rawAmountOut: normalizeResearchAmount(input.rawAmountOut, 'log.rawAmountOut', true)} : {}),
    logMessage: input.logMessage,
    slot: input.slot,
    signature: input.signature,
    ...(input.isSuccess !== undefined ? {isSuccess: input.isSuccess} : {}),
  };
}

export async function handleDualPathResearchRequest(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.writeHead(405, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, evidenceStatus: 'UNKNOWN', error: 'POST required'}));
    return;
  }
  try {
    const input = await readBoundedResearchJson(req);
    const unexpectedKeys = Object.keys(input).filter((key) => !['instruction', 'log'].includes(key));
    if (unexpectedKeys.length) throw Object.assign(new Error('Only instruction and log fields are accepted'), {status: 400});
    const instruction = normalizeDualPathInput(input.instruction ?? null, 'instruction');
    const log = normalizeDualPathInput(input.log ?? null, 'log');
    const researchEngine = new DualPathReconciliationEngine();
    const report = researchEngine.reconcile(instruction, log);
    const certificate = researchEngine.certify(report);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'CALLER_SUPPLIED_UNAUTHENTICATED',
      authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY',
      explanation: 'This report compares caller-supplied records. It does not verify their source, chain inclusion, decoder correctness, or settlement.',
      report,
      certificate,
    }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, evidenceStatus: 'UNKNOWN', error: error?.message || 'Unable to reconcile supplied evidence'}));
  }
}
