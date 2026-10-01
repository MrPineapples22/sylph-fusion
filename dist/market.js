import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, unpackMint, unpackAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getExtensionTypes, ExtensionType } from '@solana/spl-token';
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, bondingCurvePda, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, computeFeesBps } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { httpJson } from './rpc.js';
import { mulBps } from './core.js';
import { PostGraduationAmmBridge } from './platform/execution/solaris/amm-bridge.js';
const UNSAFE_REPORTED_EXTENSION = /permanent.?delegate|transfer.?hook|default(?:account)?.?state/i;
export async function readLargestHolderSnapshot(connection, mint) {
    let largest = await connection.getTokenLargestAccounts(mint, 'confirmed');
    let accountRead = await connection.getMultipleAccountsInfoAndContext(largest.value.map(account => account.address), { commitment: 'confirmed', minContextSlot: largest.context.slot });
    if (accountRead.value.some(account => account === null)) {
        // Largest-account data and account reads are separate RPC calls. Refresh
        // the list once if a listed account closed between those calls; if the
        // second snapshot is still incomplete, the caller remains fail-closed.
        largest = await connection.getTokenLargestAccounts(mint, 'confirmed');
        accountRead = await connection.getMultipleAccountsInfoAndContext(largest.value.map(account => account.address), { commitment: 'confirmed', minContextSlot: largest.context.slot });
    }
    return { accounts: largest.value, infos: accountRead.value, contextSlot: accountRead.context.slot };
}
function hasConfiguredExtensionValue(value) {
    if (value === null || value === undefined || value === false || value === 0)
        return false;
    if (typeof value === 'string')
        return !/^(?:\s*|null|false|0|none|disabled|inactive|uninitialized)$/i.test(value);
    if (Array.isArray(value))
        return value.some(hasConfiguredExtensionValue);
    if (typeof value === 'object')
        return Object.values(value).some(hasConfiguredExtensionValue);
    return true;
}
/** RugCheck serializes known extension fields as null even when those extensions are absent. */
export function hasUnsafeReportedTokenExtension(tokenExtensions) {
    const entries = Array.isArray(tokenExtensions)
        ? tokenExtensions.map((value) => {
            if (typeof value === 'string')
                return [value, true];
            if (value && typeof value === 'object') {
                const name = String(value.name ?? value.type ?? value.extension ?? '');
                const state = value.value ?? value.data ?? value.config ?? true;
                return [name, state];
            }
            return ['', value];
        })
        : tokenExtensions && typeof tokenExtensions === 'object'
            ? Object.entries(tokenExtensions)
            : [];
    return entries.some(([name, value]) => UNSAFE_REPORTED_EXTENSION.test(name) && hasConfiguredExtensionValue(value));
}
export function rugReportRejectionReason(report, maxScore) {
    const reasons = [];
    if (report.rugged === true)
        reasons.push('rugged=true');
    if (report.score > maxScore)
        reasons.push(`score=${report.score}>${maxScore}`);
    const dangerous = report.risks
        .filter((risk) => /danger|critical/i.test(String(risk?.level)))
        .slice(0, 3)
        .map((risk) => String(risk?.name ?? risk?.level ?? 'unnamed').replace(/[\r\n]/g, ' ').slice(0, 60));
    if (dangerous.length)
        reasons.push(`risks=${dangerous.join('|')}`);
    return reasons.length ? `rug report rejected (${reasons.join('; ')})` : null;
}
export function assessFastBoundHolderConcentration(input) {
    const { supply, observedRaw, knownTopTenRaw, maxTopTenBps } = input;
    if (!Number.isInteger(maxTopTenBps) || maxTopTenBps < 0 || maxTopTenBps > 10_000 || supply <= 0n || observedRaw < 0n || knownTopTenRaw < 0n || observedRaw > supply || knownTopTenRaw > observedRaw) {
        throw new Error('inconsistent holder snapshot');
    }
    if (knownTopTenRaw > mulBps(supply, maxTopTenBps)) {
        return { level: 'FAST_BOUND', status: 'UNSAFE', observedRaw, knownTopTenRaw, unknownTailRaw: supply - observedRaw };
    }
    const unknownTailRaw = supply - observedRaw;
    const worstCaseTopTenRaw = knownTopTenRaw + unknownTailRaw;
    const maxAllowedRaw = mulBps(supply, maxTopTenBps);
    // Mathematical proof: Even if 100% of the unobserved tail belonged to the top 10,
    // the resulting concentration cannot exceed maxAllowedRaw.
    const isProvablySafe = worstCaseTopTenRaw <= maxAllowedRaw;
    return {
        level: 'FAST_BOUND',
        status: isProvablySafe ? 'SAFE' : 'AMBIGUOUS',
        observedRaw,
        knownTopTenRaw,
        unknownTailRaw,
    };
}
export class Market {
    rpc;
    cfg;
    wallet;
    latestSlot = 0;
    ammBridge = new PostGraduationAmmBridge();
    constructor(rpc, cfg, wallet) {
        this.rpc = rpc;
        this.cfg = cfg;
        this.wallet = wallet;
    }
    async snapshot(mint, minSlot = 0) {
        const key = new PublicKey(mint), c = this.rpc.connection;
        const first = await c.getAccountInfo(key, 'confirmed');
        if (!first || (!first.owner.equals(TOKEN_PROGRAM_ID) && !first.owner.equals(TOKEN_2022_PROGRAM_ID)))
            throw new Error('unsupported mint owner');
        const tokenProgram = first.owner;
        const result = await c.getMultipleAccountsInfoAndContext([key, bondingCurvePda(key), GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, getAssociatedTokenAddressSync(key, this.wallet, false, tokenProgram)], { commitment: 'confirmed', minContextSlot: Math.max(this.latestSlot, minSlot - 2, 0) });
        this.latestSlot = Math.max(this.latestSlot, result.context.slot);
        const [mintInfo, curveInfo, globalInfo, feeInfo, ata] = result.value;
        if (!mintInfo || !curveInfo || !globalInfo || !feeInfo || !mintInfo.owner.equals(tokenProgram) || !curveInfo.owner.equals(PUMP_PROGRAM_ID) || !globalInfo.owner.equals(PUMP_PROGRAM_ID) || !feeInfo.owner.equals(PUMP_FEE_PROGRAM_ID))
            throw new Error('invalid snapshot account ownership');
        const mintState = unpackMint(key, mintInfo, tokenProgram);
        if (!mintState.isInitialized || mintState.supply <= 0n)
            throw new Error('invalid mint');
        const allowed = [ExtensionType.MetadataPointer, ExtensionType.TokenMetadata];
        const entrySafe = !mintState.mintAuthority && !mintState.freezeAuthority && !getExtensionTypes(mintState.tlvData).some(t => !allowed.includes(t));
        const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
        if (!curve.quoteMint.equals(PublicKey.default))
            throw new Error('only native SOL curves supported');
        return { mint: key, tokenProgram, supply: mintState.supply, curve, global: PUMP_SDK.decodeGlobal(globalInfo), fee: PUMP_SDK.decodeFeeConfig(feeInfo), info: curveInfo, ata, slot: result.context.slot, at: Date.now(), entrySafe };
    }
    buyQuote(s, lamports) {
        if (lamports <= 0n || s.supply <= 0n || BigInt(s.curve.virtualQuoteReserves.toString()) <= 0n || BigInt(s.curve.virtualTokenReserves.toString()) <= 0n)
            throw new Error('invalid buy quote inputs');
        return BigInt(getBuyTokenAmountFromSolAmount({ global: s.global, feeConfig: s.fee, mintSupply: new BN(String(s.supply)), bondingCurve: s.curve, amount: new BN(String(lamports)), quoteMint: PublicKey.default }).toString());
    }
    sellQuote(s, tokens) {
        if (tokens <= 0n || s.supply <= 0n || BigInt(s.curve.virtualQuoteReserves.toString()) <= 0n || BigInt(s.curve.virtualTokenReserves.toString()) <= 0n)
            throw new Error('invalid sell quote inputs');
        return BigInt(getSellSolAmountFromTokenAmount({ global: s.global, feeConfig: s.fee, mintSupply: new BN(String(s.supply)), bondingCurve: s.curve, amount: new BN(String(tokens)) }).toString());
    }
    validateEntry(s) {
        if (!s.entrySafe)
            throw new Error('active authority or unsupported extension');
        if (s.curve.complete) {
            this.ammBridge.registerMigration(s.mint.toBase58(), s.slot);
            throw new Error('unsupported curve mode');
        }
        // Pump SDK v2 supports native-SOL holder-reward curves for both quote
        // calculation and V2 instruction construction. Their rewards are not
        // credited by the paper ledger, so simulated P&L remains conservative.
        // Keep Mayhem curves excluded until their distinct economics are reviewed.
        if (s.curve.isMayhemMode)
            throw new Error('unsupported Mayhem curve mode');
        if (BigInt(s.curve.realQuoteReserves.toString()) < BigInt(this.cfg.MIN_REAL_RESERVE_LAMPORTS))
            throw new Error('insufficient real reserves');
        const fees = computeFeesBps({ global: s.global, feeConfig: s.fee, mintSupply: new BN(String(s.supply)), virtualQuoteReserves: s.curve.virtualQuoteReserves, virtualTokenReserves: s.curve.virtualTokenReserves, quoteMint: s.curve.quoteMint, creatorFeeBps: s.curve.creatorFeeBps });
        if (fees.protocolFeeBps.add(fees.creatorFeeBps).gtn(this.cfg.MAX_FEE_BPS))
            throw new Error('fee cap exceeded');
        const input = BigInt(this.cfg.BUY_LAMPORTS), output = this.buyQuote(s, input);
        const totalFeeBps = BigInt(fees.protocolFeeBps.add(fees.creatorFeeBps).toNumber());
        const netInput = (input * 10000n) / (10000n + totalFeeBps);
        const spotOutput = (netInput * BigInt(s.curve.virtualTokenReserves.toString())) / BigInt(s.curve.virtualQuoteReserves.toString());
        if (output <= 0n || output < mulBps(spotOutput, 10_000 - this.cfg.MAX_IMPACT_BPS))
            throw new Error('entry impact exceeds cap');
    }
    async safety(s, creator) {
        this.validateEntry(s);
        if (!this.cfg.RUGCHECK_URL)
            throw new Error('RUGCHECK_ADAPTER_CONFIGURATION_UNAVAILABLE');
        const owner = new PublicKey(creator), c = this.rpc.connection;
        const [balance, held, holders, report] = await Promise.all([
            c.getBalance(owner, 'confirmed'),
            c.getTokenAccountsByOwner(owner, { mint: s.mint }, 'confirmed'),
            readLargestHolderSnapshot(c, s.mint),
            httpJson(`${this.cfg.RUGCHECK_URL}/${s.mint}/report`, this.cfg.RPC_TIMEOUT_MS),
        ]);
        if (balance < this.cfg.MIN_CREATOR_LAMPORTS)
            throw new Error('creator SOL balance below minimum');
        const heldAmount = held.value.reduce((a, row) => a + unpackAccount(row.pubkey, row.account, s.tokenProgram).amount, 0n);
        s.creatorTokens = String(heldAmount);
        if (heldAmount > mulBps(s.supply, this.cfg.MAX_CREATOR_BPS))
            throw new Error('creator concentration');
        if (!report || typeof report.score !== 'number' || !Number.isFinite(report.score) || !Array.isArray(report.risks))
            throw new Error('unknown rug report');
        const rugRejection = rugReportRejectionReason(report, this.cfg.RUGCHECK_MAX_SCORE);
        if (rugRejection)
            throw new Error(rugRejection);
        if (report.token?.mintAuthority || report.token?.freezeAuthority || report.mintAuthority || report.freezeAuthority)
            throw new Error('mint or freeze authority active');
        const tokenExtensions = report.token_extensions;
        const hasUnsafeExtension = hasUnsafeReportedTokenExtension(tokenExtensions);
        if (report.transferFee?.pct > 0 || hasUnsafeExtension)
            throw new Error('unsafe token extension');
        const accounts = holders.accounts;
        if (!accounts.length)
            throw new Error('unknown holder distribution');
        const infos = holders.infos;
        const buckets = new Map();
        let observed = 0n;
        let certifiedProtocolInventory = 0n;
        const curveAta = getAssociatedTokenAddressSync(s.mint, bondingCurvePda(s.mint), true, s.tokenProgram);
        for (let i = 0; i < accounts.length; i++) {
            if (!infos[i])
                throw new Error('missing holder account');
            const a = unpackAccount(accounts[i].address, infos[i], s.tokenProgram);
            if (!a.mint.equals(s.mint))
                throw new Error('holder mint mismatch');
            observed += a.amount;
            if (accounts[i].address.equals(curveAta) && a.owner.equals(bondingCurvePda(s.mint))) {
                certifiedProtocolInventory += a.amount;
                continue;
            }
            const k = a.owner.toBase58();
            buckets.set(k, (buckets.get(k) ?? 0n) + a.amount);
        }
        const topTen = [...buckets.values()].sort((a, b) => a > b ? -1 : a < b ? 1 : 0).slice(0, 10).reduce((a, b) => a + b, 0n);
        const circulatingSupply = s.supply - certifiedProtocolInventory;
        const concentration = assessFastBoundHolderConcentration({
            // The curve's certified inventory is neither an organic holder nor part
            // of the organic circulating-supply denominator.
            supply: circulatingSupply,
            observedRaw: observed - certifiedProtocolInventory,
            knownTopTenRaw: topTen,
            maxTopTenBps: this.cfg.MAX_TOP_TEN_BPS,
        });
        if (concentration.status === 'UNSAFE')
            throw new Error('top-holder concentration observed');
        // AMBIGUOUS is not a malicious-token conclusion, but a bounded account
        // query cannot authorize an OPEN/INCREASE. A later FULL_ACCOUNT_CENSUS or
        // INDEXED_OWNER_CENSUS must provide the required holder certificate.
        if (concentration.status === 'AMBIGUOUS')
            throw new Error('holder concentration evidence incomplete');
    }
}
//# sourceMappingURL=market.js.map