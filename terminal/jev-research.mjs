/**
 * Local JEV Research & Advisory Shadow Lane Controller
 *
 * Implements bounded endpoints for System-1 advisory projection and evaluation.
 * Invariants:
 * - All outputs are strictly ADVISORY_ONLY.
 * - executionAuthorized is always false.
 * - No capital or signer authority.
 */

const MAX_BODY_BYTES = 65_536;

export async function readBoundedJson(req, limit = MAX_BODY_BYTES) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('JSON content type required'), {status: 415});
  }
  const chunks = [];
  let size = 0;
  const stream = typeof req.iterator === 'function' ? req.iterator({destroyOnReturn: false}) : req;
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    if (size > limit) {
      req.resume?.();
      throw Object.assign(new Error(`Request body exceeds ${limit} bytes`), {status: 413});
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

export async function handleJevShadowProjectionRequest(req, res, masterEngine) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.writeHead(405, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, error: 'GET required'}));
    return;
  }
  try {
    const projection = masterEngine.getJevShadowProjection();
    res.setHeader('Content-Type', 'application/json');
    const hasRecords = projection.totalRecords > 0;
    res.end(JSON.stringify({
      ok: true,
      projection,
      status: hasRecords ? 'LOCAL_PREVIEW_RECORDS_RECORDED' : 'NO_LOCAL_PREVIEW_RECORDS',
      evidenceMode: 'SYNTHETIC_PREVIEW_ONLY',
      authority: 'ADVISORY_ONLY',
      executionAuthorized: false,
    }));
  } catch (error) {
    res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, error: error?.message || 'Failed to project JEV shadow lane'}));
  }
}

export async function handleJevEvaluationRequest(req, res, masterEngine) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.writeHead(405, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, error: 'POST required'}));
    return;
  }
  try {
    const body = await readBoundedJson(req);
    const mint = typeof body.mint === 'string' && body.mint.trim()
      ? body.mint.trim()
      : `token_sample_${Date.now()}`;
    const overrides = body.features && typeof body.features === 'object' && !Array.isArray(body.features)
      ? body.features
      : {};
    const now = Number.isSafeInteger(body.now) && body.now > 0 ? body.now : Date.now();
    const record = masterEngine.evaluateJevShadow(mint, overrides, now);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      record,
      authority: 'ADVISORY_ONLY',
      executionAuthorized: false,
    }));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, error: error?.message || 'JEV evaluation failed'}));
  }
}

export function handleJevHostedStatusRequest(req, res, masterEngine) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const typeSafeKeyConfigured = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  const typeSafeEndpointConfigured = true;
  const typeSafeConfigured = typeSafeKeyConfigured;
  const layaConfigured = Boolean(process.env.LAYA_API_KEY?.trim());
  const projection = masterEngine.getJevShadowProjection();
  const hasRecords = projection.totalRecords > 0;
  const requestedMint = new URL(req.url, 'http://localhost').searchParams.get('mint') || '';
  const contextReadiness = requestedMint ? masterEngine.getHostedJevLayaReadiness(requestedMint) : null;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    provider: 'Local JEV/Laya rules with optional hosted comparison',
    status: hasRecords ? 'LOCAL_PREVIEW_RECORDS_RECORDED' : 'NO_LOCAL_PREVIEW_RECORDS',
    hostedStatus: !(typeSafeConfigured || layaConfigured) ? 'DISABLED' : contextReadiness?.ready ? 'READY_TO_COMPARE' : 'AWAITING_CERTIFIED_CONTEXT',
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false,
    researchOnly: true,
    model: 'jev-rule-v0 / laya-rule-v0',
    hostedModel: { typesafe: process.env.TYPESAFE_JEV_MODEL?.trim() || 'typesafe/jev-1.13', laya: 'clef-flash' },
    hostedContextReady: Boolean(contextReadiness?.ready),
    comparisonReady: Boolean(contextReadiness?.ready && (typeSafeConfigured || layaConfigured)),
    contextStatus: contextReadiness?.status || 'NO_MINT_SELECTED',
    featureSnapshotHash: contextReadiness?.featureSnapshotHash || null,
    featureContextAgeMs: contextReadiness?.ageMs ?? null,
    featureCoverage: contextReadiness?.evidenceCoverage ?? 0,
    providers: [
      { id: 'typesafe-jev', provider: 'TypeSafe Hosted', model: process.env.TYPESAFE_JEV_MODEL?.trim() || 'typesafe/jev-1.13', status: !typeSafeConfigured ? 'DISABLED' : contextReadiness?.ready ? 'READY_TO_COMPARE' : 'AWAITING_CERTIFIED_CONTEXT', credentialConfigured: typeSafeKeyConfigured, endpointConfigured: typeSafeEndpointConfigured, endpoint: process.env.TYPESAFE_API_URL?.trim() ? 'Custom HTTPS endpoint configured' : 'https://api.typesafe.ai/v1/systemone' },
      { id: 'laya', provider: 'Laya API', model: 'clef-flash', status: !layaConfigured ? 'DISABLED' : contextReadiness?.ready ? 'READY_TO_COMPARE' : 'AWAITING_CERTIFIED_CONTEXT', credentialConfigured: layaConfigured },
    ],
    primitives: ['choice', 'score', 'noul'],
    totalShadowRecords: projection.totalRecords,
    chainHead: projection.chainHead,
    reason: contextReadiness?.ready
      ? 'Fresh upstream observations meet the advisory comparison coverage and freshness gates.'
      : contextReadiness
        ? `Upstream context covers ${Math.round(contextReadiness.evidenceCoverage * 100)}% of required features; missing or stale fields remain unknown and block hosted inference.`
        : 'Enter a Solana mint to collect live provider observations. Synthetic previews are not sent to hosted models.',
    safeguards: [
      'fixed HTTPS endpoint',
      'requested model identity checked',
      'deadline-bound request',
      'malformed output rejected',
      'no command or execution authority',
      'hash-chained advisory ledger',
      'hosted inference waits for certified feature context',
    ],
  }));
}

export async function handleHostedJevLayaCompareRequest(req, res, masterEngine) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.writeHead(405, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, error: 'POST required'}));
    return;
  }
  try {
    const body = await readBoundedJson(req, 4096);
    const mint = typeof body.mint === 'string' ? body.mint.trim() : '';
    const readiness = masterEngine.getHostedJevLayaReadiness(mint);
    if (!readiness.ready) {
      res.writeHead(409, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: false, error: readiness.status, readiness,
        authority: 'ADVISORY_ONLY', executionAuthorized: false}));
      return;
    }
    const comparison = await masterEngine.compareLatestHostedJevLaya(mint);
    if (!comparison) {
      res.writeHead(409, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: false, error: 'FEATURE_CONTEXT_UNAVAILABLE', readiness}));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, comparison, readiness,
      authority: 'ADVISORY_ONLY', executionAuthorized: false}));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: false, error: error?.message || 'Hosted comparison failed',
      authority: 'ADVISORY_ONLY', executionAuthorized: false}));
  }
}
