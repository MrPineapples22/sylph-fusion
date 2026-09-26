/**
 * SYLPH TOKEN VETO SYSTEM — CORE TYPE DEFINITIONS
 *
 * Implements:
 * - Domain-isolated SubjectIdentity (MINTCELL)
 * - BankIdentity (BANKLOCK)
 * - AuthorityState (ONEFACT)
 * - Exact branded arithmetic units (UNITLOCK)
 * - CertifiedHardRule & Coverage types (VETO-KERNEL & VETO-TOTALITY)
 * - Proof, Notary, Defeater & Death contracts (DEFEATER-ZERO & PROOFVAULT)
 * - Target Multidomain Decision Outcome (DecisionOutcomeVNext)
 */
import { createHash } from 'node:crypto';
export const lamports = (n) => BigInt(n);
export const rawTokens = (n) => BigInt(n);
export const basisPoints = (n) => BigInt(n);
export const slotUnit = (n) => BigInt(n);
export const unixMillis = (n) => BigInt(n);
// Helper functions
export const stableJson = (val) => JSON.stringify(val, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
export const sha256Hex = (val) => createHash('sha256').update(stableJson(val)).digest('hex');
//# sourceMappingURL=types.js.map