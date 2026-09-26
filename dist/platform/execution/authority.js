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
import { Executor } from '../../execution.js';
import { mulBps } from '../../core.js';
/**
 * Deterministic paper execution authority.
 * Never connects to live private keys or writes on-chain transactions.
 */
export class SimulationExecutionAuthority {
    cfg;
    market;
    mode = 'SIMULATION';
    isLive = false;
    walletPublicKey;
    constructor(cfg, market, walletPubKey) {
        this.cfg = cfg;
        this.market = market;
        // Deterministic simulation public key derived from zero seed if not provided
        this.walletPublicKey = walletPubKey || Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;
    }
    canExecuteLive() {
        return false;
    }
    async warm() {
        // No-op in simulation; no live Jito tip accounts required
    }
    async build(s, side, amount, creator, stage, reason, panic) {
        const slippage = panic ? this.cfg.PANIC_SLIPPAGE_BPS : this.cfg.SLIPPAGE_BPS;
        let output;
        if (s.curve.complete) {
            if (side === 'buy')
                throw new Error('Graduated entries disabled in simulation');
            output = mulBps(amount * 1000000n / 1000000000n, 10_000 - slippage);
            if (output <= 0n)
                output = 1000n;
        }
        else {
            output = side === 'buy' ? this.market.buyQuote(s, amount) : this.market.sellQuote(s, amount);
            if (output <= 0n)
                throw new Error('Zero executable output');
        }
        const tip = Math.min(this.cfg.MAX_TIP_LAMPORTS, Math.max(this.cfg.MIN_TIP_LAMPORTS, 100_000 * (panic ? 2 : 1)));
        const baseFee = 5000n;
        const fee = BigInt(tip + this.cfg.MAX_PRIORITY_LAMPORTS) + baseFee;
        const executedSol = side === 'sell' ? mulBps(output, 10_000 - slippage) : 0n;
        const slippageLamports = side === 'sell' ? output - executedSol : 0n;
        const pendingId = randomUUID();
        const pending = {
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
            solDelta: side === 'buy' ? -amount - fee - 3000000n : executedSol - fee,
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
    async broadcast(order) {
        if (!order.signature.startsWith('sim_') && order.signature !== 'paper') {
            throw new Error(`SimulationAuthority cannot broadcast live signature: ${order.signature}`);
        }
        return { status: 'NOT_SENT', signature: order.signature, attemptedAt: Date.now(), reason: 'SIMULATION' };
    }
    async reconcile(order) {
        return {
            status: 'filled',
            tokenDelta: 0n,
            solDelta: 0n,
        };
    }
    async getWalletBalance() {
        return BigInt(this.cfg.PAPER_CASH_LAMPORTS);
    }
    async getTokenBalance() {
        return 0n;
    }
}
/**
 * Live on-chain execution authority.
 * Demands valid Keypair, live RpcPool, confirmed RPC, and Jito connectivity.
 */
export class LiveExecutionAuthority {
    cfg;
    rpc;
    market;
    key;
    mode = 'LIVE';
    isLive = true;
    walletPublicKey;
    executor;
    constructor(cfg, rpc, market, key) {
        this.cfg = cfg;
        this.rpc = rpc;
        this.market = market;
        this.key = key;
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
    canExecuteLive() {
        return (this.isLive &&
            this.cfg.MODE === 'live' &&
            !this.walletPublicKey.equals(PublicKey.default) &&
            this.rpc.endpoints.length > 0);
    }
    async warm() {
        await this.executor.warm();
    }
    async build(s, side, amount, creator, stage, reason, panic) {
        if (!this.canExecuteLive()) {
            throw new Error('LiveExecutionAuthority pre-conditions not satisfied');
        }
        const built = await this.executor.build(s, side, amount, creator, stage, reason, panic);
        if (!built.pending.signature ||
            built.pending.signature === 'paper' ||
            built.pending.signature.startsWith('sim_') ||
            built.pending.wire.length === 0) {
            throw new Error('Live execution produced invalid or placeholder transaction signature');
        }
        return built;
    }
    async broadcast(order) {
        if (order.signature === 'paper' || order.signature.startsWith('sim_')) {
            throw new Error(`LiveExecutionAuthority cannot broadcast simulated signature: ${order.signature}`);
        }
        return this.executor.broadcast(order);
    }
    async reconcile(order) {
        return this.executor.reconcile(order);
    }
    async getWalletBalance(commitment = 'confirmed') {
        const lamports = await this.rpc.connection.getBalance(this.walletPublicKey, commitment);
        return BigInt(lamports);
    }
    async getTokenBalance(mint, commitment = 'confirmed') {
        const rows = await this.rpc.connection.getParsedTokenAccountsByOwner(this.walletPublicKey, { mint }, commitment);
        return rows.value.reduce((sum, row) => sum + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
    }
}
//# sourceMappingURL=authority.js.map