/**
 * SYLPH FUSION — CONSERVATION PROOFS & OUTCOME MATURITY GATE
 * Specifications: Prompt 43 (Conservation Proofs), Prompt 44 (Learning Only After Outcome Maturity)
 *
 * Invariants:
 * 1. Exact integer lamport/token arithmetic (bigint). Zero floating-point arithmetic for accounting.
 * 2. TokensAcquired = TokensDisposed + TokensRemaining
 * 3. OpeningBasis = RealizedBasisRelieved + RemainingBasis
 * 4. AccountingPnL = RealizedGrossProceeds - RealizedBasisRelieved - IrreversibleExitCosts
 * 5. Outcome Maturity: Required sequence SETTLED -> OUTCOME_MATURE -> LEARNING_READY.
 *    No premature labels or label leakage allowed into learning engines.
 */

import { hashCanonical } from './canonical-hashing.js';

export interface ConservationProofCertificate {
  readonly certificateId: string;
  readonly lotId: string;
  readonly tokenMint: string;
  readonly tokensAcquired: bigint;
  readonly tokensDisposed: bigint;
  readonly tokensRemaining: bigint;
  readonly openingBasisLamports: bigint;
  readonly realizedBasisRelievedLamports: bigint;
  readonly remainingBasisLamports: bigint;
  readonly realizedGrossProceedsLamports: bigint;
  readonly irreversibleExitCostsLamports: bigint;
  readonly accountingPnLLamports: bigint;
  readonly isConserved: boolean;
  readonly certifiedAt: string;
  readonly certificateHash: string;
}

export interface OutcomeMaturityInput {
  readonly tradeId: string;
  readonly economicFactId: string;
  readonly accountMode: 'paper' | 'live';
  readonly settledSlot: bigint;
  readonly currentSlot: bigint;
  readonly settledAtMs: number;
  readonly currentAtMs: number;
  readonly minMaturityDelayMs: number;
  readonly minMaturitySlotDelta: bigint;
  readonly mfePct: number;
  readonly maePct: number;
  readonly realizedNetPnLLamports: bigint;
}

export interface OutcomeMaturityCertificate {
  readonly certificateId: string;
  readonly tradeId: string;
  readonly economicFactId: string;
  readonly isMature: boolean;
  readonly learningReady: boolean;
  readonly maturitySlotDelta: bigint;
  readonly observationWindowMs: number;
  readonly labelDatasetTag: 'RESEARCH_COUNTERFACTUAL' | 'MAINNET_TRUTH';
  readonly certifiedAt: string;
  readonly certificateHash: string;
  readonly rejectionReason?: string;
}

export class ConservationProofAuthority {
  /**
   * Evaluates exact economic conservation across lot tokens, cost basis, and realized P&L.
   * Throws CONSERVATION_VIOLATION if any imbalance or non-bigint arithmetic is detected.
   */
  public certifyConservation(
    lotId: string,
    tokenMint: string,
    tokensAcquired: bigint,
    tokensDisposed: bigint,
    tokensRemaining: bigint,
    openingBasisLamports: bigint,
    realizedBasisRelievedLamports: bigint,
    remainingBasisLamports: bigint,
    realizedGrossProceedsLamports: bigint,
    irreversibleExitCostsLamports: bigint,
    accountingPnLLamports: bigint,
    certifiedAt: string
  ): ConservationProofCertificate {
    // Exact Token Conservation Invariant: TokensAcquired = TokensDisposed + TokensRemaining
    const tokenBalanceDelta = tokensAcquired - (tokensDisposed + tokensRemaining);
    if (tokenBalanceDelta !== 0n) {
      throw new Error(
        `CONSERVATION_VIOLATION [TOKEN_LOT]: Acquired ${tokensAcquired} != Disposed ${tokensDisposed} + Remaining ${tokensRemaining} (delta: ${tokenBalanceDelta})`
      );
    }

    // Exact Basis Conservation Invariant: OpeningBasis = RealizedBasisRelieved + RemainingBasis
    const basisDelta = openingBasisLamports - (realizedBasisRelievedLamports + remainingBasisLamports);
    if (basisDelta !== 0n) {
      throw new Error(
        `CONSERVATION_VIOLATION [BASIS]: OpeningBasis ${openingBasisLamports} != Relieved ${realizedBasisRelievedLamports} + Remaining ${remainingBasisLamports} (delta: ${basisDelta})`
      );
    }

    // Exact Accounting P&L Invariant: AccountingPnL = RealizedGrossProceeds - RealizedBasisRelieved - IrreversibleExitCosts
    const expectedPnL = realizedGrossProceedsLamports - realizedBasisRelievedLamports - irreversibleExitCostsLamports;
    if (accountingPnLLamports !== expectedPnL) {
      throw new Error(
        `CONSERVATION_VIOLATION [PNL]: Declared ${accountingPnLLamports} != Expected ${expectedPnL} (Proceeds: ${realizedGrossProceedsLamports}, RelievedBasis: ${realizedBasisRelievedLamports}, Costs: ${irreversibleExitCostsLamports})`
      );
    }

    const certificateId = `cert_cons_${hashCanonical({ lotId, certifiedAt }).slice(0, 16)}`;
    const preimage = {
      certificateId,
      lotId,
      tokenMint,
      tokensAcquired,
      tokensDisposed,
      tokensRemaining,
      openingBasisLamports,
      realizedBasisRelievedLamports,
      remainingBasisLamports,
      realizedGrossProceedsLamports,
      irreversibleExitCostsLamports,
      accountingPnLLamports,
      isConserved: true,
      certifiedAt,
    };

    const certificateHash = hashCanonical(preimage);

    return Object.freeze({
      ...preimage,
      certificateHash,
    });
  }
}

