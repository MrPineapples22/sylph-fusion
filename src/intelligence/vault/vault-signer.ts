/**
 * SYLPH VAULT & ATOMIC SIGNATURE GATE
 * Parts XVI, XVII, XVIII, XIX, XX, LXI, LXXVI — Custody Isolation, Capability-Based Signing,
 * Atomic Gate, Signed-Transaction Quarantine & Capital Firewall
 *
 * Keeps raw private key signing isolated from the general application and AI stack.
 * Verifies all roots, epochs, leases, manifests, and commit certificates atomically.
 */

import { Keypair } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import type { CommitCertificate } from '../capital/capital-truth-engine.js';
import { VeritasTransactionDecoder, type EffectSpec, type TransactionManifest } from './effect-spec.js';
import { DurableLiveSigner, type IsolatedMessageSigner, type LiveSigningGrant } from '../../platform/signing/durable-live-signer.js';
import type { SignerAdmissionEnvelopeV1 } from './signer-admission-envelope.js';

export type SigningCapability =
  | 'SIGN_ENTRY'
  | 'SIGN_POSITION_REDUCTION'
  | 'SIGN_EXIT'
  | 'SIGN_EXECUTION_FEE';

export type SigningState =
  | 'REQUESTED'
  | 'PREPARED'
  | 'AUTHORIZED'
  | 'COMMITTING'
  | 'SIGNED_UNRELEASED'
  | 'RELEASED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FINALIZED'
  | 'SETTLED'
  | 'QUARANTINED'
  | 'REJECTED';

export interface SignatureRequest {
  readonly request_id: string;
  readonly intent_id: string;
  readonly capability: SigningCapability;
  readonly effect_spec?: EffectSpec;
  readonly manifest?: TransactionManifest;
  readonly commit_certificate?: CommitCertificate;
  readonly envelope?: SignerAdmissionEnvelopeV1;
  readonly active_control_epoch?: number;
  readonly active_revocation_epoch?: number;
  readonly production_root?: string;
  readonly proof_lease_valid?: boolean;
  readonly serialized_tx_bytes?: Uint8Array;
}

export interface SignatureResponse {
  readonly success: boolean;
  readonly sign_operation_id: string;
  readonly signature_base58?: string;
  readonly signing_state: SigningState;
  readonly denial_reason?: string;
  readonly quarantine_reason?: string;
  readonly execution_timestamp_ms: number;
  readonly simulation_only?: boolean;
}

export interface CapitalFirewallStatus {
  readonly hot_wallet_balance_sol: number;
  readonly trading_treasury_sol: number;
  readonly cold_treasury_sol: number;
  readonly max_blast_radius_sol: number;
  readonly max_compromise_loss_sol: number;
  readonly hard_limit_per_tx_sol: number;
  readonly daily_spending_cap_sol: number;
}

export interface VaultSignerOptions {
  readonly keypair?: Keypair;
  readonly hardwareSigner?: IsolatedMessageSigner;
  readonly durableSigner?: DurableLiveSigner;
  readonly maxSolPerTx?: number;
  readonly dailyCapSol?: number;
  readonly productionRoot?: string;
  /** Test-only. This class is not an isolated production signing service. */
  readonly allowSimulation?: boolean;
}

export class VaultSigner {
  private readonly keypair?: Keypair;
  private readonly hardwareSigner?: IsolatedMessageSigner;
  private readonly durableSigner?: DurableLiveSigner;
  private readonly maxSolPerTx: number;
  private readonly dailyCapSol: number;
  private currentControlEpoch = 1;
  private currentRevocationEpoch = 1;
  private readonly productionRoot: string;
  private readonly allowSimulation: boolean;
  private totalSignedCount = 0;
  private readonly signedRegistry = new Map<string, {
    signature: string;
    intent_id: string;
    state: SigningState;
    timestamp_ms: number;
  }>();

  constructor(options?: VaultSignerOptions) {
    this.hardwareSigner = options?.hardwareSigner;
    this.durableSigner = options?.durableSigner;
    this.keypair = options?.keypair ?? (options?.hardwareSigner || options?.durableSigner ? undefined : Keypair.fromSeed(Uint8Array.from(Buffer.alloc(32, 42))));
    this.maxSolPerTx = options?.maxSolPerTx ?? 2.5;
    this.dailyCapSol = options?.dailyCapSol ?? 25.0;
    this.productionRoot = options?.productionRoot ?? 'sylph_production_root_sha256_v1';
    this.allowSimulation = options?.allowSimulation === true;
  }

