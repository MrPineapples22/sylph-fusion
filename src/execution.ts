import { JitoLifecycleCoordinator } from './platform/execution/jito-lifecycle-coordinator.js';
import { Keypair, PublicKey, TransactionInstruction, type AddressLookupTableAccount, type VersionedTransactionResponse } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import { randomUUID } from 'node:crypto';
import { httpJson, RpcPool } from './rpc.js';
import { Market, type Snapshot } from './market.js';
import { log, mulBps, type Pending } from './core.js';
import type { Config } from './config.js';
import type { SigningFirewall } from './platform/signing/signing-firewall.js';

const JUPITER_PROGRAM = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

export interface ExecutionSignerGateway {
  readonly publicKey: PublicKey;
  signTransactionMessage(messageBytes: Uint8Array): Promise<Uint8Array>;
}

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
export type BroadcastOutcome = {
  status: 'ACCEPTED' | 'UNKNOWN' | 'NOT_SENT';
  signature: string;
  attemptedAt: number;
  bundleId?: string;
  reason?: string;
};
export class Executor {
  private tips: PublicKey[] = [];
  private tipAt = 0;
  private floor = 0;
  private readonly jitoCoordinator: JitoLifecycleCoordinator;
  constructor(
    readonly cfg: Config,
    readonly rpc: RpcPool,
    readonly market: Market,
    readonly key: Keypair | ExecutionSignerGateway,
    _signingFirewall?: SigningFirewall,
  ) {
    this.jitoCoordinator = new JitoLifecycleCoordinator(this.cfg.JITO_URL, this.cfg.JITO_AUTH, this.cfg.RPC_TIMEOUT_MS);
  }
  async #getTipAccounts(): Promise<string[]> {
    const response = await httpJson<{ result?: string[]; error?: unknown }>(this.cfg.JITO_URL, this.cfg.RPC_TIMEOUT_MS, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(this.cfg.JITO_AUTH ? { 'x-jito-auth': this.cfg.JITO_AUTH } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
    });
    if (response.error || response.result === undefined) throw new Error('Jito rejected request');
    return response.result;
  }
  async warm() {
    const accounts = await this.#getTipAccounts();
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
    if (!this.cfg.JUPITER_URL) throw new Error('Jupiter routing adapter is not explicitly configured');
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
  /** Paper-only compatibility builder; direct live authority is quarantined. */
  async build(s: Snapshot, side: 'buy' | 'sell', amount: bigint, creator: string, stage: number, reason: string, panic: boolean): Promise<Built> {
    this.#assertPaperBuild();
    if (Date.now() - s.at > this.cfg.QUOTE_MAX_AGE_MS) throw new Error('quote expired');
    const slippage = panic ? this.cfg.PANIC_SLIPPAGE_BPS : this.cfg.SLIPPAGE_BPS;
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
    // The caller-owned config may change while route/SDK work is awaiting.
    this.#assertPaperBuild();
    const tip = this.tip(panic);
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
  #assertPaperBuild(): void {
    if (this.cfg.MODE !== 'paper') {
      throw new Error('QUARANTINED_LEGACY_EXECUTION: Direct Executor live builds are quarantined. Live execution is unavailable; CertifiedLiveExecutionCoordinator signing and submission are also quarantined.');
    }
  }
  /** No direct submission is permitted, including paper mode and identical-wire retries. */
  async broadcast(_order: Pending): Promise<BroadcastOutcome> {
    throw new Error('QUARANTINED_LEGACY_BROADCAST: Direct Executor broadcast is quarantined. Live submission is unavailable; CertifiedLiveExecutionCoordinator signing and submission are also quarantined.');
  }
  async reconcile(order: Pending, bundleId?: string): Promise<{ status: 'pending' | 'expired' | 'failed'; fee?: bigint } | { status: 'filled'; tokenDelta: bigint; solDelta: bigint }> {
    if (bundleId) {
      const report = await this.jitoCoordinator.checkInflightStatus(bundleId, order.signature);
      if (report.status === 'AUCTION_LOST' || report.status === 'SIMULATION_FAILED') {
        log('jito_bundle_terminal_drop', { bundleId, reason: report.failureReason });
        return { status: 'failed' };
      }
    }
    const results = await Promise.allSettled(this.rpc.endpoints.map(async c => {
      // Support legacy, v0 and v1 transactions; opt into version 1 on RPC
      const tx = await c.getTransaction(order.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 1 });
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
    if (results.length > 0 && results.every(r => r.status === 'fulfilled' && Number.isSafeInteger(r.value.height) && r.value.height > order.lastValidBlockHeight + 32)) return { status: 'expired' };
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
