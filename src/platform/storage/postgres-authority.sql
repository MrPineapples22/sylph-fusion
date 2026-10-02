-- ============================================================================
-- SYLPH FUSION — UNCONNECTED POSTGRESQL AUTHORITY SCHEMA SKETCH
-- Specifications: Sections 37 (Execution Generations), 103 (Invariants 1-10)
--
-- No runtime adapter or production authority is connected to this schema.
-- Defines at-most-one matching active generation and BIGINT amount storage.
-- Transactional capital limits, durable side-effect recovery, verified terminal
-- transitions and certificate replay protection remain unimplemented.
-- ============================================================================

-- Proposed domain error mappings; SY001-SY015 are not implemented SQLSTATEs here.
-- No function/trigger raises these codes. Native database errors require a
-- reviewed adapter mapping based on SQLSTATE and exact constraint identity.
-- SY001: DUPLICATE_ECONOMIC_INTENT
-- SY002: CAPITAL_RESERVATION_EXCEEDED
-- SY003: CONCURRENT_LIVE_GENERATION_EXISTS
-- SY004: UNAUTHORIZED_SIGNING_INVOCATION
-- SY005: SIDE_EFFECT_ALREADY_COMMITTED
-- SY006: SETTLEMENT_WITHOUT_CERTIFICATE
-- SY007: PREMATURE_RESERVATION_RELEASE
-- SY008: FLOAT_AMOUNT_REJECTED
-- SY009: STALE_STATE_VERSION
-- SY010: INVALID_NO_LAND_CERTIFICATE
-- SY011: SIGNER_FIREWALL_VIOLATION
-- SY012: WIRE_TAMPER_DETECTED
-- SY013: UNCONFIRMED_RPC_QUORUM_SPLIT
-- SY014: SERIALIZATION_CONFLICT_RETRY_BLOCKED
-- SY015: PROHIBITED_AUTHORITY_ESCALATION

CREATE TABLE IF NOT EXISTS economic_intents (
    intent_id TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    requested_amount_lamports BIGINT NOT NULL CHECK (requested_amount_lamports > 0),
    max_input_lamports BIGINT NOT NULL CHECK (max_input_lamports > 0),
    state TEXT NOT NULL CHECK (state IN ('PREPARED', 'RESERVED', 'COMMITTED', 'EXECUTING', 'SETTLED', 'UNKNOWN', 'ABORTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_reservations (
    reservation_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES economic_intents(intent_id),
    reserved_lamports BIGINT NOT NULL CHECK (reserved_lamports > 0),
    state_version INT NOT NULL,
    is_released BOOLEAN NOT NULL DEFAULT FALSE,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_generations (
    intent_id TEXT NOT NULL REFERENCES economic_intents(intent_id),
    generation INT NOT NULL CHECK (generation >= 1),
    signature TEXT NOT NULL,
    wire_bytes BYTEA,
    last_valid_block_height BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'PREPARED_FOR_SIGNING', 'SIGNED', 'SUBMITTED_UNKNOWN', 'CONFIRMED', 'SUPERSEDED', 'EXPIRED')),
    submission_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (intent_id, generation)
);

-- ============================================================================
-- INVARIANT 1: AT MOST ONE ACTIVE EXECUTION GENERATION PER INTENT
-- When this index is installed as defined, it permits at most one matching row.
-- It does not require a row or verify terminal transitions out of the predicate.
-- A uniqueness conflict reports native SQLSTATE 23505 (unique_violation).
-- Mapping that specific index conflict to domain SY003 is not implemented.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_generation_per_intent 
ON execution_generations (intent_id) 
WHERE state IN ('ACTIVE', 'PREPARED_FOR_SIGNING', 'SIGNED', 'SUBMITTED_UNKNOWN');

CREATE TABLE IF NOT EXISTS settlement_certificates (
    certificate_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES economic_intents(intent_id),
    generation INT NOT NULL,
    signature TEXT NOT NULL,
    certificate_type TEXT NOT NULL CHECK (certificate_type IN ('FINALIZED_SETTLEMENT_CERTIFICATE', 'NO_LAND_CERTIFICATE')),
    slot BIGINT NOT NULL,
    fee_lamports BIGINT NOT NULL DEFAULT 0,
    token_delta BIGINT NOT NULL DEFAULT 0,
    sol_delta BIGINT NOT NULL DEFAULT 0,
    proof_digest TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (intent_id, generation) REFERENCES execution_generations(intent_id, generation)
);

CREATE TABLE IF NOT EXISTS side_effect_fences (
    fence_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES economic_intents(intent_id),
    generation INT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('SIGNING', 'SUBMISSION')),
    external_call_id TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PREPARED', 'COMMITTED', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (intent_id, generation) REFERENCES execution_generations(intent_id, generation)
);
