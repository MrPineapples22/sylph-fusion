import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import { AccountLayout, MintLayout, NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  GLOBAL_CONFIG_PDA,
  OFFLINE_PUMP_AMM_PROGRAM,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_AMM_SDK,
  canonicalPumpPoolPda,
  pumpPoolAuthorityPda,
  sellBaseInput,
} from '@pump-fun/pump-swap-sdk';
import { readCanonicalPumpSwapPool } from '../../dist/platform/execution/solaris/pump-swap-pool-reader.js';
import { PostGraduationAmmBridge } from '../../dist/platform/execution/solaris/amm-bridge.js';
import { Market } from '../../dist/market.js';

const decoder = {
  decodePool: info => PUMP_AMM_SDK.decodePool(info),
  decodeGlobalConfig: () => ({}),
  decodeFeeConfig: () => ({}),
  feeBreakdown: () => ({ lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 0n }),
};

function info(owner, data) {
  return { owner, data, executable: false, lamports: 1, rentEpoch: 0 };
}

function mintInfo(mint) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({
    mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1_000_000_000_000n,
    decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default,
  }, data);
  return info(TOKEN_PROGRAM_ID, data);
}

function tokenAccount(mint, owner, amount) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({
    mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n,
    closeAuthorityOption: 0, closeAuthority: PublicKey.default,
  }, data);
  return info(TOKEN_PROGRAM_ID, data);
}

async function fixture({ virtualQuoteReserves = -50_000_000n, quoteVaultAmount = 1_000_000_000n, coinCreator = PublicKey.default, slot = 101 } = {}) {
  const mint = Keypair.generate().publicKey;
  const poolAddress = canonicalPumpPoolPda(mint, NATIVE_MINT);
  const baseVault = getAssociatedTokenAddressSync(mint, poolAddress, true, TOKEN_PROGRAM_ID);
  const quoteVault = getAssociatedTokenAddressSync(NATIVE_MINT, poolAddress, true, TOKEN_PROGRAM_ID);
  const pool = {
    poolBump: 1, index: 0, creator: pumpPoolAuthorityPda(mint), baseMint: mint,
    quoteMint: NATIVE_MINT, lpMint: Keypair.generate().publicKey,
    poolBaseTokenAccount: baseVault, poolQuoteTokenAccount: quoteVault,
    lpSupply: new BN(1), coinCreator, isMayhemMode: false,
    isCashbackCoin: false, virtualQuoteReserves: new BN(virtualQuoteReserves.toString()),
    creatorFeeBps: new BN(0), canEditCreatorFee: false,
  };
  const poolBytes = await OFFLINE_PUMP_AMM_PROGRAM.coder.accounts.encode('pool', pool);
  const poolInfo = info(PUMP_AMM_PROGRAM_ID, poolBytes);
  const accounts = new Map([
    [poolAddress.toBase58(), poolInfo],
    [mint.toBase58(), mintInfo(mint)],
    [baseVault.toBase58(), tokenAccount(mint, poolAddress, 2_000_000_000n)],
    [quoteVault.toBase58(), tokenAccount(NATIVE_MINT, poolAddress, quoteVaultAmount)],
    [GLOBAL_CONFIG_PDA.toBase58(), info(PUMP_AMM_PROGRAM_ID, Buffer.from([1]))],
    [PUMP_AMM_FEE_CONFIG_PDA.toBase58(), info(PUMP_FEE_PROGRAM_ID, Buffer.from([1]))],
  ]);
  const connection = {
    async getAccountInfoAndContext(address) {
      assert.equal(address.toBase58(), poolAddress.toBase58());
      return { context: { slot: 100 }, value: accounts.get(address.toBase58()) };
    },
    async getMultipleAccountsInfoAndContext(addresses, config) {
      assert.equal(config.commitment, 'confirmed');
      assert.equal(config.minContextSlot, 100);
      return { context: { slot }, value: addresses.map(address => accounts.get(address.toBase58()) ?? null) };
    },
  };
  return { mint, poolAddress, accounts, connection };
}

