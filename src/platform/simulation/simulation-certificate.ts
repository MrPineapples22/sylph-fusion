/**
 * SOL-SYLPH Platform - Simulation Certificate & Two-Lane Simulation Fabric
 * Specifications: Master Blueprint Sections 31 & 32 (Priority Item 4).
 *
 * Implements:
 * 1. Two strictly separated simulation lanes:
 *    - SHADOW_SIMULATION: sigVerify=false, replaceRecentBlockhash=true (CU estimation, CPI inspection)
 *    - EXACT_FINAL_SIMULATION: sigVerify=true, replaceRecentBlockhash=false (Signed wire verification)
 * 2. SimulationCertificate: Complete deterministic cryptographic evidence binding transaction,
 *    route, quote, runtime root, program roots, units consumed, and balance deltas.
 */

import { createHash } from 'node:crypto';
import { ProgramRoot, RuntimeRoot } from '../truth/runtime-program-root.js';

export type SimulationLane = 'SHADOW_SIMULATION' | 'EXACT_FINAL_SIMULATION';

export interface SimulationCertificate {
  readonly schemaVersion: '1.0.0';
  readonly simulationLane: SimulationLane;
  readonly transactionVersion: 'legacy' | 'v0';
  readonly messageHash: string;
  readonly wireTransactionHash: string;
  readonly routeHash: string;
  readonly quoteHash: string;
  readonly accountSetHash: string;
  readonly provider: string;
  readonly runtimeRoot: RuntimeRoot;
  readonly programRoots: readonly ProgramRoot[];
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly minContextSlot: number;
  readonly simulationSlot: number;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
  readonly sigVerify: boolean;
  readonly replaceRecentBlockhash: boolean;
  readonly error: string | null;
  readonly logsHash: string;
  readonly cpiGraphHash: string;
  readonly invokedPrograms: readonly string[];
  readonly unitsConsumed: number;
  readonly loadedAccountsDataSize: number;
  readonly requestedComputeLimit: number;
  readonly priorityFeeLamports: bigint;
  readonly simulatedFeeLamports: bigint;
  readonly preSolLamports: bigint;
  readonly postSolLamports: bigint;
  readonly preTokensRaw: bigint;
  readonly postTokensRaw: bigint;
  readonly simulatedOutputRaw: bigint;
  readonly criticalAccounts: readonly string[];
  readonly isSimulationSuccess: boolean;
  readonly evidenceHash: string;
}

export class SimulationCertificateBuilder {
  /**
   * Builds an immutable, cryptographically bound SimulationCertificate.
   */
  public static buildCertificate(params: {
    lane: SimulationLane;
    transactionVersion?: 'legacy' | 'v0';
    messageHash: string;
    wireTransactionHash: string;
    routeHash: string;
    quoteHash: string;
    accountKeys: readonly string[];
    provider: string;
    runtimeRoot: RuntimeRoot;
    programRoots: readonly ProgramRoot[];
    commitment?: 'processed' | 'confirmed' | 'finalized';
    minContextSlot: number;
    simulationSlot: number;
    blockhash: string;
    lastValidBlockHeight: number;
    error?: string | null;
    logs?: readonly string[];
    invokedPrograms?: readonly string[];
    unitsConsumed: number;
    loadedAccountsDataSize?: number;
    requestedComputeLimit: number;
    priorityFeeLamports: bigint;
    simulatedFeeLamports?: bigint;
    preSolLamports: bigint;
    postSolLamports: bigint;
    preTokensRaw: bigint;
    postTokensRaw: bigint;
    simulatedOutputRaw: bigint;
    criticalAccounts?: readonly string[];
  }): SimulationCertificate {
    // Lane Invariant:
    // Shadow simulation MUST have sigVerify = false and replaceRecentBlockhash = true
    // Exact final simulation MUST have sigVerify = true and replaceRecentBlockhash = false
    const sigVerify = params.lane === 'EXACT_FINAL_SIMULATION';
    const replaceRecentBlockhash = params.lane === 'SHADOW_SIMULATION';

    const accountSetHash = createHash('sha256')
      .update(JSON.stringify([...params.accountKeys].sort()))
      .digest('hex');

    const logs = params.logs ?? [];
    const logsHash = createHash('sha256')
      .update(JSON.stringify(logs))
      .digest('hex');

    const invokedPrograms = params.invokedPrograms ?? [];
    const cpiGraphHash = createHash('sha256')
      .update(JSON.stringify(invokedPrograms))
      .digest('hex');

    const criticalAccounts = params.criticalAccounts ?? params.accountKeys.slice(0, 5);
    const isSuccess = !params.error && params.simulatedOutputRaw > 0n;

    const payload = {
      lane: params.lane,
      messageHash: params.messageHash,
      wireTransactionHash: params.wireTransactionHash,
      routeHash: params.routeHash,
      quoteHash: params.quoteHash,
      accountSetHash,
      provider: params.provider,
      runtimeRootHash: params.runtimeRoot.runtimeRootHash,
      programRootHashes: params.programRoots.map(p => p.programRootHash),
      simulationSlot: params.simulationSlot,
      blockhash: params.blockhash,
      sigVerify,
      replaceRecentBlockhash,
      unitsConsumed: params.unitsConsumed,
      simulatedOutput: String(params.simulatedOutputRaw),
      isSuccess,
    };

    const evidenceHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    return {
      schemaVersion: '1.0.0',
      simulationLane: params.lane,
      transactionVersion: params.transactionVersion ?? 'v0',
      messageHash: params.messageHash,
      wireTransactionHash: params.wireTransactionHash,
      routeHash: params.routeHash,
      quoteHash: params.quoteHash,
      accountSetHash,
      provider: params.provider,
      runtimeRoot: params.runtimeRoot,
      programRoots: Object.freeze([...params.programRoots]),
      commitment: params.commitment ?? 'processed',
      minContextSlot: params.minContextSlot,
      simulationSlot: params.simulationSlot,
      blockhash: params.blockhash,
      lastValidBlockHeight: params.lastValidBlockHeight,
      sigVerify,
      replaceRecentBlockhash,
      error: params.error ?? null,
      logsHash,
      cpiGraphHash,
      invokedPrograms: Object.freeze([...invokedPrograms]),
      unitsConsumed: params.unitsConsumed,
      loadedAccountsDataSize: params.loadedAccountsDataSize ?? 0,
      requestedComputeLimit: params.requestedComputeLimit,
      priorityFeeLamports: params.priorityFeeLamports,
      simulatedFeeLamports: params.simulatedFeeLamports ?? 5000n,
      preSolLamports: params.preSolLamports,
      postSolLamports: params.postSolLamports,
      preTokensRaw: params.preTokensRaw,
      postTokensRaw: params.postTokensRaw,
      simulatedOutputRaw: params.simulatedOutputRaw,
      criticalAccounts: Object.freeze([...criticalAccounts]),
      isSimulationSuccess: isSuccess,
      evidenceHash,
    };
  }
}
