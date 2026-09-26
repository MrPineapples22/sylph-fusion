/**
 * SOL-SYLPH 2026 Platform - Execution Assertion Layer
 *
 * Jito bundles are sequentially executed but can be split in uncle-block races.
 * The Execution Assertion Layer generates pre- and post-condition checks
 * to enforce deterministic invariants inside and around execution.
 */

export interface Preconditions {
  readonly expectedWallet: string;
  readonly expectedMint: string;
  readonly maxAuthorizedInputLamports: bigint;
  readonly maxQuoteAgeMs: number;
  readonly quoteObservedAtMs: number;
  readonly minAcceptableSlot: number;
  readonly expectedPositionVersion: number;
}

export interface Postconditions {
  readonly minExpectedTokenDelta: bigint;
  readonly maxExpectedSolOutflowLamports: bigint;
  readonly maxApprovedFeeLamports: bigint;
  readonly maxAllowedPositionExposureLamports: bigint;
}

export interface AssertionVerificationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export class ExecutionAssertionLayer {
  public static verifyPreconditions(
    pre: Preconditions,
    actual: {
      wallet: string;
      mint: string;
      inputLamports: bigint;
      currentSlot: number;
      positionVersion: number;
      nowMs?: number;
    }
  ): AssertionVerificationResult {
    const violations: string[] = [];
    const now = actual.nowMs ?? Date.now();

    if (actual.wallet !== pre.expectedWallet) {
      violations.push(`PRECONDITION_FAILED: Wallet mismatch (expected ${pre.expectedWallet}, got ${actual.wallet})`);
    }
    if (actual.mint !== pre.expectedMint) {
      violations.push(`PRECONDITION_FAILED: Mint mismatch (expected ${pre.expectedMint}, got ${actual.mint})`);
    }
    if (actual.inputLamports > pre.maxAuthorizedInputLamports) {
      violations.push(
        `PRECONDITION_FAILED: Input amount ${actual.inputLamports} exceeds authorized ceiling ${pre.maxAuthorizedInputLamports}`
      );
    }
    if (actual.currentSlot < pre.minAcceptableSlot) {
      violations.push(
        `PRECONDITION_FAILED: Stale context slot ${actual.currentSlot} < minimum acceptable ${pre.minAcceptableSlot}`
      );
    }
    if (actual.positionVersion !== pre.expectedPositionVersion) {
      violations.push(
        `PRECONDITION_FAILED: Position version conflict (expected ${pre.expectedPositionVersion}, got ${actual.positionVersion})`
      );
    }
    const quoteAge = now - pre.quoteObservedAtMs;
    if (quoteAge < 0 || quoteAge > pre.maxQuoteAgeMs) {
      violations.push(`PRECONDITION_FAILED: Quote expired (age ${quoteAge}ms > ${pre.maxQuoteAgeMs}ms)`);
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  public static verifyPostconditions(
    post: Postconditions,
    actual: {
      tokenDelta: bigint;
      solDelta: bigint; // Negative for outflow
      feeLamports: bigint;
      resultingExposureLamports: bigint;
    }
  ): AssertionVerificationResult {
    const violations: string[] = [];

    if (actual.tokenDelta < post.minExpectedTokenDelta) {
      violations.push(
        `POSTCONDITION_FAILED: Received tokens ${actual.tokenDelta} < minimum expected ${post.minExpectedTokenDelta}`
      );
    }
    const outflow = actual.solDelta < 0n ? -actual.solDelta : 0n;
    if (outflow > post.maxExpectedSolOutflowLamports) {
      violations.push(
        `POSTCONDITION_FAILED: Net SOL outflow ${outflow} exceeds max expected ${post.maxExpectedSolOutflowLamports}`
      );
    }
    if (actual.feeLamports > post.maxApprovedFeeLamports) {
      violations.push(
        `POSTCONDITION_FAILED: Transaction fee ${actual.feeLamports} exceeds approved ceiling ${post.maxApprovedFeeLamports}`
      );
    }
    if (actual.resultingExposureLamports > post.maxAllowedPositionExposureLamports) {
      violations.push(
        `POSTCONDITION_FAILED: Resulting exposure ${actual.resultingExposureLamports} exceeds limit ${post.maxAllowedPositionExposureLamports}`
      );
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
