/**
 * SYLPH FUSION — PROGRAMROOT & STATECODEC PROTOCOL GENERATIONS
 * Specifications: Sections 16 (StateCodec Protocol Generations), 17 (ProgramRoot Binary Identity), 103 (Invariant 15)
 *
 * Invariants:
 * 1. Static program-ID allowlists are insufficient: track program binary hash, loader, upgrade authority, and IDL hash.
 * 2. Any program binary drift:
 *    OPEN -> BLOCK
 *    INCREASE -> BLOCK
 *    until re-certified.
 * 3. Support protocol schema generations (old vs new Pump bonding curve and PumpSwap layouts).
 * 4. AccountLayoutCertificate & ProtocolSchemaLease enforce exact account length, discriminator, and layout generation.
 */

import { createHash } from 'node:crypto';

export type ProgramCertificationStatus = 'CERTIFIED' | 'DRIFTED' | 'UNVERIFIED' | 'REVOKED';

export interface ProgramBinaryCertificate {
  readonly programId: string;
  readonly loader: string;
  readonly programDataAddress: string;
  readonly binarySha256: string;
  readonly upgradeAuthority: string | null; // null if locked/immutable
  readonly lastUpgradeSlot: number;
  readonly idlHash: string;
  readonly certifiedAtMs: number;
  readonly certifiedSlot: number;
  readonly status: ProgramCertificationStatus;
}

export type SupportedProtocol = 'PUMP_FUN' | 'PUMP_SWAP' | 'RAYDIUM_AMM' | 'METEORA_DLMM' | 'JUPITER_ROUTER';

export interface AccountLayoutCertificate {
  readonly protocol: SupportedProtocol;
  readonly accountType: string; // e.g. 'BondingCurve', 'GlobalConfig', 'PoolState'
  readonly discriminatorHex: string;
  readonly accountLengthBytes: number;
  readonly layoutGeneration: number; // Gen 1 (legacy), Gen 2 (Token-2022 / fee-recipient expanded)
  readonly appendedFieldDefaults: Readonly<Record<string, unknown>>;
  readonly decoderVersion: string;
  readonly sdkVersion: string;
  readonly rentExemptionLamports: bigint;
  readonly isExpandable: boolean;
  readonly certificateDigest: string;
}

export interface ProtocolMaintenancePlan {
  readonly expansionNeeded: boolean;
  readonly additionalBytes: number;
  readonly additionalRentLamports: bigint;
  readonly requiresReallocInstruction: boolean;
  readonly targetAccount: string;
}

export interface ProtocolSchemaLease {
  readonly leaseId: string;
  readonly protocol: SupportedProtocol;
  readonly layoutCertificates: readonly AccountLayoutCertificate[];
  readonly issuedAtSlot: number;
  readonly expiresAtSlot: number;
  readonly maintenancePlan?: ProtocolMaintenancePlan;
  isValid(currentSlot: number): boolean;
}

export class ProgramRootAuthority {
  private certifiedPrograms = new Map<string, ProgramBinaryCertificate>();
  private layoutCertificates = new Map<string, AccountLayoutCertificate[]>();
  private activeLeases = new Map<string, ProtocolSchemaLease>();

  /**
   * Registers or updates a certified program binary snapshot.
   */
  public registerCertifiedProgram(cert: ProgramBinaryCertificate): void {
    this.certifiedPrograms.set(cert.programId, cert);
  }

  /**
   * Verifies the observed on-chain binary integrity of a program against its certified root.
   * If binary drift or unexpected upgrade is detected:
   * OPEN -> BLOCK
   * INCREASE -> BLOCK
   */
  public verifyProgramIntegrity(
    programId: string,
    observedBinaryHash: string,
    observedSlot: number
  ): { allowed: boolean; status: ProgramCertificationStatus; reason?: string } {
    const cert = this.certifiedPrograms.get(programId);
    if (!cert) {
      return {
        allowed: false,
        status: 'UNVERIFIED',
        reason: `Program ${programId} has no registered ProgramBinaryCertificate in PROGRAMROOT`
      };
    }

    if (cert.status === 'REVOKED') {
      return {
        allowed: false,
        status: 'REVOKED',
        reason: `Program ${programId} has been revoked by security authority`
      };
    }

    if (cert.binarySha256 !== observedBinaryHash) {
      // Binary drift detected! Fail-closed: block OPEN and INCREASE
      return {
        allowed: false,
        status: 'DRIFTED',
        reason: `CRITICAL: Program ${programId} binary hash drifted! Expected ${cert.binarySha256}, observed ${observedBinaryHash} at slot ${observedSlot}`
      };
    }

    return {
      allowed: true,
      status: 'CERTIFIED'
    };
  }

  /**
   * Registers a certified account layout schema generation for a protocol.
   */
  public registerLayoutCertificate(cert: AccountLayoutCertificate): void {
    const list = this.layoutCertificates.get(cert.protocol) ?? [];
    // Replace if same accountType and layoutGeneration, or append
    const idx = list.findIndex(
      (c) => c.accountType === cert.accountType && c.layoutGeneration === cert.layoutGeneration
    );
    if (idx >= 0) {
      list[idx] = cert;
    } else {
      list.push(cert);
    }
    this.layoutCertificates.set(cert.protocol, list);
  }

  /**
   * Returns matching layout certificate for an account's observed byte length and discriminator.
   */
  public resolveAccountLayout(
    protocol: SupportedProtocol,
    accountType: string,
    observedLengthBytes: number,
    observedDiscriminatorHex: string
  ): AccountLayoutCertificate | null {
    const list = this.layoutCertificates.get(protocol) ?? [];
    return (
      list.find(
        (c) =>
          c.accountType === accountType &&
          c.accountLengthBytes === observedLengthBytes &&
          c.discriminatorHex.toLowerCase() === observedDiscriminatorHex.toLowerCase()
      ) ?? null
    );
  }

  /**
   * Issues a renewable ProtocolSchemaLease for the given protocol and slot window.
   */
  public acquireSchemaLease(
    protocol: SupportedProtocol,
    currentSlot: number,
    validitySlots: number = 300,
    maintenancePlan?: ProtocolMaintenancePlan
  ): ProtocolSchemaLease {
    const certs = this.layoutCertificates.get(protocol) ?? [];
    if (certs.length === 0) {
      throw new Error(`Cannot issue ProtocolSchemaLease: protocol ${protocol} has no registered layout certificates`);
    }

    const leaseId = `LEASE-${protocol}-${currentSlot}-${Date.now()}`;
    const expiresAtSlot = currentSlot + validitySlots;

    const lease: ProtocolSchemaLease = {
      leaseId,
      protocol,
      layoutCertificates: [...certs],
      issuedAtSlot: currentSlot,
      expiresAtSlot,
      maintenancePlan,
      isValid: (slot: number) => slot >= currentSlot && slot <= expiresAtSlot
    };

    this.activeLeases.set(protocol, lease);
    return lease;
  }
}
