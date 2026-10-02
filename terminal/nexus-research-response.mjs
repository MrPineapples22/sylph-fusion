/** No calibrated, lineage-bound certificate producer is connected to this HTTP surface. */
export function serveNexusResearchUnavailable(res) {
  res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    ok: false,
    source: 'nexus-mx-research-interface',
    status: 'UNAVAILABLE',
    reason: 'NEXUS_CERTIFICATE_PRODUCER_NOT_CONNECTED',
    runtimeAuthority: 'NONE',
    executionAuthorized: false,
    totalEvaluated: 0,
    candidates: [],
  }));
}
