/**
 * SYLPH FUSION — ASSURANCE FABRIC: IMMUTABLE RECEIPT CHAIN
 * Specifications: Master Blueprint Section XLVI (Immutable Receipt Chain)
 *
 * Implements 8 strictly chained cryptographic receipts:
 * BuiltReceipt -> SimulationReceipt -> AuthorizationReceipt -> SigningReceipt ->
 * SubmissionReceipt -> LandingReceipt -> FinalityReceipt -> SettlementReceipt.
 *
 * Invariant: Each receipt hashes the previous receipt.
 */
import { createHash } from 'node:crypto';
export class ImmutableReceiptChain {
    static GENESIS_PREV_HASH = '0'.repeat(64);
    receipts = [];
    getChain() {
        return Object.freeze([...this.receipts]);
    }
    getLatestReceipt() {
        return this.receipts[this.receipts.length - 1];
    }
    computeHash(payload, prevHash, stage, timestampMs) {
        const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
        return createHash('sha256').update(`${stage}:${prevHash}:${timestampMs}:${serialized}`).digest('hex');
    }
    recordBuilt(params) {
        const prevReceiptHash = this.receipts.length > 0 ? this.receipts[this.receipts.length - 1].receiptHash : ImmutableReceiptChain.GENESIS_PREV_HASH;
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prevReceiptHash, 'BUILT', timestampMs);
        const receipt = {
            ...params,
            stage: 'BUILT',
            prevReceiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_built_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordSimulation(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'BUILT')
            throw new Error('CHAIN_ORDER_ERROR: SimulationReceipt requires prior BuiltReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'SIMULATION', timestampMs);
        const receipt = {
            ...params,
            stage: 'SIMULATION',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_sim_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordAuthorization(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'SIMULATION')
            throw new Error('CHAIN_ORDER_ERROR: AuthorizationReceipt requires prior SimulationReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'AUTHORIZATION', timestampMs);
        const receipt = {
            ...params,
            stage: 'AUTHORIZATION',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_auth_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordSigning(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'AUTHORIZATION')
            throw new Error('CHAIN_ORDER_ERROR: SigningReceipt requires prior AuthorizationReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'SIGNING', timestampMs);
        const receipt = {
            ...params,
            stage: 'SIGNING',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_sign_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordSubmission(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'SIGNING')
            throw new Error('CHAIN_ORDER_ERROR: SubmissionReceipt requires prior SigningReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'SUBMISSION', timestampMs);
        const receipt = {
            ...params,
            stage: 'SUBMISSION',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_sub_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordLanding(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'SUBMISSION')
            throw new Error('CHAIN_ORDER_ERROR: LandingReceipt requires prior SubmissionReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'LANDING', timestampMs);
        const receipt = {
            ...params,
            stage: 'LANDING',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_land_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordFinality(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'LANDING')
            throw new Error('CHAIN_ORDER_ERROR: FinalityReceipt requires prior LandingReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'FINALITY', timestampMs);
        const receipt = {
            ...params,
            stage: 'FINALITY',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_fin_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    recordSettlement(params) {
        const prev = this.getLatestReceipt();
        if (!prev || prev.stage !== 'FINALITY')
            throw new Error('CHAIN_ORDER_ERROR: SettlementReceipt requires prior FinalityReceipt');
        const timestampMs = Date.now();
        const receiptHash = this.computeHash(params, prev.receiptHash, 'SETTLEMENT', timestampMs);
        const receipt = {
            ...params,
            stage: 'SETTLEMENT',
            prevReceiptHash: prev.receiptHash,
            timestampMs,
            receiptHash,
            receiptId: `rcpt_settle_${receiptHash.slice(0, 16)}`,
        };
        this.receipts.push(receipt);
        return receipt;
    }
    verifyIntegrity() {
        for (let i = 0; i < this.receipts.length; i++) {
            const receipt = this.receipts[i];
            const expectedPrev = i === 0 ? ImmutableReceiptChain.GENESIS_PREV_HASH : this.receipts[i - 1].receiptHash;
            if (receipt.prevReceiptHash !== expectedPrev) {
                return { isValid: false, brokenIndex: i, reason: `PREV_HASH_MISMATCH at index ${i}` };
            }
        }
        return { isValid: true };
    }
}
//# sourceMappingURL=receipt-chain.js.map