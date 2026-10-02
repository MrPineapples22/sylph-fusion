import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityControlX } from '../../dist/platform/security/entity-control-x.js';

test('EntityControlX: returns empty evaluation when holdings are empty', () => {
  const result = EntityControlX.evaluateSupply({
    mint: 'MINT_EMPTY_TEST',
    totalSupplyRaw: 1_000_000_000n,
    holdings: [],
  });

  assert.equal(result.rawWalletCount, 0);
  assert.equal(result.resolvedEntityCount, 0);
  assert.equal(result.isEntropyCollapsed, false);
  assert.equal(result.supplyAvalancheRisk, 0);
  assert.match(result.rationale, /EMPTY_HOLDINGS/);
});

test('EntityControlX: detects Sybil deception gap and entropy collapse from common root funder', () => {
  const totalSupply = 1_000_000_000n; // 1B units
  // 10 wallets, but 8 are funded by the same root funder (Sybil cluster)
  const holdings = [
    { address: 'wallet_1', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_2', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_3', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_4', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_5', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_6', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_7', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_8', balanceRaw: 50_000_000n, rootFunder: 'funder_sybil_master' },
    { address: 'wallet_organic_1', balanceRaw: 20_000_000n, rootFunder: 'funder_clean_1' },
    { address: 'wallet_organic_2', balanceRaw: 30_000_000n, rootFunder: 'funder_clean_2' },
  ];

  const evalResult = EntityControlX.evaluateSupply({
    mint: 'MINT_SYBIL_TEST',
    totalSupplyRaw: totalSupply,
    holdings,
  });

  assert.equal(evalResult.rawWalletCount, 10);
  assert.equal(evalResult.resolvedEntityCount, 3); // Sybil cluster + 2 organic
  assert.equal(evalResult.deceptionGap, 0.7); // 1 - 3/10 = 0.70 (70% illusion)
  assert.equal(evalResult.isEntropyCollapsed, true);
  assert.ok(evalResult.latentInventoryFraction >= 0.40); // 8 * 50M = 400M = 40% of supply
  assert.ok(evalResult.supplyAvalancheRisk > 0.50);
  assert.match(evalResult.rationale, /ENTROPY_COLLAPSE/);
});

test('EntityControlX: unmasks covert creator-connected insider inventory', () => {
  const totalSupply = 1_000_000_000n;
  const creatorAddress = 'dev_wallet_original';
  const holdings = [
    { address: creatorAddress, balanceRaw: 50_000_000n }, // 5% direct dev
    { address: 'wallet_insider_1', balanceRaw: 150_000_000n, fundingParent: creatorAddress }, // 15% funded by dev
    { address: 'wallet_insider_2', balanceRaw: 100_000_000n, rootFunder: creatorAddress }, // 10% funded by dev
    { address: 'wallet_trader_1', balanceRaw: 50_000_000n, rootFunder: 'funder_external_1' },
    { address: 'wallet_trader_2', balanceRaw: 50_000_000n, rootFunder: 'funder_external_2' },
  ];

  const evalResult = EntityControlX.evaluateSupply({
    mint: 'MINT_INSIDER_TEST',
    totalSupplyRaw: totalSupply,
    creatorAddress,
    holdings,
  });

  // Creator cluster has dev_wallet_original, wallet_insider_1, wallet_insider_2 = 300M (30%)
  const creatorCluster = evalResult.clusters.find(c => c.rootFunder === creatorAddress);
  assert.ok(creatorCluster);
  assert.equal(creatorCluster.isInsiderSuspected, true);
  assert.equal(creatorCluster.memberWallets.length, 3);
  assert.equal(creatorCluster.supplyFraction, 0.3);
  // Latent inventory fraction should account for non-creator insider wallets
  assert.ok(evalResult.latentInventoryFraction >= 0.25);
});

test('EntityControlX: confirms healthy organic token dispersion', () => {
  const totalSupply = 1_000_000_000n;
  // 10 completely independent holders with small balanced stakes
  const holdings = Array.from({ length: 10 }, (_, i) => ({
    address: `wallet_independent_${i}`,
    balanceRaw: 20_000_000n, // 2% each
    rootFunder: `funder_unique_${i}`,
  }));

  const evalResult = EntityControlX.evaluateSupply({
    mint: 'MINT_ORGANIC_TEST',
    totalSupplyRaw: totalSupply,
    holdings,
  });

  assert.equal(evalResult.rawWalletCount, 10);
  assert.equal(evalResult.resolvedEntityCount, 10);
  assert.equal(evalResult.deceptionGap, 0);
  assert.equal(evalResult.isEntropyCollapsed, false);
  assert.ok(evalResult.normalizedEntityEntropy > 0.85);
  assert.ok(evalResult.supplyAvalancheRisk < 0.25);
  assert.match(evalResult.rationale, /Healthy entity dispersion/);
});
