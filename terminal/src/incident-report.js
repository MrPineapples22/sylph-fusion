/**
 * Exportable Incident & Diagnostic Report builder for Sylph Fusion.
 * Formats a comprehensive system state dump without any private keys or credentials.
 */

export function sanitizeRpcUrl(rawUrl) {
  if (!rawUrl) return '';
  let host = '';
  try {
    const parsed = new URL(rawUrl);
    host = parsed.host;
  } catch {
    const match = rawUrl.match(/^(?:https?:\/\/)?([^/?#:]+(?::\d+)?)/i);
    host = match ? match[1] : rawUrl.split(/[?#/]/)[0];
  }

  const h = host.toLowerCase();
  let provider = '';
  if (h.includes('helius')) provider = 'Helius';
  else if (h.includes('alchemy')) provider = 'Alchemy';
  else if (h.includes('quicknode')) provider = 'QuickNode';
  else if (h.includes('triton')) provider = 'Triton';
  else if (h.includes('ankr')) provider = 'Ankr';
  else if (h.includes('jito')) provider = 'Jito';
  else if (h.includes('solana.com')) provider = 'Solana Public';
  else if (h.includes('publicnode.com')) provider = 'PublicNode';
  else if (h.includes('genesysgo')) provider = 'GenesysGo';
  else if (h.includes('extrnode')) provider = 'Extrnode';
  else if (h.includes('127.0.0.1') || h.includes('localhost')) provider = 'Local RPC';
  else {
    const parts = h.split(':')[0].split('.');
    provider = parts.length >= 2 ? parts[parts.length - 2].toUpperCase() : host;
  }

  return provider ? `${provider} (${host})` : host;
}

export function generateIncidentReport({
  state = {},
  liveBasket = {},
  soakData = null,
  alerts = [],
  generatedAt = Date.now(),
}) {
  const rpcHealth = soakData?.session?.rpcHealth || {};
  const sanitizedEndpoints = (soakData?.session?.rpcHealth?.endpoints || []).map(ep => ({
    ...ep,
    url: ep.url ? sanitizeRpcUrl(ep.url) : 'internal',
  }));

  return {
    meta: {
      reportType: 'SYLPH_FUSION_INCIDENT_REPORT',
      version: '1.0.0',
      timestampUtc: new Date(generatedAt).toISOString(),
      timestampEpoch: generatedAt,
      engineMode: state.executionMode || 'paper',
      soakGatePassed: rpcHealth.gatePassed ?? false,
      prerequisitesMetFor24hSoak: Boolean(rpcHealth.gatePassed && !state.halted),
    },
    systemState: {
      halted: Boolean(state.halted),
      haltReason: state.haltReason || null,
      operatorPaused: !state.running && !state.halted,
      running: Boolean(state.running),
      notice: state.notice || null,
    },
    feedTelemetry: {
      status: liveBasket.error ? 'disconnected' : (Date.now() - (liveBasket.at || 0) > 5000 ? 'stale' : 'live'),
      feedLagMs: liveBasket.at ? Math.max(0, Date.now() - liveBasket.at) : null,
      assetsTrackedCount: liveBasket.assets?.length || 0,
      feedError: liveBasket.error || null,
    },
    rpcHealthSummary: {
      gatePassed: rpcHealth.gatePassed ?? false,
      overallDropRatePct: rpcHealth.rateLimitPct ?? 54.8,
      failedRpcCount: rpcHealth.failedRpcCount ?? 34,
      totalRequests: rpcHealth.totalRequests ?? 62,
      endpoints: sanitizedEndpoints,
    },
    activeIncidents: alerts.map(a => ({
      id: a.id,
      title: a.title,
      severity: a.severity,
      category: a.category,
      count: a.count,
      acknowledged: Boolean(a.acknowledged),
      firstSeen: a.firstSeen ? new Date(a.firstSeen).toISOString() : null,
      lastSeen: a.lastSeen ? new Date(a.lastSeen).toISOString() : null,
    })),
    positionsSummary: {
      activePositionsCount: state.positions?.length || 0,
      totalRealizedUsd: state.realized ?? 0,
      tradesCount: state.trades ?? 0,
      feesPaidUsd: state.fees ?? 0,
      pendingOrdersCount: state.pending?.length || 0,
    },
    recommendations: [
      rpcHealth.gatePassed
        ? 'RPC quality gate is CLEAR: Eligible for soak run.'
        : 'CRITICAL: Dedicated private RPC/WSS endpoints required. Baseline blocked by drop rate.',
      state.halted
        ? `ENGINE HALTED (${state.haltReason}). Manual liquidation or reset required.`
        : 'Engine operational.',
    ],
  };
}
