/**
 * SOL-SYLPH Platform - Authoritative Execution Separation
 *
 * Structurally separates simulation from live execution:
 * - SimulationExecutionAuthority: Handles paper/simulated trades, deterministic math, mock isolation.
 * - LiveExecutionAuthority: Requires verified Keypair, live RpcPool, Jito tip accounts, Jupiter swap checks.
 *
 * Non-negotiable invariant:
 * Live execution is impossible without valid live dependencies.
 * No placeholder signatures, slots, balances, routes, fills, transaction IDs,
 * or confirmation states may cross into live-state projections.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { randomUUID } from 'node:crypto';
import type { Config } from '../../config.js';
import type { RpcPool } from '../../rpc.js';
import { Market, type Snapshot } from '../../market.js';
import { Executor, type BroadcastOutcome, type Built } from '../../execution.js';
import { mulBps, type Pending } from '../../core.js';

export type AuthorityExecutionMode = 'SIMULATION' | 'LIVE';

export type ExecutionReconcileResult =
  | { status: 'pending'; fee?: bigint; tokenDelta?: undefined; solDelta?: undefined }
  | { status: 'expired'; fee?: bigint; tokenDelta?: undefined; solDelta?: undefined }
  | { status: 'failed'; fee?: bigint; tokenDelta?: undefined; solDelta?: undefined }
  | { status: 'filled'; tokenDelta: bigint; solDelta: bigint; fee?: bigint };

export interface ExecutionAuthority {
  readonly mode: AuthorityExecutionMode;
  readonly isLive: boolean;
  readonly walletPublicKey: PublicKey;
  canExecuteLive(): boolean;
  warm(): Promise<void>;
  build(
    s: Snapshot,
    side: 'buy' | 'sell',
    amount: bigint,
    creator: string,
    stage: number,
    reason: string,
    panic: boolean
  ): Promise<Built>;
  broadcast(order: Pending): Promise<BroadcastOutcome>;
  reconcile(order: Pending): Promise<ExecutionReconcileResult>;
  getWalletBalance(commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<bigint>;
  getTokenBalance(mint: PublicKey, commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<bigint>;
}

/**
 * Deterministic paper execution authority.
 * Never connects to live private keys or writes on-chain transactions.
 */
export class SimulationExecutionAuthority implements ExecutionAuthority {
  readonly mode: AuthorityExecutionMode = 'SIMULATION';
  readonly isLive = false;
  readonly walletPublicKey: PublicKey;

  constructor(
    private readonly cfg: Config,
    private readonly market: Market,
    walletPubKey?: PublicKey
  ) {
    // Deterministic simulation public key derived from zero seed if not provided
    this.walletPublicKey = walletPubKey || Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;
  }

  canExecuteLive(): boolean {
    return false;
  }

  async warm(): Promise<void> {
    // No-op in simulation; no live Jito tip accounts required
  }

  async build(
    s: Snapshot,
    side: 'buy' | 'sell',
    amount: bigint,
    creator: string,
    stage: number,
    reason: string,
    panic: boolean
  ): Promise<Built> {
    const slippage = panic ? this.cfg.PANIC_SLIPPAGE_BPS : this.cfg.SLIPPAGE_BPS;
    let output: bigint;

    if (s.curve.complete) {
      if (side === 'buy') throw new Error('Graduated entries disabled in simulation');
      output = mulBps(amount * 1_000_000n / 1_000_000_000n, 10_000 - slippage);
      if (output <= 0n) output = 1000n;
    } else {
      output = side === 'buy' ? this.market.buyQuote(s, amount) : this.market.sellQuote(s, amount);
      if (output <= 0n) throw new Error('Zero executable output');
    }

    const tip = Math.min(this.cfg.MAX_TIP_LAMPORTS, Math.max(this.cfg.MIN_TIP_LAMPORTS, 100_000 * (panic ? 2 : 1)));
    const baseFee = 5000n;
    const fee = BigInt(tip + this.cfg.MAX_PRIORITY_LAMPORTS) + baseFee;
    const executedSol = side === 'sell' ? mulBps(output, 10_000 - slippage) : 0n;
    const slippageLamports = side === 'sell' ? output - executedSol : 0n;

    const pendingId = randomUUID();
    const pending: Pending = {
      id: pendingId,
      mint: s.mint.toBase58(),
      side,
      signature: `sim_${pendingId.slice(0, 16)}`,
      wire: '',
      lastValidBlockHeight: 0,
      created: Date.now(),
      creator,
      tokenProgram: s.tokenProgram.toBase58(),
      stage,
      reserve: s.curve.realQuoteReserves.toString(),
      reason,
      requested: String(amount),
      creatorTokens: s.creatorTokens,
    };

    return {
      pending,
      tokenDelta: side === 'buy' ? mulBps(output, 10_000 - slippage) : -amount,
      solDelta: side === 'buy' ? -amount - fee - 3_000_000n : executedSol - fee,
      quotedOutput: output,
      quoteTimestamp: s.at,
      overhead: {
        tipLamports: String(tip),
        priorityLamports: String(this.cfg.MAX_PRIORITY_LAMPORTS),
        rentLamports: side === 'buy' ? '3000000' : '0',
        slippageBps: slippage,
        slippageLamports: String(slippageLamports),
        baseFeeLamports: String(baseFee),
      },
    };
  }

