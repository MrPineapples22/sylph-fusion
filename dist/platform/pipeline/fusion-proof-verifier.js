/**
 * SYLPH FUSION — CROSS-PROOF VERIFIER: JOURNAL + CERTIFICATE + STATE
 * Specifications: Blueprint Section 11 (Cross-Verify Journal + Certificate + State)
 *
 * Invariant: A lifecycle is only verified if the journal, certificate chain,
 * and state roots are strictly cross-verified at EVERY revision.
 */
export function verifyFusionProof(journalEntries, certificates) {
    const errors = [];
    if (journalEntries.length !== certificates.length) {
        errors.push(`LENGTH_MISMATCH: Journal has ${journalEntries.length} entries, certificate chain has ${certificates.length} certificates`);
    }
    const count = Math.min(journalEntries.length, certificates.length);
    for (let n = 0; n < count; n++) {
        const j = journalEntries[n];
        const c = certificates[n];
        // 1. Economic Identity Parity
        if (j.economicFactId !== c.economicFactId) {
            errors.push(`REVISION_${n}_FACT_ID_MISMATCH: Journal fact ${j.economicFactId} != Certificate fact ${c.economicFactId}`);
        }
        // 2. State Transition Parity
        if (j.fromState !== c.fromState) {
            errors.push(`REVISION_${n}_FROM_STATE_MISMATCH: Journal fromState ${j.fromState} != Certificate fromState ${c.fromState}`);
        }
        if (j.toState !== c.toState) {
            errors.push(`REVISION_${n}_TO_STATE_MISMATCH: Journal toState ${j.toState} != Certificate toState ${c.toState}`);
        }
        // 3. State Root Parity
        if (j.previousStateRoot !== c.previousStateRoot) {
            errors.push(`REVISION_${n}_PREV_STATE_ROOT_MISMATCH: Journal prevRoot ${j.previousStateRoot} != Certificate prevRoot ${c.previousStateRoot}`);
        }
        if (j.nextStateRoot !== c.nextStateRoot) {
            errors.push(`REVISION_${n}_NEXT_STATE_ROOT_MISMATCH: Journal nextRoot ${j.nextStateRoot} != Certificate nextRoot ${c.nextStateRoot}`);
        }
        // 4. Certificate Hash Parity
        if (j.certificateHash !== c.certificateHash) {
            errors.push(`REVISION_${n}_CERT_HASH_MISMATCH: Journal certHash ${j.certificateHash} != Certificate hash ${c.certificateHash}`);
        }
        // 5. Envelope Root Parity
        if (j.envelopeRoot !== c.envelopeRoot) {
            errors.push(`REVISION_${n}_ENVELOPE_ROOT_MISMATCH: Journal envRoot ${j.envelopeRoot} != Certificate envRoot ${c.envelopeRoot}`);
        }
    }
    return {
        isValid: errors.length === 0,
        checkedRevisions: count,
        errors,
    };
}
//# sourceMappingURL=fusion-proof-verifier.js.map