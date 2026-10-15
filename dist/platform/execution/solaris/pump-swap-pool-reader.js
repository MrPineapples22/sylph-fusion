import { getExtensionTypes, ExtensionType, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount, unpackMint, } from '@solana/spl-token';
import { computeFeesBps, GLOBAL_CONFIG_PDA, PUMP_AMM_FEE_CONFIG_PDA, PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, PUMP_FEE_PROGRAM_ID, canonicalPumpPoolPda, pumpPoolAuthorityPda, } from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
const sdkDecoder = {
    decodePool: info => PUMP_AMM_SDK.decodePool(info),
    decodeGlobalConfig: info => PUMP_AMM_SDK.decodeGlobalConfig(info),
    decodeFeeConfig: info => PUMP_AMM_SDK.decodeFeeConfig(info),
    feeBreakdown: ({ pool, globalConfig, feeConfig, mint, mintSupply, baseReserves, effectiveQuoteReserves }) => {
        const fees = computeFeesBps({
            globalConfig,
            feeConfig,
            creator: pool.creator,
            baseMintSupply: new BN(mintSupply.toString()),
            baseMint: mint,
            baseReserve: new BN(baseReserves.toString()),
            quoteReserve: new BN(effectiveQuoteReserves.toString()),
            quoteMint: pool.quoteMint,
            isMayhemMode: pool.isMayhemMode,
            creatorFeeBps: pool.creatorFeeBps,
        });
        const creatorFeeBps = pool.coinCreator.equals(PublicKey.default) ? 0n : BigInt(fees.creatorFeeBps.toString());
        return {
            lpFeeBps: BigInt(fees.lpFeeBps.toString()),
            protocolFeeBps: BigInt(fees.protocolFeeBps.toString()),
            creatorFeeBps,
        };
    },
};
const U64_MAX = (1n << 64n) - 1n;
const ALLOWED_MINT_EXTENSIONS = new Set([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
const canonicalObservations = new WeakSet();
/** True only for the exact immutable object returned by this reader. */
export function isCanonicalPumpSwapObservation(value) {
    return typeof value === 'object' && value !== null && canonicalObservations.has(value);
}
function requireInfo(info, code) {
    if (!info)
        throw new Error(code);
    return info;
}
function requireOwner(info, expected, code) {
    if (!info.owner.equals(expected))
        throw new Error(code);
}
function validatePoolIdentity(pool, mint, expectedPool) {
    if (pool.index !== 0 || !canonicalPumpPoolPda(mint, NATIVE_MINT).equals(expectedPool) ||
        !pool.creator.equals(pumpPoolAuthorityPda(mint)) || !pool.baseMint.equals(mint) ||
        !pool.quoteMint.equals(NATIVE_MINT)) {
        throw new Error('PUMP_AMM_POOL_IDENTITY_MISMATCH');
    }
}
/**
 * Reads PumpSwap's canonical native-SOL pool. The first read discovers vault addresses;
 * the second read re-fetches the pool and both vaults at one context slot, so reserve values
 * cannot be mixed across different account states.
 */
export async function readCanonicalPumpSwapPool(connection, mint, options = {}) {
    const minContextSlot = options.minContextSlot ?? 0;
    const now = options.now ?? Date.now;
    const decoder = options.decoder ?? sdkDecoder;
    if (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)
        throw new Error('INVALID_AMM_MIN_CONTEXT_SLOT');
    const poolAddress = canonicalPumpPoolPda(mint, NATIVE_MINT);
    const firstRead = await connection.getAccountInfoAndContext(poolAddress, {
        commitment: 'confirmed',
        minContextSlot,
    });
    if (!Number.isSafeInteger(firstRead.context.slot) || firstRead.context.slot < minContextSlot) {
        throw new Error('PUMP_AMM_POOL_CONTEXT_BELOW_MINIMUM');
    }
    const firstPoolInfo = requireInfo(firstRead.value, 'PUMP_CANONICAL_POOL_NOT_FOUND');
    requireOwner(firstPoolInfo, PUMP_AMM_PROGRAM_ID, 'PUMP_AMM_POOL_OWNER_MISMATCH');
    const firstPool = decoder.decodePool(firstPoolInfo);
    validatePoolIdentity(firstPool, mint, poolAddress);
    const read = await connection.getMultipleAccountsInfoAndContext([
        poolAddress,
        mint,
        firstPool.poolBaseTokenAccount,
        firstPool.poolQuoteTokenAccount,
        GLOBAL_CONFIG_PDA,
        PUMP_AMM_FEE_CONFIG_PDA,
    ], { commitment: 'confirmed', minContextSlot: Math.max(minContextSlot, firstRead.context.slot) });
    if (!Number.isSafeInteger(read.context.slot) || read.context.slot < Math.max(minContextSlot, firstRead.context.slot)) {
        throw new Error('PUMP_AMM_SNAPSHOT_CONTEXT_REGRESSION');
    }
    const [poolInfo, mintInfo, baseVaultInfo, quoteVaultInfo, globalInfo, feeInfo] = read.value;
    const canonicalPoolInfo = requireInfo(poolInfo, 'PUMP_CANONICAL_POOL_NOT_FOUND');
    const canonicalMintInfo = requireInfo(mintInfo, 'PUMP_BASE_MINT_NOT_FOUND');
    const baseInfo = requireInfo(baseVaultInfo, 'PUMP_BASE_VAULT_NOT_FOUND');
    const quoteInfo = requireInfo(quoteVaultInfo, 'PUMP_QUOTE_VAULT_NOT_FOUND');
    const globalConfigInfo = requireInfo(globalInfo, 'PUMP_AMM_GLOBAL_CONFIG_NOT_FOUND');
    const feeConfigInfo = requireInfo(feeInfo, 'PUMP_AMM_FEE_CONFIG_NOT_FOUND');
    requireOwner(canonicalPoolInfo, PUMP_AMM_PROGRAM_ID, 'PUMP_AMM_POOL_OWNER_MISMATCH');
    requireOwner(globalConfigInfo, PUMP_AMM_PROGRAM_ID, 'PUMP_AMM_GLOBAL_CONFIG_OWNER_MISMATCH');
    requireOwner(feeConfigInfo, PUMP_FEE_PROGRAM_ID, 'PUMP_AMM_FEE_CONFIG_OWNER_MISMATCH');
    const pool = decoder.decodePool(canonicalPoolInfo);
    validatePoolIdentity(pool, mint, poolAddress);
    if (!pool.poolBaseTokenAccount.equals(firstPool.poolBaseTokenAccount) ||
        !pool.poolQuoteTokenAccount.equals(firstPool.poolQuoteTokenAccount)) {
        throw new Error('PUMP_AMM_POOL_VAULTS_CHANGED_DURING_READ');
    }
    const tokenProgram = canonicalMintInfo.owner;
    if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
        throw new Error('PUMP_BASE_MINT_PROGRAM_UNSUPPORTED');
    }
    const expectedBaseVault = getAssociatedTokenAddressSync(mint, poolAddress, true, tokenProgram);
    const expectedQuoteVault = getAssociatedTokenAddressSync(NATIVE_MINT, poolAddress, true, TOKEN_PROGRAM_ID);
    if (!pool.poolBaseTokenAccount.equals(expectedBaseVault) || !pool.poolQuoteTokenAccount.equals(expectedQuoteVault)) {
        throw new Error('PUMP_AMM_VAULT_ADDRESS_MISMATCH');
    }
    requireOwner(baseInfo, tokenProgram, 'PUMP_BASE_VAULT_PROGRAM_MISMATCH');
    requireOwner(quoteInfo, TOKEN_PROGRAM_ID, 'PUMP_QUOTE_VAULT_PROGRAM_MISMATCH');
    const mintState = unpackMint(mint, canonicalMintInfo, tokenProgram);
    if (!mintState.isInitialized || mintState.supply <= 0n ||
        getExtensionTypes(mintState.tlvData).some(extension => !ALLOWED_MINT_EXTENSIONS.has(extension))) {
        throw new Error('PUMP_BASE_MINT_SEMANTICS_UNSUPPORTED');
    }
    const baseVault = unpackAccount(pool.poolBaseTokenAccount, baseInfo, tokenProgram);
    const quoteVault = unpackAccount(pool.poolQuoteTokenAccount, quoteInfo, TOKEN_PROGRAM_ID);
    if (!baseVault.owner.equals(poolAddress) || !quoteVault.owner.equals(poolAddress) ||
        !baseVault.mint.equals(mint) || !quoteVault.mint.equals(NATIVE_MINT) ||
        baseVault.amount <= 0n || quoteVault.amount <= 0n) {
        throw new Error('PUMP_AMM_VAULT_AUTHORITY_MINT_OR_BALANCE_MISMATCH');
    }
    const effectiveQuoteReserves = quoteVault.amount + BigInt(pool.virtualQuoteReserves.toString());
    if (effectiveQuoteReserves <= 0n || effectiveQuoteReserves > U64_MAX) {
        throw new Error('PUMP_AMM_EFFECTIVE_QUOTE_RESERVES_OUT_OF_RANGE');
    }
    const globalConfig = decoder.decodeGlobalConfig(globalConfigInfo);
    const feeConfig = decoder.decodeFeeConfig(feeConfigInfo);
    const feeBreakdown = decoder.feeBreakdown({
        pool,
        globalConfig,
        feeConfig,
        mint,
        mintSupply: mintState.supply,
        baseReserves: baseVault.amount,
        effectiveQuoteReserves,
    });
    const effectiveFeeBps = feeBreakdown.lpFeeBps + feeBreakdown.protocolFeeBps + feeBreakdown.creatorFeeBps;
    if (effectiveFeeBps < 0n || effectiveFeeBps >= 10000n || effectiveFeeBps > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('PUMP_AMM_EFFECTIVE_FEE_OUT_OF_RANGE');
    }
    const observedAtMs = now();
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0)
        throw new Error('INVALID_PUMP_AMM_OBSERVATION_TIME');
    const observation = {
        venue: 'PUMPSWAP',
        poolAddress: poolAddress.toBase58(),
        quoteMint: NATIVE_MINT.toBase58(),
        quoteReserves: effectiveQuoteReserves,
        rawQuoteReserves: quoteVault.amount,
        virtualQuoteReserves: BigInt(pool.virtualQuoteReserves.toString()),
        tokenReserves: baseVault.amount,
        effectiveFeeBps: Number(effectiveFeeBps),
        feeBreakdown,
        slot: read.context.slot,
        observedAtMs,
        source: 'CANONICAL_ON_CHAIN_RPC',
    };
    canonicalObservations.add(observation);
    return Object.freeze(observation);
}
//# sourceMappingURL=pump-swap-pool-reader.js.map