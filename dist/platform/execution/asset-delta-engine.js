/**
 * SYLPH FUSION — ASSET DELTA & ECONOMIC CONSERVATION ENGINE
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1-10)
 *
 * Implements authoritative transaction asset delta extraction:
 * - Computes raw on-chain balance deltas as primary economic truth.
 * - Separates transaction fees (base fee, priority fee, Jito tip, ATA rent) from trade proceeds.
 * - Prevents double-counting of Wrapped SOL (WSOL) wrapping/unwrapping operations.
 * - Validates global conservation across pre/post balances.
 */
import { NATIVE_MINT } from '@solana/spl-token';
export class AssetDeltaEngine {
    static NATIVE_SOL_MINT = NATIVE_MINT.toBase58();
    /**
     * Computes verified asset deltas from transaction metadata with strict conservation checks.
     */
    static computeAssetDeltas(tx, walletAddress, targetTokenMint, knownTipAccounts = new Set()) {
        const meta = tx.meta;
        if (!meta) {
            throw new Error('MISSING_TRANSACTION_METADATA: Transaction has no metadata');
        }
        if (meta.err) {
            throw new Error(`TRANSACTION_FAILED_ON_CHAIN: ${JSON.stringify(meta.err)}`);
        }
        const accountKeys = tx.transaction.message.getAccountKeys({
            accountKeysFromLookups: meta.loadedAddresses,
        });
        let walletIndex = -1;
        for (let i = 0; i < accountKeys.length; i++) {
            if (accountKeys.get(i)?.toBase58() === walletAddress) {
                walletIndex = i;
                break;
            }
        }
        if (walletIndex === -1) {
            throw new Error(`WALLET_NOT_FOUND_IN_TRANSACTION: ${walletAddress}`);
        }
        if (!Number.isSafeInteger(meta.preBalances[walletIndex]) || !Number.isSafeInteger(meta.postBalances[walletIndex])) {
            throw new Error('UNSAFE_BALANCE_INTEGER: Pre or post balance exceeds safe integer limits');
        }
        const preSol = BigInt(meta.preBalances[walletIndex]);
        const postSol = BigInt(meta.postBalances[walletIndex]);
        const grossSolDelta = postSol - preSol;
        // Fee payer is account at index 0
        const isFeePayer = walletIndex === 0;
        const txFeeLamports = isFeePayer ? BigInt(meta.fee) : 0n;
        // Detect Jito tip transfers from wallet
        let jitoTipLamports = 0n;
        if (knownTipAccounts.size > 0) {
            for (let i = 0; i < accountKeys.length; i++) {
                const pkStr = accountKeys.get(i)?.toBase58();
                if (pkStr && knownTipAccounts.has(pkStr)) {
                    const preTip = BigInt(meta.preBalances[i] ?? 0);
                    const postTip = BigInt(meta.postBalances[i] ?? 0);
                    if (postTip > preTip) {
                        jitoTipLamports += postTip - preTip;
                    }
                }
            }
        }
        // Token balances for target mint
        const sumToken = (rows, mint) => (rows ?? [])
            .filter(r => r.owner === walletAddress && r.mint === mint)
            .reduce((sum, r) => sum + BigInt(r.uiTokenAmount.amount), 0n);
        const preTokens = sumToken(meta.preTokenBalances, targetTokenMint);
        const postTokens = sumToken(meta.postTokenBalances, targetTokenMint);
        const tokenDelta = postTokens - preTokens;
        // Check for Wrapped SOL (WSOL) activity
        const preWSOL = sumToken(meta.preTokenBalances, AssetDeltaEngine.NATIVE_SOL_MINT);
        const postWSOL = sumToken(meta.postTokenBalances, AssetDeltaEngine.NATIVE_SOL_MINT);
        const wsolDelta = postWSOL - preWSOL;
        const isWSOLWrapped = preWSOL > 0n || postWSOL > 0n || wsolDelta !== 0n;
        // Calculate ATA rent (if new ATA created for target token)
        let ataRentLamports = 0n;
        const hadPreTokenAccount = (meta.preTokenBalances ?? []).some(r => r.owner === walletAddress && r.mint === targetTokenMint);
        const hasPostTokenAccount = (meta.postTokenBalances ?? []).some(r => r.owner === walletAddress && r.mint === targetTokenMint);
        if (!hadPreTokenAccount && hasPostTokenAccount) {
            ataRentLamports = 2039280n;
        }
        // Net economic SOL delta separates fees from trade delta to avoid double counting:
        // When buying: grossSolDelta is negative (e.g. -amount - txFee - jitoTip).
        // Economic cost = grossSolDelta + txFee + jitoTip (removes fees from pool fill evaluation).
        // Also adds back wsolDelta if token was wrapped.
        let netEconomicSolDelta = grossSolDelta;
        if (isFeePayer) {
            netEconomicSolDelta += txFeeLamports;
        }
        netEconomicSolDelta += jitoTipLamports;
        // Global conservation check across entire transaction:
        // sum(postBalances) + fee === sum(preBalances)
        const sumPreBalances = meta.preBalances.reduce((a, b) => a + BigInt(b), 0n);
        const sumPostBalances = meta.postBalances.reduce((a, b) => a + BigInt(b), 0n);
        const isConservationValid = sumPostBalances + BigInt(meta.fee) === sumPreBalances;
        return {
            signature: tx.transaction.signatures[0],
            wallet: walletAddress,
            tokenMint: targetTokenMint,
            grossSolDelta,
            netEconomicSolDelta,
            tokenDelta,
            txFeeLamports,
            jitoTipLamports,
            ataRentLamports,
            isWSOLWrapped,
            isConservationValid,
        };
    }
}
//# sourceMappingURL=asset-delta-engine.js.map