test('PumpSwap reader verifies canonical pool, token-vault ownership, and signed effective quote reserves', async () => {
  const f = await fixture();
  const observedNow = Date.now();
  const observation = await readCanonicalPumpSwapPool(f.connection, f.mint, {
    minContextSlot: 100, now: () => observedNow, decoder,
  });
  assert.equal(observation.venue, 'PUMPSWAP');
  assert.equal(observation.source, 'CANONICAL_ON_CHAIN_RPC');
  assert.equal(observation.poolAddress, f.poolAddress.toBase58());
  assert.equal(observation.quoteReserves, 950_000_000n);
  assert.equal(observation.tokenReserves, 2_000_000_000n);
  assert.equal(observation.effectiveFeeBps, 25);
  assert.deepEqual(observation.feeBreakdown, { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 0n });
  assert.equal(observation.slot, 101);
  assert.equal(observation.observedAtMs, observedNow);

  const bridge = new PostGraduationAmmBridge({ sniperCooldownMs: 0, minAmmQuoteReserves: 1n });
  bridge.registerMigration(f.mint.toBase58(), 100);
  bridge.registerAmmPool(f.mint.toBase58(), observation);
  assert.equal(bridge.canExecuteTrade(f.mint.toBase58(), 'BUY').allowed, true);
  assert.equal(bridge.getObservationSummary(f.mint.toBase58()).status, 'OBSERVED');
  assert.equal(bridge.getObservationSummary(f.mint.toBase58()).slot, 101);

  const market = new Market({ connection: {} }, {}, PublicKey.default);
  market.ammBridge.registerMigration(f.mint.toBase58(), 100);
  market.ammBridge.registerAmmPool(f.mint.toBase58(), observation);
  const amountIn = 100_000_000n;
  const sdkExactSellOut = sellBaseInput({
    base: new BN(amountIn.toString()), slippage: 0,
    baseReserve: new BN(observation.tokenReserves.toString()),
    quoteReserve: new BN(observation.rawQuoteReserves.toString()),
    virtualQuoteReserves: new BN(observation.virtualQuoteReserves.toString()),
    globalConfig: { lpFeeBasisPoints: new BN(20), protocolFeeBasisPoints: new BN(5), coinCreatorFeeBasisPoints: new BN(0) },
    feeConfig: null, baseMintAccount: { supply: new BN('1000000000000') }, baseMint: f.mint,
    coinCreator: PublicKey.default, creator: pumpPoolAuthorityPda(f.mint),
    quoteMint: NATIVE_MINT, isMayhemMode: false,
  }).uiQuote;
  assert.equal(market.ammExitQuote(f.mint.toBase58(), amountIn), BigInt(sdkExactSellOut.toString()));

  const spoofBridge = new PostGraduationAmmBridge({ sniperCooldownMs: 0, minAmmQuoteReserves: 1n });
  spoofBridge.registerMigration('spoof-mint', 100);
  spoofBridge.registerAmmPool('spoof-mint', { ...observation, source: 'CANONICAL_ON_CHAIN_RPC' });
  assert.equal(spoofBridge.canExecuteTrade('spoof-mint', 'BUY').allowed, false);
  assert.equal(spoofBridge.getObservationSummary('spoof-mint').status, 'UNVERIFIED');
});

