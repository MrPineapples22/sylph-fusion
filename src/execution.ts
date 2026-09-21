import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, TransactionInstruction, type AddressLookupTableAccount, type VersionedTransactionResponse } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';
import { randomUUID } from 'node:crypto';
import { httpJson, RpcPool } from './rpc.js';
import { Market, type Snapshot } from './market.js';
import { ceilDiv, log, mulBps, type Pending } from './core.js';
import type { Config } from './config.js';

const JUPITER_PROGRAM = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
export type Built = {
  pending: Pending;
  tokenDelta: bigint;
  solDelta: bigint;
  quotedOutput?: bigint;
  quoteTimestamp?: number;
  overhead?: {
    tipLamports: string;
    priorityLamports: string;
    rentLamports: string;
    slippageBps: number;
    slippageLamports?: string;
    baseFeeLamports?: string;
  };
};
export class Executor {
  private tips: PublicKey[] = [];
  private tipAt = 0;
  private floor = 0;
  private lastSubmit = 0;
  constructor(readonly cfg: Config, readonly rpc: RpcPool, readonly market: Market, readonly key: Keypair) {}
  private async jito<T>(method: string, params: unknown[]): Promise<T> {
    const response = await httpJson<{ result?: T; error?: unknown }>(this.cfg.JITO_URL, this.cfg.RPC_TIMEOUT_MS, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(this.cfg.JITO_AUTH ? { 'x-jito-auth': this.cfg.JITO_AUTH } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (response.error || response.result === undefined) throw new Error('Jito rejected request');
    return response.result;
  }
  async warm() {
    const accounts = await this.jito<string[]>('getTipAccounts', []);
    if (!Array.isArray(accounts) || !accounts.length) throw new Error('Jito returned no tip accounts');
    this.tips = accounts.map(s => new PublicKey(s));
    await this.refreshFloor();
  }
  async refreshFloor() {
    if (Date.now() - this.tipAt < 10_000) return;
    try {
      const rows = await httpJson<any[]>('https://bundles.jito.wtf/api/v1/bundles/tip_floor', this.cfg.RPC_TIMEOUT_MS);
      const sol = Number(rows[0]?.landed_tips_75th_percentile);
      if (!Number.isFinite(sol) || sol < 0) throw new Error('invalid tip floor');
      this.floor = Math.ceil(sol * 1e9); this.tipAt = Date.now();
    } catch { this.floor = this.cfg.MIN_TIP_LAMPORTS; }
  }
  private tip(panic: boolean) { return Math.min(this.cfg.MAX_TIP_LAMPORTS, Math.max(this.cfg.MIN_TIP_LAMPORTS, this.floor * (panic ? 2 : 1))); }
  async graduatedSell(mint: string, amount: bigint, slippage: number): Promise<{ instructions: TransactionInstruction[]; alts: AddressLookupTableAccount[]; output: bigint }> {
    const headers = { 'content-type': 'application/json', ...(this.cfg.JUPITER_API_KEY ? { 'x-api-key': this.cfg.JUPITER_API_KEY } : {}) };
    const url = `${this.cfg.JUPITER_URL}/quote?inputMint=${mint}&outputMint=${NATIVE_MINT}&amount=${amount}&slippageBps=${slippage}&restrictIntermediateTokens=true&maxAccounts=32`;
    const quote = await httpJson<any>(url, this.cfg.RPC_TIMEOUT_MS, { headers });
    if (quote.inputMint !== mint || quote.outputMint !== NATIVE_MINT.toBase58() || quote.swapMode !== 'ExactIn' || BigInt(quote.inAmount) !== amount || BigInt(quote.outAmount) <= 0n || BigInt(quote.otherAmountThreshold) < mulBps(BigInt(quote.outAmount), 10_000 - slippage)) throw new Error('invalid Jupiter quote');
    const result = await httpJson<any>(`${this.cfg.JUPITER_URL}/swap-instructions`, this.cfg.RPC_TIMEOUT_MS, { method: 'POST', headers,
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: this.key.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: false, useSharedAccounts: false }) });
    if (result.error || !result.swapInstruction || (result.otherInstructions?.length ?? 0) > 0 || result.tokenLedgerInstruction) throw new Error('unsupported Jupiter instruction response');
    const decode = (x: any) => new TransactionInstruction({ programId: new PublicKey(x.programId), data: Buffer.from(x.data, 'base64'), keys: x.accounts.map((a: any) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })) });
    const setup: TransactionInstruction[] = (result.setupInstructions ?? []).map(decode);
    if (setup.some(ix => !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) || !ix.keys[0]?.pubkey.equals(this.key.publicKey) || !ix.keys[2]?.pubkey.equals(this.key.publicKey))) throw new Error('unexpected Jupiter setup');
    const swap = decode(result.swapInstruction);
    if (!swap.programId.equals(JUPITER_PROGRAM) || swap.keys.some(k => k.isSigner && !k.pubkey.equals(this.key.publicKey))) throw new Error('unexpected Jupiter swap signer/program');
    const instructions = [...setup, swap];
    if (result.cleanupInstruction) {
      const cleanup = decode(result.cleanupInstruction);
      const nativeAta = getAssociatedTokenAddressSync(NATIVE_MINT, this.key.publicKey);
      if (!cleanup.programId.equals(TOKEN_PROGRAM_ID) || cleanup.data.length !== 1 || cleanup.data[0] !== 9 || !cleanup.keys[0]?.pubkey.equals(nativeAta) || !cleanup.keys[1]?.pubkey.equals(this.key.publicKey) || !cleanup.keys[2]?.pubkey.equals(this.key.publicKey)) throw new Error('unexpected Jupiter cleanup');
      instructions.push(cleanup);
    }
    const alts = await Promise.all((result.addressLookupTableAddresses ?? []).map(async (address: string) => {
      const table = await this.rpc.connection.getAddressLookupTable(new PublicKey(address));
      if (!table.value) throw new Error('missing lookup table');
      return table.value;
    }));
    return { instructions, alts, output: BigInt(quote.outAmount) };
  }
  async build(s: Snapshot, side: 'buy' | 'sell', amount: bigint, creator: string, stage: number, reason: string, panic: boolean): Promise<Built> {
    const started = performance.now(), slippage = panic ? this.cfg.PANIC_SLIPPAGE_BPS : this.cfg.SLIPPAGE_BPS;
    let instructions: TransactionInstruction[], alts: AddressLookupTableAccount[] = [];
    let output: bigint;
    if (s.curve.complete) {
      if (side === 'buy') throw new Error('graduated entries disabled');
      const route = await this.graduatedSell(s.mint.toBase58(), amount, slippage);
      instructions = route.instructions; alts = route.alts; output = route.output;
    } else {
      output = side === 'buy' ? this.market.buyQuote(s, amount) : this.market.sellQuote(s, amount);
      if (output <= 0n) throw new Error('zero executable output');
      const shared = { global: s.global, bondingCurveAccountInfo: s.info, bondingCurve: s.curve, mint: s.mint, user: this.key.publicKey, tokenProgram: s.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, slippage: 0 };
      // Apply integer basis points ourselves; SDK slippage parameters are percentages.
      if (side === 'buy') instructions = await PUMP_SDK.buyV2Instructions({ ...shared, associatedUserAccountInfo: s.ata, amount: new BN(String(mulBps(output, 10_000 - slippage))), quoteAmount: new BN(String(amount)) });
      else instructions = await PUMP_SDK.sellV2Instructions({ ...shared, amount: new BN(String(amount)), quoteAmount: new BN(String(mulBps(output, 10_000 - slippage))) });
    }
    const tip = this.tip(panic);
    if (this.cfg.MODE === 'paper') {
      const baseFee = 5000n;
      const fee = BigInt(tip + this.cfg.MAX_PRIORITY_LAMPORTS) + baseFee;
      const executedSol = side === 'sell' ? mulBps(output, 10_000 - slippage) : 0n;
      const slippageLamports = side === 'sell' ? output - executedSol : 0n;
      return {
        pending: { id: randomUUID(), mint: s.mint.toBase58(), side, signature: 'paper', wire: '', lastValidBlockHeight: 0, created: Date.now(), creator, tokenProgram: s.tokenProgram.toBase58(), stage, reserve: s.curve.realQuoteReserves.toString(), reason, requested: String(amount), creatorTokens: s.creatorTokens },
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
    if (!this.tips.length) throw new Error('Jito not initialized');
    instructions.push(SystemProgram.transfer({ fromPubkey: this.key.publicKey, toPubkey: this.tips[Math.floor(Math.random() * this.tips.length)], lamports: tip }));
    const c = this.rpc.connection;
    const [hash, recent] = await Promise.all([
      c.getLatestBlockhashAndContext({ commitment: 'confirmed', minContextSlot: s.slot }),
      c.getRecentPrioritizationFees({ lockedWritableAccounts: [s.mint, this.key.publicKey] }).catch(() => []),
    ]);
    const samples = recent.map(x => x.prioritizationFee).filter(x => Number.isSafeInteger(x) && x >= 0).sort((a, b) => a - b);
    const suggested = BigInt(samples[Math.floor(samples.length * 0.75)] ?? 1000) * BigInt(panic ? 2 : 1);
    const make = (units: number, price: bigint) => {
      const msg = new TransactionMessage({ payerKey: this.key.publicKey, recentBlockhash: hash.value.blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ...instructions] }).compileToV0Message(alts);
      const tx = new VersionedTransaction(msg); tx.sign([this.key]); return tx;
    };
    const draft = make(1_400_000, 1n);
    const simulation = await c.simulateTransaction(draft, { sigVerify: true, commitment: 'confirmed', minContextSlot: s.slot });
    if (simulation.value.err || !simulation.value.unitsConsumed) throw new Error('transaction simulation failed');
    const units = Math.ceil(simulation.value.unitsConsumed * 1.15) + 1000;
    if (units > 1_400_000) throw new Error('compute budget exceeds chain limit');
    const maxPrice = BigInt(this.cfg.MAX_PRIORITY_LAMPORTS) * 1_000_000n / BigInt(units);
    const price = suggested > maxPrice ? maxPrice : suggested;
    const transaction = make(units, price), wire = Buffer.from(transaction.serialize()).toString('base64');
    if (Buffer.from(wire, 'base64').length > 1232) throw new Error('transaction exceeds packet limit');
    if (Date.now() - s.at > this.cfg.QUOTE_MAX_AGE_MS) throw new Error('quote expired during build');
    log('transaction_prepared', { side, computeUnits: units, priorityLamports: String(ceilDiv(price * BigInt(units), 1_000_000n)), tipLamports: tip, buildMs: Math.round(performance.now() - started) });
    return {
      pending: { id: randomUUID(), mint: s.mint.toBase58(), side, signature: bs58.encode(transaction.signatures[0]), wire, lastValidBlockHeight: hash.value.lastValidBlockHeight, created: Date.now(), creator, tokenProgram: s.tokenProgram.toBase58(), stage, reserve: s.curve.realQuoteReserves.toString(), reason, requested: String(amount), creatorTokens: s.creatorTokens },
      tokenDelta: 0n,
      solDelta: 0n,
      quotedOutput: output,
      quoteTimestamp: s.at,
      overhead: {
        tipLamports: String(tip),
        priorityLamports: String(ceilDiv(price * BigInt(units), 1_000_000n)),
        rentLamports: side === 'buy' ? '3000000' : '0',
        slippageBps: slippage,
      },
    };
  }
  async broadcast(order: Pending) {
    if (Date.now() - this.lastSubmit < 2000) return;
    this.lastSubmit = Date.now();
    // Retry only these exact signed bytes. A timeout does not authorize another economic order.
    try { const bundleId = await this.jito<string>('sendBundle', [[order.wire], { encoding: 'base64' }]); log('bundle_accepted', { signature: order.signature, bundleId }); }
    catch { log('bundle_submission_uncertain', { signature: order.signature }); }
  }
  async reconcile(order: Pending): Promise<{ status: 'pending' | 'expired' | 'failed'; fee?: bigint } | { status: 'filled'; tokenDelta: bigint; solDelta: bigint }> {
    const results = await Promise.allSettled(this.rpc.endpoints.map(async c => {
      const tx = await c.getTransaction(order.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      const height = tx ? 0 : await c.getBlockHeight('finalized');
      return { tx, height };
    }));
    const found = results.flatMap(r => r.status === 'fulfilled' && r.value.tx ? [r.value.tx] : []);
    if (found.length) {
      const tx = found[0];
      if (!tx.meta) return { status: 'pending' };
      if (tx.meta.err) return { status: 'failed', fee: BigInt(tx.meta.fee) };
      const delta = transactionDeltas(tx, this.key.publicKey.toBase58(), order.mint);
      return { status: 'filled', ...delta };
    }
    if (results.every(r => r.status === 'fulfilled' && r.value.height > order.lastValidBlockHeight + 32)) return { status: 'expired' };
    return { status: 'pending' };
  }
}
export function transactionDeltas(tx: VersionedTransactionResponse, wallet: string, mint: string): { tokenDelta: bigint; solDelta: bigint } {
  const meta = tx.meta;
  if (!meta || meta.err) throw new Error('missing successful transaction metadata');
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
  const index = [...Array(keys.length).keys()].find(i => keys.get(i)?.toBase58() === wallet);
  if (index === undefined || !Number.isSafeInteger(meta.preBalances[index]) || !Number.isSafeInteger(meta.postBalances[index])) throw new Error('invalid wallet balance metadata');
  const sum = (rows: typeof meta.preTokenBalances) => (rows ?? []).filter(r => r.owner === wallet && r.mint === mint).reduce((n, r) => n + BigInt(r.uiTokenAmount.amount), 0n);
  return { tokenDelta: sum(meta.postTokenBalances) - sum(meta.preTokenBalances), solDelta: BigInt(meta.postBalances[index]) - BigInt(meta.preBalances[index]) };
}
