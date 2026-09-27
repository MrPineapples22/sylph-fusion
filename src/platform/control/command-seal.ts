/**
 * SYLPH FUSION — CONTROLROOT, COMMANDSEAL & CONFIGSEAL
 * Specifications: Sections 44 (ControlRoot), 45 (CommandSeal), 46 (ConfigSeal), 103 (Invariants 2, 4)
 *
 * Invariants:
 * 1. NO EXECUTION WITHOUT AN ECONOMIC INTENT (Invariant 2).
 * 2. NO STALE FENCE CAN SIGN (Invariant 4).
 * 3. All consequential commands require a signed CommandEnvelope with anti-replay nonce,
 *    operator role, fence epoch, config root, and expected state root.
 * 4. No caller-provided string (like `requestedBy`) is sufficient authentication.
 * 5. ConfigurationBundle is hashed; permits issued under old config are invalidated.
 */

import { createHash, createHmac } from 'node:crypto';

export type OperatorRole = 'OPERATOR' | 'GUARDIAN' | 'AUTOMATION_AGENT' | 'RECOVERY_SYSTEM' | 'SUPERVISOR';

export interface OperatorIdentity {
  readonly operatorId: string;
  readonly role: OperatorRole;
  readonly secretOrKey: string;
}

export interface CommandEnvelope {
  readonly commandId: string;
  readonly operatorId: string;
  readonly role: OperatorRole;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly nonce: string;
  readonly controlEpoch: number;
  readonly fenceEpoch: number;
  readonly releaseRoot: string;
  readonly configRoot: string;
  readonly expectedStateRoot: string;
  readonly signature: string;
  readonly envelopeDigest: string;
}

export interface ConfigurationBundle {
  readonly execution: Readonly<Record<string, unknown>>;
  readonly risk: Readonly<Record<string, unknown>>;
  readonly tokenPolicy: Readonly<Record<string, unknown>>;
  readonly providerConfig: Readonly<Record<string, unknown>>;
  readonly signerConfig: Readonly<Record<string, unknown>>;
  readonly modelConfig: Readonly<Record<string, unknown>>;
  readonly feePolicy: Readonly<Record<string, unknown>>;
  readonly jitoPolicy: Readonly<Record<string, unknown>>;
  readonly capitalLimits: Readonly<Record<string, unknown>>;
}

export interface ConfigSeal {
  readonly configEpoch: number;
  readonly bundle: ConfigurationBundle;
  readonly bundleHash: string;
  readonly sealedAtMs: number;
}

export function createConfigSeal(configEpoch: number, bundle: ConfigurationBundle): ConfigSeal {
  const serialized = JSON.stringify(bundle);
  const bundleHash = createHash('sha256').update(serialized).digest('hex');
  return {
    configEpoch,
    bundle,
    bundleHash,
    sealedAtMs: Date.now()
  };
}

export function signCommandEnvelope(
  params: Omit<CommandEnvelope, 'signature' | 'envelopeDigest' | 'payloadHash'>,
  signingKey: string
): CommandEnvelope {
  const payloadHash = createHash('sha256').update(JSON.stringify(params.payload)).digest('hex');
  const digestPayload = `${params.commandId}:${params.operatorId}:${params.role}:${params.action}:${payloadHash}:${params.issuedAtMs}:${params.expiresAtMs}:${params.nonce}:${params.controlEpoch}:${params.fenceEpoch}:${params.releaseRoot}:${params.configRoot}:${params.expectedStateRoot}`;
  const envelopeDigest = createHash('sha256').update(digestPayload).digest('hex');
  const signature = createHmac('sha256', signingKey).update(envelopeDigest).digest('hex');

  return {
    ...params,
    payloadHash,
    signature,
    envelopeDigest
  };
}

export class ControlRootKernel {
  private controlEpoch = 1;
  private currentFenceEpoch: number;
  private activeConfigSeal: ConfigSeal;
  private currentReleaseRoot: string;
  private seenNonces = new Set<string>();
  private registeredOperators = new Map<string, OperatorIdentity>();

