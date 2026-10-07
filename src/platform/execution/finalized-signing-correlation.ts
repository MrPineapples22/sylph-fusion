import bs58 from 'bs58';
import type { FinalizedTransactionCpiEvidence } from '../ingestion/finalized-block-auditor.js';
import type { PersistedSigningIntent } from '../signing/durable-live-signer.js';

export type FinalizedSigningCorrelation =
  | 'MATCHED_REPORTED_SIGNING_IDENTITY'
  | 'MISMATCHED_REPORTED_SIGNING_IDENTITY'
  | 'UNAVAILABLE_SIGNING_INTENT_BINDING';

/** Diagnostic field comparison only; it cannot authenticate persisted evidence, certify settlement, or release a reservation. */
export function correlateFinalizedTransactionToSigningIntent(
  evidence: FinalizedTransactionCpiEvidence,
  intent: PersistedSigningIntent | null,
): FinalizedSigningCorrelation {
  if (!evidence || !intent || intent.state !== 'SIGNED' || typeof intent.signatureBase64 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(intent.messageSha256) || !evidence.messageSha256 || !evidence.accountKeys ||
      evidence.messageSignatureBinding !== 'VERIFIED') {
    return 'UNAVAILABLE_SIGNING_INTENT_BINDING';
  }
  if (evidence.accountKeys[0] !== intent.wallet) return 'UNAVAILABLE_SIGNING_INTENT_BINDING';
  try {
    const signatureBytes = Buffer.from(intent.signatureBase64, 'base64');
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== intent.signatureBase64) {
      return 'UNAVAILABLE_SIGNING_INTENT_BINDING';
    }
    const observedSignature = bs58.decode(evidence.signature);
    if (observedSignature.length !== 64 || !Buffer.from(observedSignature).equals(signatureBytes) ||
        evidence.messageSha256 !== intent.messageSha256) {
      return 'MISMATCHED_REPORTED_SIGNING_IDENTITY';
    }
    return 'MATCHED_REPORTED_SIGNING_IDENTITY';
  } catch {
    return 'UNAVAILABLE_SIGNING_INTENT_BINDING';
  }
}
