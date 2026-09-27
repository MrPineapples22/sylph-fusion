import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessFastBoundHolderConcentration,
  HolderRootAuthority,
  globalHolderRoot,
} from '../../dist/platform/security/holder-root.js';

test('HOLDERROOT: fast bound mathematically proves SAFE when worst-case top-10 <= limit', () => {
  // Supply = 1000, observed = 950, known top 10 = 250, unknown tail = 50.
  // maxTopTenBps = 3000 (300 max).
  // Worst-case top 10 = 250 + 50 = 300 <= 300 -> PROVABLY SAFE!
  const assessment = assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 950n,
    knownTopTenRaw: 250n,
    maxTopTenBps: 3_000,
  });
  assert.equal(assessment.status, 'SAFE');
  assert.equal(assessment.unknownTailRaw, 50n);
  assert.match(assessment.reason, /mathematically bounded within limit/);
});

test('HOLDERROOT: fast bound returns UNSAFE when known top 10 exceeds limit', () => {
  const assessment = assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 600n,
    knownTopTenRaw: 350n,
    maxTopTenBps: 3_000,
  });
  assert.equal(assessment.status, 'UNSAFE');
  assert.equal(assessment.unknownTailRaw, 400n);
});

test('HOLDERROOT: fast bound returns AMBIGUOUS when tail exceeds threshold without proof', () => {
  const assessment = assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 400n,
    knownTopTenRaw: 250n,
    maxTopTenBps: 3_000,
  });
  // 250 + 600 = 850 > 300 -> Ambiguous, requires extended census
  assert.equal(assessment.status, 'AMBIGUOUS');
  assert.equal(assessment.unknownTailRaw, 600n);
});

test('HOLDERROOT: excludes protocol inventory (bonding curve ATA) from circulating supply and top holders', () => {
  const authority = new HolderRootAuthority();
  const mint = 'TestMint11111111111111111111111111111111111';
  const curveAta = 'CurveAta11111111111111111111111111111111111';
  const curvePda = 'CurvePda11111111111111111111111111111111111';

  // 1 Billion total supply. Bonding curve holds 800M (80%).
  // Users hold 200M total across 15 wallets.
  const accounts = [
    { address: curveAta, owner: curvePda, amount: 800_000_000n },
    { address: 'Ata1', owner: 'User1', amount: 20_000_000n }, // 10% of 200M circulating
    { address: 'Ata2', owner: 'User2', amount: 15_000_000n }, // 7.5%
    { address: 'Ata3', owner: 'User3', amount: 15_000_000n }, // 7.5%
    { address: 'Ata4', owner: 'User4', amount: 10_000_000n }, // 5%
    { address: 'Ata5', owner: 'User5', amount: 10_000_000n }, // 5%
    { address: 'Ata6', owner: 'User6', amount: 10_000_000n }, // 5%
    { address: 'Ata7', owner: 'User7', amount: 10_000_000n }, // 5%
    { address: 'Ata8', owner: 'User8', amount: 10_000_000n }, // 5%
    { address: 'Ata9', owner: 'User9', amount: 10_000_000n }, // 5%
    { address: 'Ata10', owner: 'User10', amount: 10_000_000n }, // 5%
    { address: 'Ata11', owner: 'User11', amount: 10_000_000n }, // 5%
    { address: 'Ata12', owner: 'User12', amount: 10_000_000n }, // 5%
    { address: 'Ata13', owner: 'User13', amount: 20_000_000n }, // 10%
    { address: 'Ata14', owner: 'User14', amount: 20_000_000n }, // 10%
    { address: 'Ata15', owner: 'User15', amount: 30_000_000n }, // 15%
  ];

  const cert = authority.evaluateCensus({
    mint,
    supply: 1_000_000_000n,
    accounts,
    protocol: {
      bondingCurveAta: curveAta,
      bondingCurvePda: curvePda,
    },
    maxTop1Bps: 2000,  // max 20%
    maxTop3Bps: 4500,  // max 45%
    maxTop10Bps: 8500, // max 85%
  });

  // Bonding curve was excluded from top holders:
  // Top 1 holder is User15 with 30M / 200M = 15% (1500 bps)
  assert.equal(cert.metrics.nonProtocolSupply, 200_000_000n);
  assert.equal(cert.metrics.protocolInventoryRaw, 800_000_000n);
  assert.equal(cert.metrics.top1Raw, 30_000_000n);
  assert.equal(cert.metrics.top1Bps, 1500);
  assert.equal(cert.status, 'SAFE');
  assert.equal(cert.metrics.uniqueHolderCount, 15);
  assert.ok(cert.metrics.hhi > 0 && cert.metrics.hhi < 2000);
});

test('HOLDERROOT: aggregates multiple ATAs belonging to the same economic owner', () => {
  const authority = new HolderRootAuthority();
  const mint = 'TestMint22222222222222222222222222222222222';

  // Whale splits 35M tokens across 3 separate token accounts under the same owner
  const accounts = [
    { address: 'WhaleAta1', owner: 'WhaleWallet', amount: 15_000_000n },
    { address: 'WhaleAta2', owner: 'WhaleWallet', amount: 10_000_000n },
    { address: 'WhaleAta3', owner: 'WhaleWallet', amount: 10_000_000n },
    { address: 'UserAta1', owner: 'UserWallet1', amount: 35_000_000n },
    { address: 'UserAta2', owner: 'UserWallet2', amount: 30_000_000n },
  ];

  const cert = authority.evaluateCensus({
    mint,
    supply: 100_000_000n,
    accounts,
    protocol: {},
    maxTop1Bps: 3000, // 30% limit
  });

  // Aggregated WhaleWallet holds 35M (35% = 3500 bps), which triggers UNSAFE
  assert.equal(cert.metrics.top1Raw, 35_000_000n);
  assert.equal(cert.metrics.top1Bps, 3500);
  assert.equal(cert.status, 'UNSAFE');
  assert.match(cert.reason, /Top-1 holder owns 3500 bps/);
});

test('HOLDERROOT: excludes system burn addresses from top holders', () => {
  const authority = new HolderRootAuthority();
  const mint = 'BurnMint11111111111111111111111111111111111';

  const accounts = [
    { address: '11111111111111111111111111111111', owner: '11111111111111111111111111111111', amount: 50_000_000n }, // 50% burned
    { address: 'UserAta1', owner: 'User1', amount: 25_000_000n }, // 50% of remaining 50M
    { address: 'UserAta2', owner: 'User2', amount: 25_000_000n }, // 50% of remaining 50M
  ];

  const cert = authority.evaluateCensus({
    mint,
    supply: 100_000_000n,
    accounts,
    protocol: {},
  });

  // Burn address was stripped into protocolInventoryRaw
  assert.equal(cert.metrics.protocolInventoryRaw, 50_000_000n);
  assert.equal(cert.metrics.nonProtocolSupply, 50_000_000n);
  assert.equal(cert.metrics.uniqueHolderCount, 2);
});