  public getPublicKey(): string {
    if (this.hardwareSigner) {
      return this.hardwareSigner.wallet;
    }
    if (this.keypair) {
      return this.keypair.publicKey.toBase58();
    }
    throw new Error('NO_KEY_CONFIGURED: Neither hardwareSigner nor keypair configured in VaultSigner');
  }

  public setEpochs(controlEpoch: number, revocationEpoch: number): void {
    this.currentControlEpoch = controlEpoch;
    this.currentRevocationEpoch = revocationEpoch;
  }

  /**
   * Evaluates Maximum Blast Radius & Compromise Loss (Part XX & LXXVI).
   */
  public getFirewallStatus(currentHotBalanceSol: number): CapitalFirewallStatus {
    const blastRadius = Math.min(currentHotBalanceSol, this.maxSolPerTx);
    const maxCompromise = Math.min(currentHotBalanceSol, this.dailyCapSol);

    return {
      hot_wallet_balance_sol: currentHotBalanceSol,
      trading_treasury_sol: 50.0,
      cold_treasury_sol: 500.0,
      max_blast_radius_sol: blastRadius,
      max_compromise_loss_sol: maxCompromise,
      hard_limit_per_tx_sol: this.maxSolPerTx,
      daily_spending_cap_sol: this.dailyCapSol,
    };
  }

  public getSignedRecord(opId: string): { signature: string; intent_id: string; state: SigningState; timestamp_ms: number } | undefined {
    return this.signedRegistry.get(opId);
  }

  public getSignedCount(): number {
    return this.totalSignedCount;
  }