  constructor(params: {
    initialFenceEpoch: number;
    initialConfigSeal: ConfigSeal;
    currentReleaseRoot: string;
  }) {
    this.currentFenceEpoch = params.initialFenceEpoch;
    this.activeConfigSeal = params.initialConfigSeal;
    this.currentReleaseRoot = params.currentReleaseRoot;
  }

  public registerOperator(operator: OperatorIdentity): void {
    this.registeredOperators.set(operator.operatorId, operator);
  }

  public advanceFenceEpoch(newFenceEpoch: number): void {
    if (newFenceEpoch <= this.currentFenceEpoch) {
      throw new Error(`Cannot regress fence epoch from ${this.currentFenceEpoch} to ${newFenceEpoch}`);
    }
    this.currentFenceEpoch = newFenceEpoch;
  }

  public updateConfiguration(newBundle: ConfigurationBundle): ConfigSeal {
    const nextEpoch = this.activeConfigSeal.configEpoch + 1;
    this.activeConfigSeal = createConfigSeal(nextEpoch, newBundle);
    return this.activeConfigSeal;
  }

  public getActiveConfigSeal(): ConfigSeal {
    return this.activeConfigSeal;
  }

  public getFenceEpoch(): number {
    return this.currentFenceEpoch;
  }

  /**
   * Authoritative Command Envelope Verification & Anti-Replay Validation
   */
  public verifyAndAuthorizeCommand(
    envelope: CommandEnvelope,
    currentStateRoot: string,
    nowMs: number
  ): { authorized: boolean; reason?: string } {
    // 1. Verify Operator Identity
    const operator = this.registeredOperators.get(envelope.operatorId);
    if (!operator) {
      return { authorized: false, reason: `Unknown operatorId: ${envelope.operatorId}` };
    }

    if (operator.role !== envelope.role) {
      return { authorized: false, reason: `Operator role mismatch: expected ${operator.role}, received ${envelope.role}` };
    }

    // 2. Anti-Replay Nonce Check
    if (this.seenNonces.has(envelope.nonce)) {
      return { authorized: false, reason: `ANTI-REPLAY VIOLATION: Nonce ${envelope.nonce} has already been executed` };
    }

    // 3. Expiration Check
    if (nowMs > envelope.expiresAtMs) {
      return { authorized: false, reason: `Command expired: current time ${nowMs} > expiry ${envelope.expiresAtMs}` };
    }

    // 4. Fence Epoch Validation (Section 42 & Invariant 4)
    if (envelope.fenceEpoch !== this.currentFenceEpoch) {
      return {
        authorized: false,
        reason: `STALE FENCE REJECTION: Command fence epoch ${envelope.fenceEpoch} does not match active epoch ${this.currentFenceEpoch}`
      };
    }

    // 5. Release Root Validation
    if (envelope.releaseRoot !== this.currentReleaseRoot) {
      return {
        authorized: false,
        reason: `RELEASE ROOT MISMATCH: Command built against ${envelope.releaseRoot}, current release is ${this.currentReleaseRoot}`
      };
    }

    // 6. Config Root Validation (Section 46)
    // Risk-increasing commands under stale config are strictly invalidated
    const isRiskIncreasing = envelope.action.startsWith('OPEN') || envelope.action.startsWith('INCREASE');
    if (isRiskIncreasing && envelope.configRoot !== this.activeConfigSeal.bundleHash) {
      return {
        authorized: false,
        reason: `CONFIG STALENESS VIOLATION: Risk-increasing command was authorized under obsolete config root ${envelope.configRoot}`
      };
    }

    // 7. Expected State Root Validation (CAS semantics)
    if (envelope.expectedStateRoot !== currentStateRoot) {
      return {
        authorized: false,
        reason: `STATE CONFLICT: Expected state root ${envelope.expectedStateRoot}, actual state root ${currentStateRoot}`
      };
    }

    // 8. Cryptographic Signature Verification
    const expectedSig = createHmac('sha256', operator.secretOrKey).update(envelope.envelopeDigest).digest('hex');
    if (expectedSig !== envelope.signature) {
      return { authorized: false, reason: 'INVALID_SIGNATURE: Command cryptographic envelope signature verification failed' };
    }

    // Mark nonce as executed
    this.seenNonces.add(envelope.nonce);
    return { authorized: true };
  }
}
