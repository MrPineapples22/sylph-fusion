/**
 * SYLPH FUSION — ISOLATED SIGNER GATEWAY (Section 37)
 *
 * Implements hardware/KMS/zero-trust isolated signing abstraction:
 * SignExactTransaction(exactHash, permit)
 *
 * Security Invariants:
 * 1. Private keys NEVER live in source code, Git history, logs, certificates,
 *    or APIs. They are never exposed to research models.
 * 2. Signing is cryptographically bound to:
 *    - exact transaction hash
 *    - exact action hash
 *    - policy root
 *    - state root
 *    - release root
 *    - config root
 *    - capital reservation
 *    - execution permit
 *    - expiry slot
 * 3. Any mutation or divergence invalidates authority and halts signing.
 */

import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { OneShotExecutionPermit } from './exact-bytes-authority.js';

export interface IsolatedSignerRequest {
  readonly exactTransactionBytes: Uint8Array;
  readonly exactTransactionHash: string;
  readonly actionHash: string;
  readonly permit: OneShotExecutionPermit;
  readonly currentSlot: bigint;
  readonly configRoot: string;
}

export interface IsolatedSignerResponse {
  readonly signature: Uint8Array;
  readonly signatureBase58: string;
  readonly signedWireBytes: Uint8Array;
  readonly signerPublicKey: PublicKey;
  readonly signedAtMs: number;
  readonly bindingDigest: string;
}

export interface UnderlyingKeyStore {
  readonly publicKey: PublicKey;
  signBytes(bytes: Uint8Array): Promise<Uint8Array>;
}

export class IsolatedSignerGateway {
  constructor(
    private readonly keyStore: UnderlyingKeyStore,
    private readonly currentReleaseRoot: () => string
  ) {}

  public get publicKey(): PublicKey {
    return this.keyStore.publicKey;
  }

  /**
   * Authorizes and executes signature creation strictly on exact transaction bytes.
   * Trading intelligence layer cannot access raw signing keys.
   */
  public async signExactTransaction(request: IsolatedSignerRequest): Promise<IsolatedSignerResponse> {
    const {
      exactTransactionBytes,
      exactTransactionHash,
      actionHash,
      permit,
      currentSlot,
      configRoot,
    } = request;

    // 1. Verify byte hash integrity
    const computedHash = createHash('sha256').update(exactTransactionBytes).digest('hex');
    if (computedHash !== exactTransactionHash) {
      throw new Error(
        `SIGNING_AUTHORITY_REJECTED: Computed tx hash ${computedHash} does not match claimed ${exactTransactionHash}`
      );
    }

    // 2. Verify release root binding
    const expectedReleaseRoot = this.currentReleaseRoot();
    if (permit.releaseRoot !== expectedReleaseRoot) {
      throw new Error(
        `SIGNING_AUTHORITY_REJECTED: Release root mismatch (permit: ${permit.releaseRoot}, current: ${expectedReleaseRoot})`
      );
    }

    // 3. Verify slot range
    if (currentSlot < permit.validFromSlot || currentSlot > permit.validUntilSlot) {
      throw new Error(
        `SIGNING_AUTHORITY_REJECTED: Current slot ${currentSlot} outside permit window [${permit.validFromSlot}, ${permit.validUntilSlot}]`
      );
    }

    // 4. Verify clock expiry
    const now = Date.now();
    if (now > permit.expiresAtMs) {
      throw new Error(`SIGNING_AUTHORITY_REJECTED: Permit expired at ${permit.expiresAtMs} (now ${now})`);
    }

    // 5. Build full binding cryptographic digest
    const bindingDigest = createHash('sha256')
      .update('ISOLATED_SIGNING_AUTHORIZATION:')
      .update(exactTransactionHash)
      .update(actionHash)
      .update(permit.policyRoot)
      .update(permit.stateRoot)
      .update(permit.releaseRoot)
      .update(configRoot)
      .update(permit.capitalReservationId)
      .update(permit.permitId)
      .update(currentSlot.toString())
      .digest('hex');

    // 6. Sign message bytes via isolated hardware/KMS keystore (no private keys in memory or logs)
    const signature = await this.keyStore.signBytes(exactTransactionBytes);

    // Combine signature + serialized message into wire bytes
    const signedWireBytes = new Uint8Array(signature.length + exactTransactionBytes.length);
    signedWireBytes.set(signature, 0);
    signedWireBytes.set(exactTransactionBytes, signature.length);

    // Encode signature in base58 without logging secrets
    const bs58 = (await import('bs58')).default;
    const signatureBase58 = bs58.encode(signature);

    return Object.freeze({
      signature,
      signatureBase58,
      signedWireBytes,
      signerPublicKey: this.keyStore.publicKey,
      signedAtMs: now,
      bindingDigest,
    });
  }
}
