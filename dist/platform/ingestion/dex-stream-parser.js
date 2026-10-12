/**
 * Research-only DEX transaction envelope inspector.
 * Exact known program IDs identify a candidate protocol; this module does not
 * decode protocol instructions, infer token identity, or estimate trade amounts.
 */
import { createHash } from 'node:crypto';
export class DEXStreamParser {
    static PROGRAMS = {
        '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'PUMP_FUN',
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'RAYDIUM_AMM_V4',
        'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'METEORA_DLMM',
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'WHIRLPOOL_ORCA',
    };
    totalInspected = 0;
    totalErrors = 0;
    /** Logs are intentionally excluded: generic instruction names are ambiguous. */
    identifyProtocol(programId) {
        return programId ? DEXStreamParser.PROGRAMS[programId] ?? 'UNKNOWN_DEX' : 'UNKNOWN_DEX';
    }
    /** Return an observation envelope, not a decoded trade or financial fact. */
    parseTransaction(raw) {
        if (!raw || !Number.isSafeInteger(raw.slot) || raw.slot < 0 ||
            (raw.signature !== undefined && (typeof raw.signature !== 'string' || !raw.signature))) {
            this.totalErrors += 1;
            throw new Error('INVALID_RAW_TRANSACTION');
        }
        this.totalInspected += 1;
        const parsedAtMs = Date.now();
        const programId = typeof raw.programId === 'string' ? raw.programId : null;
        const isSuccess = Object.hasOwn(raw, 'err') ? raw.err === null : null;
        const observationHash = createHash('sha256')
            .update(`${raw.signature ?? 'UNKNOWN'}:${raw.slot}:${programId ?? 'UNKNOWN'}`)
            .digest('hex');
        return {
            protocol: this.identifyProtocol(programId ?? undefined),
            decodeStatus: 'NOT_DECODED',
            tradeType: 'UNKNOWN',
            mint: null,
            userPubkey: null,
            inAmountSol: null,
            outAmountTokens: null,
            priceSol: null,
            slot: raw.slot,
            signature: raw.signature ?? null,
            isSuccess,
            parsedAtMs,
            observationHash,
        };
    }
    getStats() {
        return { totalInspected: this.totalInspected, totalErrors: this.totalErrors };
    }
}
//# sourceMappingURL=dex-stream-parser.js.map