import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, unpackMint, unpackAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getExtensionTypes, ExtensionType } from '@solana/spl-token';
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, bondingCurvePda, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, computeFeesBps, type BondingCurve, type Global, type FeeConfig } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { RpcPool, httpJson } from './rpc.js';
import type { Config } from './config.js';
import { mulBps } from './core.js';
import { PostGraduationAmmBridge } from './platform/execution/solaris/amm-bridge.js';

export type Snapshot = { mint: PublicKey; tokenProgram: PublicKey; supply: bigint; curve: BondingCurve; global: Global; fee: FeeConfig; info: AccountInfo<Buffer>; ata: AccountInfo<Buffer> | null; slot: number; at: number; creatorTokens?: string; entrySafe: boolean };
export class Market {
  private latestSlot = 0;
  readonly ammBridge = new PostGraduationAmmBridge();
  constructor(readonly rpc: RpcPool, readonly cfg: Config, readonly wallet: PublicKey) {}
  async snapshot(mint: string, minSlot = 0): Promise<Snapshot> {
    const key = new PublicKey(mint), c = this.rpc.connection;
    const first = await c.getAccountInfo(key, 'confirmed');
    if (!first || (!first.owner.equals(TOKEN_PROGRAM_ID) && !first.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('unsupported mint owner');
    const tokenProgram = first.owner;
    const result = await c.getMultipleAccountsInfoAndContext([key, bondingCurvePda(key), GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, getAssociatedTokenAddressSync(key, this.wallet, false, tokenProgram)], { commitment: 'confirmed', minContextSlot: Math.max(this.latestSlot, minSlot - 2, 0) });
    this.latestSlot = Math.max(this.latestSlot, result.context.slot);
    const [mintInfo, curveInfo, globalInfo, feeInfo, ata] = result.value;
    if (!mintInfo || !curveInfo || !globalInfo || !feeInfo || !mintInfo.owner.equals(tokenProgram) || !curveInfo.owner.equals(PUMP_PROGRAM_ID) || !globalInfo.owner.equals(PUMP_PROGRAM_ID) || !feeInfo.owner.equals(PUMP_FEE_PROGRAM_ID)) throw new Error('invalid snapshot account ownership');
    const mintState = unpackMint(key, mintInfo, tokenProgram);
    if (!mintState.isInitialized || mintState.supply <= 0n) throw new Error('invalid mint');
    const allowed = [ExtensionType.MetadataPointer, ExtensionType.TokenMetadata];
    const entrySafe = !mintState.mintAuthority && !mintState.freezeAuthority && !getExtensionTypes(mintState.tlvData).some(t => !allowed.includes(t));
    const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
    if (!curve.quoteMint.equals(PublicKey.default)) throw new Error('only native SOL curves supported');
    return { mint: key, tokenProgram, supply: mintState.supply, curve, global: PUMP_SDK.decodeGlobal(globalInfo), fee: PUMP_SDK.decodeFeeConfig(feeInfo), info: curveInfo, ata, slot: result.context.slot, at: Date.now(), entrySafe };
  }
  buyQuote(s: Snapshot, lamports: bigint): bigint {
    if (lamports <= 0n || s.supply <= 0n || BigInt(s.curve.virtualQuoteReserves.toString()) <= 0n || BigInt(s.curve.virtualTokenReserves.toString()) <= 0n) throw new Error('invalid buy quote inputs');
    return BigInt(getBuyTokenAmountFromSolAmount({ global: s.global, feeConfig: s.fee, mintSupply: new BN(String(s.supply)), bondingCurve: s.curve, amount: new BN(String(lamports)), quoteMint: PublicKey.default }).toString());
  }
  sellQuote(s: Snapshot, tokens: bigint): bigint {
    if (tokens <= 0n || s.supply <= 0n || BigInt(s.curve.virtualQuoteReserves.toString()) <= 0n || BigInt(s.curve.virtualTokenReserves.toString()) <= 0n) throw new Error('invalid sell quote inputs');
    return BigInt(getSellSolAmountFromTokenAmount({ global: s.global, feeConfig: s.fee, mintSupply: new BN(String(s.supply)), bondingCurve: s.curve, amount: new BN(String(tokens)) }).toString());
  }
  validateEntry(s: Snapshot): void {
    if (!s.entrySafe) throw new Error('active authority or unsupported extension');
    if (s.curve.complete) {
      this.ammBridge.registerMigration(s.mint.toBase58(), s.slot);
      throw new Error('unsupported curve mode');
    }
    if (s.curve.isMayhemMode || s.curve.isHolderReward) throw new Error('unsupported curve mode');
    if (BigInt(s.curve.realQuoteReserves.toString()) < BigInt(this.cfg.MIN_REAL_RESERVE_LAMPORTS)) throw new Error('insufficient real reserves');
    const fees = computeFeesBps({ global: s.global, feeConfig: s.fee, mintSupply: new BN(String(s.supply)), virtualQuoteReserves: s.curve.virtualQuoteReserves, virtualTokenReserves: s.curve.virtualTokenReserves, quoteMint: s.curve.quoteMint, creatorFeeBps: s.curve.creatorFeeBps });
    if (fees.protocolFeeBps.add(fees.creatorFeeBps).gtn(this.cfg.MAX_FEE_BPS)) throw new Error('fee cap exceeded');
    const input = BigInt(this.cfg.BUY_LAMPORTS), output = this.buyQuote(s, input);
    const spotOutput = input * BigInt(s.curve.virtualTokenReserves.toString()) / BigInt(s.curve.virtualQuoteReserves.toString());
    if (output <= 0n || output < mulBps(spotOutput, 10_000 - this.cfg.MAX_IMPACT_BPS)) throw new Error('entry impact exceeds cap');
  }
  async safety(s: Snapshot, creator: string): Promise<void> {
    this.validateEntry(s);
    if (!this.cfg.RUGCHECK_URL) throw new Error('RUGCHECK_ADAPTER_CONFIGURATION_UNAVAILABLE');
    const owner = new PublicKey(creator), c = this.rpc.connection;
    const [balance, held, largest, report] = await Promise.all([
      c.getBalance(owner, 'confirmed'),
      c.getTokenAccountsByOwner(owner, { mint: s.mint }, 'confirmed'),
      c.getTokenLargestAccounts(s.mint, 'confirmed'),
      httpJson<any>(`${this.cfg.RUGCHECK_URL}/${s.mint}/report`, this.cfg.RPC_TIMEOUT_MS),
    ]);
    if (balance < this.cfg.MIN_CREATOR_LAMPORTS) throw new Error('creator SOL balance below minimum');
    const heldAmount = held.value.reduce((a, row) => a + unpackAccount(row.pubkey, row.account, s.tokenProgram).amount, 0n);
    s.creatorTokens = String(heldAmount);
    if (heldAmount > mulBps(s.supply, this.cfg.MAX_CREATOR_BPS)) throw new Error('creator concentration');
    if (!report || typeof report.score !== 'number' || !Number.isFinite(report.score) || !Array.isArray(report.risks)) throw new Error('unknown rug report');
    if (report.rugged === true || report.score > this.cfg.RUGCHECK_MAX_SCORE || report.risks.some((r: any) => /danger|critical/i.test(String(r?.level)))) throw new Error('rug report rejected');
    if (report.token?.mintAuthority || report.token?.freezeAuthority || report.mintAuthority || report.freezeAuthority) throw new Error('mint or freeze authority active');
    const tokenExtensions = report.token_extensions;
    const extensionEntries = Array.isArray(tokenExtensions)
      ? tokenExtensions.map((value: unknown) => ['', value] as const)
      : tokenExtensions && typeof tokenExtensions === 'object'
        ? Object.entries(tokenExtensions as Record<string, unknown>)
        : [];
    const hasUnsafeExtension = extensionEntries.some(([name, value]) =>
      /permanent|transfer.?hook|default.?state/i.test(`${name} ${String(value)}`)
    );
    if (report.transferFee?.pct > 0 || hasUnsafeExtension) throw new Error('unsafe token extension');
    const accounts = largest.value;
    if (!accounts.length) throw new Error('unknown holder distribution');
    const infos = await c.getMultipleAccountsInfo(accounts.map(a => a.address), 'confirmed');
    const buckets = new Map<string, bigint>();
    let observed = 0n;
    const curveAta = getAssociatedTokenAddressSync(s.mint, bondingCurvePda(s.mint), true, s.tokenProgram);
    for (let i = 0; i < accounts.length; i++) {
      if (!infos[i]) throw new Error('missing holder account');
      const a = unpackAccount(accounts[i].address, infos[i]!, s.tokenProgram);
      if (!a.mint.equals(s.mint)) throw new Error('holder mint mismatch');
      observed += a.amount;
      if (accounts[i].address.equals(curveAta) && a.owner.equals(bondingCurvePda(s.mint))) continue;
      const k = a.owner.toBase58(); buckets.set(k, (buckets.get(k) ?? 0n) + a.amount);
    }
    const topTen = [...buckets.values()].sort((a, b) => a > b ? -1 : a < b ? 1 : 0).slice(0, 10).reduce((a, b) => a + b, 0n);
    if (observed > s.supply) throw new Error('inconsistent holder snapshot');
    // Any unobserved balance could belong to a large owner. Count the entire tail
    // against the cap, rather than assuming unlisted accounts are well distributed.
    if (topTen + s.supply - observed > mulBps(s.supply, this.cfg.MAX_TOP_TEN_BPS)) throw new Error('top-holder concentration upper bound');
  }
}
