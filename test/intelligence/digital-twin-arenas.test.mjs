import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DigitalTwin,
  ReplayClock,
  NetworkTwinSimulator,
  VersionArena,
  FilterArena,
} from '../../dist/intelligence/twin/digital-twin.js';

test('DigitalTwin, ReplayClock, Network simulation, and Arenas', () => {
  // 1. ReplayClock playback speeds
  const clock = new ReplayClock(1_000_000, 100);
  assert.equal(clock.now(), 1_000_000);
  assert.equal(clock.currentSlot(), 100);

  clock.setSpeed('10x');
  clock.advance(1000); // 1000ms * 10x = 10,000ms
  assert.equal(clock.now(), 1_010_000);
  assert.equal(clock.currentSlot(), 125); // +25 slots (10,000 / 400)

  // 2. NetworkTwinSimulator fault injection
  const net = new NetworkTwinSimulator();
  const okRpc = net.simulateNetworkCall('RPC');
  assert.equal(okRpc.success, true);

  net.setFaults({ injectJupiterFailure: true, inject429RateLimit: true });
  const jupFail = net.simulateNetworkCall('JUPITER');
  assert.equal(jupFail.success, false);
  assert.equal(jupFail.errorReason, 'JUPITER_ROUTING_TIMEOUT');

  const dexFail = net.simulateNetworkCall('DEXSCREENER');
  assert.equal(dexFail.success, false);
  assert.equal(dexFail.errorReason, 'HTTP_429_TOO_MANY_REQUESTS');

  // 3. VersionArena Champion vs Challenger
  const arena = new VersionArena();
  const comparison = arena.runComparison({
    championName: 'Champion_v2.0',
    challengerName: 'Challenger_v2.1',
    dataset: [
      { mint: 'm1', isRug: false, peakMultiplier: 2.5, championDecidedEnter: true, challengerDecidedEnter: true },
      { mint: 'm2', isRug: true, peakMultiplier: 0.2, championDecidedEnter: true, challengerDecidedEnter: false }, // Challenger avoided rug!
      { mint: 'm3', isRug: false, peakMultiplier: 1.8, championDecidedEnter: false, challengerDecidedEnter: true }, // Challenger captured winner!
    ],
  });

  assert.equal(comparison.championName, 'Champion_v2.0');
  assert.equal(comparison.challengerName, 'Challenger_v2.1');
  assert.ok(comparison.challengerPnlSol > comparison.championPnlSol);
  assert.ok(comparison.challengerRugsAvoided >= comparison.championRugsAvoided);
  assert.equal(comparison.challengerPromotable, true);

  // 4. FilterArena
  const filterArena = new FilterArena();
  const filterReport = filterArena.auditFilter({
    filterName: 'DevHoldingConcentrationFilter',
    tokens: [
      { mint: 't1', passedFilter: false, isRug: true, peakMultiplier: 0.1 }, // rug avoided
      { mint: 't2', passedFilter: false, isRug: true, peakMultiplier: 0.2 }, // rug avoided
      { mint: 't3', passedFilter: true, isRug: false, peakMultiplier: 2.0 },
      { mint: 't4', passedFilter: false, isRug: false, peakMultiplier: 1.2 }, // rejected non-runner
    ],
  });

  assert.equal(filterReport.tokensRejected, 3);
  assert.equal(filterReport.rugsAvoided, 2);
  assert.equal(filterReport.filterJustified, true);
});
