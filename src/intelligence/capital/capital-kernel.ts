/**
 * SYLPH CAPITAL KERNEL & FORMAL INVARIANTS
 * Parts LXXI, LXXII, LXXIII, LXXIV, XL, XLI, XLII — Deterministic Capital Kernel,
 * Monotonic Authority Lattice, Invariant Suite & Branch-Aware Uncertainty
 *
 * An isolated, deterministic kernel strictly separate from probabilistic AI.
 * It enforces hard safety boundaries, authority modes, and branch-aware accounting.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthorityMode =
  | 'A0_OBSERVE_ONLY'
  | 'A1_CANCEL_ONLY'
  | 'A2_REDUCE_ONLY'
  | 'A3_MAINTAIN'
  | 'A4_LIMITED_INCREASE'
  | 'A5_NORMAL';

export function getAuthorityRank(mode: AuthorityMode): number {
  switch (mode) {
    case 'A0_OBSERVE_ONLY': return 0;
    case 'A1_CANCEL_ONLY': return 1;
    case 'A2_REDUCE_ONLY': return 2;
    case 'A3_MAINTAIN': return 3;
    case 'A4_LIMITED_INCREASE': return 4;
    case 'A5_NORMAL': return 5;
  }
}

export interface InvariantCheckResult {
  readonly invariant_id: string;
  readonly is_passed: boolean;
  readonly severity: 'FATAL' | 'CRITICAL' | 'WARNING';
  readonly message: string;
}

export interface RecoveryCertificate {
  readonly recovery_id: string;
  readonly cause: string;
  readonly previous_authority: AuthorityMode;
  readonly target_authority: AuthorityMode;
  readonly capital_state_root: string;
  readonly position_reconciliation_hash: string;
  readonly provider_status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  readonly market_freshness_ms: number;
  readonly revocation_epoch: number;
  readonly signer_state: 'READY' | 'UNAVAILABLE';
  readonly settlement_state: 'CLEAN' | 'UNCLEAN';
  readonly control_epoch: number;
  readonly timestamp_ms: number;
  readonly evidence_hashes: readonly string[];
  readonly verification_result: boolean;
  readonly signature?: string;
  readonly proof?: string;
}

export interface RecoveryVerifier {
  verify(certificate: RecoveryCertificate, signatureOrProof?: string): boolean;
}

export interface CryptographicRecoveryVerifierOptions {
  secretKey?: string;
  authorizedIssuer?: string;
  maxFreshnessMs?: number;
}

export class CryptographicRecoveryVerifier implements RecoveryVerifier {
  private readonly secretKey: string;
  private readonly authorizedIssuer: string;
  private readonly maxFreshnessMs: number;

  constructor(options?: CryptographicRecoveryVerifierOptions) {
    this.secretKey = options?.secretKey ?? 'sylph-institutional-recovery-key-v1';
    this.authorizedIssuer = options?.authorizedIssuer ?? 'astra-risk-recovery-authority';
    this.maxFreshnessMs = options?.maxFreshnessMs ?? 30_000;
  }

  public computeDigest(certificate: RecoveryCertificate): string {
    const payload = [
      certificate.recovery_id,
      certificate.cause,
      certificate.previous_authority,
      certificate.target_authority,
      certificate.capital_state_root,
      certificate.position_reconciliation_hash,
      certificate.provider_status,
      certificate.market_freshness_ms.toString(),
      certificate.revocation_epoch.toString(),
      certificate.control_epoch.toString(),
      certificate.signer_state,
      certificate.settlement_state,
      certificate.timestamp_ms.toString(),
      certificate.verification_result.toString(),
      [...certificate.evidence_hashes].sort().join(','),
      this.authorizedIssuer,
    ].join(':');

    return createHmac('sha256', this.secretKey).update(payload).digest('hex');
  }

  public sign(certificate: RecoveryCertificate): { certificate: RecoveryCertificate; proof: string } {
    const cert: RecoveryCertificate = {
      ...certificate,
      verification_result: true,
    };
    const proof = this.computeDigest(cert);
    return {
      certificate: {
        ...cert,
        signature: proof,
        proof,
      },
      proof,
    };
  }

  public verify(certificate: RecoveryCertificate, signatureOrProof?: string): boolean {
    const proof = signatureOrProof ?? certificate.signature ?? (certificate as any).proof;
    if (!proof || typeof proof !== 'string') {
      return false;
    }

    if (certificate.verification_result !== true) {
      return false;
    }

    const expectedDigest = this.computeDigest(certificate);
    if (proof.length !== expectedDigest.length) {
      return false;
    }

    const bufProof = Buffer.from(proof, 'utf8');
    const bufExpected = Buffer.from(expectedDigest, 'utf8');
    if (!timingSafeEqual(bufProof, bufExpected)) {
      return false;
    }

    return true;
  }
}

export interface KernelVerificationReport {
  readonly is_authorized: boolean;
  readonly authority_mode: AuthorityMode;
  readonly violated_invariants: readonly InvariantCheckResult[];
  readonly all_invariants_passed: boolean;
  readonly conservative_available_cash_sol: number;
  readonly conservative_max_exposure_sol: number;
  readonly verification_timestamp_ms: number;
}

export interface CapitalKernelOptions {
  maxOpenPositions?: number;
  maxUnknownCapitalSol?: number;
  maxUnresolvedIntents?: number;
  initialAuthority?: AuthorityMode;
  recoveryVerifier?: RecoveryVerifier;
}

export class CapitalKernel {
  private authorityMode: AuthorityMode;
  private readonly maxOpenPositions: number;
  private readonly maxUnknownCapitalSol: number;
  private readonly maxUnresolvedIntents: number;
  private readonly recoveryVerifier?: RecoveryVerifier;

  constructor(options?: CapitalKernelOptions) {
    // Invariant: Bootstrap authority is strictly A0_OBSERVE_ONLY (Master Blueprint Section XXXVIII, LXVII #1)
    this.authorityMode = options?.initialAuthority ?? 'A0_OBSERVE_ONLY';
    this.maxOpenPositions = options?.maxOpenPositions ?? 5;
    this.maxUnknownCapitalSol = options?.maxUnknownCapitalSol ?? 10.0;
    this.maxUnresolvedIntents = options?.maxUnresolvedIntents ?? 3;
    this.recoveryVerifier = options?.recoveryVerifier;
  }

  public getAuthorityMode(): AuthorityMode {
    return this.authorityMode;
  }

  /**
   * Authority lattice downgrade (Part LXXI):
   * Moves strictly downward upon errors or failure signals.
   */
  public downgradeAuthority(targetMode: AuthorityMode, reason: string): AuthorityMode {
    if (getAuthorityRank(targetMode) < getAuthorityRank(this.authorityMode)) {
      this.authorityMode = targetMode;
    }
    return this.authorityMode;
  }

  /**
   * Authority restoration requires explicit proof and complete reconciliation via RecoveryCertificate.
   * Direct boolean restoration without cryptographic certificate verification is strictly rejected (BP §48).
   */
  public restoreAuthority(
    targetModeOrCert: AuthorityMode | RecoveryCertificate,
    proofOrConfirmed?: string | boolean
  ): boolean {
    if (typeof targetModeOrCert === 'object' && targetModeOrCert !== null && 'recovery_id' in targetModeOrCert) {
      return this.restoreAuthorityWithCertificate(
        targetModeOrCert,
        typeof proofOrConfirmed === 'string' ? proofOrConfirmed : undefined
      );
    }
    return false;
  }

  /**
   * Recovery requires a trusted cryptographic verifier and reconciliation of all recovery invariants.
   * Unverified or caller-asserted certificates fail closed to prevent unauthorized authority promotion.
   */
  public restoreAuthorityWithCertificate(
    cert: RecoveryCertificate,
    signatureOrProof?: string
  ): boolean {
    // Fail closed: Caller-asserted certificates without a trusted verifier cannot promote authority
    if (!this.recoveryVerifier) {
      return false;
    }

    // Rule 1: Verification result must be true
    if (cert.verification_result !== true) {
      return false;
    }

    // Cryptographic proof / provenance verification
    const proof = signatureOrProof ?? cert.signature ?? cert.proof;
    if (!this.recoveryVerifier.verify(cert, proof)) {
      return false;
    }

    // Rule 2: Provider health must be HEALTHY
    if (cert.provider_status !== 'HEALTHY') {
      return false;
    }

    // Rule 3: Settlement state must be CLEAN
    if (cert.settlement_state !== 'CLEAN') {
      return false;
    }

    // Rule 4: Signer state must be READY
    if (cert.signer_state !== 'READY') {
      return false;
    }

    // Rule 5: Market data freshness within 30 seconds (0 <= freshness <= 30_000)
    if (typeof cert.market_freshness_ms !== 'number' || cert.market_freshness_ms < 0 || cert.market_freshness_ms > 30_000) {
      return false;
    }

    // Rule 6: Capital state root must be at least 16 chars long
    if (typeof cert.capital_state_root !== 'string' || cert.capital_state_root.length < 16) {
      return false;
    }

    // Rule 7: Position reconciliation hash must be valid non-empty string
    if (typeof cert.position_reconciliation_hash !== 'string' || cert.position_reconciliation_hash.length < 8) {
      return false;
    }

    // Rule 8: Upward lattice progression: rank(target_authority) > rank(this.authorityMode)
    if (getAuthorityRank(cert.target_authority) <= getAuthorityRank(this.authorityMode)) {
      return false;
    }

    // Rule 9: Previous authority must match current kernel authority
    if (cert.previous_authority !== this.authorityMode) {
      return false;
    }

    // Rule 10: Must contain evidence hashes
    if (!Array.isArray(cert.evidence_hashes) || cert.evidence_hashes.length === 0) {
      return false;
    }

    // All rules passed: promote authority
    this.authorityMode = cert.target_authority;
    return true;
  }

  /**
   * Evaluates all 12+ formal non-negotiable invariants (Part LXXIII).
   */
  public verifyCapitalAction(params: {
    action_type: 'INCREASE_EXPOSURE' | 'REDUCE_EXPOSURE' | 'CANCEL' | 'OBSERVE';
    proposed_delta_sol: number;
    confirmed_cash_sol: number;
    reserved_cash_sol: number;
    emergency_reserve_sol: number;
    current_open_positions_count: number;
    unresolved_intents_count: number;
    unknown_capital_sol: number;
    has_active_reservation: boolean;
    has_commit_certificate: boolean;
    has_valid_survival_certificate: boolean;
    request_control_epoch: number;
    active_control_epoch: number;
    request_revocation_epoch: number;
    active_revocation_epoch: number;
    is_proof_revoked: boolean;
    is_lease_valid: boolean;
    confirmed_position_balance_sol?: number;
  }): KernelVerificationReport {
    const results: InvariantCheckResult[] = [];

    // Inv 1: open_positions <= max_open_positions (for new exposure)
    if (params.action_type === 'INCREASE_EXPOSURE') {
      const pCountPass = params.current_open_positions_count < this.maxOpenPositions;
      results.push({
        invariant_id: 'INV_1_MAX_OPEN_POSITIONS',
        is_passed: pCountPass,
        severity: 'FATAL',
        message: pCountPass ? 'Position count in bounds' : `Position count ${params.current_open_positions_count} >= max ${this.maxOpenPositions}`,
      });
    }

    // Inv 2: authorized -> reservation_exists
    const resPass = params.action_type !== 'INCREASE_EXPOSURE' || params.has_active_reservation;
    results.push({
      invariant_id: 'INV_2_RESERVATION_EXISTS',
      is_passed: resPass,
      severity: 'FATAL',
      message: resPass ? 'Reservation verified' : 'No active capital reservation exists for proposed action',
    });

    // Inv 3: authorized -> current_ControlEpoch
    const ctrlPass = params.request_control_epoch === params.active_control_epoch;
    results.push({
      invariant_id: 'INV_3_CONTROL_EPOCH_MATCH',
      is_passed: ctrlPass,
      severity: 'FATAL',
      message: ctrlPass ? 'Control epoch valid' : `Stale control epoch: requested ${params.request_control_epoch}, active ${params.active_control_epoch}`,
    });

    // Inv 4: authorized -> current_RevocationEpoch
    const revPass = params.request_revocation_epoch === params.active_revocation_epoch;
    results.push({
      invariant_id: 'INV_4_REVOCATION_EPOCH_MATCH',
      is_passed: revPass,
      severity: 'FATAL',
      message: revPass ? 'Revocation epoch valid' : `Stale revocation epoch: requested ${params.request_revocation_epoch}, active ${params.active_revocation_epoch}`,
    });

    // Inv 5: entry_signature -> SurvivalCertificate valid (Dual Admission Control)
    if (params.action_type === 'INCREASE_EXPOSURE') {
      const survPass = params.has_valid_survival_certificate;
      results.push({
        invariant_id: 'INV_5_SURVIVAL_CERTIFICATE_VALID',
        is_passed: survPass,
        severity: 'FATAL',
        message: survPass ? 'Survival certificate verified' : 'Missing or expired SurvivalCertificate for entry',
      });
    }

    // Inv 6: exit_amount <= conservative_confirmed_balance
    if (params.action_type === 'REDUCE_EXPOSURE') {
      const maxExit = params.confirmed_position_balance_sol ?? 0;
      const exitPass = params.proposed_delta_sol <= maxExit;
      results.push({
        invariant_id: 'INV_6_EXIT_LEQ_BALANCE',
        is_passed: exitPass,
        severity: 'FATAL',
        message: exitPass ? 'Exit size within balance' : `Attempt to exit ${params.proposed_delta_sol} SOL exceeds confirmed balance ${maxExit} SOL`,
      });
    }

    // Inv 7: available_capital >= 0
    const conservativeAvailableCash = params.confirmed_cash_sol - params.reserved_cash_sol - params.emergency_reserve_sol;
    const availPass = conservativeAvailableCash >= 0;
    results.push({
      invariant_id: 'INV_7_NON_NEGATIVE_AVAILABLE_CASH',
      is_passed: availPass,
      severity: 'FATAL',
      message: availPass ? 'Available capital non-negative' : `Negative available cash: ${conservativeAvailableCash} SOL`,
    });

    // Inv 8: REDUCE_ONLY -> no exposure increase
    if (this.authorityMode === 'A2_REDUCE_ONLY' || this.authorityMode === 'A1_CANCEL_ONLY' || this.authorityMode === 'A0_OBSERVE_ONLY') {
      const modePass = params.action_type !== 'INCREASE_EXPOSURE';
      results.push({
        invariant_id: 'INV_8_REDUCE_ONLY_NO_INCREASE',
        is_passed: modePass,
        severity: 'FATAL',
        message: modePass ? 'Authority mode permits action' : `Exposure increase strictly prohibited in mode ${this.authorityMode}`,
      });
    }

    // Inv 9: revoked_proof -> cannot authorize new exposure increase (Invariant 6 & INV_AUTH_011: REDUCE/CLOSE/CANCEL dominate)
    const proofPass = params.action_type !== 'INCREASE_EXPOSURE' || (!params.is_proof_revoked && params.is_lease_valid);
    results.push({
      invariant_id: 'INV_9_PROOF_NOT_REVOKED',
      is_passed: proofPass,
      severity: 'FATAL',
      message: proofPass ? 'Proof lease valid or action is risk-reducing' : 'Proof is revoked or proof lease has expired for exposure increase',
    });

    // Inv 10: Unknown capital limits (Part XLII)
    const unknownPass = params.unknown_capital_sol <= this.maxUnknownCapitalSol;
    results.push({
      invariant_id: 'INV_10_UNKNOWN_CAPITAL_LIMIT',
      is_passed: unknownPass,
      severity: 'CRITICAL',
      message: unknownPass ? 'Unknown capital in bounds' : `Unknown capital ${params.unknown_capital_sol} SOL exceeds limit ${this.maxUnknownCapitalSol} SOL`,
    });

    // Inv 11: Unresolved intents limit
    const unresolvedPass = params.unresolved_intents_count <= this.maxUnresolvedIntents;
    results.push({
      invariant_id: 'INV_11_UNRESOLVED_INTENTS_LIMIT',
      is_passed: unresolvedPass,
      severity: 'CRITICAL',
      message: unresolvedPass ? 'Unresolved intents in bounds' : `Unresolved intents ${params.unresolved_intents_count} exceeds limit ${this.maxUnresolvedIntents}`,
    });

    const fatalViolations = results.filter((r) => !r.is_passed);
    const allPassed = fatalViolations.length === 0;

    // Automatic downgrade ONLY upon system-integrity failures (Section 10).
    // Local capacity full (INV_1) or single-action checks (INV_2, INV_5, INV_6) reject the action without permanently poisoning global authority.
    const systemIntegrityViolations = fatalViolations.filter((v) =>
      v.invariant_id === 'INV_3_CONTROL_EPOCH_MATCH' ||
      v.invariant_id === 'INV_4_REVOCATION_EPOCH_MATCH' ||
      v.invariant_id === 'INV_7_NON_NEGATIVE_AVAILABLE_CASH' ||
      v.invariant_id === 'INV_9_PROOF_NOT_REVOKED' ||
      v.invariant_id === 'INV_10_UNKNOWN_CAPITAL_LIMIT' ||
      v.invariant_id === 'INV_11_UNRESOLVED_INTENTS_LIMIT'
    );

    if (systemIntegrityViolations.length > 0) {
      this.downgradeAuthority('A2_REDUCE_ONLY', `System-integrity failure: ${systemIntegrityViolations[0].invariant_id}`);
    }

    const conservativeMaxExposure = params.confirmed_cash_sol + params.reserved_cash_sol + params.unknown_capital_sol;

    return {
      is_authorized: allPassed,
      authority_mode: this.authorityMode,
      violated_invariants: fatalViolations,
      all_invariants_passed: allPassed,
      conservative_available_cash_sol: Math.max(0, conservativeAvailableCash),
      conservative_max_exposure_sol: conservativeMaxExposure,
      verification_timestamp_ms: Date.now(),
    };
  }
}
