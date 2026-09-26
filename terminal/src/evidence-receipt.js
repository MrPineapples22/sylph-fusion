/**
 * Rich intelligence panels may contain explanatory display fallbacks. Only a
 * source that explicitly attests both verification and complete coverage may
 * unlock those panels.
 */
export const MAX_EVIDENCE_RECEIPT_WINDOW_MS = 15_000;

export function hasCompleteVerifiedEvidence(receipt, now = Date.now()) {
  return receipt?.evidenceStatus === 'VERIFIED'
    && receipt?.evidenceCompleteness === 'COMPLETE'
    && Number.isFinite(receipt?.generatedAt)
    && Number.isFinite(receipt?.validUntil)
    && receipt.generatedAt <= now
    && receipt.validUntil >= receipt.generatedAt
    && receipt.validUntil - receipt.generatedAt <= MAX_EVIDENCE_RECEIPT_WINDOW_MS
    && now <= receipt.validUntil;
}
