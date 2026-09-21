/**
 * Artifact Manifest & Cryptographic Reproducibility Evaluator
 *
 * Generates an immutable, verifiable manifest for session runs and exports:
 * - Schema versions (snapshot, outcome, policy)
 * - SHA-256 policy hash (entry rules, sizing limits, ladder thresholds)
 * - SHA-256 runtime config hash (sanitized, zero secret leakage)
 * - Session slot boundaries (startSlot, endSlot, totalSlots, slotLag)
 * - Artifact checksums (session events, candidate snapshots, fills)
 */

export const MANIFEST_SCHEMA_VERSION = '1.0.0';
export const CURRENT_SCHEMAS = {
  snapshotSchemaVersion: '1.2.0',
  outcomeSchemaVersion: '1.1.0',
  policySchemaVersion: '2.0.0',
};

// Pure JavaScript SHA-256 implementation (FIPS-180-2 compliant, zero external dependencies)
export function sha256Hex(ascii) {
  ascii = Array.from(new TextEncoder().encode(ascii), byte => String.fromCharCode(byte)).join('');
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  let result = '';

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = [];
  const k = [];
  let primeCounter = 0;

  const isPrime = (candidate) => {
    for (let factor = 2; factor <= Math.sqrt(candidate); factor++) {
      if (candidate % factor === 0) return false;
    }
    return true;
  };

  const getFractionalBits = (powVal) => Math.floor((powVal - Math.floor(powVal)) * maxWord);

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) {
        hash[primeCounter] = getFractionalBits(mathPow(candidate, 1 / 2));
      }
      k[primeCounter] = getFractionalBits(mathPow(candidate, 1 / 3));
      primeCounter++;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return; // Non-ASCII byte
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength | 0;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] =
        i < 16
          ? w[i]
          : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const s0Hash = ((hash[0] >>> 2) | (hash[0] << 30)) ^ ((hash[0] >>> 13) | (hash[0] << 19)) ^ ((hash[0] >>> 22) | (hash[0] << 10));
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const t2 = (s0Hash + maj) | 0;
      const s1Hash = ((hash[4] >>> 6) | (hash[4] << 26)) ^ ((hash[4] >>> 11) | (hash[4] << 21)) ^ ((hash[4] >>> 25) | (hash[4] << 7));
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const t1 = (hash[7] + s1Hash + ch + k[i] + w[i]) | 0;

      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function generateArtifactManifest({
  session = null,
  config = null,
  rules = null,
  fills = [],
  candidates = [],
} = {}) {
  // 1. Policy Hash (Entry criteria, ladder thresholds, stop limits - synchronized with engine defaults)
  const policyPayload = {
    schemaVersion: CURRENT_SCHEMAS.policySchemaVersion,
    maxSlippageBps: config?.SLIPPAGE_BPS ?? (config?.slippage !== undefined ? config.slippage * 100 : 300),
    targetSizeSol: config?.BUY_LAMPORTS !== undefined
      ? Number(config.BUY_LAMPORTS) / 1e9
      : (config?.size !== undefined ? config.size : 0.01),
    tp1Pct: config?.tp1 ?? 20, // Stage 0: 12_000 bps = +20%
    tp2Pct: config?.tp2 ?? 60, // Stage 1: 16_000 bps = +60%
    tp3Pct: config?.tp3 ?? 150, // Stage 2: 25_000 bps = +150%
    stopLossPct: config?.STOP_BPS !== undefined ? config.STOP_BPS / 100 : (config?.stop ?? 12.0),
    trailingStopPct: config?.trailing ?? 20.0,
    maxPositions: config?.MAX_POSITIONS ?? config?.maxPositions ?? 3,
    entryStrategy: config?.strategy ?? 'breakout',
    reserveDriftCapBps: 200,
    minBuyerCount: config?.MIN_BUYERS ?? 5,
    maxCurveCompletionPct: 95,
  };
  const policyHash = sha256Hex(JSON.stringify(policyPayload));

  // 2. Sanitized Runtime Configuration Hash
  const sanitizedConfig = {
    executionMode: config?.MODE ?? config?.executionMode ?? 'paper_amm',
    pollIntervalMs: config?.POLL_MS ?? config?.interval ?? 1000,
    priorityFeeMicrolamports: config?.MAX_PRIORITY_LAMPORTS ?? config?.priority ?? 200000,
    jitoTipSol: config?.MIN_TIP_LAMPORTS !== undefined ? Number(config.MIN_TIP_LAMPORTS) / 1e9 : (config?.tip ?? 0.00001),
    rpcRateLimitCap: 5.0, // 5% max acceptable 429 drop rate
    feedFreshnessThresholdMs: config?.FEED_STALE_MS ?? 5000,
    modelTimeoutMs: 10,
    modelFailClosed: true,
  };
  const configHash = sha256Hex(JSON.stringify(sanitizedConfig));

  // 3. Normalize candidates and fills arrays safely
  const candidateList = Array.isArray(candidates)
    ? candidates
    : Array.isArray(session?.candidatesSample)
    ? session.candidatesSample
    : Array.isArray(session?.candidates)
    ? session.candidates
    : [];

  const fillList = Array.isArray(fills) && fills.length > 0
    ? fills
    : Array.isArray(session?.fills?.recent)
    ? session.fills.recent
    : Array.isArray(session?.fills)
    ? session.fills
    : [];

  // Session slot boundaries
  const startSlot = session?.startSlot ?? null;
  const endSlot = session?.endSlot ?? null;
  const totalSlots = startSlot !== null && endSlot !== null ? Math.max(0, endSlot - startSlot) : null;

  // 4. Checksums of session artifacts
  const candidatesPayload = candidateList.map(c => ({
    id: c?.candidateId || c?.mint || 'unknown',
    slot: c?.slot ?? 0,
    disposition: c?.evaluationDisposition || c?.disposition || 'unknown',
    seal: c?.featureSealHash || '',
  }));
  const candidatesChecksum = sha256Hex(JSON.stringify(candidateList));

  const fillsPayload = fillList.map(f => ({
    id: f?.id || f?.orderId || 'order',
    side: f?.side || 'unknown',
    mint: f?.mint || 'unknown',
    amount: String(f?.requestedAmount || f?.qty || '0'),
  }));
  const fillsChecksum = sha256Hex(JSON.stringify(fillList));

  const sessionId = session?.sessionDir || session?.sessionId || `session-${startSlot}-${endSlot}`;
  const startMs = session?.startTimeMs ?? null;
  const endMs = session?.endTimeMs ?? null;
  const durationSeconds = startMs !== null && endMs !== null ? Math.round((endMs - startMs) / 1000) : null;

  const manifest = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    sessionId,
    generatedAtUtc: new Date().toISOString(),
    schemas: CURRENT_SCHEMAS,
    cryptographicHashes: {
      policyHash,
      configHash,
      candidatesChecksum,
      fillsChecksum,
    },
    sessionBoundaries: {
      startSlot,
      endSlot,
      totalSlots,
      startMs,
      endMs,
      durationSeconds,
    },
    policyContext: policyPayload,
    runtimeConfiguration: sanitizedConfig,
    itemCounts: {
      candidatesEvaluated: candidateList.length,
      fillsExecuted: fillsPayload.length,
      rejectionsLogged: session?.rejections?.total ?? candidateList.filter(c => c.evaluationDisposition === 'rejected').length,
    },
    integrityVerification: {
      policyHashValid: policyHash.length === 64,
      configHashValid: configHash.length === 64,
      checksumsValid: candidatesChecksum.length === 64 && fillsChecksum.length === 64,
      slotContinuity: startSlot !== null && endSlot !== null && endSlot >= startSlot,
      status: 'COMPUTED_UNVERIFIED',
      scope: 'JSON records supplied to this panel; may be a partial session sample. Not raw artifact bytes.',
      integrityType: 'SHA-256 Checksums (Non-Signed)',
      signatureNotice: 'SHA-256 hashes provide cryptographic integrity fingerprints, not private-key digital authenticity.',
    },
  };

  return manifest;
}
