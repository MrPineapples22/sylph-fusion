import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EconomicAuthorityStore} from '../../dist/intelligence/capital/economic-authority-store.js';
import {handleCapitalReserveRequest, projectCapitalReserve} from '../capital-reserve-policy.mjs';

function snapshot(overrides = {}) {
  return {
    cashUsd: 250,
    reservedCashUsd: 10,
    solPriceUsd: 150,
    ...overrides,
  };
}

async function withRoute(getSnapshot, action) {
  const server = createServer((req, res) => {
    if (!handleCapitalReserveRequest(req, res, {getSnapshot, nowMs: 100_000})) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('reserve route is read-only and cannot overwrite active or quarantined EconomicAuthorityStore capital', async () => {
  const store = new EconomicAuthorityStore(10_000_000_000n);
  const active = store.acquireReservation('active-reserve', 500_000_000n, 100);
  const uncertain = store.acquireReservation('unknown-reserve', 500_000_000n, 100);
  store.quarantineUnknownCapital(uncertain.reservationId, 101);
  const before = {
    cash: store.getConfirmedCash(),
    reserved: store.getReservedCash(),
    unknown: store.getUnknownCapital(),
    journal: store.getJournal(),
    activeReservationEvent: store.getJournal().find(entry => entry.payload.reservationId === active.reservationId)?.eventType,
  };

  await withRoute(() => snapshot(), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capital/reserve?stressed=true`);
    assert.equal(response.status, 200);
    const projection = await response.json();
    assert.equal(projection.valueSource, 'GATEWAY_STATE_SNAPSHOT');
    assert.equal(projection.projectionStatus, 'ASSUMPTION_ONLY');
    assert.equal(projection.isStressed, true);
    assert.equal(projection.solPriceFreshness, 'UNKNOWN');
    assert.equal(projection.unknownCapitalLamports, null);
    assert.equal(projection.availableCashLamports, null);
    assert.equal(projection.availableCashStatus, 'UNKNOWN');
  });

  assert.equal(store.getConfirmedCash(), before.cash);
  assert.equal(store.getReservedCash(), before.reserved);
  assert.equal(store.getUnknownCapital(), before.unknown);
  assert.deepEqual(store.getJournal(), before.journal, 'GET must not append or reconstruct economic journal entries');
  assert.equal(store.getJournal().find(entry => entry.payload.reservationId === active.reservationId)?.eventType,
    before.activeReservationEvent, 'active reservation evidence remains intact');
});

test('policy projection preserves reserve formula and converts only within safe lamport bounds', () => {
  const normal = projectCapitalReserve(snapshot(), {nowMs: 100_000});
  assert.equal(normal.paperCashLamports, '1666666667');
  assert.equal(normal.reservedCashLamports, '66666667');
  assert.equal(normal.emergencyReserveLamports, '333333333', '20% equity reserve dominates the 0.05 SOL floor');
  assert.ok(Math.abs(normal.emergencyReserveUsd - 50) < 0.000001);
  assert.equal(normal.availableCashUsd, null, 'Gateway snapshot does not include unknown capital');
  assert.equal(normal.solPriceFreshness, 'UNKNOWN', 'snapshot has no timestamp, so price freshness is not claimed');

  const fresh = projectCapitalReserve(snapshot({solPriceUpdatedAtMs: 99_999}), {nowMs: 100_000});
  assert.equal(fresh.solPriceFreshness, 'FRESH');
  assert.equal(fresh.projectionStatus, 'ASSUMPTION_ONLY', 'a fresh observation improves display context, not economic authority');

  const stressed = projectCapitalReserve(snapshot({cashUsd: 1, reservedCashUsd: 0}), {stressed: true, nowMs: 100_000});
  assert.equal(stressed.emergencyReserveLamports, '100000000', 'stressed exit reserve retains the existing 0.1 SOL scenario');
  assert.equal(stressed.emergencyReserveUsd, 15);

  const oversizedCash = projectCapitalReserve(snapshot({cashUsd: 1e300}), {nowMs: 100_000});
  const tinyPrice = projectCapitalReserve(snapshot({solPriceUsd: 1e-300}), {nowMs: 100_000});
  const excessivePrice = projectCapitalReserve(snapshot({solPriceUsd: Number.MAX_VALUE}), {nowMs: 100_000});
  assert.equal(oversizedCash.evidenceStatus, 'UNKNOWN');
  assert.equal(oversizedCash.paperCashLamports, null);
  assert.equal(tinyPrice.evidenceStatus, 'UNKNOWN');
  assert.equal(tinyPrice.reason, 'CAPITAL_LAMPORT_CONVERSION_OUT_OF_RANGE');
  assert.equal(excessivePrice.evidenceStatus, 'UNKNOWN');
  assert.equal(excessivePrice.paperCashLamports, null);
});

test('invalid and stale Gateway price/capital evidence returns explicit UNKNOWN without healthy defaults', async () => {
  for (const [bad, reason] of [
    [snapshot({cashUsd: -1}), 'GATEWAY_CAPITAL_DATA_INVALID'],
    [snapshot({reservedCashUsd: 251}), 'GATEWAY_CAPITAL_DATA_INVALID'],
    [snapshot({cashUsd: Number.NaN}), 'GATEWAY_CAPITAL_DATA_INVALID'],
    [snapshot({solPriceUsd: 0}), 'SOL_PRICE_INVALID'],
    [snapshot({solPriceUsd: Number.POSITIVE_INFINITY}), 'SOL_PRICE_INVALID'],
  ]) {
    const projection = projectCapitalReserve(bad, {nowMs: 100_000});
    assert.equal(projection.evidenceStatus, 'UNKNOWN');
    assert.equal(projection.reason, reason);
    assert.equal(projection.paperCashLamports, null);
    assert.equal(projection.availableCashUsd, null);
  }

  const stale = projectCapitalReserve(snapshot({solPriceUpdatedAtMs: 90_000}), {nowMs: 100_000});
  assert.equal(stale.evidenceStatus, 'UNKNOWN');
  assert.equal(stale.solPriceFreshness, 'STALE');
  assert.equal(stale.reason, 'SOL_PRICE_STALE');
  assert.equal(stale.emergencyReserveUsd, null);

  await withRoute(() => snapshot({solPriceUsd: 0}), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capital/reserve`);
    const body = await response.json();
    assert.equal(body.evidenceStatus, 'UNKNOWN');
    assert.equal(body.reason, 'SOL_PRICE_INVALID');
    assert.equal(body.emergencyReserveUsd, null);
  });
});