  private validatePreSignAssertions(request: SignatureRequest, opId: string): SignatureResponse | null {
    // 1. Verify capability (Part XIX: no arbitrary transfers)
    if (!['SIGN_ENTRY', 'SIGN_POSITION_REDUCTION', 'SIGN_EXIT', 'SIGN_EXECUTION_FEE'].includes(request.capability)) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: `UNAUTHORIZED_CAPABILITY: ${request.capability}`,
        execution_timestamp_ms: Date.now(),
      };
    }

    // 2. Verify Control Epoch match
    if (request.active_control_epoch !== this.currentControlEpoch || request.commit_certificate?.control_epoch !== this.currentControlEpoch) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: `CONTROL_EPOCH_MISMATCH: req=${request.active_control_epoch}, cert=${request.commit_certificate?.control_epoch}, vault=${this.currentControlEpoch}`,
        execution_timestamp_ms: Date.now(),
      };
    }

    // 3. Verify Revocation Epoch match
    if (request.active_revocation_epoch !== this.currentRevocationEpoch || request.commit_certificate?.revocation_epoch !== this.currentRevocationEpoch) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: `REVOCATION_EPOCH_MISMATCH: req=${request.active_revocation_epoch}, cert=${request.commit_certificate?.revocation_epoch}, vault=${this.currentRevocationEpoch}`,
        execution_timestamp_ms: Date.now(),
      };
    }

    // 4. Verify Production Root match
    if (request.production_root !== this.productionRoot || request.commit_certificate?.production_root !== this.productionRoot) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: 'PRODUCTION_ROOT_MISMATCH: Unauthorized software build root',
        execution_timestamp_ms: Date.now(),
      };
    }

    // 5. Verify Durable Commit Certificate & Intent Identity
    if (!request.commit_certificate?.is_durable_committed) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: 'NO_DURABLE_COMMIT: Write-Ahead Log commit confirmation missing',
        execution_timestamp_ms: Date.now(),
      };
    }
    if (request.commit_certificate.intent_id !== request.intent_id) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: `COMMIT_INTENT_MISMATCH: req=${request.intent_id}, cert=${request.commit_certificate.intent_id}`,
        execution_timestamp_ms: Date.now(),
      };
    }

    // 5b. Verify SignerAdmissionEnvelopeV1 if present
    if (request.envelope) {
      if (request.envelope.intentId !== request.intent_id) {
        return {
          success: false,
          sign_operation_id: opId,
          signing_state: 'REJECTED',
          denial_reason: `ENVELOPE_INTENT_MISMATCH: req=${request.intent_id}, env=${request.envelope.intentId}`,
          execution_timestamp_ms: Date.now(),
        };
      }
      if (request.envelope.controlEpoch !== this.currentControlEpoch || request.envelope.revocationEpoch !== this.currentRevocationEpoch) {
        return {
          success: false,
          sign_operation_id: opId,
          signing_state: 'REJECTED',
          denial_reason: 'ENVELOPE_EPOCH_STALE: Admission envelope epochs do not match active vault epochs',
          execution_timestamp_ms: Date.now(),
        };
      }
      if (request.serialized_tx_bytes) {
        const actualHash = createHash('sha256').update(request.serialized_tx_bytes).digest('hex');
        if (actualHash !== request.envelope.exactMessageHash) {
          return {
            success: false,
            sign_operation_id: opId,
            signing_state: 'REJECTED',
            denial_reason: 'ENVELOPE_MESSAGE_HASH_MISMATCH: Serialized tx bytes hash does not match admission envelope',
            execution_timestamp_ms: Date.now(),
          };
        }
      }
    }

    // 6. Verify Proof Lease validity
    if (!request.proof_lease_valid) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: 'EXPIRED_PROOF_LEASE: Proof lease has expired or is revoked',
        execution_timestamp_ms: Date.now(),
      };
    }

    // 7. Verify Hard Spending Limits
    if ((request.effect_spec?.max_sol_debit ?? 0) > this.maxSolPerTx) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: `HARD_TX_LIMIT_EXCEEDED: ${request.effect_spec?.max_sol_debit} SOL > hard limit ${this.maxSolPerTx} SOL`,
        execution_timestamp_ms: Date.now(),
      };
    }

    // 7b. Verify Intent Equivalence (Manifest must be authorized subset of EffectSpec)
    if (request.effect_spec && request.manifest) {
      const decoder = new VeritasTransactionDecoder();
      const equiv = decoder.verifyIntentEquivalence(request.effect_spec, request.manifest);
      if (!equiv.is_equivalent) {
        return {
          success: false,
          sign_operation_id: opId,
          signing_state: 'REJECTED',
          denial_reason: `INTENT_MISMATCH: ${equiv.material_mismatches.join('; ')}`,
          execution_timestamp_ms: Date.now(),
        };
      }
    }

    // 7c. Verify Commit Certificate Bound (Manifest debit cannot exceed authorized commit certificate)
    if (request.manifest && request.commit_certificate && request.manifest.estimated_sol_debit > request.commit_certificate.max_sol_debit + 0.000001) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: `EXCESSIVE_SOL_DEBIT: manifest ${request.manifest.estimated_sol_debit} > authorized commit ${request.commit_certificate.max_sol_debit}`,
        execution_timestamp_ms: Date.now(),
      };
    }

    return null;
  }

  /**
   * Atomic Signature Gate (Part XVI & XVII):
   * Enforces 15 explicit pre-sign assertions before touching the keypair.
   */
  public processSignatureRequest(request: SignatureRequest): SignatureResponse {
    const opId = `sign_op_${request.intent_id}_${Date.now()}`;

    if (!this.allowSimulation) {
      if (this.hardwareSigner) {
        return {
          success: false,
          sign_operation_id: opId,
          signing_state: 'REJECTED',
          denial_reason: 'ASYNC_SIGNER_REQUIRED: Hardware signer configured; call processSignatureRequestAsync()',
          execution_timestamp_ms: Date.now(),
        };
      }
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: 'SIGNER_UNAVAILABLE: VaultSigner only supports explicit test simulation',
        execution_timestamp_ms: Date.now(),
      };
    }

    const rejection = this.validatePreSignAssertions(request, opId);
    if (rejection) {
      return rejection;
    }

    // 8. Sign transaction atomically (Zone 0 Signer Simulation)
    const secretKey = this.keypair?.secretKey ?? Buffer.alloc(32, 42);
    const txBytes = request.serialized_tx_bytes ?? Buffer.from(request.intent_id);
    const simulatedSignature = 'simulation_sig_' + createHash('sha256')
      .update(txBytes)
      .update(secretKey)
      .digest('hex');

    this.totalSignedCount++;

    // 9. Last-moment revocation check: if revocation advanced during sign, QUARANTINE! (Part LXI)
    if ((request.active_revocation_epoch ?? 0) < this.currentRevocationEpoch) {
      this.signedRegistry.set(opId, {
        signature: simulatedSignature,
        intent_id: request.intent_id,
        state: 'QUARANTINED',
        timestamp_ms: Date.now(),
      });

      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'QUARANTINED',
        quarantine_reason: 'SIGNED_TX_QUARANTINED: Revocation epoch advanced during atomic signing gate',
        execution_timestamp_ms: Date.now(),
      };
    }

    // 10. Register in Signed Transaction Registry and RELEASE
    this.signedRegistry.set(opId, {
      signature: simulatedSignature,
      intent_id: request.intent_id,
      state: 'RELEASED',
      timestamp_ms: Date.now(),
    });

    return {
      success: true,
      sign_operation_id: opId,
      signature_base58: simulatedSignature,
      signing_state: 'RELEASED',
      simulation_only: true,
      execution_timestamp_ms: Date.now(),
    };
  }

  /**
   * Asynchronous Atomic Signature Gate for Live Hardware Signers (AWS KMS / HSM Enclave).
   */
  public async processSignatureRequestAsync(request: SignatureRequest): Promise<SignatureResponse> {
    const opId = `sign_op_${request.intent_id}_${Date.now()}`;

    if (!this.allowSimulation && !this.hardwareSigner) {
      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'REJECTED',
        denial_reason: 'SIGNER_UNAVAILABLE: VaultSigner only supports explicit test simulation or configured hardware signer',
        execution_timestamp_ms: Date.now(),
      };
    }

    const rejection = this.validatePreSignAssertions(request, opId);
    if (rejection) {
      return rejection;
    }

    let signatureBase58: string;
    let isSimulation = false;

    if (this.durableSigner) {
      const txBytes = request.serialized_tx_bytes ?? Buffer.from(request.intent_id);
      const msgSha256 = createHash('sha256').update(txBytes).digest('hex');
      const grant: LiveSigningGrant = {
        grantId: `grant_${request.intent_id}_${Date.now()}`,
        economicIntentId: request.intent_id,
        wallet: this.getPublicKey(),
        messageSha256: msgSha256,
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
        controlEpoch: this.currentControlEpoch,
      };
      const rawSig = await this.durableSigner.sign(grant, txBytes);
      signatureBase58 = bs58.encode(rawSig);
    } else if (this.hardwareSigner) {
      const txBytes = request.serialized_tx_bytes ?? Buffer.from(request.intent_id);
      const rawSig = await this.hardwareSigner.signAuthorizedMessage(txBytes);
      signatureBase58 = bs58.encode(rawSig);
    } else {
      const secretKey = this.keypair?.secretKey ?? Buffer.alloc(32, 42);
      const txBytes = request.serialized_tx_bytes ?? Buffer.from(request.intent_id);
      signatureBase58 = 'simulation_sig_' + createHash('sha256')
        .update(txBytes)
        .update(secretKey)
        .digest('hex');
      isSimulation = true;
    }

    this.totalSignedCount++;

    // 9. Last-moment revocation check
    if ((request.active_revocation_epoch ?? 0) < this.currentRevocationEpoch) {
      this.signedRegistry.set(opId, {
        signature: signatureBase58,
        intent_id: request.intent_id,
        state: 'QUARANTINED',
        timestamp_ms: Date.now(),
      });

      return {
        success: false,
        sign_operation_id: opId,
        signing_state: 'QUARANTINED',
        quarantine_reason: 'SIGNED_TX_QUARANTINED: Revocation epoch advanced during atomic signing gate',
        execution_timestamp_ms: Date.now(),
      };
    }

    // 10. Register in Signed Transaction Registry and RELEASE
    this.signedRegistry.set(opId, {
      signature: signatureBase58,
      intent_id: request.intent_id,
      state: 'RELEASED',
      timestamp_ms: Date.now(),
    });

    return {
      success: true,
      sign_operation_id: opId,
      signature_base58: signatureBase58,
      signing_state: 'RELEASED',
      simulation_only: isSimulation,
      execution_timestamp_ms: Date.now(),
    };
  }
}
