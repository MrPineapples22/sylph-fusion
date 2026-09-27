/**
 * SYLPH FUSION — SENTINEL-ALT: Transaction Account Set & Resource Integrity Authority
 * Specifications: Section 11 (Upgrade 7: Sentinel-ALT), Section 16 (Solana Transaction Requirements)
 *
 * Invariants:
 * 1. Freeze not only transaction bytes but the semantic resource graph.
 * 2. Produces 5 cryptographic fingerprints:
 *    AccountSetHash, WritableSetHash, SignerSetHash, ResourceBudgetHash, LookupResolutionHash.
 * 3. Supports legacy, v0, and v1 transaction resource configurations.
 * 4. Any difference between reviewed account graph and signed graph triggers
 *    TRANSACTION_IDENTITY_DRIFT and immediate fail-closed rejection.
 */

import { createHash } from 'node:crypto';

export type SolanaTransactionVersion = 'LEGACY' | 'V0' | 'V1';

export interface AddressLookupTableResolution {
  readonly tableAddress: string;
  readonly tableAccountHash: string;
  readonly writableIndexes: readonly number[];
  readonly readonlyIndexes: readonly number[];
  readonly resolvedWritableAddresses: readonly string[];
  readonly resolvedReadonlyAddresses: readonly string[];
}

export interface ResourceBudgetConfig {
  readonly computeUnitLimit: number;
  readonly computeUnitPriceMicroLamports: bigint;
  readonly loadedAccountsDataSizeLimit?: number;
  readonly heapSizeExtraPages?: number;
  readonly totalSerializedBytes: number;
}

export interface SemanticResourceGraph {
  readonly transactionVersion: SolanaTransactionVersion;
  readonly feePayer: string;
  readonly staticAccountKeys: readonly string[];
  readonly writableAccountKeys: readonly string[];
  readonly signerAccountKeys: readonly string[];
  readonly programIds: readonly string[];
  readonly addressLookupTables: readonly AddressLookupTableResolution[];
  readonly resourceBudget: ResourceBudgetConfig;
}

export interface SemanticResourceGraphHashes {
  readonly accountSetHash: string;
  readonly writableSetHash: string;
  readonly signerSetHash: string;
  readonly resourceBudgetHash: string;
  readonly lookupResolutionHash: string;
  readonly compositeResourceDigest: string;
}

export class SentinelAltAuthority {
  /**
   * Hashes a semantic resource graph into 5 discrete fingerprints and a composite digest.
   */
  public static computeHashes(graph: SemanticResourceGraph): SemanticResourceGraphHashes {
    const sortedAllAccounts = [...graph.staticAccountKeys].sort().join(';');
    const accountSetHash = createHash('sha256').update(sortedAllAccounts).digest('hex');

    const sortedWritables = [...graph.writableAccountKeys].sort().join(';');
    const writableSetHash = createHash('sha256').update(sortedWritables).digest('hex');

    const sortedSigners = [...graph.signerAccountKeys].sort().join(';');
    const signerSetHash = createHash('sha256').update(sortedSigners).digest('hex');

    const budgetPayload = `${graph.resourceBudget.computeUnitLimit}:${graph.resourceBudget.computeUnitPriceMicroLamports}:${graph.resourceBudget.loadedAccountsDataSizeLimit ?? 0}:${graph.resourceBudget.heapSizeExtraPages ?? 0}:${graph.resourceBudget.totalSerializedBytes}`;
    const resourceBudgetHash = createHash('sha256').update(budgetPayload).digest('hex');

    const altsPayload = graph.addressLookupTables
      .map((alt) => `${alt.tableAddress}:${alt.tableAccountHash}:${alt.resolvedWritableAddresses.join(',')}:${alt.resolvedReadonlyAddresses.join(',')}`)
      .join('|');
    const lookupResolutionHash = createHash('sha256').update(altsPayload).digest('hex');

    const compositePayload = `${graph.transactionVersion}:${graph.feePayer}:${accountSetHash}:${writableSetHash}:${signerSetHash}:${resourceBudgetHash}:${lookupResolutionHash}`;
    const compositeResourceDigest = createHash('sha256').update(compositePayload).digest('hex');

    return {
      accountSetHash,
      writableSetHash,
      signerSetHash,
      resourceBudgetHash,
      lookupResolutionHash,
      compositeResourceDigest
    };
  }

  /**
   * Compares the reviewed resource graph against the final candidate for signing.
   * Throws `TRANSACTION_IDENTITY_DRIFT` if any property, account, ALT, or budget shifted.
   */
  public static assertGraphIntegrity(
    reviewed: SemanticResourceGraph,
    candidate: SemanticResourceGraph
  ): { isIntact: boolean; compositeDigest: string } {
    const reviewedHashes = this.computeHashes(reviewed);
    const candidateHashes = this.computeHashes(candidate);

    if (reviewedHashes.compositeResourceDigest !== candidateHashes.compositeResourceDigest) {
      const mismatches: string[] = [];
      if (reviewedHashes.accountSetHash !== candidateHashes.accountSetHash) mismatches.push('ACCOUNT_SET_MISMATCH');
      if (reviewedHashes.writableSetHash !== candidateHashes.writableSetHash) mismatches.push('WRITABLE_SET_MISMATCH');
      if (reviewedHashes.signerSetHash !== candidateHashes.signerSetHash) mismatches.push('SIGNER_SET_MISMATCH');
      if (reviewedHashes.resourceBudgetHash !== candidateHashes.resourceBudgetHash) mismatches.push('RESOURCE_BUDGET_MISMATCH');
      if (reviewedHashes.lookupResolutionHash !== candidateHashes.lookupResolutionHash) mismatches.push('ALT_LOOKUP_MISMATCH');

      throw new Error(
        `TRANSACTION_IDENTITY_DRIFT: Candidate transaction mutated post-review! Breaches: [${mismatches.join(', ')}]. ` +
        `Expected composite ${reviewedHashes.compositeResourceDigest}, candidate ${candidateHashes.compositeResourceDigest}`
      );
    }

    return { isIntact: true, compositeDigest: reviewedHashes.compositeResourceDigest };
  }
}