  async broadcast(order: Pending): Promise<BroadcastOutcome> {
    if (!order.signature.startsWith('sim_') && order.signature !== 'paper') {
      throw new Error(`SimulationAuthority cannot broadcast live signature: ${order.signature}`);
    }
    return { status: 'NOT_SENT', signature: order.signature, attemptedAt: Date.now(), reason: 'SIMULATION' };
  }

  async reconcile(order: Pending): Promise<ExecutionReconcileResult> {
    return {
      status: 'filled',
      tokenDelta: 0n,
      solDelta: 0n,
    };
  }

  async getWalletBalance(): Promise<bigint> {
    return BigInt(this.cfg.PAPER_CASH_LAMPORTS);
  }

  async getTokenBalance(): Promise<bigint> {
    return 0n;
  }
}

/**
 * Live on-chain execution authority.
 * Demands valid Keypair, live RpcPool, confirmed RPC, and Jito connectivity.
 */
export class LiveExecutionAuthority implements ExecutionAuthority {
  readonly mode: AuthorityExecutionMode = 'LIVE';
  readonly isLive = true;
  readonly walletPublicKey: PublicKey;
  private readonly executor: Executor;

  constructor(
    private readonly cfg: Config,
    private readonly rpc: RpcPool,
    private readonly market: Market,
    private readonly key: Keypair
  ) {
    if (cfg.MODE !== 'live') {
      throw new Error(`LiveExecutionAuthority cannot be initialized with non-live config mode: ${cfg.MODE}`);
    }

    if (!key || !key.publicKey || key.publicKey.equals(PublicKey.default)) {
      throw new Error('LiveExecutionAuthority requires a valid, non-default Solana Keypair');
    }

    // Ensure key is not the known test seed Buffer.alloc(32, 7)
    const testSeedKey = Keypair.fromSeed(Buffer.alloc(32, 7));
    if (key.publicKey.equals(testSeedKey.publicKey)) {
      throw new Error('LiveExecutionAuthority rejected placeholder test seed keypair');
    }

    if (!rpc || !rpc.connection || !rpc.endpoints || !rpc.endpoints.length) {
      throw new Error('LiveExecutionAuthority requires an active RpcPool with at least one confirmed endpoint');
    }

    this.walletPublicKey = key.publicKey;
    this.executor = new Executor(cfg, rpc, market, key);
  }

  canExecuteLive(): boolean {
    return (
      this.isLive &&
      this.cfg.MODE === 'live' &&
      !this.walletPublicKey.equals(PublicKey.default) &&
      this.rpc.endpoints.length > 0
    );
  }

  async warm(): Promise<void> {
    await this.executor.warm();
  }

  async build(
    s: Snapshot,
    side: 'buy' | 'sell',
    amount: bigint,
    creator: string,
    stage: number,
    reason: string,
    panic: boolean
  ): Promise<Built> {
    if (!this.canExecuteLive()) {
      throw new Error('LiveExecutionAuthority pre-conditions not satisfied');
    }

    const built = await this.executor.build(s, side, amount, creator, stage, reason, panic);

    if (
      !built.pending.signature ||
      built.pending.signature === 'paper' ||
      built.pending.signature.startsWith('sim_') ||
      built.pending.wire.length === 0
    ) {
      throw new Error('Live execution produced invalid or placeholder transaction signature');
    }

    return built;
  }

  async broadcast(order: Pending): Promise<BroadcastOutcome> {
    if (order.signature === 'paper' || order.signature.startsWith('sim_')) {
      throw new Error(`LiveExecutionAuthority cannot broadcast simulated signature: ${order.signature}`);
    }
    return this.executor.broadcast(order);
  }

  async reconcile(order: Pending): Promise<ExecutionReconcileResult> {
    return this.executor.reconcile(order);
  }

  async getWalletBalance(commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<bigint> {
    const lamports = await this.rpc.connection.getBalance(this.walletPublicKey, commitment);
    return BigInt(lamports);
  }

  async getTokenBalance(mint: PublicKey, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<bigint> {
    const rows = await this.rpc.connection.getParsedTokenAccountsByOwner(
      this.walletPublicKey,
      { mint },
      commitment
    );
    return rows.value.reduce((sum, row) => sum + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
  }
}
