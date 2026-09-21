/**
 * SOL-SYLPH State Epochs & Fencing Tokens
 * Blueprint Part LXVIII & Phase 2
 *
 * Every critical state mutation increments a state epoch/version.
 * Background tasks carry fencing tokens. Stale tasks must not:
 * overwrite newer state, issue permits, execute, or modify risk reservations.
 */

export interface FencingToken {
  readonly epoch: number;
  readonly issuedAtMs: number;
  readonly taskId: string;
  readonly operation: string;
}

export class StateEpochEngine {
  private currentEpoch: number = 1;
  private readonly activeFences = new Map<string, FencingToken>();

  public getCurrentEpoch(): number {
    return this.currentEpoch;
  }

  public incrementEpoch(reason: string): number {
    this.currentEpoch += 1;
    return this.currentEpoch;
  }

  public issueFencingToken(taskId: string, operation: string): FencingToken {
    const token: FencingToken = {
      epoch: this.currentEpoch,
      issuedAtMs: Date.now(),
      taskId,
      operation,
    };
    this.activeFences.set(taskId, token);
    return token;
  }

  public validateFencingToken(token: FencingToken): { valid: boolean; currentEpoch: number; reason?: string } {
    if (token.epoch < this.currentEpoch) {
      return {
        valid: false,
        currentEpoch: this.currentEpoch,
        reason: `FENCING_VIOLATION: Token epoch ${token.epoch} is stale compared to current epoch ${this.currentEpoch}`,
      };
    }
    if (Date.now() - token.issuedAtMs > 10000) {
      return {
        valid: false,
        currentEpoch: this.currentEpoch,
        reason: `FENCING_TIMEOUT: Token expired (${Date.now() - token.issuedAtMs}ms old)`,
      };
    }
    return { valid: true, currentEpoch: this.currentEpoch };
  }
}
