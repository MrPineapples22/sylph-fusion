import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { Market } from '../dist/market.js';
import { SimulationExecutionAuthority } from '../dist/platform/execution/authority.js';

test('REQ-016: Graduated positions maintain valid AMM marks and executable exit routes', async () => {
  const mint = new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R');
  const creator = 'DevWallet111111111111111111111111111111111111';
  const dummyWallet = new PublicKey('11111111111111111111111111111111');

  const cfg = {
    BUY_LAMPORTS: 100_000_000,
    SLIPPAGE_BPS: 200,
    PANIC_SLIPPAGE_BPS: 500,
    STOP_BPS: 1000,
    BASE_FEE_LAMPORTS: 5_000,
    PRIORITY_MICRO_LAMPORTS: 10_000,
    COMPUTE_UNITS: 200_000,
    TIP_LAMPORTS: 100_000,
    PANIC_TIP_LAMPORTS: 1_000_000,
    MIN_REAL_RESERVE_LAMPORTS: 1_000_000,
    MAX_FEE_BPS: 200,
    MAX_IMPACT_BPS: 1000,
    LIQUIDITY_DROP_BPS: 1500,
    MIN_TIP_LAMPORTS: 50_000,
    MAX_TIP_LAMPORTS: 200_000,
    MAX_PRIORITY_LAMPORTS: 10_000,
  };

  const dummyRpc = {
    connection: {
      getAccountInfo: async () => null,
      getMultipleAccountsInfoAndContext: async () => ({ context: { slot: 100 }, value: [] }),
    },
  };

  const market = new Market(dummyRpc, cfg, dummyWallet);
  const authority = new SimulationExecutionAuthority(cfg, market);

  const completedCurveSnapshot = {
    mint,
    tokenProgram: dummyWallet,
    supply: 1_000_000_000_000_000n,
    curve: {
      complete: true,
      realQuoteReserves: 85_000_000_000n,
      virtualTokenReserves: 206_900_000_000_000n,
      virtualQuoteReserves: 115_000_000_000n,
      isHolderReward: false,
      isMayhemMode: false,
    },
    global: {},
    fee: {},
    info: {},
    ata: null,
    slot: 250_000_000,
    at: Date.now(),
    entrySafe: true,
  };

  const tokenAmount = 5_000_000_000n; // 5,000 tokens

  // 1. Before AMM pool is registered, exit attempt fails closed safely (never manufactures fake SOL)
  await assert.rejects(
    async () => {
      await authority.build(completedCurveSnapshot, 'sell', tokenAmount, creator, 1, 'exit_test', false);
    },
    /Graduated-curve execution quote unavailable in simulation/,
    'Completed curve without verified AMM pool must fail closed'
  );

  // 2. Lifecycle transitions to MIGRATION_PENDING upon curve completion
  const mintStr = mint.toBase58();
  market.ammBridge.registerMigration(mintStr, 250_000_000);
  const c1 = market.lifecycle.transitionLifecycle(mintStr, {
    evidenceId: 'EV-MIG-TRIGGER',
    slot: 250_000_000,
    timestampMs: Date.now(),
    source: 'ON_CHAIN_PROGRAM',
    details: 'Bonding curve completed',
  }, 'MIGRATION_PENDING');

  assert.equal(c1.currentState, 'MIGRATION_PENDING');
  assert.equal(c1.valuationStatus, 'UNPRICED_MIGRATING');
  assert.equal(c1.isHoldingPreserved, true, 'Holding must be preserved during migration window');

  // 3. Register verified Raydium AMM pool with 85 SOL reserves
  const poolAddress = 'RaydiumPoolPumpSwapVerified111111111111111';
  const initialPoolSolReserves = 85_000_000_000n; // 85 SOL
  market.ammBridge.registerRaydiumPool(mintStr, poolAddress, initialPoolSolReserves);

  // Mark AMM active in lifecycle
  const c2 = market.lifecycle.transitionLifecycle(mintStr, {
    evidenceId: 'EV-AMM-VERIFIED',
    slot: 250_000_050,
    timestampMs: Date.now(),
    source: 'ON_CHAIN_PROGRAM',
    destinationPoolAddress: poolAddress,
    migrationProgramId: 'raydium_cpmm_or_pumpswap',
    details: 'Verified AMM liquidity open',
  }, 'AMM_ACTIVE');

  assert.equal(c2.currentState, 'AMM_ACTIVE');
  assert.equal(c2.valuationStatus, 'PRICED_AMM');

  // 4. Test market.ammExitQuote() constant-product calculation
  const quote = market.ammExitQuote(mintStr, tokenAmount);
  assert.ok(quote > 0n, 'Graduated AMM quote must be positive');

  // Expected math: gross = (5_000_000_000 * 85_000_000_000) / (206_900_000_000_000 + 5_000_000_000)
  // net = (gross * 9975) / 10000
  const expectedGross = (tokenAmount * initialPoolSolReserves) / (206_900_000_000_000n + tokenAmount);
  const expectedNet = (expectedGross * 9975n) / 10000n;
  assert.equal(quote, expectedNet);

  // 5. Test that authority.build() successfully builds executable exit order on graduated venue
  const built = await authority.build(completedCurveSnapshot, 'sell', tokenAmount, creator, 1, 'exit_graduated', false);
  assert.ok(built);
  assert.equal(built.pending.side, 'sell');
  assert.equal(built.pending.mint, mintStr);
  assert.equal(built.quotedOutput, quote);
  assert.equal(built.tokenDelta, -tokenAmount);
  assert.ok(built.solDelta > 0n);
  assert.ok(built.pending.signature.startsWith('sim_'));
});
