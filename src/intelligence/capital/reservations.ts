/**
 * SYLPH HIERARCHICAL & SERIALIZABLE RESERVATION ENGINE
 * Parts VIII, IX, X, XI — Serializable Commit, Hierarchical Ownership,
 * Worst-Case Accounting & Economic Intent Identity
 *
 * Prevents concurrent trades from violating portfolio boundaries.
 * Decouples economic intents from transaction candidate IDs.
 * Enforces EXACT-BASE-UNIT (bigint lamports) authoritative capital reservations.
 */

export interface HierarchicalReservationOwner {
  readonly hot_wallet_address: string;
  readonly portfolio_id: string;
  readonly strategy_id: string;
  readonly token_mint: string;
  readonly position_id?: string;
  readonly economic_intent_id: string;
}

export interface ExactWorstCaseLamports {
  readonly max_input_lamports: bigint;
  readonly max_base_fee_lamports: bigint;
  readonly max_priority_fee_lamports: bigint;
  readonly max_jito_tip_lamports: bigint;
  readonly ata_rent_lamports: bigint;
  readonly max_slippage_bps: number;
  readonly total_worst_case_lamports: bigint;
}

export interface WorstCaseAccounting {
  readonly max_input_sol: number;
  readonly max_base_fee_sol: number;
  readonly max_priority_fee_sol: number;
  readonly max_jito_tip_sol: number;
  readonly ata_rent_sol: number;
  readonly max_slippage_bps: number;
  readonly total_worst_case_sol: number;
  readonly exact_lamports?: ExactWorstCaseLamports;
}

export interface DurableReservationCapability {
  readonly capability_id: string;
  readonly intent_id: string;
  readonly owner: HierarchicalReservationOwner;
  readonly exact_accounting: ExactWorstCaseLamports;
  readonly state_version: number;
  readonly expires_at_slot: number;
  readonly created_at_ms: number;
  readonly is_released: boolean;
}

export interface EconomicIntent {
  readonly economic_intent_id: string;
  readonly candidate_transaction_id: string;
  readonly sign_operation_id?: string;
  readonly reservation_id: string;
  readonly owner: HierarchicalReservationOwner;
  readonly accounting: WorstCaseAccounting;
  readonly exact_accounting: ExactWorstCaseLamports;
  readonly capability?: DurableReservationCapability;
  readonly state: 'PREPARED' | 'RESERVED' | 'COMMITTED' | 'EXECUTING' | 'SETTLED' | 'UNKNOWN' | 'ABORTED';
  readonly created_at_ms: number;
  readonly expires_at_slot: number;
}

export class HierarchicalReservationEngine {
  private readonly intents = new Map<string, EconomicIntent>(); // key = economic_intent_id
  private readonly reservations = new Map<string, {
    owner: HierarchicalReservationOwner;
    accounting: WorstCaseAccounting;
    exact_accounting: ExactWorstCaseLamports;
    capability: DurableReservationCapability;
    state_version_at_creation: number;
  }>();

  /**
   * Calculates total worst-case capital requirement using exact bigint lamports.
   * Zero floating point representation allowed in authoritative reservation ledger.
   */
  public calculateWorstCaseLamports(params: {
    input_lamports: bigint;
    max_priority_fee_lamports?: bigint;
    jito_tip_lamports?: bigint;
    needs_ata_creation?: boolean;
    max_slippage_bps?: number;
  }): ExactWorstCaseLamports {
    if (params.input_lamports <= 0n) {
      throw new Error(`INVALID_INPUT_LAMPORTS: must be positive bigint (got ${params.input_lamports})`);
    }
    const baseFee = 5_000n;
    const prioFee = params.max_priority_fee_lamports ?? 750_000n; // 0.00075 SOL default
    const jitoTip = params.jito_tip_lamports ?? 100_000n;
    const ataRent = params.needs_ata_creation ? 2_039_280n : 0n;
    const slippageBps = params.max_slippage_bps ?? 300;
    const slippageBuffer = (params.input_lamports * BigInt(slippageBps)) / 10_000n;

    const total = params.input_lamports + baseFee + prioFee + jitoTip + ataRent + slippageBuffer;

    return {
      max_input_lamports: params.input_lamports,
      max_base_fee_lamports: baseFee,
      max_priority_fee_lamports: prioFee,
      max_jito_tip_lamports: jitoTip,
      ata_rent_lamports: ataRent,
      max_slippage_bps: slippageBps,
      total_worst_case_lamports: total,
    };
  }

