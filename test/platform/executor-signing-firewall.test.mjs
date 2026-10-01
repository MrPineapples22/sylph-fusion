import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

import { Executor } from '../../dist/execution.js';
import { SigningFirewall } from '../../dist/platform/signing/signing-firewall.js';

function mockConfig(overrides = {}) {
  return {
    MODE: 'live',
    KEYPAIR_PATH: 'mock',
    RPC_TIMEOUT_MS: 3000,
    QUOTE_MAX_AGE_MS: 10000,
    SLIPPAGE_BPS: 300,
    PANIC_SLIPPAGE_BPS: 1000,
    MAX_PRIORITY_LAMPORTS: 200_000,
    MIN_TIP_LAMPORTS: 10_000,
    MAX_TIP_LAMPORTS: 500_000,
    JITO_URL: 'https://mock.jito',
    JITO_AUTH: '',
    ...overrides,
  };
}

function mockSnapshot(mintKey, address) {
  const zero = new BN(0);
  return {
    mint: mintKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    supply: 1000000000000000n,
    at: Date.now(),
    slot: 1,
    ata: null,
    info: { data: Buffer.alloc(256), owner: PUMP_PROGRAM_ID, lamports: 100, executable: false, rentEpoch: 0 },
    fee: null,
    global: {
      feeRecipient: address,
      feeRecipients: [address],
      feeBasisPoints: new BN(100),
      creatorFeeBasisPoints: zero,
      creatorFeeConfigurable: false,
    },
    curve: {
      virtualTokenReserves: new BN('1073000000000000'),
      virtualQuoteReserves: new BN('30000000000'),
      realTokenReserves: new BN('793100000000000'),
      realQuoteReserves: new BN('1000000000'),
      tokenTotalSupply: new BN('1000000000000000'),
      creator: address,
      quoteMint: PublicKey.default,
      creatorFeeBps: zero,
      isMayhemMode: false,
      complete: false,
    },
    creatorTokens: '0',
  };
}

test('Executor: Signs via decoupled ExecutionSignerGateway without raw secret key in memory', async () => {
  const kp = Keypair.generate();
  let signingInvoked = false;

  const isolatedGateway = {
    publicKey: kp.publicKey,
    async signTransactionMessage(messageBytes) {
      signingInvoked = true;
      // Mocked 64-byte signature from isolated KMS enclave
      return new Uint8Array(64).fill(42);
    },
  };

  const rpc = {
    connection: {
      getLatestBlockhashAndContext: async () => ({
        value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 },
      }),
      getRecentPrioritizationFees: async () => [{ prioritizationFee: 1000 }],
      simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 100000 } }),
    },
  };

  const executor = new Executor(
    mockConfig(),
    rpc,
    { buyQuote: () => 1_000_000n, sellQuote: () => 1_000_000n },
    isolatedGateway
  );
  executor.tips = [new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5')];

  const mint = Keypair.generate().publicKey;
  const snapshot = mockSnapshot(mint, kp.publicKey);

  const built = await executor.build(snapshot, 'buy', 10_000_000n, kp.publicKey.toBase58(), 0, 'test_decoupled', false);

  assert.equal(signingInvoked, true, 'Isolated signer gateway must be invoked');
  assert.ok(built.pending.signature.length > 0);
  assert.notEqual(built.pending.signature, 'paper');
});

test('Executor: SigningFirewall blocks transaction when unauthorized program ID is injected', async () => {
  const kp = Keypair.generate();
  const rpc = {
    connection: {
      getLatestBlockhashAndContext: async () => ({
        value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 },
      }),
      getRecentPrioritizationFees: async () => [{ prioritizationFee: 1000 }],
      simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 100000 } }),
    },
  };

  // Restrict allowed programs in custom firewall policy
  class DenyingFirewall extends SigningFirewall {
    evaluate(req, dec, policy, gates) {
      return { approved: false, reasonCodes: ['UNKNOWN_PROGRAM_DENIED', 'UNAUTHORIZED_DRAINER_DETECTED'] };
    }
  }

  const executor = new Executor(
    mockConfig(),
    rpc,
    { buyQuote: () => 1_000_000n, sellQuote: () => 1_000_000n },
    kp,
    new DenyingFirewall()
  );
  executor.tips = [new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5')];

  const mint = Keypair.generate().publicKey;
  const snapshot = mockSnapshot(mint, kp.publicKey);

  await assert.rejects(
    executor.build(snapshot, 'buy', 10_000_000n, kp.publicKey.toBase58(), 0, 'test_malicious', false),
    /SIGNING_FIREWALL_REJECTED.*UNKNOWN_PROGRAM_DENIED/
  );
});
