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

export function snapshotFinalizedCostInput(input: FinalizedCostInput): FinalizedCostInput {
  if (typeof input !== 'object' || input === null) throw new Error('FINALIZED_COST_INPUT_REQUIRED');
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
    throw new Error('FINALIZED_COST_INPUT_PROTOTYPE_INVALID');
  }
  const allowed = new Set(['certificateId','settlementId','finalizedAtMs','source','sourceEventId','transactionSignature',
    'grossPnlLamports','networkFeeLamports','priorityFeeLamports','jitoTipLamports','routeFeeLamports',
    'failedTransactionCostLamports','mevCostLamports','slippageCostLamports','tokenDeltaLamports']);
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !allowed.has(key))) {
    throw new Error('FINALIZED_COST_INPUT_EXTRA_FIELD');
  }
  const snapshot: FinalizedCostInput = Object.freeze({
    certificateId: input.certificateId,
    settlementId: input.settlementId,
    finalizedAtMs: input.finalizedAtMs,
    source: input.source,
    sourceEventId: input.sourceEventId,
    transactionSignature: input.transactionSignature,
    grossPnlLamports: input.grossPnlLamports,
    networkFeeLamports: input.networkFeeLamports,
    priorityFeeLamports: input.priorityFeeLamports,
    jitoTipLamports: input.jitoTipLamports,
    routeFeeLamports: input.routeFeeLamports,
    failedTransactionCostLamports: input.failedTransactionCostLamports,
    mevCostLamports: input.mevCostLamports,
    slippageCostLamports: input.slippageCostLamports,
    tokenDeltaLamports: input.tokenDeltaLamports,
  });
  assertFinalizedInput(snapshot);
  return snapshot;
}

function assertFinalizedInput(input: FinalizedCostInput): void {
  if (typeof input.certificateId !== 'string' || !input.certificateId || typeof input.settlementId !== 'string' || !input.settlementId ||
    typeof input.source !== 'string' || !input.source || typeof input.sourceEventId !== 'string' || !input.sourceEventId) {
    throw new Error('FINALIZED_COST_IDENTITY_REQUIRED');
  }
  for (const [name, value] of Object.entries(input)) {
    if (name === 'transactionSignature') {
      if (value !== undefined && typeof value !== 'string') throw new Error('TRANSACTION_SIGNATURE_MUST_BE_STRING');
    } else if (name !== 'finalizedAtMs' && typeof value !== 'string' && typeof value !== 'bigint') {
      throw new Error(`${name}_TYPE_INVALID`);
    }
  }
  if (!Number.isSafeInteger(input.finalizedAtMs) || input.finalizedAtMs <= 0) {
    throw new Error('FINALIZED_AT_MUST_BE_SAFE_POSITIVE_INTEGER');
  }
  for (const name of ['grossPnlLamports','networkFeeLamports','priorityFeeLamports','jitoTipLamports','routeFeeLamports',
    'failedTransactionCostLamports','mevCostLamports','slippageCostLamports','tokenDeltaLamports'] as const) {
    if (typeof input[name] !== 'bigint') throw new Error(`${name}_MUST_BE_BIGINT`);
  }
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === 'bigint' && name !== 'grossPnlLamports' && name !== 'tokenDeltaLamports') assertNonNegative(name, value);
  }
}

/** Creates a sealed, cost-complete record. Gross PnL and token delta may be negative. */
export function createFinalizedCostRecord(input: FinalizedCostInput): FinalizedCostRecord {
  const snapshot = snapshotFinalizedCostInput(input);
  const totalCostLamports = snapshot.networkFeeLamports + snapshot.priorityFeeLamports + snapshot.jitoTipLamports +
    snapshot.routeFeeLamports + snapshot.failedTransactionCostLamports + snapshot.mevCostLamports + snapshot.slippageCostLamports;
  const realizedNetPnlLamports = snapshot.grossPnlLamports + snapshot.tokenDeltaLamports - totalCostLamports;
  const payload = {
    certificateId: snapshot.certificateId, settlementId: snapshot.settlementId, finalizedAtMs: snapshot.finalizedAtMs,
    source: snapshot.source, sourceEventId: snapshot.sourceEventId, transactionSignature: snapshot.transactionSignature,
    grossPnlLamports: snapshot.grossPnlLamports.toString(), networkFeeLamports: snapshot.networkFeeLamports.toString(),
    priorityFeeLamports: snapshot.priorityFeeLamports.toString(), jitoTipLamports: snapshot.jitoTipLamports.toString(),
    routeFeeLamports: snapshot.routeFeeLamports.toString(), failedTransactionCostLamports: snapshot.failedTransactionCostLamports.toString(),
    mevCostLamports: snapshot.mevCostLamports.toString(), slippageCostLamports: snapshot.slippageCostLamports.toString(),
    tokenDeltaLamports: snapshot.tokenDeltaLamports.toString(), totalCostLamports: totalCostLamports.toString(),
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
  private readonly preparedRecords = new WeakSet<object>();

  public prepare(input: FinalizedCostInput): FinalizedCostRecord {
    const snapshot = snapshotFinalizedCostInput(input);
    this.assertIdentityAvailable(snapshot.certificateId, snapshot.settlementId);
    const record = createFinalizedCostRecord(snapshot);
    this.preparedRecords.add(record);
    return record;
  }

  public append(input: FinalizedCostInput): FinalizedCostRecord {
    return this.appendPrepared(this.prepare(input));
  }

  public appendPrepared(record: FinalizedCostRecord): FinalizedCostRecord {
    if (typeof record !== 'object' || record === null || !this.preparedRecords.has(record)) {
      throw new Error('FINALIZED_COST_RECORD_NOT_PREPARED_BY_THIS_LEDGER');
    }
    this.assertIdentityAvailable(record.certificateId, record.settlementId);
    if (!verifyFinalizedCostRecord(record)) throw new Error('FINALIZED_COST_RECORD_INTEGRITY_INVALID');
    this.byCertificate.set(record.certificateId, record);
    this.settlementIds.add(record.settlementId);
    return record;
  }

  private assertIdentityAvailable(certificateId: string, settlementId: string): void {
    if (this.byCertificate.has(certificateId)) throw new Error('FINALIZED_COST_CERTIFICATE_ALREADY_SETTLED');
    if (this.settlementIds.has(settlementId)) throw new Error('FINALIZED_COST_SETTLEMENT_ID_ALREADY_USED');
  }

  public get(certificateId: string): FinalizedCostRecord | undefined {
    return this.byCertificate.get(certificateId);
  }

  public verify(): boolean {
    return [...this.byCertificate.values()].every(verifyFinalizedCostRecord);
  }
}
