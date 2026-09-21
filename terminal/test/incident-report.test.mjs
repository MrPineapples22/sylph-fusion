import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIncidentReport } from '../src/incident-report.js';

test('generateIncidentReport creates a sanitized report structure without secrets', () => {
  const report = generateIncidentReport({
    state: {
      executionMode: 'paper',
      halted: true,
      haltReason: 'SIMULATED_DRAWDOWN_BREACH',
      running: false,
      positions: [{ asset: 'SOL', qty: 10 }],
      realized: 125.5,
      trades: 4,
      fees: 0.12,
    },
    liveBasket: {
      assets: [{ id: 'SOL' }],
      at: Date.now() - 6500, // 6.5s ago -> stale
    },
    soakData: {
      session: {
        rpcHealth: {
          gatePassed: false,
          rateLimitPct: 54.8,
          failedRpcCount: 34,
          totalRequests: 62,
          endpoints: [
            { url: 'https://mainnet.helius-rpc.com/?api-key=secret_12345_token', status: 'rate-limited' }
          ]
        }
      }
    },
    alerts: [
      { id: 'rpc-rate-limiting', title: 'RPC rate limiting', severity: 'CRITICAL', count: 34 }
    ],
    generatedAt: 1726500000000,
  });

  assert.equal(report.meta.reportType, 'SYLPH_FUSION_INCIDENT_REPORT');
  assert.equal(report.meta.prerequisitesMetFor24hSoak, false);
  assert.equal(report.systemState.halted, true);
  assert.equal(report.systemState.haltReason, 'SIMULATED_DRAWDOWN_BREACH');
  assert.equal(report.feedTelemetry.status, 'stale');

  // Verify secret URL was sanitized to host/provider label
  const ep = report.rpcHealthSummary.endpoints[0];
  assert.ok(!ep.url.includes('secret_12345_token'), 'API key must be sanitized');
  assert.equal(ep.url, 'Helius (mainnet.helius-rpc.com)');

  assert.equal(report.activeIncidents.length, 1);
  assert.equal(report.activeIncidents[0].count, 34);
  assert.ok(report.recommendations.length > 0);
});
