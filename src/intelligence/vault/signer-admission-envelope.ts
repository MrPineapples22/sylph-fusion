/**
 * SYLPH FUSION — Signer Admission Envelope V1
 * Architectural Directive: No verified SignerAdmissionEnvelope -> No exposure-increasing signature.
 *
 * Cryptographically binds capital reservations, commit certificates, execution witness digests,
 * control/revocation epochs, fee ceilings, and exact message hashes before signing admission.
 */

import { createHash } from 'node:crypto';

export interface SignerAdmissionEnvelopeV1 {
  readonly envelopeId: string;
  readonly intentId: string;
  readonly reservationId: string;
  readonly commitGeneration: number;
  readonly commitDigest: string;
  readonly exactMessageHash: string;
  readonly executionWitnessDigest: string;
  readonly controlEpoch: number;
  readonly revocationEpoch: number;
  readonly maxPrincipalLamports: bigint;
  readonly maxNetworkFeeLamports: bigint;
  readonly maxPriorityFeeLamports: bigint;
  readonly maxTipLamports: bigint;
  readonly expiresAtSlot: number;
  readonly envelopeHash: string;
}

export function createSignerAdmissionEnvelope(params: {
  intentId: string;
  reservationId: string;
  commitGeneration: number;
  commitDigest: string;
  exactMessageHash: string;
  executionWitnessDigest: string;
  controlEpoch: number;
  revocationEpoch: number;
  maxPrincipalLamports: bigint;
  maxNetworkFeeLamports: bigint;
  maxPriorityFeeLamports: bigint;
  maxTipLamports: bigint;
  expiresAtSlot: number;
}): SignerAdmissionEnvelopeV1 {
  const payload = [
    params.intentId,
    params.reservationId,
    params.commitGeneration.toString(),
    params.commitDigest,
    params.exactMessageHash,
    params.executionWitnessDigest,
    params.controlEpoch.toString(),
    params.revocationEpoch.toString(),
    params.maxPrincipalLamports.toString(),
    params.maxNetworkFeeLamports.toString(),
    params.maxPriorityFeeLamports.toString(),
    params.maxTipLamports.toString(),
    params.expiresAtSlot.toString(),
  ].join(':');

  const envelopeHash = createHash('sha256').update(payload).digest('hex');
  const envelopeId = `ADMIT-${envelopeHash.slice(0, 16)}`;

  return Object.freeze({
    envelopeId,
    intentId: params.intentId,
    reservationId: params.reservationId,
    commitGeneration: params.commitGeneration,
    commitDigest: params.commitDigest,
    exactMessageHash: params.exactMessageHash,
    executionWitnessDigest: params.executionWitnessDigest,
    controlEpoch: params.controlEpoch,
    revocationEpoch: params.revocationEpoch,
    maxPrincipalLamports: params.maxPrincipalLamports,
    maxNetworkFeeLamports: params.maxNetworkFeeLamports,
    maxPriorityFeeLamports: params.maxPriorityFeeLamports,
    maxTipLamports: params.maxTipLamports,
    expiresAtSlot: params.expiresAtSlot,
    envelopeHash,
  });
}
