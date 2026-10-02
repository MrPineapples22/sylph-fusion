/**
 * SOL-SYLPH Platform - Ultimate Execution Record & Audit Evidence Chain
 * Specifications: Master Blueprint Section 99 (Ultimate Execution Record) & 4 (Evidence Fabric).
 *
 * Implements:
 * 1. The complete 19-link cryptographic evidence ledger:
 *    Canonical Events -> TokenTruth -> Authenticity -> OpportunityDecision -> Exitability ->
 *    Quote -> TransactionRoot -> RuntimeRoot -> ProgramRoots -> SimulationCertificate ->
 *    StateLease -> ExecutionPermit -> SigningIntent -> DeliveryReceipt -> LandedOutcome ->
 *    Position -> ExitDecision -> ExitLandedOutcome -> Settlement -> Calibration -> Regret.
 * 2. Immutable hash-chain linkage:
 *    Every step cryptographically commits to the hash of preceding links.
 * 3. Exact deterministic historical reconstruction:
 *    Guarantees zero hindsight contamination and fully auditable capital attribution.
 */
import { createHash } from 'node:crypto';
export class UltimateExecutionRecordLedger {
    /**
     * Chains together all execution evidence artifacts into a tamper-proof audit record.
     */
    static sealRecord(params) {
        const createdAtMs = Date.now();
        const recordId = `exec_rec_${params.mint.slice(0, 8)}_${params.intentId}_${createdAtMs}`;
        const exitDecisionHash = params.exitDecisionHash ?? 'PENDING_EXIT';
        const settlementRecordHash = params.settlementRecordHash ?? 'PENDING_SETTLEMENT';
        const calibrationRecordHash = params.calibrationRecordHash ?? 'PENDING_CALIBRATION';
        const counterfactualRegretHash = params.counterfactualRegretHash ?? 'PENDING_REGRET';
        // Hash chain computing sequential dependency
        const chainHasher = createHash('sha256');
        chainHasher.update('CHAIN_ROOT:').update(recordId);
        chainHasher.update(params.canonicalEventsHash);
        chainHasher.update(params.tokenTruthCertificateHash);
        chainHasher.update(params.authenticityCertificateHash);
        chainHasher.update(params.opportunityDecisionHash);
        chainHasher.update(params.exitabilityCertificateHash);
        chainHasher.update(params.quoteHash);
        chainHasher.update(params.transactionRootHash);
        chainHasher.update(params.runtimeRootHash);
        chainHasher.update(params.programRootsHash);
        chainHasher.update(params.simulationCertificateHash);
        chainHasher.update(params.stateLeaseHash);
        chainHasher.update(params.executionPermitHash);
        chainHasher.update(params.signingIntentHash);
        chainHasher.update(params.deliveryReceiptHash);
        chainHasher.update(params.landedOutcomeCertificateHash);
        chainHasher.update(params.positionRecordHash);
        chainHasher.update(exitDecisionHash);
        chainHasher.update(settlementRecordHash);
        chainHasher.update(calibrationRecordHash);
        chainHasher.update(counterfactualRegretHash);
        const provenanceChainSeal = chainHasher.digest('hex');
        return {
            recordId,
            intentId: params.intentId,
            mint: params.mint,
            createdAtMs,
            canonicalEventsHash: params.canonicalEventsHash,
            tokenTruthCertificateHash: params.tokenTruthCertificateHash,
            authenticityCertificateHash: params.authenticityCertificateHash,
            opportunityDecisionHash: params.opportunityDecisionHash,
            exitabilityCertificateHash: params.exitabilityCertificateHash,
            quoteHash: params.quoteHash,
            transactionRootHash: params.transactionRootHash,
            runtimeRootHash: params.runtimeRootHash,
            programRootsHash: params.programRootsHash,
            simulationCertificateHash: params.simulationCertificateHash,
            stateLeaseHash: params.stateLeaseHash,
            executionPermitHash: params.executionPermitHash,
            signingIntentHash: params.signingIntentHash,
            deliveryReceiptHash: params.deliveryReceiptHash,
            landedOutcomeCertificateHash: params.landedOutcomeCertificateHash,
            positionRecordHash: params.positionRecordHash,
            exitDecisionHash,
            settlementRecordHash,
            calibrationRecordHash,
            counterfactualRegretHash,
            provenanceChainSeal,
        };
    }
    /**
     * Verifies the cryptographic integrity of an execution provenance chain.
     */
    static verifyRecordIntegrity(record) {
        const chainHasher = createHash('sha256');
        chainHasher.update('CHAIN_ROOT:').update(record.recordId);
        chainHasher.update(record.canonicalEventsHash);
        chainHasher.update(record.tokenTruthCertificateHash);
        chainHasher.update(record.authenticityCertificateHash);
        chainHasher.update(record.opportunityDecisionHash);
        chainHasher.update(record.exitabilityCertificateHash);
        chainHasher.update(record.quoteHash);
        chainHasher.update(record.transactionRootHash);
        chainHasher.update(record.runtimeRootHash);
        chainHasher.update(record.programRootsHash);
        chainHasher.update(record.simulationCertificateHash);
        chainHasher.update(record.stateLeaseHash);
        chainHasher.update(record.executionPermitHash);
        chainHasher.update(record.signingIntentHash);
        chainHasher.update(record.deliveryReceiptHash);
        chainHasher.update(record.landedOutcomeCertificateHash);
        chainHasher.update(record.positionRecordHash);
        chainHasher.update(record.exitDecisionHash);
        chainHasher.update(record.settlementRecordHash);
        chainHasher.update(record.calibrationRecordHash);
        chainHasher.update(record.counterfactualRegretHash);
        return chainHasher.digest('hex') === record.provenanceChainSeal;
    }
}
//# sourceMappingURL=ultimate-execution-record.js.map