export class OutcomeMaturityGate {
  /**
   * Enforces maturity delay before an outcome can transition to LEARNING_READY.
   * Prevents label leakage and premature post-trade evaluations.
   */
  public evaluateMaturity(input: OutcomeMaturityInput, evaluatedAt: string): OutcomeMaturityCertificate {
    const slotDelta = input.currentSlot - input.settledSlot;
    const timeDeltaMs = input.currentAtMs - input.settledAtMs;

    // Check slot maturity requirement
    if (slotDelta < input.minMaturitySlotDelta) {
      return this.reject(
        input,
        evaluatedAt,
        `INSUFFICIENT_SLOT_MATURITY: Slot delta ${slotDelta} < required ${input.minMaturitySlotDelta}`
      );
    }

    // Check temporal maturity requirement
    if (timeDeltaMs < input.minMaturityDelayMs) {
      return this.reject(
        input,
        evaluatedAt,
        `INSUFFICIENT_TIME_MATURITY: Elapsed time ${timeDeltaMs}ms < required ${input.minMaturityDelayMs}ms`
      );
    }

    // Isolate simulation/paper labels from mainnet truth
    const datasetTag: 'MAINNET_TRUTH' | 'RESEARCH_COUNTERFACTUAL' =
      input.accountMode === 'live' ? 'MAINNET_TRUTH' : 'RESEARCH_COUNTERFACTUAL';

    const certificateId = `cert_mat_${hashCanonical({ tradeId: input.tradeId, evaluatedAt }).slice(0, 16)}`;
    const preimage = {
      certificateId,
      tradeId: input.tradeId,
      economicFactId: input.economicFactId,
      isMature: true,
      learningReady: true,
      maturitySlotDelta: slotDelta,
      observationWindowMs: timeDeltaMs,
      labelDatasetTag: datasetTag,
      certifiedAt: evaluatedAt,
    };

    const certificateHash = hashCanonical(preimage);

    return Object.freeze({
      ...preimage,
      certificateHash,
    });
  }

  private reject(input: OutcomeMaturityInput, evaluatedAt: string, reason: string): OutcomeMaturityCertificate {
    const slotDelta = input.currentSlot - input.settledSlot;
    const timeDeltaMs = input.currentAtMs - input.settledAtMs;
    const certificateId = `cert_mat_${hashCanonical({ tradeId: input.tradeId, evaluatedAt, reason }).slice(0, 16)}`;

    const preimage = {
      certificateId,
      tradeId: input.tradeId,
      economicFactId: input.economicFactId,
      isMature: false,
      learningReady: false,
      maturitySlotDelta: slotDelta,
      observationWindowMs: timeDeltaMs,
      labelDatasetTag: input.accountMode === 'live' ? ('MAINNET_TRUTH' as const) : ('RESEARCH_COUNTERFACTUAL' as const),
      certifiedAt: evaluatedAt,
      rejectionReason: reason,
    };

    const certificateHash = hashCanonical(preimage);

    return Object.freeze({
      ...preimage,
      certificateHash,
    });
  }
}
