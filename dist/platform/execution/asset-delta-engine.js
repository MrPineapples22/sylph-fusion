/**
 * SYLPH FUSION — ASSET DELTA & ECONOMIC CONSERVATION ENGINE
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1-10)
 *
 * Implements authoritative transaction asset delta extraction:
 * - Computes raw on-chain balance deltas as primary economic truth.
 * - Separates transaction fees and instruction-proven tips/token-account funding from trade proceeds.
 * - Prevents double-counting of Wrapped SOL (WSOL) wrapping/unwrapping operations.
 * - Validates global conservation across pre/post balances.
 */
import bs58 from 'bs58';
import { PublicKey, SystemInstruction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';
export class AssetDeltaEngine {
    static NATIVE_SOL_MINT = NATIVE_MINT.toBase58();
    static instructionData(value) {
        if (value instanceof Uint8Array)
            return Uint8Array.from(value);
        if (typeof value !== 'string')
            return null;
        try {
            const decoded = bs58.decode(value);
            return bs58.encode(decoded) === value ? Uint8Array.from(decoded) : null;
        }
        catch {
            return null;
        }
    }
    static makeInstruction(programIdIndex, accountIndexes, dataValue, accountKeys) {
        if (!Number.isSafeInteger(programIdIndex) || !Array.isArray(accountIndexes) ||
            !accountIndexes.every(index => Number.isSafeInteger(index) && index >= 0 && index < accountKeys.length))
            return null;
        const programId = accountKeys.get(programIdIndex);
        const data = this.instructionData(dataValue);
        if (!programId || !data)
            return null;
        const keys = accountIndexes.map(index => ({
            pubkey: accountKeys.get(index), isSigner: false, isWritable: false,
        }));
        return new TransactionInstruction({ programId, keys, data: Buffer.from(data) });
    }
    static inspectSystemInstructions(tx, accountKeys, walletAddress, targetMint, knownTipAccounts) {
        const meta = tx.meta;
        const candidates = [];
        let complete = Array.isArray(meta.innerInstructions);
        const append = (programIdIndex, accountIndexes, data) => {
            const instruction = this.makeInstruction(programIdIndex, accountIndexes, data, accountKeys);
            if (!instruction) {
                complete = false;
                return;
            }
            if (instruction.programId.equals(SystemProgram.programId))
                candidates.push(instruction);
        };
        const compiledInstructions = tx.transaction.message.compiledInstructions;
        if (!Array.isArray(compiledInstructions))
            complete = false;
        else
            for (const instruction of compiledInstructions) {
                append(instruction.programIdIndex, instruction.accountKeyIndexes, instruction.data);
            }
        if (Array.isArray(meta.innerInstructions)) {
            for (const group of meta.innerInstructions) {
                if (!Number.isSafeInteger(group.index) || !Array.isArray(group.instructions)) {
                    complete = false;
                    continue;
                }
                for (const instruction of group.instructions)
                    append(instruction.programIdIndex, instruction.accounts, instruction.data);
            }
        }
        let jitoTipLamports = 0n;
        const createdAccountFunding = new Map();
        for (const instruction of candidates) {
            let instructionType;
            try {
                instructionType = SystemInstruction.decodeInstructionType(instruction);
            }
            catch {
                complete = false;
                continue;
            }
            try {
                if (instructionType === 'Transfer') {
                    const transfer = SystemInstruction.decodeTransfer(instruction);
                    if (transfer.fromPubkey.toBase58() === walletAddress && knownTipAccounts.has(transfer.toPubkey.toBase58())) {
                        jitoTipLamports += transfer.lamports;
                    }
                }
                else if (instructionType === 'TransferWithSeed') {
                    const transfer = SystemInstruction.decodeTransferWithSeed(instruction);
                    if (transfer.fromPubkey.toBase58() === walletAddress && knownTipAccounts.has(transfer.toPubkey.toBase58())) {
                        jitoTipLamports += transfer.lamports;
                    }
                }
                else if (instructionType === 'Create') {
                    const created = SystemInstruction.decodeCreateAccount(instruction);
                    let index = -1;
                    for (let accountIndex = 0; accountIndex < accountKeys.length; accountIndex++) {
                        if (accountKeys.get(accountIndex)?.equals(created.newAccountPubkey)) {
                            index = accountIndex;
                            break;
                        }
                    }
                    if (index >= 0) {
                        const amounts = createdAccountFunding.get(index) ?? [];
                        amounts.push({ payer: created.fromPubkey.toBase58(), lamports: BigInt(created.lamports) });
                        createdAccountFunding.set(index, amounts);
                    }
                }
            }
            catch {
                complete = false;
            }
        }
        const tipRequested = knownTipAccounts.size > 0;
        const jitoTipStatus = !tipRequested ? 'NOT_REQUESTED'
            : complete ? 'REPORTED_COMPLETE' : 'PARTIAL';
        const postRows = meta.postTokenBalances;
        const preRows = meta.preTokenBalances;
        const newTargetAccounts = postRows.filter(row => row.owner === walletAddress && row.mint === targetMint &&
            !preRows.some(previous => previous.accountIndex === row.accountIndex && previous.mint === targetMint));
        if (newTargetAccounts.length === 0) {
            return { jitoTipLamports, jitoTipStatus, ataRentLamports: 0n, ataRentStatus: 'NOT_APPLICABLE' };
        }
        let ataRentLamports = 0n;
        for (const row of newTargetAccounts) {
            if (!Number.isSafeInteger(row.accountIndex) || row.accountIndex < 0 || row.accountIndex >= accountKeys.length) {
                return { jitoTipLamports, jitoTipStatus, ataRentLamports: null, ataRentStatus: 'UNAVAILABLE' };
            }
            const funding = createdAccountFunding.get(row.accountIndex);
            if (!funding || funding.length !== 1 || funding[0].payer !== walletAddress) {
                return { jitoTipLamports, jitoTipStatus, ataRentLamports: null, ataRentStatus: 'UNAVAILABLE' };
            }
            const tokenProgram = row.programId;
            if (typeof tokenProgram !== 'string') {
                return { jitoTipLamports, jitoTipStatus, ataRentLamports: null, ataRentStatus: 'UNAVAILABLE' };
            }
            let isAssociatedTokenAddress = false;
            try {
                isAssociatedTokenAddress = getAssociatedTokenAddressSync(new PublicKey(targetMint), new PublicKey(walletAddress), false, new PublicKey(tokenProgram)).equals(accountKeys.get(row.accountIndex));
            }
            catch {
                return { jitoTipLamports, jitoTipStatus, ataRentLamports: null, ataRentStatus: 'UNAVAILABLE' };
            }
            if (!isAssociatedTokenAddress) {
                return { jitoTipLamports, jitoTipStatus, ataRentLamports: null, ataRentStatus: 'UNAVAILABLE' };
            }
            ataRentLamports += funding[0].lamports;
        }
        return { jitoTipLamports, jitoTipStatus, ataRentLamports, ataRentStatus: 'REPORTED_CREATE_FUNDING' };
    }
    /**
     * Computes verified asset deltas from transaction metadata with strict conservation checks.
     */
    static computeAssetDeltas(tx, walletAddress, targetTokenMint, knownTipAccounts = new Set()) {
        const meta = tx.meta;
        if (!meta) {
            throw new Error('MISSING_TRANSACTION_METADATA: Transaction has no metadata');
        }
        if (!Object.prototype.hasOwnProperty.call(meta, 'err') || meta.err !== null) {
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
        if (!Number.isSafeInteger(meta.fee) || meta.fee < 0 ||
            !Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) ||
            meta.preBalances.length !== accountKeys.length || meta.postBalances.length !== accountKeys.length ||
            meta.preBalances.some(balance => !Number.isSafeInteger(balance) || balance < 0) ||
            meta.postBalances.some(balance => !Number.isSafeInteger(balance) || balance < 0)) {
            throw new Error('INVALID_TRANSACTION_BALANCE_METADATA');
        }
        if (!Array.isArray(meta.preTokenBalances) || !Array.isArray(meta.postTokenBalances)) {
            throw new Error('TOKEN_BALANCE_METADATA_UNAVAILABLE');
        }
        const preSol = BigInt(meta.preBalances[walletIndex]);
        const postSol = BigInt(meta.postBalances[walletIndex]);
        const grossSolDelta = postSol - preSol;
        // Fee payer is account at index 0
        const isFeePayer = walletIndex === 0;
        const txFeeLamports = isFeePayer ? BigInt(meta.fee) : 0n;
        const systemInstructionEvidence = this.inspectSystemInstructions(tx, accountKeys, walletAddress, targetTokenMint, knownTipAccounts);
        const { jitoTipLamports, jitoTipStatus, ataRentLamports, ataRentStatus } = systemInstructionEvidence;
        // Token balances for target mint
        const sumToken = (rows, mint) => rows.filter(r => r.owner === walletAddress && r.mint === mint)
            .reduce((sum, r) => {
            const amount = r.uiTokenAmount?.amount;
            if (typeof amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(amount)) {
                throw new Error('INVALID_TOKEN_AMOUNT_METADATA');
            }
            return sum + BigInt(amount);
        }, 0n);
        const preTokens = sumToken(meta.preTokenBalances, targetTokenMint);
        const postTokens = sumToken(meta.postTokenBalances, targetTokenMint);
        const tokenDelta = postTokens - preTokens;
        // Check for Wrapped SOL (WSOL) activity
        const preWSOL = sumToken(meta.preTokenBalances, AssetDeltaEngine.NATIVE_SOL_MINT);
        const postWSOL = sumToken(meta.postTokenBalances, AssetDeltaEngine.NATIVE_SOL_MINT);
        const wsolDelta = postWSOL - preWSOL;
        const isWSOLWrapped = wsolDelta !== 0n;
        // Net economic SOL delta separates fees from trade delta to avoid double counting:
        // When buying: grossSolDelta is negative (e.g. -amount - txFee - jitoTip).
        // Economic cost = grossSolDelta + txFee + jitoTip (removes fees from pool fill evaluation).
        // Include WSOL balance movement so wrapping/unwrapping is not counted as an economic gain/loss.
        let netEconomicSolDelta = grossSolDelta;
        netEconomicSolDelta += wsolDelta;
        if (isFeePayer) {
            netEconomicSolDelta += txFeeLamports;
        }
        netEconomicSolDelta += jitoTipLamports;
        // Only remove token-account funding from trade proceeds when the exact
        // wallet-paid associated-account creation was proven above.
        if (ataRentStatus === 'REPORTED_CREATE_FUNDING' && ataRentLamports !== null) {
            netEconomicSolDelta += ataRentLamports;
        }
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
            wsolDelta,
            tokenDelta,
            txFeeLamports,
            jitoTipLamports,
            jitoTipStatus,
            ataRentLamports,
            ataRentStatus,
            isWSOLWrapped,
            isConservationValid,
        };
    }
}
//# sourceMappingURL=asset-delta-engine.js.map