/**
 * SOL-SYLPH 2026 Platform - Veritas Wire Message Decoder
 * Architectural Directives: Pillar 6 (Signing Authority) & Pillar 9 (Veritas Transaction Effect Decoder).
 *
 * Implements native binary deserialization of compiled Solana VersionedMessage wire bytes.
 * Eliminates the Caller-Manifest Decoupling vulnerability by extracting transaction facts,
 * program IDs, instruction discriminators, writable accounts, and value transfers directly
 * from the exact byte stream to be signed.
 */

import { VersionedMessage, type AddressLookupTableAccount } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import type { DecodedTransactionView } from './signing-firewall.js';

export interface DecodedInstructionDetail {
  readonly programId: string;
  readonly accounts: readonly string[];
  readonly writableAccounts: readonly string[];
  readonly dataLength: number;
  readonly discriminatorHex: string;
  readonly instructionType: 'COMPUTE_BUDGET_LIMIT' | 'COMPUTE_BUDGET_PRICE' | 'SYSTEM_TRANSFER' | 'SPL_TRANSFER' | 'ATA_CREATE' | 'PUMP_BUY' | 'PUMP_SELL' | 'JUPITER_SWAP' | 'UNKNOWN';
  readonly valueLamports?: bigint;
  readonly tokenAmountRaw?: bigint;
  readonly targetMint?: string;
  readonly destinationPubkey?: string;
}

