/**
 * SYLPH FUSION — ECONOMIC FLIGHT RECORDER & DURABLE EXECUTION ATTEMPT STORE
 * Specifications: Master Blueprint Sections 5, 6, 7 (Economic Flight Recorder)
 *
 * Epistemic Invariants:
 * 1. Record EVERY candidate BEFORE knowing its result (zero survivorship/selection bias).
 * 2. Guarded lifecycle from DISCOVERED to OUTCOME_MATURE.
 * 3. File-backed WAL persistence when the caller explicitly supplies a database path.
 * 4. Composite uniqueness: UNIQUE(economicFactId, executionGenerationId, revision).
 * 5. Immutable history: No deletions, no overwrites; corrections/state advances append a new revision.
 * 6. Captures all 45+ economic and microstructure quantities required to reconstruct P&L.
 */

import { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../../platform/pipeline/canonical-hashing.js';

export type FlightLifecycleStage =
  | 'DISCOVERED'
  | 'FILTER_EVALUATED'
  | 'DECISION_CREATED'
  | 'QUOTE_CAPTURED'
  | 'BUILD_STARTED'
  | 'BUILD_COMPLETED'
  | 'SIMULATED'
  | 'AUTHORIZED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'UNKNOWN'
  | 'LANDED_SUCCESS'
  | 'LANDED_FAILURE'
  | 'NOLAND'
  | 'FINALIZED'
  | 'SETTLED'
  | 'OUTCOME_MATURE';

export type FlightTerminalOutcome =
  | 'NONE'
  | 'LANDED_SUCCESS'
  | 'LANDED_INSTRUCTION_FAILURE'
  | 'SLIPPAGE_REJECTED'
  | 'DELIVERY_FAILED'
  | 'BLOCKHASH_EXPIRED'
  | 'CERTIFIED_NO_LAND'
  | 'UNKNOWN';

export interface EconomicFlightRecord {
  readonly flightId: string;
  readonly attemptId: string;
  readonly economicFactId: string;
  readonly economicIntentId: string;
  readonly executionGenerationId: string;
  readonly revision: number;
  readonly stage: FlightLifecycleStage;
  readonly strategyId: string;
  readonly modelVersion: string;
  readonly policyVersion: string;
  readonly releaseRoot: string;
  readonly mint: string;
  readonly creator: string;
  readonly walletCluster: string;
  readonly regime: string;
  readonly protocol: string;

  // Timestamps
  readonly discoveredAt: string;
  readonly observedAt: string;
  readonly knownAt: string;
  readonly decisionAt: string | null;
  readonly quotedAt: string | null;
  readonly builtAt: string | null;
  readonly signedAt: string | null;
  readonly submittedAt: string | null;
  readonly landedAt: string | null;
  readonly finalizedAt: string | null;
  readonly settledAt: string | null;

  // Prices
  readonly decisionPrice: number | null;
  readonly quotePrice: number | null;
  readonly simulationPrice: number | null;
  readonly landingPrice: number | null;
  readonly exitPrice: number | null;

  // Quantities & Amounts
  readonly requestedInputLamports: bigint | null;
  readonly quotedOutputRaw: bigint | null;
  readonly simulatedOutputRaw: bigint | null;
  readonly actualOutputRaw: bigint | null;

  // Execution Frictions & Shortfalls
  readonly baseFeeLamports: bigint | null;
  readonly priorityFeeLamports: bigint | null;
  readonly jitoTipLamports: bigint | null;
  readonly routeFeeLamports: bigint | null;
  readonly token2022FeeLamports: bigint | null;
  readonly rentLamports: bigint | null;
  readonly realizedSlippageBps: number | null;
  readonly selfImpactBps: number | null;
  readonly implementationShortfallBps: number | null;

  // Transport & Microstructure Environment
  readonly transport: 'JITO_BUNDLE' | 'TPU_QUIC' | 'RPC_FALLBACK' | 'SIMULATED';
  readonly rpcProvider: string;
  readonly jitoRegion: string;
  readonly leaderInformation: string;
  readonly writableAccountSet: readonly string[];

  // Terminality, Evaluation & PnL
  readonly terminalOutcome: FlightTerminalOutcome;
  readonly mfePct: number | null;
  readonly maePct: number | null;
  readonly grossPnLLamports: bigint | null;
  readonly netPnLLamports: bigint | null;
  readonly outcomeMaturedAt: string | null;
  readonly recordHash: string;
}

const ALLOWED_STAGE_TRANSITIONS: Readonly<Record<FlightLifecycleStage, readonly FlightLifecycleStage[]>> = {
  DISCOVERED: ['FILTER_EVALUATED'],
  FILTER_EVALUATED: ['DECISION_CREATED'],
  DECISION_CREATED: ['QUOTE_CAPTURED'],
  QUOTE_CAPTURED: ['BUILD_STARTED'],
  BUILD_STARTED: ['BUILD_COMPLETED'],
  BUILD_COMPLETED: ['SIMULATED'],
  SIMULATED: ['AUTHORIZED'],
  AUTHORIZED: ['SIGNED'],
  SIGNED: ['SUBMITTED'],
  SUBMITTED: ['ACKNOWLEDGED', 'UNKNOWN'],
  ACKNOWLEDGED: ['UNKNOWN', 'LANDED_SUCCESS', 'LANDED_FAILURE'],
  UNKNOWN: ['ACKNOWLEDGED', 'LANDED_SUCCESS', 'LANDED_FAILURE', 'NOLAND'],
  LANDED_SUCCESS: ['FINALIZED'],
  LANDED_FAILURE: ['FINALIZED'],
  NOLAND: ['FINALIZED'],
  FINALIZED: ['SETTLED'],
  SETTLED: ['OUTCOME_MATURE'],
  OUTCOME_MATURE: [],
};

export class SQLiteExecutionAttemptStore {
  private readonly db: DatabaseSync;
  private readonly inMemory: boolean;

  constructor(dbPath: string) {
    this.inMemory = dbPath === ':memory:';
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    if (!this.inMemory) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
        // FULL sync preserves committed WAL transactions across power loss/hard reboot.
        this.db.exec('PRAGMA synchronous = FULL;');
      } catch {
        // In-memory or restricted environments ignore journal mode pragmas.
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS flight_records (
        flight_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        economic_fact_id TEXT NOT NULL,
        economic_intent_id TEXT NOT NULL,
        execution_generation_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        stage TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        release_root TEXT NOT NULL,
        mint TEXT NOT NULL,
        creator TEXT NOT NULL,
        wallet_cluster TEXT NOT NULL,
        regime TEXT NOT NULL,
        protocol TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        known_at TEXT NOT NULL,
        decision_at TEXT,
        quoted_at TEXT,
        built_at TEXT,
        signed_at TEXT,
        submitted_at TEXT,
        landed_at TEXT,
        finalized_at TEXT,
        settled_at TEXT,
        decision_price REAL,
        quote_price REAL,
        simulation_price REAL,
        landing_price REAL,
        exit_price REAL,
        requested_input_lamports TEXT,
        quoted_output_raw TEXT,
        simulated_output_raw TEXT,
        actual_output_raw TEXT,
        base_fee_lamports TEXT,
        priority_fee_lamports TEXT,
        jito_tip_lamports TEXT,
        route_fee_lamports TEXT,
        token2022_fee_lamports TEXT,
        rent_lamports TEXT,
        realized_slippage_bps REAL,
        self_impact_bps REAL,
        implementation_shortfall_bps REAL,
        transport TEXT NOT NULL,
        rpc_provider TEXT NOT NULL,
        jito_region TEXT NOT NULL,
        leader_information TEXT NOT NULL,
        writable_account_set_json TEXT NOT NULL,
        terminal_outcome TEXT NOT NULL,
        mfe_pct REAL,
        mae_pct REAL,
        gross_pnl_lamports TEXT,
        net_pnl_lamports TEXT,
        outcome_matured_at TEXT,
        record_hash TEXT NOT NULL,
        UNIQUE (economic_fact_id, execution_generation_id, revision)
      );

      CREATE INDEX IF NOT EXISTS idx_flight_attempt_id ON flight_records (attempt_id);
      CREATE INDEX IF NOT EXISTS idx_flight_fact_gen ON flight_records (economic_fact_id, execution_generation_id);
      CREATE INDEX IF NOT EXISTS idx_flight_stage ON flight_records (stage);

      CREATE TRIGGER IF NOT EXISTS flight_records_no_update
      BEFORE UPDATE ON flight_records
      BEGIN SELECT RAISE(ABORT, 'FLIGHT_RECORDER_UPDATE_FORBIDDEN'); END;

      CREATE TRIGGER IF NOT EXISTS flight_records_no_delete
      BEFORE DELETE ON flight_records
      BEGIN SELECT RAISE(ABORT, 'FLIGHT_RECORDER_DELETE_FORBIDDEN'); END;
    `);
  }

  public append(record: EconomicFlightRecord): void {
    if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
      throw new Error('FLIGHT_RECORDER_INVALID_REVISION');
    }
    const expectedHash = hashCanonical({ ...record, recordHash: '' });
    if (record.recordHash !== expectedHash) {
      throw new Error('FLIGHT_RECORDER_RECORD_HASH_MISMATCH');
    }

    // Enforce immutable append-only invariant
    const existing = this.db.prepare(
      'SELECT flight_id FROM flight_records WHERE economic_fact_id = ? AND execution_generation_id = ? AND revision = ?'
    ).get(record.economicFactId, record.executionGenerationId, record.revision);

    if (existing) {
      throw new Error(
        `FLIGHT_RECORDER_IMMUTABLE_OVERWRITE_BLOCKED: Attempted to overwrite existing revision ${record.revision} for fact ${record.economicFactId} gen ${record.executionGenerationId}`
      );
    }

    const latest = this.getLatest(record.economicFactId, record.executionGenerationId);
    if (!latest) {
      if (record.revision !== 0 || record.stage !== 'DISCOVERED') {
        throw new Error('FLIGHT_RECORDER_INVALID_INITIAL_REVISION');
      }
    } else {
      if (record.revision !== latest.revision + 1) {
        throw new Error('FLIGHT_RECORDER_REVISION_GAP');
      }
      if (record.mint !== latest.mint || record.economicIntentId !== latest.economicIntentId
        || record.attemptId !== latest.attemptId) {
        throw new Error('FLIGHT_RECORDER_IDENTITY_MUTATION');
      }
      if (!ALLOWED_STAGE_TRANSITIONS[latest.stage].includes(record.stage)) {
        throw new Error(`FLIGHT_RECORDER_ILLEGAL_STAGE_TRANSITION: ${latest.stage} -> ${record.stage}`);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO flight_records (
        flight_id, attempt_id, economic_fact_id, economic_intent_id, execution_generation_id,
        revision, stage, strategy_id, model_version, policy_version, release_root,
        mint, creator, wallet_cluster, regime, protocol,
        discovered_at, observed_at, known_at, decision_at, quoted_at, built_at, signed_at,
        submitted_at, landed_at, finalized_at, settled_at,
        decision_price, quote_price, simulation_price, landing_price, exit_price,
        requested_input_lamports, quoted_output_raw, simulated_output_raw, actual_output_raw,
        base_fee_lamports, priority_fee_lamports, jito_tip_lamports, route_fee_lamports,
        token2022_fee_lamports, rent_lamports, realized_slippage_bps, self_impact_bps,
        implementation_shortfall_bps, transport, rpc_provider, jito_region,
        leader_information, writable_account_set_json, terminal_outcome,
        mfe_pct, mae_pct, gross_pnl_lamports, net_pnl_lamports,
        outcome_matured_at, record_hash
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      record.flightId,
      record.attemptId,
      record.economicFactId,
      record.economicIntentId,
      record.executionGenerationId,
      record.revision,
      record.stage,
      record.strategyId,
      record.modelVersion,
      record.policyVersion,
      record.releaseRoot,
      record.mint,
      record.creator,
      record.walletCluster,
      record.regime,
      record.protocol,
      record.discoveredAt,
      record.observedAt,
      record.knownAt,
      record.decisionAt,
      record.quotedAt,
      record.builtAt,
      record.signedAt,
      record.submittedAt,
      record.landedAt,
      record.finalizedAt,
      record.settledAt,
      record.decisionPrice,
      record.quotePrice,
      record.simulationPrice,
      record.landingPrice,
      record.exitPrice,
      record.requestedInputLamports !== null ? record.requestedInputLamports.toString() : null,
      record.quotedOutputRaw !== null ? record.quotedOutputRaw.toString() : null,
      record.simulatedOutputRaw !== null ? record.simulatedOutputRaw.toString() : null,
      record.actualOutputRaw !== null ? record.actualOutputRaw.toString() : null,
      record.baseFeeLamports !== null ? record.baseFeeLamports.toString() : null,
      record.priorityFeeLamports !== null ? record.priorityFeeLamports.toString() : null,
      record.jitoTipLamports !== null ? record.jitoTipLamports.toString() : null,
      record.routeFeeLamports !== null ? record.routeFeeLamports.toString() : null,
      record.token2022FeeLamports !== null ? record.token2022FeeLamports.toString() : null,
      record.rentLamports !== null ? record.rentLamports.toString() : null,
      record.realizedSlippageBps,
      record.selfImpactBps,
      record.implementationShortfallBps,
      record.transport,
      record.rpcProvider,
      record.jitoRegion,
      record.leaderInformation,
      JSON.stringify(record.writableAccountSet),
      record.terminalOutcome,
      record.mfePct,
      record.maePct,
      record.grossPnLLamports !== null ? record.grossPnLLamports.toString() : null,
      record.netPnLLamports !== null ? record.netPnLLamports.toString() : null,
      record.outcomeMaturedAt,
      record.recordHash
    );
  }

  public getLatest(economicFactId: string, executionGenerationId: string): EconomicFlightRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM flight_records WHERE economic_fact_id = ? AND execution_generation_id = ? ORDER BY revision DESC LIMIT 1'
    ).get(economicFactId, executionGenerationId);

    return row ? this.deserializeRow(row as Record<string, unknown>) : null;
  }

  public getByAttemptId(attemptId: string): EconomicFlightRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM flight_records WHERE attempt_id = ? ORDER BY revision DESC LIMIT 1'
    ).get(attemptId);

    return row ? this.deserializeRow(row as Record<string, unknown>) : null;
  }

  public getRevisions(economicFactId: string, executionGenerationId: string): readonly EconomicFlightRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM flight_records WHERE economic_fact_id = ? AND execution_generation_id = ? ORDER BY revision ASC'
    ).all(economicFactId, executionGenerationId);

    return Object.freeze(rows.map((r) => this.deserializeRow(r as Record<string, unknown>)));
  }

  public getAllHistory(): readonly EconomicFlightRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM flight_records ORDER BY discovered_at ASC, economic_fact_id ASC, execution_generation_id ASC, revision ASC'
    ).all();
    return Object.freeze(rows.map((row) => this.deserializeRow(row as Record<string, unknown>)));
  }

  public getByStage(stage: FlightLifecycleStage): readonly EconomicFlightRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM flight_records WHERE stage = ? ORDER BY revision ASC'
    ).all(stage);

    return Object.freeze(rows.map((r) => this.deserializeRow(r as Record<string, unknown>)));
  }

  public count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM flight_records').get() as { c: number };
    return row.c;
  }

  public close(): void {
    this.db.close();
  }

  private deserializeRow(row: Record<string, unknown>): EconomicFlightRecord {
    return Object.freeze({
      flightId: row.flight_id as string,
      attemptId: row.attempt_id as string,
      economicFactId: row.economic_fact_id as string,
      economicIntentId: row.economic_intent_id as string,
      executionGenerationId: row.execution_generation_id as string,
      revision: Number(row.revision),
      stage: row.stage as FlightLifecycleStage,
      strategyId: row.strategy_id as string,
      modelVersion: row.model_version as string,
      policyVersion: row.policy_version as string,
      releaseRoot: row.release_root as string,
      mint: row.mint as string,
      creator: row.creator as string,
      walletCluster: row.wallet_cluster as string,
      regime: row.regime as string,
      protocol: row.protocol as string,
      discoveredAt: row.discovered_at as string,
      observedAt: row.observed_at as string,
      knownAt: row.known_at as string,
      decisionAt: (row.decision_at as string) ?? null,
      quotedAt: (row.quoted_at as string) ?? null,
      builtAt: (row.built_at as string) ?? null,
      signedAt: (row.signed_at as string) ?? null,
      submittedAt: (row.submitted_at as string) ?? null,
      landedAt: (row.landed_at as string) ?? null,
      finalizedAt: (row.finalized_at as string) ?? null,
      settledAt: (row.settled_at as string) ?? null,
      decisionPrice: row.decision_price !== null ? Number(row.decision_price) : null,
      quotePrice: row.quote_price !== null ? Number(row.quote_price) : null,
      simulationPrice: row.simulation_price !== null ? Number(row.simulation_price) : null,
      landingPrice: row.landing_price !== null ? Number(row.landing_price) : null,
      exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
      requestedInputLamports: row.requested_input_lamports ? BigInt(row.requested_input_lamports as string) : null,
      quotedOutputRaw: row.quoted_output_raw ? BigInt(row.quoted_output_raw as string) : null,
      simulatedOutputRaw: row.simulated_output_raw ? BigInt(row.simulated_output_raw as string) : null,
      actualOutputRaw: row.actual_output_raw ? BigInt(row.actual_output_raw as string) : null,
      baseFeeLamports: row.base_fee_lamports ? BigInt(row.base_fee_lamports as string) : null,
      priorityFeeLamports: row.priority_fee_lamports ? BigInt(row.priority_fee_lamports as string) : null,
      jitoTipLamports: row.jito_tip_lamports ? BigInt(row.jito_tip_lamports as string) : null,
      routeFeeLamports: row.route_fee_lamports ? BigInt(row.route_fee_lamports as string) : null,
      token2022FeeLamports: row.token2022_fee_lamports ? BigInt(row.token2022_fee_lamports as string) : null,
      rentLamports: row.rent_lamports ? BigInt(row.rent_lamports as string) : null,
      realizedSlippageBps: row.realized_slippage_bps !== null ? Number(row.realized_slippage_bps) : null,
      selfImpactBps: row.self_impact_bps !== null ? Number(row.self_impact_bps) : null,
      implementationShortfallBps:
        row.implementation_shortfall_bps !== null ? Number(row.implementation_shortfall_bps) : null,
      transport: row.transport as 'JITO_BUNDLE' | 'TPU_QUIC' | 'RPC_FALLBACK' | 'SIMULATED',
      rpcProvider: row.rpc_provider as string,
      jitoRegion: row.jito_region as string,
      leaderInformation: row.leader_information as string,
      writableAccountSet: Object.freeze(JSON.parse(row.writable_account_set_json as string)),
      terminalOutcome: row.terminal_outcome as FlightTerminalOutcome,
      mfePct: row.mfe_pct !== null ? Number(row.mfe_pct) : null,
      maePct: row.mae_pct !== null ? Number(row.mae_pct) : null,
      grossPnLLamports: row.gross_pnl_lamports ? BigInt(row.gross_pnl_lamports as string) : null,
      netPnLLamports: row.net_pnl_lamports ? BigInt(row.net_pnl_lamports as string) : null,
      outcomeMaturedAt: (row.outcome_matured_at as string) ?? null,
      recordHash: row.record_hash as string,
    });
  }
}

export class EconomicFlightRecorder {
  private readonly store: SQLiteExecutionAttemptStore;

  constructor(store: SQLiteExecutionAttemptStore) {
    this.store = store;
  }

  public getStore(): SQLiteExecutionAttemptStore {
    return this.store;
  }

  /**
   * Stage 1: Records discovery of a candidate BEFORE any filtering or model evaluation.
   */
  public recordDiscovery(params: {
    economicFactId: string;
    mint: string;
    creator: string;
    protocol?: string;
    regime?: string;
    discoveredAt?: string;
    observedAt?: string;
    knownAt?: string;
  }): EconomicFlightRecord {
    const now = new Date().toISOString();
    const flightId = `flight_${params.economicFactId}_r0`;
    const attemptId = `att_${params.economicFactId}_r0`;

    const record: EconomicFlightRecord = Object.freeze({
      flightId,
      attemptId,
      economicFactId: params.economicFactId,
      economicIntentId: `intent_${params.economicFactId}`,
      executionGenerationId: `gen_${params.economicFactId}_0`,
      revision: 0,
      stage: 'DISCOVERED',
      strategyId: 'DISCOVERY_CANDIDATE',
      modelVersion: '1.0.0',
      policyVersion: '1.0.0',
      releaseRoot: 'RELEASE_ROOT_ACTIVE',
      mint: params.mint,
      creator: params.creator,
      walletCluster: 'UNKNOWN_CLUSTER',
      regime: params.regime ?? 'STANDARD',
      protocol: params.protocol ?? 'PUMP_FUN',
      discoveredAt: params.discoveredAt ?? now,
      observedAt: params.observedAt ?? now,
      knownAt: params.knownAt ?? now,
      decisionAt: null,
      quotedAt: null,
      builtAt: null,
      signedAt: null,
      submittedAt: null,
      landedAt: null,
      finalizedAt: null,
      settledAt: null,
      decisionPrice: null,
      quotePrice: null,
      simulationPrice: null,
      landingPrice: null,
      exitPrice: null,
      requestedInputLamports: null,
      quotedOutputRaw: null,
      simulatedOutputRaw: null,
      actualOutputRaw: null,
      baseFeeLamports: null,
      priorityFeeLamports: null,
      jitoTipLamports: null,
      routeFeeLamports: null,
      token2022FeeLamports: null,
      rentLamports: null,
      realizedSlippageBps: null,
      selfImpactBps: null,
      implementationShortfallBps: null,
      transport: 'SIMULATED',
      rpcProvider: 'INITIAL_PROVIDER',
      jitoRegion: 'DEFAULT',
      leaderInformation: 'PENDING_DISCOVERY',
      writableAccountSet: Object.freeze([]),
      terminalOutcome: 'NONE',
      mfePct: null,
      maePct: null,
      grossPnLLamports: null,
      netPnLLamports: null,
      outcomeMaturedAt: null,
      recordHash: '',
    });

    const hash = hashCanonical(record);
    const completeRecord: EconomicFlightRecord = Object.freeze({
      ...record,
      recordHash: hash,
    });

    this.store.append(completeRecord);
    return completeRecord;
  }

  /**
   * Advances the flight record to the next lifecycle stage, incrementing the revision.
   */
  public advanceLifecycle(
    economicFactId: string,
    executionGenerationId: string,
    newStage: FlightLifecycleStage,
    updates: Partial<EconomicFlightRecord>
  ): EconomicFlightRecord {
    const current = this.store.getLatest(economicFactId, executionGenerationId);
    if (!current) {
      throw new Error(
        `FLIGHT_RECORDER_RECORD_NOT_FOUND: Cannot advance non-existent fact ${economicFactId} gen ${executionGenerationId}`
      );
    }

    const nextRevision = current.revision + 1;
    const flightId = `flight_${economicFactId}_r${nextRevision}`;
    const attemptId = updates.attemptId ?? current.attemptId;

    const draftRecord: EconomicFlightRecord = Object.freeze({
      ...current,
      ...updates,
      flightId,
      attemptId,
      economicFactId,
      executionGenerationId,
      revision: nextRevision,
      stage: newStage,
      recordHash: '',
    });

    const recordHash = hashCanonical(draftRecord);
    const completeRecord: EconomicFlightRecord = Object.freeze({
      ...draftRecord,
      recordHash,
    });

    this.store.append(completeRecord);
    return completeRecord;
  }
}
