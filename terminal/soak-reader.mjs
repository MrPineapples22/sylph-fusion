import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import readline from 'node:readline';

export function categorizeReason(reason) {
  const r = (reason || '').toLowerCase();
  if (r.includes('rpc') || r.includes('endpoint') || r.includes('fetch') || r.includes('rate') || r.includes('429')) return 'rpc';
  if (r.includes('curve') || r.includes('mayhem') || r.includes('bonding')) return 'curve';
  if (r.includes('creator') || r.includes('rug') || r.includes('dev') || r.includes('authority') || r.includes('freeze') || r.includes('concentration')) return 'safety';
  if (r.includes('reserve') || r.includes('drift') || r.includes('liquidity') || r.includes('cash') || r.includes('budget')) return 'liquidity';
  return 'other';
}

export function computeBaselineScore({ rpcFailureRate, totalRejections, rpcRejectionCount, runtimeSeconds, checkpointCount, fillsCount }) {
  if (totalRejections === 0 && fillsCount === 0) return 0;
  let score = 0;
  // 1. RPC drop rate (max 40 pts). Drops to 0 if rateLimit >= 5%
  if (rpcFailureRate < 5) {
    score += 40 * (1 - rpcFailureRate / 5);
  }
  // 2. Strategy evaluation presence (max 30 pts)
  const validRejections = totalRejections - rpcRejectionCount;
  if (validRejections > 0) {
    score += Math.min(30, validRejections * 3);
  }
  // 3. Runtime stability (max 15 pts)
  if (runtimeSeconds >= 300) {
    score += 15;
  } else if (runtimeSeconds > 0) {
    score += (runtimeSeconds / 300) * 15;
  }
  // 4. Session checkpoints & fills (max 15 pts)
  if (checkpointCount > 0) score += 10;
  if (fillsCount > 0) score += 5;

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

export async function readLatestSoakSession(sessionsDir, requestedSessionName = null) {
  if (!existsSync(sessionsDir)) return null;
  const entries = await readdir(sessionsDir, { withFileTypes: true });
  const soakDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('soak-'))
    .map(e => e.name)
    .sort()
    .reverse();

  if (soakDirs.length === 0) return null;

  const sessionDirName = requestedSessionName && soakDirs.includes(requestedSessionName)
    ? requestedSessionName
    : soakDirs[0];

  const sessionDirPath = join(sessionsDir, sessionDirName);
  const jsonlPath = join(sessionDirPath, 'session.jsonl');
  const fillsCsvPath = join(sessionDirPath, 'fills.csv');

  if (!existsSync(jsonlPath)) return null;

  const rejectionMap = new Map();
  const blockedExits = [];
  const clearedExits = [];
  const checkpoints = [];
  const candidatesSample = [];
  let eventsCount = 0;
  let firstTime = null;
  let lastTime = null;

  const rl = readline.createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    eventsCount++;
    try {
      const evt = JSON.parse(line);
      const time = evt.time ? new Date(evt.time).getTime() : null;
      if (time && (!firstTime || time < firstTime)) firstTime = time;
      if (time && (!lastTime || time > lastTime)) lastTime = time;

      if (evt.event === 'entry_rejected' && evt.reason) {
        rejectionMap.set(evt.reason, (rejectionMap.get(evt.reason) || 0) + 1);
        if (candidatesSample.length < 50) {
          candidatesSample.push({
            mint: evt.mint,
            reason: evt.reason,
            time: evt.time,
            category: categorizeReason(evt.reason),
            eligible: false,
            curve: evt.curve ?? null,
            drift: evt.drift ?? null,
            realReserveSol: evt.realReserveSol ?? null,
            buyers: evt.buyers ?? null,
            devSold: evt.devSold ?? false,
          });
        }
      } else if (evt.event === 'exit_blocked_by_pending') {
        blockedExits.push(evt);
      } else if (evt.event === 'exit_block_cleared') {
        clearedExits.push(evt);
      } else if (evt.event === 'soak_checkpoint') {
        checkpoints.push(evt);
      }
    } catch {
      // Ignore malformed lines
    }
  }

  const totalRejections = [...rejectionMap.values()].reduce((a, b) => a + b, 0);
  const taxonomy = [...rejectionMap.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      pct: totalRejections > 0 ? Number(((count / totalRejections) * 100).toFixed(1)) : 0,
      category: categorizeReason(reason),
    }))
    .sort((a, b) => b.count - a.count);

  const rpcRejectionCount = rejectionMap.get('all RPC endpoints failed') || 0;
  const rpcFailureRate = totalRejections > 0 ? Number(((rpcRejectionCount / totalRejections) * 100).toFixed(1)) : 0;
  const isGatePassed = rpcFailureRate < 5;

  // Read fills CSV
  const fills = [];
  if (existsSync(fillsCsvPath)) {
    try {
      const csvData = await readFile(fillsCsvPath, 'utf8');
      const lines = csvData.trim().split(/\r?\n/);
      if (lines.length > 1) {
        const headers = lines[0].split(',');
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',');
          if (cols.length >= headers.length) {
            const row = Object.fromEntries(headers.map((h, idx) => [h, cols[idx]]));
            fills.push(row);
          }
        }
      }
    } catch {
      // Ignore fills parse errors
    }
  }

  const runtimeSeconds = firstTime && lastTime ? Math.max(0, Math.round((lastTime - firstTime) / 1000)) : 0;

  const baselineQualityScore = computeBaselineScore({
    rpcFailureRate,
    totalRejections,
    rpcRejectionCount,
    runtimeSeconds,
    checkpointCount: checkpoints.length,
    fillsCount: fills.length,
  });

  const funnel = computeFunnelFromSession({
    rejectionMap,
    totalRejections,
    fillsCount: fills.length,
    candidatesCount: candidatesSample.length,
  });

  return {
    available: true,
    sessionDir: sessionDirName,
    availableSessions: soakDirs,
    eventsCount,
    runtimeSeconds,
    startTime: firstTime ? new Date(firstTime).toISOString() : null,
    endTime: lastTime ? new Date(lastTime).toISOString() : null,
    baselineQualityScore,
    soakStatus: isGatePassed ? 'APPROVED' : 'BLOCKED',
    funnel,
    rejections: {
      total: totalRejections,
      taxonomy,
    },
    candidatesSample,
    rpcHealth: {
      failedRpcCount: rpcRejectionCount,
      rateLimitPct: rpcFailureRate,
      gatePassed: isGatePassed,
      alert: rpcFailureRate >= 5
        ? `${rpcFailureRate}% candidate drop rate caused by RPC rate limits. Dedicated/private RPC endpoints required before 24h soak.`
        : 'RPC health within acceptable bounds (<5% drop rate).',
    },
    blockedExits: {
      totalBlocked: blockedExits.length,
      totalCleared: clearedExits.length,
      recent: blockedExits.slice(-10).reverse(),
      cleared: clearedExits.slice(-10).reverse(),
    },
    latestCheckpoint: checkpoints.at(-1) || null,
    fills: {
      count: fills.length,
      recent: fills.slice(-10).reverse(),
    },
  };
}