test('PumpSwap sell quote matches SDK when creator fees are nonzero and rounded independently', async () => {
  const coinCreator = Keypair.generate().publicKey;
  const f = await fixture({ coinCreator });
  const feeBreakdown = { lpFeeBps: 21n, protocolFeeBps: 7n, creatorFeeBps: 13n };
  const observation = await readCanonicalPumpSwapPool(f.connection, f.mint, {
    minContextSlot: 100, decoder: { ...decoder, feeBreakdown: () => feeBreakdown },
  });
  const market = new Market({ connection: {} }, {}, PublicKey.default);
  market.ammBridge.registerMigration(f.mint.toBase58(), 100);
  market.ammBridge.registerAmmPool(f.mint.toBase58(), observation);
  const amountIn = 100_000_000n;
  const sdkExactSellOut = sellBaseInput({
    base: new BN(amountIn.toString()), slippage: 0,
    baseReserve: new BN(observation.tokenReserves.toString()),
    quoteReserve: new BN(observation.rawQuoteReserves.toString()),
    virtualQuoteReserves: new BN(observation.virtualQuoteReserves.toString()),
    globalConfig: { lpFeeBasisPoints: new BN(21), protocolFeeBasisPoints: new BN(7), coinCreatorFeeBasisPoints: new BN(13) },
    feeConfig: null, baseMintAccount: { supply: new BN('1000000000000') }, baseMint: f.mint,
    coinCreator, creator: pumpPoolAuthorityPda(f.mint), quoteMint: NATIVE_MINT, isMayhemMode: false,
  }).uiQuote;
  assert.equal(market.ammExitQuote(f.mint.toBase58(), amountIn), BigInt(sdkExactSellOut.toString()));
});

test('PumpSwap sell quote fails closed when virtual reserves exceed executable raw quote vault', async () => {
  const f = await fixture({ virtualQuoteReserves: 949_999_999n, quoteVaultAmount: 1n });
  const observation = await readCanonicalPumpSwapPool(f.connection, f.mint, { minContextSlot: 100, decoder });
  assert.equal(observation.quoteReserves, 950_000_000n);
  const market = new Market({ connection: {} }, {}, PublicKey.default);
  market.ammBridge.registerMigration(f.mint.toBase58(), 100);
  market.ammBridge.registerAmmPool(f.mint.toBase58(), observation);
  assert.throws(() => market.ammExitQuote(f.mint.toBase58(), 100_000_000n), /PUMP_AMM_INSUFFICIENT_REAL_QUOTE_RESERVES/);
});

test('PumpSwap reader rejects a stale context and a vault owned by the wrong token program', async () => {
  const belowMinimum = await fixture({ slot: 99 });
  await assert.rejects(
    readCanonicalPumpSwapPool(belowMinimum.connection, belowMinimum.mint, { minContextSlot: 100, decoder }),
    /PUMP_AMM_SNAPSHOT_CONTEXT_REGRESSION/,
  );

  const wrongOwner = await fixture();
  const pool = PUMP_AMM_SDK.decodePool(wrongOwner.accounts.get(wrongOwner.poolAddress.toBase58()));
  wrongOwner.accounts.set(pool.poolQuoteTokenAccount.toBase58(), info(PUMP_AMM_PROGRAM_ID, Buffer.alloc(AccountLayout.span)));
  await assert.rejects(
    readCanonicalPumpSwapPool(wrongOwner.connection, wrongOwner.mint, { decoder }),
    /PUMP_QUOTE_VAULT_PROGRAM_MISMATCH/,
  );

  const wrongAuthority = await fixture();
  const authorityPool = PUMP_AMM_SDK.decodePool(wrongAuthority.accounts.get(wrongAuthority.poolAddress.toBase58()));
  wrongAuthority.accounts.set(authorityPool.poolBaseTokenAccount.toBase58(),
    tokenAccount(wrongAuthority.mint, Keypair.generate().publicKey, 2_000_000_000n));
  await assert.rejects(
    readCanonicalPumpSwapPool(wrongAuthority.connection, wrongAuthority.mint, { decoder }),
    /PUMP_AMM_VAULT_AUTHORITY_MINT_OR_BALANCE_MISMATCH/,
  );
});

test('AMM observation failure is visible as a bounded code without leaking provider details', () => {
  const bridge = new PostGraduationAmmBridge();
  bridge.registerMigration('failed-pool', 101);
  bridge.recordPoolObservationFailure('failed-pool', 'https://rpc.example/?api-key=secret');
  const summary = bridge.getObservationSummary('failed-pool');
  assert.equal(summary.status, 'UNAVAILABLE');
  assert.equal(summary.lastError, 'PUMP_AMM_RPC_READ_FAILED');
  assert.equal(summary.lastAttemptAtMs > 0, true);
});
