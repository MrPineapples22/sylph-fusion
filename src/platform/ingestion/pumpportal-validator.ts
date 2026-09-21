/**
 * SOL-SYLPH Platform - Strict PumpPortal Frame Validation
 *
 * Enforces:
 * - Transport liveness != market observation validity.
 * - JSON schema and event structure validation.
 * - Public key format validation.
 * - Timestamp drift bounds (reject future or excessively aged messages).
 * - Monotonic slot ordering and replay prevention.
 * - Duplicate frame deduplication by transaction signature.
 * - Numeric integrity (reject NaN, Infinity, negative quantities, corrupted numbers).
 * - Real measured latency from frame timestamps.
 */

import { PublicKey } from '@solana/web3.js';

export interface PumpPortalFrame {
  txType: 'create' | 'trade';
  mint: string;
  signature?: string;
  slot?: number;
  timestamp?: number;
  solAmount?: number;
  tokenAmount?: number;
  user?: string;
  name?: string;
  symbol?: string;
  marketCapSol?: number;
}

export interface ValidatedPumpPortalObservation {
  readonly isValid: boolean;
  readonly rejectionReason?: string;
  readonly frame?: PumpPortalFrame;
  readonly measuredLatencyMs?: number;
}

export class PumpPortalFrameValidator {
  private readonly seenSignatures = new Set<string>();
  private readonly signatureQueue: string[] = [];
  private lastSlot = 0;
  private readonly maxSeenSignatures = 10_000;

  private isValidPublicKey(key: unknown): boolean {
    if (typeof key !== 'string') return false;
    try {
      return new PublicKey(key).toBase58() === key;
    } catch {
      return false;
    }
  }

  private isValidSignature(sig: unknown): boolean {
    return typeof sig === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig);
  }

  public resetSlotTracking(): void {
    this.lastSlot = 0;
  }

  public validateRaw(raw: unknown, receivedAtMs = Date.now()): ValidatedPumpPortalObservation {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { isValid: false, rejectionReason: 'MALFORMED_FRAME_NOT_OBJECT' };
    }

    const d = raw as Record<string, any>;

    // 1. Check for explicit provider error frames
    if (d.error || d.errors) {
      return { isValid: false, rejectionReason: 'PROVIDER_REPORTED_ERROR' };
    }

    // 2. Validate event type
    const txType = d.txType;
    if (txType !== 'create' && txType !== 'trade') {
      return { isValid: false, rejectionReason: `UNRECOGNIZED_TX_TYPE: ${txType}` };
    }

    // 3. Validate token mint
    if (!this.isValidPublicKey(d.mint)) {
      return { isValid: false, rejectionReason: 'INVALID_TOKEN_MINT_ADDRESS' };
    }

    // 4. Validate user/trader/creator if provided
    if (d.user && !this.isValidPublicKey(d.user)) {
      return { isValid: false, rejectionReason: 'INVALID_USER_ADDRESS' };
    }

    // 5. Validate signature and check duplicates
    let signature: string | undefined;
    if (d.signature && typeof d.signature === 'string') {
      if (!this.isValidSignature(d.signature)) {
        return { isValid: false, rejectionReason: 'MALFORMED_TRANSACTION_SIGNATURE' };
      }
      const sig = d.signature;
      if (this.seenSignatures.has(sig)) {
        return { isValid: false, rejectionReason: 'DUPLICATE_TRANSACTION_FRAME' };
      }
      this.seenSignatures.add(sig);
      this.signatureQueue.push(sig);
      if (this.signatureQueue.length > this.maxSeenSignatures) {
        const oldest = this.signatureQueue.shift();
        if (oldest) this.seenSignatures.delete(oldest);
      }
      signature = sig;
    }

    // 6. Validate slot and check monotonicity/replay
    let slot: number | undefined;
    if (d.slot !== undefined && d.slot !== null) {
      const parsedSlot = Number(d.slot);
      if (!Number.isSafeInteger(parsedSlot) || parsedSlot <= 0) {
        return { isValid: false, rejectionReason: 'INVALID_SLOT_NUMBER' };
      }
      // Replay check: reject if more than 64 slots behind the latest observed
      if (this.lastSlot > 0 && parsedSlot + 64 < this.lastSlot) {
        return { isValid: false, rejectionReason: `SLOT_REPLAY_DETECTED: ${parsedSlot} vs latest ${this.lastSlot}` };
      }
      slot = parsedSlot;
      this.lastSlot = Math.max(this.lastSlot, parsedSlot);
    }

    // 7. Validate timestamps and calculate real measured latency
    let frameTimestamp: number | undefined;
    let measuredLatencyMs: number | undefined;

    if (d.timestamp !== undefined && d.timestamp !== null) {
      const rawTs = Number(d.timestamp);
      if (!Number.isFinite(rawTs) || rawTs <= 0) {
        return { isValid: false, rejectionReason: 'INVALID_TIMESTAMP_VALUE' };
      }
      // Support both seconds and milliseconds
      const tsMs = rawTs > 1e11 ? rawTs : rawTs * 1000;

      // Drift check: cannot be > 10s in the future or > 120s in the past
      if (tsMs > receivedAtMs + 10_000) {
        return { isValid: false, rejectionReason: 'FUTURE_TIMESTAMP_DRIFT' };
      }
      if (receivedAtMs - tsMs > 120_000) {
        return { isValid: false, rejectionReason: 'STALE_TIMESTAMP_EXPIRATION' };
      }

      frameTimestamp = tsMs;
      measuredLatencyMs = Math.max(1, receivedAtMs - tsMs);
    }

    // 8. Validate numeric amounts
    let solAmount: number | undefined;
    if (d.solAmount !== undefined && d.solAmount !== null) {
      const n = Number(d.solAmount);
      if (!Number.isFinite(n) || n < 0) {
        return { isValid: false, rejectionReason: 'INVALID_SOL_AMOUNT' };
      }
      solAmount = n;
    }

    let tokenAmount: number | undefined;
    if (d.tokenAmount !== undefined && d.tokenAmount !== null) {
      const n = Number(d.tokenAmount);
      if (!Number.isFinite(n) || n < 0) {
        return { isValid: false, rejectionReason: 'INVALID_TOKEN_AMOUNT' };
      }
      tokenAmount = n;
    }

    let marketCapSol: number | undefined;
    if (d.marketCapSol !== undefined && d.marketCapSol !== null) {
      const n = Number(d.marketCapSol);
      if (!Number.isFinite(n) || n < 0) {
        return { isValid: false, rejectionReason: 'INVALID_MARKET_CAP_SOL' };
      }
      marketCapSol = n;
    }

    const frame: PumpPortalFrame = {
      txType,
      mint: d.mint,
      signature,
      slot,
      timestamp: frameTimestamp,
      solAmount,
      tokenAmount,
      marketCapSol,
      user: d.user,
      name: d.name ? String(d.name).slice(0, 80) : undefined,
      symbol: d.symbol ? String(d.symbol).slice(0, 24) : undefined,
    };

    return {
      isValid: true,
      frame,
      measuredLatencyMs,
    };
  }
}
