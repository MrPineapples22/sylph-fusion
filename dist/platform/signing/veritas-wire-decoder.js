/**
 * SOL-SYLPH 2026 Platform - Veritas Wire Message Decoder
 * Architectural Directives: Pillar 6 (Signing Authority) & Pillar 9 (Veritas Transaction Effect Decoder).
 *
 * Implements native binary deserialization of compiled Solana VersionedMessage wire bytes.
 * Eliminates the Caller-Manifest Decoupling vulnerability by extracting transaction facts,
 * program IDs, instruction discriminators, writable accounts, and value transfers directly
 * from the exact byte stream to be signed.
 */
import { VersionedMessage } from '@solana/web3.js';
import { createHash } from 'node:crypto';
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const COMPUTE_BUDGET_ID = 'ComputeBudget111111111111111111111111111111';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SPL_TOKEN_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const JUPITER_V6_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const PUMP_BUY_DISCRIMINATOR = '66063d1201daebea';
const PUMP_SELL_DISCRIMINATOR = '33e685a4017f83ad';
export class VeritasWireDecoder {
    /**
     * Extracts observed message facts. `complete` supports only payer-origin native
     * transfers to one recipient and the CU limit/price instructions decoded below.
     * Pump (including SDK 2.0.0 V2), Jupiter, ATA and token effects are not yet
     * authority-complete and therefore cannot authorize signing. No account-state,
     * simulation, fee-inclusive wallet exposure or venue certification is implied.
     */
    static decode(messageBytes, options = {}) {
        if (!(messageBytes instanceof Uint8Array) || messageBytes.byteLength === 0) {
            throw new Error('VERITAS_DECODE_FAILED: messageBytes must be a non-empty Uint8Array');
        }
        const messageHash = createHash('sha256').update(messageBytes).digest('hex');
        let message;
        try {
            message = VersionedMessage.deserialize(messageBytes);
            if (!Buffer.from(message.serialize()).equals(Buffer.from(messageBytes))) {
                throw new Error('Noncanonical message encoding or trailing bytes');
            }
        }
        catch (err) {
            throw new Error(`VERITAS_DECODE_FAILED: Deserialization failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const header = message.header;
        const staticKeys = message.staticAccountKeys.map((k) => k.toBase58());
        // Resolve address lookup tables if present (v0)
        const resolvedWritableKeys = [];
        const resolvedReadonlyKeys = [];
        if (message.version === 0 && 'addressTableLookups' in message) {
            for (const lookup of message.addressTableLookups) {
                const tablePubkey = lookup.accountKey.toBase58();
                const table = options.altResolver?.(tablePubkey);
                if (!table) {
                    throw new Error(`VERITAS_DECODE_FAILED: AddressLookupTable ${tablePubkey} could not be resolved`);
                }
                for (const idx of lookup.writableIndexes) {
                    const key = table.state.addresses[idx];
                    if (!key)
                        throw new Error(`VERITAS_DECODE_FAILED: Invalid ALT writable index ${idx} for table ${tablePubkey}`);
                    resolvedWritableKeys.push(key.toBase58());
                }
                for (const idx of lookup.readonlyIndexes) {
                    const key = table.state.addresses[idx];
                    if (!key)
                        throw new Error(`VERITAS_DECODE_FAILED: Invalid ALT readonly index ${idx} for table ${tablePubkey}`);
                    resolvedReadonlyKeys.push(key.toBase58());
                }
            }
        }
        const allAccountKeys = [...staticKeys, ...resolvedWritableKeys, ...resolvedReadonlyKeys];
        // Compute static account writability
        // Writable signers: [0 .. numRequiredSignatures - numReadonlySignedAccounts - 1]
        const numSigners = header.numRequiredSignatures;
        const numReadonlySigners = header.numReadonlySignedAccounts;
        const numWritableSigners = numSigners - numReadonlySigners;
        // Non-signers: [numSigners .. staticKeys.length - 1]
        const numNonSigners = staticKeys.length - numSigners;
        const numReadonlyNonSigners = header.numReadonlyUnsignedAccounts;
        const numWritableNonSigners = numNonSigners - numReadonlyNonSigners;
        const writableAccountSet = new Set();
        const readonlyAccountSet = new Set();
        for (let i = 0; i < numWritableSigners; i++) {
            writableAccountSet.add(staticKeys[i]);
        }
        for (let i = numWritableSigners; i < numSigners; i++) {
            readonlyAccountSet.add(staticKeys[i]);
        }
        for (let i = numSigners; i < numSigners + numWritableNonSigners; i++) {
            writableAccountSet.add(staticKeys[i]);
        }
        for (let i = numSigners + numWritableNonSigners; i < staticKeys.length; i++) {
            readonlyAccountSet.add(staticKeys[i]);
        }
        for (const k of resolvedWritableKeys)
            writableAccountSet.add(k);
        for (const k of resolvedReadonlyKeys)
            readonlyAccountSet.add(k);
        const feePayer = staticKeys[0] ?? '';
        const signer = feePayer;
        const programIdSet = new Set();
        let totalAmountLamports = 0n;
        let priorityFeeLamports = 0n;
        let computeUnitLimit;
        let computeUnitPriceMicroLamports;
        // Policy expectations are not observations. Unsupported token/swap effects
        // remain diagnostic only until their complete economic/account contract is decoded.
        let detectedMint = '';
        let detectedDestination = '';
        let complete = header.numRequiredSignatures === 1 && numWritableSigners === 1;
        let transferCount = 0;
        let pumpTokensRaw;
        let pumpMaxCostLamports;
        let pumpMinOutputLamports;
        const instructionDetails = [];
        for (const compiled of message.compiledInstructions) {
            const progPubkey = staticKeys[compiled.programIdIndex];
            if (!progPubkey) {
                throw new Error(`VERITAS_DECODE_FAILED: Invalid program index ${compiled.programIdIndex}`);
            }
            programIdSet.add(progPubkey);
            const ixAccountKeys = compiled.accountKeyIndexes.map((idx) => {
                const key = allAccountKeys[idx];
                if (!key)
                    throw new Error(`VERITAS_DECODE_FAILED: Account index ${idx} out of range`);
                return key;
            });
            const ixWritableKeys = ixAccountKeys.filter((k) => writableAccountSet.has(k));
            const data = Buffer.from(compiled.data);
            const dataLength = data.length;
            const discriminatorHex = data.subarray(0, Math.min(8, dataLength)).toString('hex');
            let instructionType = 'UNKNOWN';
            let valueLamports;
            let tokenAmountRaw;
            let targetMint;
            let destPubkey;
            if (progPubkey === COMPUTE_BUDGET_ID) {
                if (dataLength === 5 && data[0] === 2) {
                    instructionType = 'COMPUTE_BUDGET_LIMIT';
                    if (computeUnitLimit !== undefined || ixAccountKeys.length !== 0)
                        complete = false;
                    computeUnitLimit = data.readUInt32LE(1);
                    if (computeUnitLimit === 0 || computeUnitLimit > 1_400_000)
                        complete = false;
                }
                else if (dataLength === 9 && data[0] === 3) {
                    instructionType = 'COMPUTE_BUDGET_PRICE';
                    if (computeUnitPriceMicroLamports !== undefined || ixAccountKeys.length !== 0)
                        complete = false;
                    computeUnitPriceMicroLamports = data.readBigUInt64LE(1);
                }
            }
            else if (progPubkey === SYSTEM_PROGRAM_ID) {
                // System Program: index 2 is Transfer (u32 LE = 2, lamports u64 LE at offset 4)
                if (dataLength === 12 && data.readUInt32LE(0) === 2) {
                    instructionType = 'SYSTEM_TRANSFER';
                    valueLamports = data.readBigUInt64LE(4);
                    destPubkey = ixAccountKeys[1];
                    if (ixAccountKeys.length !== 2 || ixAccountKeys[0] !== feePayer
                        || !ixAccountKeys.every(k => writableAccountSet.has(k)))
                        complete = false;
                    if (detectedDestination && detectedDestination !== destPubkey)
                        complete = false;
                    transferCount++;
                    totalAmountLamports += valueLamports;
                    // A System transfer is not evidence that its recipient is a Jito tip account.
                    if (!detectedDestination && destPubkey)
                        detectedDestination = destPubkey;
                }
            }
            else if (progPubkey === ATA_PROGRAM_ID) {
                instructionType = 'ATA_CREATE';
                destPubkey = ixAccountKeys[1];
                targetMint = ixAccountKeys[3];
                if (!detectedMint && targetMint)
                    detectedMint = targetMint;
            }
            else if (progPubkey === PUMP_PROGRAM_ID) {
                if (discriminatorHex === PUMP_BUY_DISCRIMINATOR && dataLength >= 24) {
                    instructionType = 'PUMP_BUY';
                    tokenAmountRaw = data.readBigUInt64LE(8);
                    const maxSolCost = data.readBigUInt64LE(16);
                    pumpTokensRaw = tokenAmountRaw;
                    pumpMaxCostLamports = maxSolCost;
                    totalAmountLamports += maxSolCost;
                    targetMint = ixAccountKeys[2];
                    if (!detectedMint && targetMint)
                        detectedMint = targetMint;
                }
                else if (discriminatorHex === PUMP_SELL_DISCRIMINATOR && dataLength >= 24) {
                    instructionType = 'PUMP_SELL';
                    tokenAmountRaw = data.readBigUInt64LE(8);
                    const minSolOutput = data.readBigUInt64LE(16);
                    pumpTokensRaw = tokenAmountRaw;
                    pumpMinOutputLamports = minSolOutput;
                    targetMint = ixAccountKeys[2];
                    if (!detectedMint && targetMint)
                        detectedMint = targetMint;
                }
            }
            else if (progPubkey === JUPITER_V6_ID) {
                // Program allowlisting does not establish the instruction or routed effects.
                instructionType = 'UNKNOWN';
            }
            else if (progPubkey === SPL_TOKEN_ID || progPubkey === TOKEN_2022_ID) {
                if (dataLength >= 9 && (data[0] === 3 || data[0] === 12)) {
                    instructionType = 'SPL_TRANSFER';
                    tokenAmountRaw = data.readBigUInt64LE(1);
                    destPubkey = ixAccountKeys[1];
                }
            }
            if (!['SYSTEM_TRANSFER', 'COMPUTE_BUDGET_LIMIT', 'COMPUTE_BUDGET_PRICE'].includes(instructionType)) {
                complete = false;
            }
            instructionDetails.push({
                programId: progPubkey,
                accounts: Object.freeze(ixAccountKeys),
                writableAccounts: Object.freeze(ixWritableKeys),
                dataLength,
                discriminatorHex,
                instructionType,
                valueLamports,
                tokenAmountRaw,
                targetMint,
                destinationPubkey: destPubkey,
            });
        }
        if (computeUnitPriceMicroLamports !== undefined) {
            // The message must explicitly bound CU usage; do not invent a default fee envelope.
            if (computeUnitLimit === undefined)
                complete = false;
            else
                priorityFeeLamports = (computeUnitPriceMicroLamports * BigInt(computeUnitLimit) + 999999n) / 1000000n;
        }
        return Object.freeze({
            complete: complete && transferCount > 0,
            frozen: true,
            messageHash,
            version: message.version,
            recentBlockhash: message.recentBlockhash,
            signer,
            feePayer,
            allAccountKeys: Object.freeze(allAccountKeys),
            programIds: Object.freeze(Array.from(programIdSet)),
            writableAccounts: Object.freeze(Array.from(writableAccountSet)),
            readonlyAccounts: Object.freeze(Array.from(readonlyAccountSet)),
            amountLamports: totalAmountLamports,
            mint: detectedMint,
            destination: detectedDestination,
            // Exact native transfers have no slippage. Swap bounds are currently unsupported.
            maxSlippageBps: 0,
            priorityFeeLamports,
            simulationId: options.simulationId ?? `sim_${messageHash.slice(0, 16)}`,
            instructions: Object.freeze(instructionDetails),
            computeUnitLimit,
            computeUnitPriceMicroLamports,
            pumpTokensRaw,
            pumpMaxCostLamports,
            pumpMinOutputLamports,
        });
    }
}
//# sourceMappingURL=veritas-wire-decoder.js.map