export function computeFunnelFromSession({ rejectionMap, totalRejections, fillsCount, candidatesCount = 0 }) {
  const safeRejections = rejectionMap instanceof Map ? rejectionMap : new Map(Object.entries(rejectionMap || {}));
  const total = totalRejections ?? [...safeRejections.values()].reduce((a, b) => a + b, 0);
  const fills = fillsCount ?? 0;
  const totalEvaluations = total + fills;

  const rpcDrops = safeRejections.get('all RPC endpoints failed') || 0;
  const curveDrops = [...safeRejections.entries()].filter(([r]) => categorizeReason(r) === 'curve').reduce((sum, [, c]) => sum + c, 0);
  const safetyDrops = [...safeRejections.entries()].filter(([r]) => categorizeReason(r) === 'safety').reduce((sum, [, c]) => sum + c, 0);
  const driftDrops = [...safeRejections.entries()].filter(([r]) => r.toLowerCase().includes('drift')).reduce((sum, [, c]) => sum + c, 0);
  const liquidityCashDrops = [...safeRejections.entries()].filter(([r]) => categorizeReason(r) === 'liquidity' && !r.toLowerCase().includes('drift')).reduce((sum, [, c]) => sum + c, 0);
  const otherDrops = Math.max(0, total - (rpcDrops + curveDrops + safetyDrops + driftDrops + liquidityCashDrops));

  const discovered = Math.max(totalEvaluations, candidatesCount);
  const aged = Math.max(0, discovered - Math.round(otherDrops * 0.5));
  const buyerThreshold = Math.max(0, aged - rpcDrops);
  const safetyPassed = Math.max(0, buyerThreshold - safetyDrops);
  const driftPassed = Math.max(0, safetyPassed - driftDrops);
  const eligible = Math.max(0, driftPassed - curveDrops - liquidityCashDrops);
  const paperFilled = fills;

  return {
    discovered,
    aged,
    buyerThreshold,
    safetyPassed,
    driftPassed,
    eligible,
    paperFilled,
    stageDropOffs: [
      { from: 'discovered', to: 'aged', dropCount: Math.max(0, discovered - aged), topReason: 'Candidate age below minimum threshold (<10s)' },
      { from: 'aged', to: 'buyer threshold', dropCount: Math.max(0, aged - buyerThreshold), topReason: rpcDrops > 0 ? 'RPC rate limits / snapshot failure' : 'Buyer count (<5) or buy:sell ratio (<2x)' },
      { from: 'buyer threshold', to: 'safety passed', dropCount: Math.max(0, buyerThreshold - safetyPassed), topReason: 'Safety gate (creator sell, concentration, freeze/mint authority)' },
      { from: 'safety passed', to: 'drift passed', dropCount: Math.max(0, safetyPassed - driftPassed), topReason: 'Reserve drift exceeded dual thresholds (price drift or liquidity drop > 200 BPS)' },
      { from: 'drift passed', to: 'eligible', dropCount: Math.max(0, driftPassed - eligible), topReason: 'Curve graduation complete, mayhem mode, or insufficient cash reserve' },
      { from: 'eligible', to: 'paper-filled', dropCount: Math.max(0, eligible - paperFilled), topReason: 'Pending order in-flight blocking or execution risk cap' },
    ],
  };
}

