import { createHash } from 'node:crypto';
import { VeritasWireDecoder } from './veritas-wire-decoder.js';

/**
 * Narrow, fail-closed authorization boundary before an isolated signer.
 * A transaction decoder must supply a complete decoded view; this class never
 * accepts descriptive claims in place of decoded transaction facts.
 */
export interface FrozenSigningRequest {
  readonly requestId: string; readonly environment: 'devnet' | 'mainnet-beta'; readonly messageBytes: Uint8Array;
  readonly messageHash: string; readonly expectedSigner: string; readonly feePayer: string; readonly policyVersion: string;
  readonly policyHash: string; readonly intentId: string; readonly simulationId: string; readonly expiresAt: number;
}
export interface DecodedTransactionView {
  readonly complete: boolean; readonly messageHash: string; readonly signer: string; readonly feePayer: string;
  readonly programIds: readonly string[]; readonly writableAccounts: readonly string[]; readonly amountLamports: bigint;
  readonly mint: string; readonly destination: string; readonly maxSlippageBps: number; readonly priorityFeeLamports: bigint;
  readonly simulationId: string; readonly frozen: boolean;
}
export interface SigningFirewallPolicy {
  readonly version: string; readonly hash: string; readonly allowedPrograms: readonly string[]; readonly allowedFeePayers: readonly string[];
  readonly maxAmountLamports: bigint; readonly maxSlippageBps: number; readonly maxPriorityFeeLamports: bigint;
  readonly expectedMint: string; readonly expectedDestination: string; readonly mainnetEnabled: boolean;
}
export interface FirewallGates { readonly journalHealthy: boolean; readonly killSwitchClear: boolean; readonly providerGateHealthy: boolean; readonly simulationPassed: boolean; }
export type FirewallDecision = { readonly approved: true; readonly messageHash: string } | { readonly approved: false; readonly reasonCodes: readonly string[] };
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export interface DurableReplayStore {
  has(key: string): boolean;
  add(key: string): void;
  getAll?(): readonly string[];
}

export class InMemoryDurableReplayStore implements DurableReplayStore {
  private readonly items = new Set<string>();
  has(key: string): boolean { return this.items.has(key); }
  add(key: string): void { this.items.add(key); }
  getAll(): readonly string[] { return Array.from(this.items); }
}

export class SigningFirewall {
  private readonly consumed = new Set<string>();
  private readonly replayStore?: DurableReplayStore;

  constructor(replayStore?: DurableReplayStore) {
    this.replayStore = replayStore;
    if (replayStore && typeof replayStore.getAll === 'function') {
      const existing = replayStore.getAll();
      for (const k of existing) this.consumed.add(k);
    }
  }

  evaluate(request: FrozenSigningRequest, decoded: DecodedTransactionView | null, policy: SigningFirewallPolicy, gates: FirewallGates, now=Date.now()): FirewallDecision {
    const reasons:string[]=[];
    if (!request.requestId || !request.intentId || !request.simulationId || !request.messageBytes.byteLength) reasons.push('REQUEST_INVALID');
    const actualHash=sha256(request.messageBytes); if (actualHash!==request.messageHash) reasons.push('MESSAGE_HASH_MISMATCH');
    if (request.expiresAt<=now) reasons.push('AUTHORIZATION_EXPIRED');
    if (this.consumed.has(request.requestId)||this.consumed.has(request.messageHash)||(this.replayStore&&(this.replayStore.has(request.requestId)||this.replayStore.has(request.messageHash)))) reasons.push('REPLAY_DETECTED');
    if (request.policyVersion!==policy.version||request.policyHash!==policy.hash) reasons.push('POLICY_VERSION_MISMATCH');
    if (request.environment==='mainnet-beta'&&!policy.mainnetEnabled) reasons.push('MAINNET_INTERLOCK_CLOSED');
    if (!gates.journalHealthy) reasons.push('JOURNAL_UNHEALTHY'); if (!gates.killSwitchClear) reasons.push('KILL_SWITCH_ACTIVE'); if (!gates.providerGateHealthy) reasons.push('PROVIDER_GATE_UNHEALTHY'); if (!gates.simulationPassed) reasons.push('SIMULATION_UNAVAILABLE');
    let effectiveDecoded: DecodedTransactionView | null = null;
    if (request.messageBytes?.byteLength) {
      try {
        effectiveDecoded = VeritasWireDecoder.decode(request.messageBytes, {
          simulationId: request.simulationId,
        });
        if (decoded) {
          const fields = ['complete', 'frozen', 'messageHash', 'signer', 'feePayer', 'amountLamports',
            'mint', 'destination', 'maxSlippageBps', 'priorityFeeLamports', 'simulationId'] as const;
          const sameSet = (a: readonly string[], b: readonly string[]) =>
            a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
          if (fields.some(field => decoded[field] !== effectiveDecoded![field])
            || !sameSet(decoded.programIds, effectiveDecoded.programIds)
            || !sameSet(decoded.writableAccounts, effectiveDecoded.writableAccounts)) {
            reasons.push('CALLER_MANIFEST_SPOOF_DETECTED');
          }
        }
      } catch (err) {
        effectiveDecoded = null;
        reasons.push(`NATIVE_DECODE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!effectiveDecoded || !effectiveDecoded.complete) reasons.push('TRANSACTION_DECODER_INCOMPLETE'); else {
      if (!effectiveDecoded.frozen) reasons.push('TRANSACTION_NOT_FROZEN'); if(effectiveDecoded.messageHash!==actualHash) reasons.push('DECODED_MESSAGE_MISMATCH');
      if(effectiveDecoded.signer!==request.expectedSigner||effectiveDecoded.feePayer!==request.feePayer) reasons.push('SIGNER_OR_FEE_PAYER_MISMATCH');
      if(!policy.allowedFeePayers.includes(effectiveDecoded.feePayer)) reasons.push('FEE_PAYER_DENIED');
      if(effectiveDecoded.programIds.some(id=>!policy.allowedPrograms.includes(id))) reasons.push('UNKNOWN_PROGRAM_DENIED');
      if(effectiveDecoded.amountLamports<0n||effectiveDecoded.amountLamports>policy.maxAmountLamports) reasons.push('AMOUNT_POLICY_DENIED');
      if(effectiveDecoded.maxSlippageBps<0||effectiveDecoded.maxSlippageBps>policy.maxSlippageBps) reasons.push('SLIPPAGE_POLICY_DENIED');
      if(effectiveDecoded.priorityFeeLamports<0n||effectiveDecoded.priorityFeeLamports>policy.maxPriorityFeeLamports) reasons.push('PRIORITY_FEE_POLICY_DENIED');
      if((policy.expectedMint && effectiveDecoded.mint!==policy.expectedMint)||(policy.expectedDestination && effectiveDecoded.destination!==policy.expectedDestination)) reasons.push('INTENT_BINDING_MISMATCH');
      if(effectiveDecoded.simulationId!==request.simulationId) reasons.push('SIMULATION_BINDING_MISMATCH');
    }
    if(reasons.length)return Object.freeze({approved:false,reasonCodes:Object.freeze(reasons)});
    this.consumed.add(request.requestId);
    this.consumed.add(request.messageHash);
    if (this.replayStore) {
      this.replayStore.add(request.requestId);
      this.replayStore.add(request.messageHash);
    }
    return Object.freeze({approved:true,messageHash:actualHash});
  }
}
