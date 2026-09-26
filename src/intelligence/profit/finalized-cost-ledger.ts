import { createHash } from 'node:crypto';

/**
 * Research/paper-only settlement evidence. This module deliberately accepts
 * already-finalized facts and has no signer, transport, quote, or execution
 * dependency. It cannot authorize an economic action.
 */
export interface FinalizedCostInput {
  readonly certificateId: string;
  readonly settlementId: string;
  readonly finalizedAtMs: number;
  readonly source: string;
  readonly sourceEventId: string;
  readonly transactionSignature?: string;
  readonly grossPnlLamports: bigint;
  readonly networkFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly jitoTipLamports: bigint;
  readonly routeFeeLamports: bigint;
  readonly failedTransactionCostLamports: bigint;
  readonly mevCostLamports: bigint;
  readonly slippageCostLamports: bigint;
  readonly tokenDeltaLamports: bigint;
}

export interface FinalizedCostRecord extends Omit<FinalizedCostInput,
  'grossPnlLamports' | 'networkFeeLamports' | 'priorityFeeLamports' |
  'jitoTipLamports' | 'routeFeeLamports' | 'failedTransactionCostLamports' |
  'mevCostLamports' | 'slippageCostLamports' | 'tokenDeltaLamports'> {
  readonly grossPnlLamports: string;
  readonly networkFeeLamports: string;
  readonly priorityFeeLamports: string;
  readonly jitoTipLamports: string;
  readonly failedTransactionCostLamports: string;
  readonly mevCostLamports: string;
  readonly slippageCostLamports: string;
  readonly tokenDeltaLamports: string;
  readonly totalCostLamports: string;
  readonly realizedNetPnlLamports: string;
  readonly integrityHash: string;
}

const canonicalize = (value: unknown): string => JSON.stringify(value);
const digest = (value: unknown): string => createHash('sha256').update(canonicalize(value)).digest('hex');

function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) throw new Error(`${name}_MUST_BE_NON_NEGATIVE`);
}

function assertFinalizedInput(input: FinalizedCostInput): void {
  if (!input.certificateId || !input.settlementId || !input.source || !input.sourceEventId) {
    throw new Error('FINALIZED_COST_IDENTITY_REQUIRED');
  }
  if (!Number.isSafeInteger(input.finalizedAtMs) || input.finalizedAtMs <= 0) {
    throw new Error('FINALIZED_AT_MUST_BE_SAFE_POSITIVE_INTEGER');
  }
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === 'bigint' && name !== 'grossPnlLamports' && name !== 'tokenDeltaLamports') assertNonNegative(name, value);
  }
}

/** Creates a sealed, cost-complete record. Gross PnL and token delta may be negative. */
export function createFinalizedCostRecord(input: FinalizedCostInput): FinalizedCostRecord {
  assertFinalizedInput(input);
  const totalCostLamports = input.networkFeeLamports + input.priorityFeeLamports + input.jitoTipLamports +
    input.routeFeeLamports + input.failedTransactionCostLamports + input.mevCostLamports + input.slippageCostLamports;
  const realizedNetPnlLamports = input.grossPnlLamports + input.tokenDeltaLamports - totalCostLamports;
  const payload = {
    certificateId: input.certificateId, settlementId: input.settlementId, finalizedAtMs: input.finalizedAtMs,
    source: input.source, sourceEventId: input.sourceEventId, transactionSignature: input.transactionSignature,
    grossPnlLamports: input.grossPnlLamports.toString(), networkFeeLamports: input.networkFeeLamports.toString(),
    priorityFeeLamports: input.priorityFeeLamports.toString(), jitoTipLamports: input.jitoTipLamports.toString(),
    routeFeeLamports: input.routeFeeLamports.toString(), failedTransactionCostLamports: input.failedTransactionCostLamports.toString(),
    mevCostLamports: input.mevCostLamports.toString(), slippageCostLamports: input.slippageCostLamports.toString(),
    tokenDeltaLamports: input.tokenDeltaLamports.toString(), totalCostLamports: totalCostLamports.toString(),
    realizedNetPnlLamports: realizedNetPnlLamports.toString(),
  };
  return Object.freeze({ ...payload, integrityHash: digest(payload) });
}

export function verifyFinalizedCostRecord(record: FinalizedCostRecord): boolean {
  const { integrityHash, ...payload } = record;
  return digest(payload) === integrityHash;
}

/** One final settlement per decision certificate; corrections require a new certificate, never overwrite history. */
export class FinalizedCostLedger {
  private readonly byCertificate = new Map<string, FinalizedCostRecord>();
  private readonly settlementIds = new Set<string>();

  public append(input: FinalizedCostInput): FinalizedCostRecord {
    if (this.byCertificate.has(input.certificateId)) throw new Error('FINALIZED_COST_CERTIFICATE_ALREADY_SETTLED');
    if (this.settlementIds.has(input.settlementId)) throw new Error('FINALIZED_COST_SETTLEMENT_ID_ALREADY_USED');
    const record = createFinalizedCostRecord(input);
    this.byCertificate.set(record.certificateId, record);
    this.settlementIds.add(record.settlementId);
    return record;
  }

  public get(certificateId: string): FinalizedCostRecord | undefined {
    return this.byCertificate.get(certificateId);
  }

  public verify(): boolean {
    return [...this.byCertificate.values()].every(verifyFinalizedCostRecord);
  }
}