export async function readSessionEvents(sessionsDir, sessionName, limit = 500, offset = 0) {
  if (!existsSync(sessionsDir)) return { events: [], total: 0, session: sessionName };
  const safeSessionName = (sessionName || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const sessionDirPath = join(sessionsDir, safeSessionName);
  const jsonlPath = join(sessionDirPath, 'session.jsonl');
  if (!existsSync(jsonlPath)) return { events: [], total: 0, session: safeSessionName };

  const allEvents = [];
  const rl = readline.createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Infinity,
  });

  let index = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      allEvents.push({ id: ++index, ...evt });
    } catch {
      // ignore
    }
  }

  const total = allEvents.length;
  const paginated = allEvents.slice(offset, offset + limit);
  return {
    events: paginated,
    total,
    session: safeSessionName,
    startTime: allEvents[0]?.time || null,
    endTime: allEvents.at(-1)?.time || null,
  };
}

export async function exportSessionArtifact(sessionsDir, sessionName, format) {
  const safeSessionName = (sessionName || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const sessionDirPath = join(sessionsDir, safeSessionName);
  if (!existsSync(sessionDirPath)) {
    throw new Error(`Session ${safeSessionName} not found`);
  }

  if (format === 'jsonl') {
    const jsonlPath = join(sessionDirPath, 'session.jsonl');
    if (!existsSync(jsonlPath)) throw new Error('session.jsonl not found');
    const content = await readFile(jsonlPath, 'utf8');
    return {
      contentType: 'application/x-ndjson; charset=utf-8',
      filename: `${safeSessionName}.jsonl`,
      content,
    };
  }

  if (format === 'csv') {
    const csvPath = join(sessionDirPath, 'fills.csv');
    if (!existsSync(csvPath)) throw new Error('fills.csv not found');
    const content = await readFile(csvPath, 'utf8');
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${safeSessionName}-fills.csv`,
      content,
    };
  }

  if (format === 'summary') {
    const sessionData = await readLatestSoakSession(sessionsDir, safeSessionName);
    return {
      contentType: 'application/json; charset=utf-8',
      filename: `${safeSessionName}-summary.json`,
      content: JSON.stringify(sessionData, null, 2),
    };
  }

  throw new Error(`Unsupported export format: ${format}`);
}

let cachedEngineToken = '';
function isCurrentEngineState(value) {
  return Boolean(value && value.connected !== false && (value.limits || value.config));
}

export function buildRpcStatusPayload(soakData) {
  const engineIsCurrent = soakData?.engineRunning === true && isCurrentEngineState(soakData?.liveEngine);
  const rpcHealth = soakData?.liveEngine?.rpcHealth;
  return {
    ok: true,
    engineRunning: engineIsCurrent,
    rpcEndpoints: engineIsCurrent && Array.isArray(soakData.liveEngine.rpcEndpoints)
      ? soakData.liveEngine.rpcEndpoints
      : [],
    rpcHealth: engineIsCurrent && rpcHealth && typeof rpcHealth === 'object' && !Array.isArray(rpcHealth)
      ? rpcHealth
      : null,
    sessionId: typeof soakData?.session?.sessionDir === 'string' ? soakData.session.sessionDir : null,
    sessionRpcHealth: soakData?.session?.rpcHealth && typeof soakData.session.rpcHealth === 'object' && !Array.isArray(soakData.session.rpcHealth)
      ? soakData.session.rpcHealth
      : null,
  };
}

async function fetchLiveEngineState(engineUrl = 'http://127.0.0.1:8787') {
  try {
    if (!cachedEngineToken) {
      const probeRes = await fetch(engineUrl, { signal: AbortSignal.timeout(400) });
      if (probeRes.ok) {
        const html = await probeRes.text();
        cachedEngineToken = html.match(/name="dashboard-token" content="([a-f0-9]{64})"/)?.[1] || '';
      }
    }
    if (!cachedEngineToken) return null;
    const res = await fetch(`${engineUrl}/api/state`, {
      signal: AbortSignal.timeout(400),
      headers: { 'x-dashboard-token': cachedEngineToken },
    });
    if (res.ok) {
      return await res.json();
    }
    if (res.status === 403) {
      cachedEngineToken = ''; // token invalidated, retry on next poll
    }
  } catch {
    cachedEngineToken = '';
  }
  return null;
}

export async function readRuntimeConfig(projectRoot, liveEngine = null) {
  const envConfig = {};
  const envPath = join(projectRoot, '.env');
  if (existsSync(envPath)) {
    try {
      const content = await readFile(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          envConfig[key] = val;
        }
      }
    } catch {
      // ignore disk read errors
    }
  }

  const hasLiveEngine = isCurrentEngineState(liveEngine);
  const activeEngine = hasLiveEngine ? liveEngine : null;
  const limits = activeEngine?.limits || {};
  const engineCfg = activeEngine?.config || {};

  return {
    source: hasLiveEngine ? 'live_engine' : (Object.keys(envConfig).length > 0 ? 'project_env' : 'engine_defaults'),
    sourceDetail: hasLiveEngine
      ? 'Live Engine Runtime (http://127.0.0.1:8787/api/state)'
      : (Object.keys(envConfig).length > 0 ? 'Backend Server (.env on disk)' : 'Engine Defaults (Uninitialized)'),
    sourcePath: hasLiveEngine ? 'http://127.0.0.1:8787/api/state' : (existsSync(envPath) ? envPath : null),
    loadedAtMs: Date.now(),
    isDynamic: true,

    // Dynamic parameters parsed from running engine or .env
    BUY_LAMPORTS: limits.buy ? Number(limits.buy) : (engineCfg.BUY_LAMPORTS ? Number(engineCfg.BUY_LAMPORTS) : (envConfig.BUY_LAMPORTS ? Number(envConfig.BUY_LAMPORTS) : 10_000_000)),
    STOP_BPS: limits.stop !== undefined ? Number(limits.stop) : (engineCfg.STOP_BPS !== undefined ? Number(engineCfg.STOP_BPS) : (envConfig.STOP_BPS ? Number(envConfig.STOP_BPS) : 1200)),
    SLIPPAGE_BPS: limits.slippage !== undefined ? Number(limits.slippage) : (engineCfg.SLIPPAGE_BPS !== undefined ? Number(engineCfg.SLIPPAGE_BPS) : (envConfig.SLIPPAGE_BPS ? Number(envConfig.SLIPPAGE_BPS) : 300)),
    MAX_POSITIONS: limits.positions !== undefined ? Number(limits.positions) : (engineCfg.MAX_POSITIONS !== undefined ? Number(engineCfg.MAX_POSITIONS) : (envConfig.MAX_POSITIONS ? Number(envConfig.MAX_POSITIONS) : 3)),
    MAX_PRIORITY_LAMPORTS: limits.priority ? Number(limits.priority) : (engineCfg.MAX_PRIORITY_LAMPORTS ? Number(engineCfg.MAX_PRIORITY_LAMPORTS) : (envConfig.MAX_PRIORITY_LAMPORTS ? Number(envConfig.MAX_PRIORITY_LAMPORTS) : 200_000)),
    MIN_TIP_LAMPORTS: envConfig.MIN_TIP_LAMPORTS ? Number(envConfig.MIN_TIP_LAMPORTS) : 10_000,
    MAX_TIP_LAMPORTS: limits.tip ? Number(limits.tip) : (envConfig.MAX_TIP_LAMPORTS ? Number(envConfig.MAX_TIP_LAMPORTS) : 500_000),
    MAX_EXPOSURE_LAMPORTS: limits.exposure ? Number(limits.exposure) : (envConfig.MAX_EXPOSURE_LAMPORTS ? Number(envConfig.MAX_EXPOSURE_LAMPORTS) : 100_000_000),
    MIN_BUYERS: envConfig.MIN_BUYERS ? Number(envConfig.MIN_BUYERS) : 5,
    MIN_REAL_RESERVE_LAMPORTS: envConfig.MIN_REAL_RESERVE_LAMPORTS ? Number(envConfig.MIN_REAL_RESERVE_LAMPORTS) : 1_000_000_000,
    MODE: activeEngine?.mode || envConfig.MODE || 'paper',
    EXIT_LADDER_STAGES: [12_000, 16_000, 25_000, 60_000, 160_000],
  };
}

export async function getSoakTelemetry(projectRoot, requestedSession = null) {
  const sessionsDir = join(projectRoot, 'sessions');
  const sessionData = await readLatestSoakSession(sessionsDir, requestedSession);
  const liveEngine = await fetchLiveEngineState();
  const runtimeConfig = await readRuntimeConfig(projectRoot, liveEngine);

  return {
    timestamp: Date.now(),
    engineRunning: isCurrentEngineState(liveEngine),
    liveEngine,
    session: sessionData,
    runtimeConfig,
  };
}

export async function compareSoakSessions(sessionsDir, sessionNameA, sessionNameB) {
  const [dataA, dataB] = await Promise.all([
    readLatestSoakSession(sessionsDir, sessionNameA),
    readLatestSoakSession(sessionsDir, sessionNameB),
  ]);

  if (!dataA && !dataB) return null;

  const scoreA = dataA?.baselineQualityScore ?? 0;
  const scoreB = dataB?.baselineQualityScore ?? 0;

  const dropRateA = dataA?.rpcHealth?.rateLimitPct ?? 0;
  const dropRateB = dataB?.rpcHealth?.rateLimitPct ?? 0;

  const dropsCountA = dataA?.rpcHealth?.failedRpcCount ?? 0;
  const dropsCountB = dataB?.rpcHealth?.failedRpcCount ?? 0;

  // Funnel comparison
  const funnelA = dataA?.funnel || { discovered: 0, aged: 0, buyerThreshold: 0, safetyPassed: 0, driftPassed: 0, eligible: 0, paperFilled: 0 };
  const funnelB = dataB?.funnel || { discovered: 0, aged: 0, buyerThreshold: 0, safetyPassed: 0, driftPassed: 0, eligible: 0, paperFilled: 0 };

  const gates = ['discovered', 'aged', 'buyerThreshold', 'safetyPassed', 'driftPassed', 'eligible', 'paperFilled'];
  const funnelComparison = gates.map(gate => {
    const countA = funnelA[gate] ?? 0;
    const countB = funnelB[gate] ?? 0;
    const topA = Math.max(1, funnelA.discovered || 1);
    const topB = Math.max(1, funnelB.discovered || 1);
    return {
      gate,
      countA,
      countB,
      delta: countB - countA,
      pctA: Math.round((countA / topA) * 1000) / 10,
      pctB: Math.round((countB / topB) * 1000) / 10,
    };
  });

  // Rejection mix comparison
  const taxA = new Map((dataA?.rejections?.taxonomy || []).map(t => [t.reason, t]));
  const taxB = new Map((dataB?.rejections?.taxonomy || []).map(t => [t.reason, t]));
  const allReasons = new Set([...taxA.keys(), ...taxB.keys()]);

  const rejectionDiff = [...allReasons].map(reason => {
    const itemA = taxA.get(reason);
    const itemB = taxB.get(reason);
    const countA = itemA?.count ?? 0;
    const countB = itemB?.count ?? 0;
    const pctA = itemA?.pct ?? 0;
    const pctB = itemB?.pct ?? 0;
    return {
      reason,
      category: categorizeReason(reason),
      countA,
      countB,
      deltaCount: countB - countA,
      pctA,
      pctB,
      deltaPct: Math.round((pctB - pctA) * 10) / 10,
    };
  }).sort((a, b) => (b.countA + b.countB) - (a.countA + a.countB));

  return {
    sessionA: {
      name: dataA?.sessionDir || sessionNameA,
      runtimeSeconds: dataA?.runtimeSeconds ?? 0,
      score: scoreA,
      gatePassed: dataA?.rpcHealth?.gatePassed ?? false,
      soakStatus: dataA?.soakStatus || 'BLOCKED',
      rpcDropRate: dropRateA,
      rpcDropsCount: dropsCountA,
      fillsCount: dataA?.fills?.total ?? 0,
    },
    sessionB: {
      name: dataB?.sessionDir || sessionNameB,
      runtimeSeconds: dataB?.runtimeSeconds ?? 0,
      score: scoreB,
      gatePassed: dataB?.rpcHealth?.gatePassed ?? false,
      soakStatus: dataB?.soakStatus || 'BLOCKED',
      rpcDropRate: dropRateB,
      rpcDropsCount: dropsCountB,
      fillsCount: dataB?.fills?.total ?? 0,
    },
    summaryDeltas: {
      scoreDelta: Math.round((scoreB - scoreA) * 10) / 10,
      rpcDropRateDelta: Math.round((dropRateB - dropRateA) * 10) / 10,
      rpcDropsDelta: dropsCountB - dropsCountA,
      fillsDelta: (dataB?.fills?.total ?? 0) - (dataA?.fills?.total ?? 0),
    },
    funnelComparison,
    rejectionDiff,
  };
}

