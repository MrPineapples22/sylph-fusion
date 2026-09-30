# SYLPH FUSION — RECOVERY MODEL & RESTORATION MACHINE
**Standard:** Master Quantitative Upgrade §§ 2.6, 11, 12  
**Core Invariant:** Every state capable of reducing authority must define a deterministic recovery path. No restoration on timeouts alone.

---

## 1. THE EIGHT RECOVERY QUESTIONS

For every degradation state, the recovery subsystem enforces answers to eight non-negotiable questions:

1. **What caused the transition?** (e.g. RPC quorum split, stale market feed, unresolved intent backlog, circuit breaker).
2. **Is the transition temporary or permanent?** (e.g. transient network drop vs malicious mint exploit).
3. **What evidence proves the cause is gone?** (e.g. 5 consecutive healthy RPC pings, fresh blockhash, on-chain position balance match).
4. **Who is authorized to restore authority?** (e.g. `CapitalKernel.restoreAuthorityWithCertificate()`).
5. **What recovery states are traversed?** (`A2_REDUCE_ONLY` -> `A4_LIMITED_INCREASE` -> `A5_NORMAL`).
6. **What epoch/version is restored?** (Epoch must monotonically increment; old leases remain permanently dead).
7. **What evidence is logged?** (`RecoveryCertificate` recorded in write-ahead event ledger).
8. **What prevents premature restoration?** (Fail-closed assertions on provider health, state root length, and settlement cleanliness).

---

## 2. THE RECOVERY CERTIFICATE CONTRACT

Authority cannot be restored via a boolean flag. Restoration requires an immutable `RecoveryCertificate`:

```typescript
export interface RecoveryCertificate {
  readonly recovery_id: string;
  readonly cause: string;
  readonly previous_authority: AuthorityMode;
  readonly target_authority: AuthorityMode;
  readonly capital_state_root: string;
  readonly position_reconciliation_hash: string;
  readonly provider_status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  readonly market_freshness_ms: number;
  readonly revocation_epoch: number;
  readonly signer_state: 'READY' | 'UNAVAILABLE';
  readonly settlement_state: 'CLEAN' | 'UNCLEAN';
  readonly control_epoch: number;
  readonly timestamp_ms: number;
  readonly evidence_hashes: readonly string[];
  readonly verification_result: boolean;
}
```

### Verification Rules in `CapitalKernel.restoreAuthorityWithCertificate()`:
1. `cert.verification_result === true`
2. `cert.provider_status === 'HEALTHY'`
3. `cert.settlement_state === 'CLEAN'`
4. `cert.signer_state === 'READY'`
5. `0 <= cert.market_freshness_ms <= 30,000`
6. `cert.capital_state_root.length >= 16`
7. Upward lattice progression: `rank(target_authority) > rank(current_authority)`.

---

## 3. REVOCATION RESOLUTION LIFECYCLE

Revocations in `RevocationEngine` follow an explicit 3-state lifecycle:

```text
[TRIGGERED] ────────► [ACTIVE] ────────► [RESOLVED / EXPIRED]
 (advance epoch)   (blocks barrier)     (epoch advances, archived)
```

- **Trigger:** Calling `triggerRevocation()` increments `currentEpoch` and registers the record in `activeRevocations`.
- **Resolution:** When the underlying condition is remediated, `resolveRevocation(id, reason, slot)` moves the record to `resolvedRevocations` and advances `currentEpoch`.
- **Expiration:** Automated cleanup via `expireRevocations(currentSlot, maxAgeSlots)` expires stale time-limited circuit breakers safely.