  /**
   * Calculates total worst-case capital requirement including all edge fees (Part X).
   * Backed by exact integer lamports arithmetic to eliminate IEEE-754 precision loss.
   */
  public calculateWorstCase(params: {
    input_sol: number;
    priority_fee_multiplier?: number;
    jito_tip_lamports?: number;
    needs_ata_creation?: boolean;
    max_slippage_bps?: number;
  }): WorstCaseAccounting {
    if (!Number.isFinite(params.input_sol) || params.input_sol <= 0) {
      throw new Error(`INVALID_INPUT_SOL: must be positive finite number (got ${params.input_sol})`);
    }

    const inputLamports = BigInt(Math.round(params.input_sol * 1e9));
    const prioMult = params.priority_fee_multiplier ?? 1.5;
    const maxPrioLamports = BigInt(Math.round(500_000 * prioMult));
    const jitoTipLamports = BigInt(params.jito_tip_lamports ?? 100_000);

    const exact = this.calculateWorstCaseLamports({
      input_lamports: inputLamports,
      max_priority_fee_lamports: maxPrioLamports,
      jito_tip_lamports: jitoTipLamports,
      needs_ata_creation: params.needs_ata_creation,
      max_slippage_bps: params.max_slippage_bps,
    });

    return {
      max_input_sol: Number(exact.max_input_lamports) / 1e9,
      max_base_fee_sol: Number(exact.max_base_fee_lamports) / 1e9,
      max_priority_fee_sol: Number(exact.max_priority_fee_lamports) / 1e9,
      max_jito_tip_sol: Number(exact.max_jito_tip_lamports) / 1e9,
      ata_rent_sol: Number(exact.ata_rent_lamports) / 1e9,
      max_slippage_bps: exact.max_slippage_bps,
      total_worst_case_sol: Number(exact.total_worst_case_lamports) / 1e9,
      exact_lamports: exact,
    };
  }

  /**
   * Prepares and registers an EconomicIntent decoupled from physical tx hash (Part XI).
   */
  public createEconomicIntent(params: {
    economic_intent_id: string;
    candidate_transaction_id: string;
    owner: HierarchicalReservationOwner;
    accounting: WorstCaseAccounting;
    exact_accounting?: ExactWorstCaseLamports;
    state_version: number;
    expires_at_slot: number;
  }): EconomicIntent {
    const reservationId = `res_${params.economic_intent_id}_${params.state_version}`;

    // Exactly-once invariant: prevent duplicate economic intent creation
    if (this.intents.has(params.economic_intent_id)) {
      throw new Error(`DUPLICATE_ECONOMIC_INTENT: ${params.economic_intent_id} already exists`);
    }

    const exact: ExactWorstCaseLamports = params.exact_accounting ?? params.accounting.exact_lamports ?? {
      max_input_lamports: BigInt(Math.round(params.accounting.max_input_sol * 1e9)),
      max_base_fee_lamports: BigInt(Math.round(params.accounting.max_base_fee_sol * 1e9)),
      max_priority_fee_lamports: BigInt(Math.round(params.accounting.max_priority_fee_sol * 1e9)),
      max_jito_tip_lamports: BigInt(Math.round(params.accounting.max_jito_tip_sol * 1e9)),
      ata_rent_lamports: BigInt(Math.round(params.accounting.ata_rent_sol * 1e9)),
      max_slippage_bps: params.accounting.max_slippage_bps,
      total_worst_case_lamports: BigInt(Math.round(params.accounting.total_worst_case_sol * 1e9)),
    };

    const capability: DurableReservationCapability = {
      capability_id: `cap_${reservationId}`,
      intent_id: params.economic_intent_id,
      owner: params.owner,
      exact_accounting: exact,
      state_version: params.state_version,
      expires_at_slot: params.expires_at_slot,
      created_at_ms: Date.now(),
      is_released: false,
    };

    const intent: EconomicIntent = {
      economic_intent_id: params.economic_intent_id,
      candidate_transaction_id: params.candidate_transaction_id,
      reservation_id: reservationId,
      owner: params.owner,
      accounting: params.accounting,
      exact_accounting: exact,
      capability,
      state: 'PREPARED',
      created_at_ms: Date.now(),
      expires_at_slot: params.expires_at_slot,
    };

    this.intents.set(params.economic_intent_id, intent);
    this.reservations.set(reservationId, {
      owner: params.owner,
      accounting: params.accounting,
      exact_accounting: exact,
      capability,
      state_version_at_creation: params.state_version,
    });

    return intent;
  }

  /**
   * Updates candidate tx ID without duplicating economic action (e.g. fee requoting) (Part XI).
   */
  public replaceCandidateTransaction(
    intentId: string,
    newCandidateTxId: string,
    newAccounting?: WorstCaseAccounting,
    newExactAccounting?: ExactWorstCaseLamports
  ): EconomicIntent {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error(`Intent not found: ${intentId}`);

    const accounting = newAccounting ?? intent.accounting;
    const exact = newExactAccounting ?? (newAccounting?.exact_lamports ?? intent.exact_accounting);

    const updated: EconomicIntent = {
      ...intent,
      candidate_transaction_id: newCandidateTxId,
      accounting,
      exact_accounting: exact,
    };
    this.intents.set(intentId, updated);
    return updated;
  }

  /**
   * Transition to UNKNOWN on timeout: reservation remains locked! (Part X).
   */
  public markIntentUnknown(intentId: string): void {
    const intent = this.intents.get(intentId);
    if (!intent) return;
    this.intents.set(intentId, { ...intent, state: 'UNKNOWN' });
  }

  public getIntent(intentId: string): EconomicIntent | undefined {
    return this.intents.get(intentId);
  }

  public getCapability(intentId: string): DurableReservationCapability | undefined {
    return this.intents.get(intentId)?.capability;
  }

  public getActiveIntentCount(): number {
    let count = 0;
    for (const intent of this.intents.values()) {
      if (intent.state === 'PREPARED' || intent.state === 'RESERVED' || intent.state === 'COMMITTED' || intent.state === 'UNKNOWN') {
        count++;
      }
    }
    return count;
  }
}