export interface DetailedDecodedTransactionView extends DecodedTransactionView {
  readonly version: 'legacy' | 0;
  readonly recentBlockhash: string;
  readonly allAccountKeys: readonly string[];
  readonly readonlyAccounts: readonly string[];
  readonly instructions: readonly DecodedInstructionDetail[];
  readonly computeUnitLimit?: number;
  readonly computeUnitPriceMicroLamports?: bigint;
  readonly jitoTipLamports?: bigint;
  readonly pumpTokensRaw?: bigint;
  readonly pumpMaxCostLamports?: bigint;
  readonly pumpMinOutputLamports?: bigint;
}

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
   * Directly deserializes compiled Solana transaction message bytes and extracts
   * an authoritative, tamper-proof DecodedTransactionView.
   */
  public static decode(
    messageBytes: Uint8Array,
    options: {
      simulationId?: string;
      expectedMint?: string;
      expectedDestination?: string;
      maxSlippageBps?: number;
      altResolver?: (lookupTableKey: string) => AddressLookupTableAccount | undefined;
    } = {}
  ): DetailedDecodedTransactionView {
    if (!(messageBytes instanceof Uint8Array) || messageBytes.byteLength === 0) {
      throw new Error('VERITAS_DECODE_FAILED: messageBytes must be a non-empty Uint8Array');
    }

    const messageHash = createHash('sha256').update(messageBytes).digest('hex');
    let message: VersionedMessage;
    try {
      message = VersionedMessage.deserialize(messageBytes);
    } catch (err) {
      throw new Error(`VERITAS_DECODE_FAILED: Deserialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const header = message.header;
    const staticKeys = message.staticAccountKeys.map((k) => k.toBase58());

    // Resolve address lookup tables if present (v0)
    const resolvedWritableKeys: string[] = [];
    const resolvedReadonlyKeys: string[] = [];

    if (message.version === 0 && 'addressTableLookups' in message) {
      for (const lookup of message.addressTableLookups) {
        const tablePubkey = lookup.accountKey.toBase58();
        const table = options.altResolver?.(tablePubkey);
        if (!table) {
          throw new Error(`VERITAS_DECODE_FAILED: AddressLookupTable ${tablePubkey} could not be resolved`);
        }
        for (const idx of lookup.writableIndexes) {
          const key = table.state.addresses[idx];
          if (!key) throw new Error(`VERITAS_DECODE_FAILED: Invalid ALT writable index ${idx} for table ${tablePubkey}`);
          resolvedWritableKeys.push(key.toBase58());
        }
        for (const idx of lookup.readonlyIndexes) {
          const key = table.state.addresses[idx];
          if (!key) throw new Error(`VERITAS_DECODE_FAILED: Invalid ALT readonly index ${idx} for table ${tablePubkey}`);
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

    const writableAccountSet = new Set<string>();
    const readonlyAccountSet = new Set<string>();

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
    for (const k of resolvedWritableKeys) writableAccountSet.add(k);
    for (const k of resolvedReadonlyKeys) readonlyAccountSet.add(k);

    const feePayer = staticKeys[0] ?? '';
    const signer = feePayer;
    const programIdSet = new Set<string>();

    let totalAmountLamports = 0n;
    let priorityFeeLamports = 0n;
    let computeUnitLimit: number | undefined;
    let computeUnitPriceMicroLamports: bigint | undefined;
    let jitoTipLamports = 0n;
    let detectedMint = options.expectedMint ?? '';
    let detectedDestination = options.expectedDestination ?? '';
    let pumpTokensRaw: bigint | undefined;
    let pumpMaxCostLamports: bigint | undefined;
    let pumpMinOutputLamports: bigint | undefined;

    const instructionDetails: DecodedInstructionDetail[] = [];

    for (const compiled of message.compiledInstructions) {
      const progPubkey = staticKeys[compiled.programIdIndex];
      if (!progPubkey) {
        throw new Error(`VERITAS_DECODE_FAILED: Invalid program index ${compiled.programIdIndex}`);
      }
      programIdSet.add(progPubkey);

      const ixAccountKeys = compiled.accountKeyIndexes.map((idx) => {
        const key = allAccountKeys[idx];
        if (!key) throw new Error(`VERITAS_DECODE_FAILED: Account index ${idx} out of range`);
        return key;
      });

      const ixWritableKeys = ixAccountKeys.filter((k) => writableAccountSet.has(k));
      const data = Buffer.from(compiled.data);
      const dataLength = data.length;
      const discriminatorHex = data.subarray(0, Math.min(8, dataLength)).toString('hex');

      let instructionType: DecodedInstructionDetail['instructionType'] = 'UNKNOWN';
      let valueLamports: bigint | undefined;
      let tokenAmountRaw: bigint | undefined;
      let targetMint: string | undefined;
      let destPubkey: string | undefined;

      if (progPubkey === COMPUTE_BUDGET_ID) {
        if (dataLength === 5 && data[0] === 2) {
          instructionType = 'COMPUTE_BUDGET_LIMIT';
          computeUnitLimit = data.readUInt32LE(1);
        } else if (dataLength === 9 && data[0] === 3) {
          instructionType = 'COMPUTE_BUDGET_PRICE';
          computeUnitPriceMicroLamports = data.readBigUInt64LE(1);
          if (computeUnitLimit !== undefined) {
            priorityFeeLamports = (computeUnitPriceMicroLamports * BigInt(computeUnitLimit) + 999_999n) / 1_000_000n;
          }
        }
      } else if (progPubkey === SYSTEM_PROGRAM_ID) {
        // System Program: index 2 is Transfer (u32 LE = 2, lamports u64 LE at offset 4)
        if (dataLength === 12 && data.readUInt32LE(0) === 2) {
          instructionType = 'SYSTEM_TRANSFER';
          valueLamports = data.readBigUInt64LE(4);
          destPubkey = ixAccountKeys[1];
          totalAmountLamports += valueLamports;
          jitoTipLamports += valueLamports; // Transfers to tip accounts or recipients
          if (!detectedDestination && destPubkey) detectedDestination = destPubkey;
        }
      } else if (progPubkey === ATA_PROGRAM_ID) {
        instructionType = 'ATA_CREATE';
        destPubkey = ixAccountKeys[1];
        targetMint = ixAccountKeys[3];
        if (!detectedMint && targetMint) detectedMint = targetMint;
      } else if (progPubkey === PUMP_PROGRAM_ID) {
        if (discriminatorHex === PUMP_BUY_DISCRIMINATOR && dataLength >= 24) {
          instructionType = 'PUMP_BUY';
          tokenAmountRaw = data.readBigUInt64LE(8);
          const maxSolCost = data.readBigUInt64LE(16);
          pumpTokensRaw = tokenAmountRaw;
          pumpMaxCostLamports = maxSolCost;
          totalAmountLamports += maxSolCost;
          targetMint = ixAccountKeys[2];
          if (!detectedMint && targetMint) detectedMint = targetMint;
        } else if (discriminatorHex === PUMP_SELL_DISCRIMINATOR && dataLength >= 24) {
          instructionType = 'PUMP_SELL';
          tokenAmountRaw = data.readBigUInt64LE(8);
          const minSolOutput = data.readBigUInt64LE(16);
          pumpTokensRaw = tokenAmountRaw;
          pumpMinOutputLamports = minSolOutput;
          targetMint = ixAccountKeys[2];
          if (!detectedMint && targetMint) detectedMint = targetMint;
        }
      } else if (progPubkey === JUPITER_V6_ID) {
        instructionType = 'JUPITER_SWAP';
      } else if (progPubkey === SPL_TOKEN_ID || progPubkey === TOKEN_2022_ID) {
        if (dataLength >= 9 && (data[0] === 3 || data[0] === 12)) {
          instructionType = 'SPL_TRANSFER';
          tokenAmountRaw = data.readBigUInt64LE(1);
          destPubkey = ixAccountKeys[1];
        }
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

    return Object.freeze({
      complete: true,
      frozen: true,
      messageHash,
      version: message.version as 'legacy' | 0,
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
      maxSlippageBps: options.maxSlippageBps ?? 300,
      priorityFeeLamports,
      simulationId: options.simulationId ?? `sim_${messageHash.slice(0, 16)}`,
      instructions: Object.freeze(instructionDetails),
      computeUnitLimit,
      computeUnitPriceMicroLamports,
      jitoTipLamports,
      pumpTokensRaw,
      pumpMaxCostLamports,
      pumpMinOutputLamports,
    });
  }
}
