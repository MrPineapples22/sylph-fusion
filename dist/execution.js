import { JitoLifecycleCoordinator } from './platform/execution/jito-lifecycle-coordinator.js';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import { randomUUID } from 'node:crypto';
import { httpJson } from './rpc.js';
import { log, mulBps } from './core.js';
import { AssetDeltaEngine } from './platform/execution/asset-delta-engine.js';
import { canonicalJson } from './platform/pipeline/canonical-hashing.js';
const JUPITER_PROGRAM = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
const JUPITER_ROUTE_DISCRIMINATORS = new Set([
    'e517cb977ae3ad2a', // route
    'c1209b3341d69c81', // sharedAccountsRoute
]);
function validateJupiterExactInInstruction(data, amount, output, slippageBps) {
    if (data.length < 31 || !JUPITER_ROUTE_DISCRIMINATORS.has(data.subarray(0, 8).toString('hex'))) {
        throw new Error('unsupported Jupiter exact-in route instruction');
    }
    // Both exact-in V6 route variants end with inAmount:u64, quotedOutAmount:u64,
    // slippageBps:u16 and platformFeeBps:u8. Bind this suffix to the HTTP result.
    const inAmount = data.readBigUInt64LE(data.length - 19);
    const quotedOutAmount = data.readBigUInt64LE(data.length - 11);
    const encodedSlippageBps = data.readUInt16LE(data.length - 3);
    const platformFeeBps = data[data.length - 1];
    if (inAmount !== amount || quotedOutAmount !== output || encodedSlippageBps !== slippageBps || platformFeeBps !== 0) {
        throw new Error('Jupiter instruction economics do not match build response');
    }
}
export class Executor {
    cfg;
    rpc;
    market;
    key;
    tips = [];
    tipAt = 0;
    floor = 0;
    jitoCoordinator;
    constructor(cfg, rpc, market, key, _signingFirewall) {
        this.cfg = cfg;
        this.rpc = rpc;
        this.market = market;
        this.key = key;
        this.jitoCoordinator = new JitoLifecycleCoordinator(this.cfg.JITO_URL, this.cfg.JITO_AUTH, this.cfg.RPC_TIMEOUT_MS);
    }
    async #getTipAccounts() {
        const response = await httpJson(this.cfg.JITO_URL, this.cfg.RPC_TIMEOUT_MS, {
            method: 'POST', headers: { 'content-type': 'application/json', ...(this.cfg.JITO_AUTH ? { 'x-jito-auth': this.cfg.JITO_AUTH } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
        });
        if (response.error || response.result === undefined)
            throw new Error('Jito rejected request');
        return response.result;
    }
    async warm() {
        const accounts = await this.#getTipAccounts();
        if (!Array.isArray(accounts) || !accounts.length)
            throw new Error('Jito returned no tip accounts');
        this.tips = accounts.map(s => new PublicKey(s));
        await this.refreshFloor();
    }
    async refreshFloor() {
        if (Date.now() - this.tipAt < 10_000)
            return;
        try {
            const rows = await httpJson('https://bundles.jito.wtf/api/v1/bundles/tip_floor', this.cfg.RPC_TIMEOUT_MS);
            const sol = Number(rows[0]?.landed_tips_75th_percentile);
            if (!Number.isFinite(sol) || sol < 0)
                throw new Error('invalid tip floor');
            this.floor = Math.ceil(sol * 1e9);
            this.tipAt = Date.now();
        }
        catch {
            this.floor = this.cfg.MIN_TIP_LAMPORTS;
        }
    }
    tip(panic) { return Math.min(this.cfg.MAX_TIP_LAMPORTS, Math.max(this.cfg.MIN_TIP_LAMPORTS, this.floor * (panic ? 2 : 1))); }
    async graduatedSell(mint, amount, slippage) {
        if (!this.cfg.JUPITER_URL)
            throw new Error('Jupiter routing adapter is not explicitly configured');
        if (!this.cfg.JUPITER_API_KEY)
            throw new Error('Jupiter Swap API V2 requires an explicitly configured API key');
        if (amount <= 0n || !Number.isSafeInteger(slippage) || slippage < 0 || slippage > 10_000)
            throw new Error('invalid Jupiter quote inputs');
        const headers = { 'content-type': 'application/json', 'x-api-key': this.cfg.JUPITER_API_KEY };
        const url = new URL(`${this.cfg.JUPITER_URL.replace(/\/+$/, '')}/build`);
        url.search = new URLSearchParams({
            inputMint: mint,
            outputMint: NATIVE_MINT.toBase58(),
            amount: String(amount),
            taker: this.key.publicKey.toBase58(),
            slippageBps: String(slippage),
            maxAccounts: '32',
        }).toString();
        const build = await httpJson(url.toString(), this.cfg.RPC_TIMEOUT_MS, { headers });
        const isIntegerString = (value) => typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value);
        if (!build || build.inputMint !== mint || build.outputMint !== NATIVE_MINT.toBase58() || build.swapMode !== 'ExactIn' ||
            !isIntegerString(build.inAmount) || BigInt(build.inAmount) !== amount || !isIntegerString(build.outAmount) || BigInt(build.outAmount) <= 0n ||
            !isIntegerString(build.otherAmountThreshold) || BigInt(build.otherAmountThreshold) <= 0n || BigInt(build.otherAmountThreshold) > BigInt(build.outAmount) ||
            build.slippageBps !== slippage || !Array.isArray(build.setupInstructions) || !Array.isArray(build.computeBudgetInstructions) ||
            !Array.isArray(build.otherInstructions) || !build.swapInstruction || build.tipInstruction != null || build.otherInstructions.length !== 0 ||
            !Array.isArray(build.routePlan) || build.routePlan.length === 0 || build.routePlan.length > 32 ||
            !build.blockhashWithMetadata || !Array.isArray(build.blockhashWithMetadata.blockhash) || build.blockhashWithMetadata.blockhash.length !== 32 ||
            build.blockhashWithMetadata.blockhash.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
            !Number.isSafeInteger(build.blockhashWithMetadata.lastValidBlockHeight) || build.blockhashWithMetadata.lastValidBlockHeight <= 0) {
            throw new Error('invalid or unsupported Jupiter V2 build response');
        }
        const quoteTimestamp = Date.now();
        // Jupiter's threshold is the executable minimum. Validate it against the
        // requested tolerance with integer rounding, then preserve that exact
        // provider bound for paper settlement instead of recomputing a second one.
        const minimumOutput = BigInt(build.otherAmountThreshold);
        if (minimumOutput !== mulBps(BigInt(build.outAmount), 10_000 - slippage))
            throw new Error('invalid Jupiter V2 minimum output');
        const decode = (x) => {
            if (!x || typeof x !== 'object' || typeof x.programId !== 'string' || typeof x.data !== 'string' ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x.data) || !Array.isArray(x.accounts) || x.accounts.length > 64) {
                throw new Error('unsupported Jupiter V2 instruction response');
            }
            const data = Buffer.from(x.data, 'base64');
            if (data.toString('base64') !== x.data)
                throw new Error('unsupported Jupiter V2 instruction response');
            return new TransactionInstruction({ programId: new PublicKey(x.programId), data, keys: x.accounts.map((a) => {
                    if (!a || typeof a.pubkey !== 'string' || typeof a.isSigner !== 'boolean' || typeof a.isWritable !== 'boolean')
                        throw new Error('unsupported Jupiter V2 account response');
                    return { pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable };
                }) });
        };
        const computeBudget = build.computeBudgetInstructions.map(decode);
        for (const ix of computeBudget) {
            if (!ix.programId.equals(COMPUTE_BUDGET_PROGRAM) || ix.keys.length !== 0 || ix.data.length !== 9 || ix.data[0] !== 3) {
                throw new Error('unsupported Jupiter V2 compute budget instruction');
            }
            const microLamports = ix.data.readBigUInt64LE(1);
            if ((microLamports * 1400000n + 999999n) / 1000000n > BigInt(this.cfg.MAX_PRIORITY_LAMPORTS)) {
                throw new Error('Jupiter V2 priority fee exceeds configured cap');
            }
        }
        const setup = build.setupInstructions.map(decode);
        if (setup.some(ix => !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) || !ix.keys[0]?.pubkey.equals(this.key.publicKey) || !ix.keys[2]?.pubkey.equals(this.key.publicKey)))
            throw new Error('unexpected Jupiter setup');
        const swap = decode(build.swapInstruction);
        if (!swap.programId.equals(JUPITER_PROGRAM) || swap.keys.some(k => k.isSigner && !k.pubkey.equals(this.key.publicKey)))
            throw new Error('unexpected Jupiter swap signer/program');
        validateJupiterExactInInstruction(swap.data, amount, BigInt(build.outAmount), slippage);
        const instructions = [...setup, swap];
        if (build.cleanupInstruction) {
            const cleanup = decode(build.cleanupInstruction);
            const nativeAta = getAssociatedTokenAddressSync(NATIVE_MINT, this.key.publicKey);
            if (!cleanup.programId.equals(TOKEN_PROGRAM_ID) || cleanup.data.length !== 1 || cleanup.data[0] !== 9 || !cleanup.keys[0]?.pubkey.equals(nativeAta) || !cleanup.keys[1]?.pubkey.equals(this.key.publicKey) || !cleanup.keys[2]?.pubkey.equals(this.key.publicKey))
                throw new Error('unexpected Jupiter cleanup');
            instructions.push(cleanup);
        }
        const lookupTables = build.addressesByLookupTableAddress;
        if (lookupTables !== null && (typeof lookupTables !== 'object' || Array.isArray(lookupTables)))
            throw new Error('invalid Jupiter V2 lookup table response');
        const alts = await Promise.all(Object.entries(lookupTables ?? {}).map(async ([address, addresses]) => {
            if (!Array.isArray(addresses) || addresses.length > 256 || addresses.some(value => typeof value !== 'string'))
                throw new Error('invalid Jupiter V2 lookup table addresses');
            const table = await this.rpc.connection.getAddressLookupTable(new PublicKey(address));
            if (!table.value)
                throw new Error('missing lookup table');
            const liveAddresses = new Set(table.value.state.addresses.map(value => value.toBase58()));
            if (addresses.some(value => !liveAddresses.has(value)))
                throw new Error('Jupiter V2 lookup table contents changed');
            return table.value;
        }));
        return {
            instructions: [...computeBudget, ...instructions],
            alts,
            output: BigInt(build.outAmount),
            minimumOutput,
            quoteTimestamp,
            lastValidBlockHeight: build.blockhashWithMetadata.lastValidBlockHeight,
        };
    }
    /** Paper-only compatibility builder; direct live authority is quarantined. */
    async build(s, side, amount, creator, stage, reason, panic) {
        this.#assertPaperBuild();
        if (Date.now() - s.at > this.cfg.QUOTE_MAX_AGE_MS)
            throw new Error('quote expired');
        const slippage = panic ? this.cfg.PANIC_SLIPPAGE_BPS : this.cfg.SLIPPAGE_BPS;
        let instructions, alts = [];
        let output;
        let minimumOutput;
        let quoteTimestamp = s.at;
        let lastValidBlockHeight = 0;
        if (s.curve.complete) {
            if (side === 'buy')
                throw new Error('graduated entries disabled');
            const route = await this.graduatedSell(s.mint.toBase58(), amount, slippage);
            if (Date.now() - s.at > this.cfg.QUOTE_MAX_AGE_MS)
                throw new Error('quote expired');
            instructions = route.instructions;
            alts = route.alts;
            output = route.output;
            minimumOutput = route.minimumOutput;
            quoteTimestamp = route.quoteTimestamp;
            lastValidBlockHeight = route.lastValidBlockHeight;
        }
        else {
            output = side === 'buy' ? this.market.buyQuote(s, amount) : this.market.sellQuote(s, amount);
            if (output <= 0n)
                throw new Error('zero executable output');
            const shared = { global: s.global, bondingCurveAccountInfo: s.info, bondingCurve: s.curve, mint: s.mint, user: this.key.publicKey, tokenProgram: s.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, slippage: 0 };
            // Apply integer basis points ourselves; SDK slippage parameters are percentages.
            if (side === 'buy')
                instructions = await PUMP_SDK.buyV2Instructions({ ...shared, associatedUserAccountInfo: s.ata, amount: new BN(String(mulBps(output, 10_000 - slippage))), quoteAmount: new BN(String(amount)) });
            else
                instructions = await PUMP_SDK.sellV2Instructions({ ...shared, amount: new BN(String(amount)), quoteAmount: new BN(String(mulBps(output, 10_000 - slippage))) });
        }
        // The caller-owned config may change while route/SDK work is awaiting.
        this.#assertPaperBuild();
        const tip = this.tip(panic);
        const baseFee = 5000n;
        const fee = BigInt(tip + this.cfg.MAX_PRIORITY_LAMPORTS) + baseFee;
        const executedSol = side === 'sell' ? (minimumOutput ?? mulBps(output, 10_000 - slippage)) : 0n;
        const slippageLamports = side === 'sell' ? output - executedSol : 0n;
        return {
            pending: { id: randomUUID(), mint: s.mint.toBase58(), side, signature: 'paper', wire: '', lastValidBlockHeight, created: Date.now(), creator, tokenProgram: s.tokenProgram.toBase58(), stage, reserve: s.curve.realQuoteReserves.toString(), reason, requested: String(amount), creatorTokens: s.creatorTokens },
            tokenDelta: side === 'buy' ? mulBps(output, 10_000 - slippage) : -amount,
            solDelta: side === 'buy' ? -amount - fee - 3000000n : executedSol - fee,
            quotedOutput: output,
            quoteTimestamp,
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
    #assertPaperBuild() {
        if (this.cfg.MODE !== 'paper') {
            throw new Error('QUARANTINED_LEGACY_EXECUTION: Direct Executor live builds are quarantined. Live execution is unavailable; CertifiedLiveExecutionCoordinator signing and submission are also quarantined.');
        }
    }
    /** No direct submission is permitted, including paper mode and identical-wire retries. */
    async broadcast(_order) {
        throw new Error('QUARANTINED_LEGACY_BROADCAST: Direct Executor broadcast is quarantined. Live submission is unavailable; CertifiedLiveExecutionCoordinator signing and submission are also quarantined.');
    }
    async reconcile(order, bundleId) {
        if (bundleId) {
            const report = await this.jitoCoordinator.checkInflightStatus(bundleId, order.signature);
            if (report.status === 'AUCTION_LOST' || report.status === 'SIMULATION_FAILED') {
                // Relay status is useful diagnostics, but only finalized chain evidence
                // can decide whether this signature failed or landed.
                log('jito_bundle_terminal_observation', { bundleId, signature: order.signature, status: report.status, reason: report.failureReason });
            }
        }
        const results = await Promise.allSettled(this.rpc.endpoints.map(async (c) => {
            // The pinned web3.js 1.98.4 decoder supports legacy/v0 only.
            // A v1 response must remain unresolved until a v1-capable reader is adopted.
            const tx = await c.getTransaction(order.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
            const height = tx ? 0 : await c.getBlockHeight('finalized');
            return { tx, height };
        }));
        const found = results.flatMap(r => r.status === 'fulfilled' && r.value.tx ? [r.value.tx] : []);
        if (found.length) {
            // A single RPC result, missing endpoint, or found/not-found disagreement
            // is insufficient to mutate the local economic ledger.
            if (found.length !== results.length || found.length < 2)
                return { status: 'pending' };
            if (found.some(tx => !isFinalizedTransactionFor(tx, order.signature)))
                return { status: 'pending' };
            const first = found[0];
            if (first.meta.err !== null) {
                const encodedError = safeJson(first.meta.err);
                const fee = first.meta.fee;
                if (encodedError === null || first.meta.err === undefined || !Number.isSafeInteger(fee) || fee < 0 || found.some(tx => tx.meta.err === null || safeJson(tx.meta.err) !== encodedError || tx.meta.fee !== fee))
                    return { status: 'pending' };
                return { status: 'failed', fee: BigInt(fee) };
            }
            const firstOutcome = finalizedEconomicSnapshot(first);
            if (firstOutcome === null || found.some(tx => tx.meta.err !== null || finalizedEconomicSnapshot(tx) !== firstOutcome))
                return { status: 'pending' };
            try {
                const deltas = found.map(tx => transactionDeltas(tx, this.key.publicKey.toBase58(), order.mint, order.signature));
                const firstDelta = deltas[0];
                if (deltas.some(delta => delta.solDelta !== firstDelta.solDelta || delta.tokenDelta !== firstDelta.tokenDelta))
                    return { status: 'pending' };
                return { status: 'filled', ...firstDelta };
            }
            catch {
                return { status: 'pending' };
            }
        }
        if (results.length > 0 && results.every(r => r.status === 'fulfilled' && Number.isSafeInteger(r.value.height) && r.value.height > order.lastValidBlockHeight + 32))
            return { status: 'expired' };
        return { status: 'pending' };
    }
}
function safeJson(value) {
    try {
        return JSON.stringify(value) ?? null;
    }
    catch {
        return null;
    }
}
function isFinalizedTransactionFor(tx, signature) {
    return !!tx && Array.isArray(tx.transaction?.signatures) && tx.transaction.signatures[0] === signature &&
        Number.isSafeInteger(tx.slot) && tx.slot > 0 && !!tx.meta &&
        Object.prototype.hasOwnProperty.call(tx.meta, 'err') && tx.meta.err !== undefined;
}
function finalizedEconomicSnapshot(tx) {
    try {
        const meta = tx.meta;
        return canonicalJson({
            signature: tx.transaction.signatures[0], slot: tx.slot, error: meta.err, fee: meta.fee,
            preBalances: meta.preBalances, postBalances: meta.postBalances,
            preTokenBalances: meta.preTokenBalances, postTokenBalances: meta.postTokenBalances,
            loadedAddresses: meta.loadedAddresses,
        });
    }
    catch {
        return null;
    }
}
export function transactionDeltas(tx, wallet, mint, expectedSignature) {
    if (!tx.meta || tx.meta.err !== null || (expectedSignature !== undefined && tx.transaction.signatures[0] !== expectedSignature)) {
        throw new Error('missing successful transaction metadata or signature mismatch');
    }
    const report = AssetDeltaEngine.computeAssetDeltas(tx, wallet, mint);
    if (!report.isConservationValid)
        throw new Error('transaction balance conservation failed');
    return { tokenDelta: report.tokenDelta, solDelta: report.grossSolDelta };
}
//# sourceMappingURL=execution.js.map