/**
 * The only in-process boundary permitted to issue a protected token VETO.
 *
 * Implements:
 * - Direct re-export of all modern VETO subsystems from ./veto/
 * - Complete backward compatibility for existing TokenSafetyAuthority & HardRuleRegistry
 * - Protected semantic invariant: VETO MEANS PROVEN VETO.
 */
import { createHash, randomUUID } from 'node:crypto';
export * from './veto/index.js';
const stable = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');
const sameMint = (a, b) => a.clusterGenesisHash === b.clusterGenesisHash && a.mint === b.mint;
/**
 * TokenSafetyAuthority: Formal evaluation boundary.
 */
export class TokenSafetyAuthority {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    evaluate(subject, ruleId, evidence) {
        const rule = this.registry.active(ruleId);
        if (!rule)
            return { tokenSafety: 'UNKNOWN', reason: 'Hard rule is absent from the active registry' };
        if (rule.subjectKind !== subject.kind)
            return { tokenSafety: 'UNKNOWN', reason: 'Rule is not applicable to this subject kind' };
        const targetFact = rule.requiredFact ?? rule.evaluatorIr?.targetFact;
        const supporting = evidence.filter((root) => root.fact === targetFact);
        if (!supporting.length)
            return { tokenSafety: 'UNKNOWN', reason: 'Required root evidence is missing' };
        if (supporting.some((root) => !sameMint(root.subject, subject))) {
            return { tokenSafety: 'CONFLICTED', reason: 'Cross-mint evidence cannot support a token proof' };
        }
        if (supporting.some((root) => root.bank.clusterGenesisHash !== subject.clusterGenesisHash || root.bank.canonicality !== 'CANONICAL')) {
            return { tokenSafety: 'UNKNOWN', reason: 'Evidence is not bound to a canonical bank for this cluster' };
        }
        if (supporting.some((root) => !root.rawBytesHash || !root.decoderId || !root.decoderHash)) {
            return { tokenSafety: 'UNKNOWN', reason: 'Evidence lacks raw-byte decoder provenance' };
        }
        if (supporting.some((root) => root.state.kind === 'CONFLICTED')) {
            return { tokenSafety: 'CONFLICTED', reason: 'Authority decoders disagree' };
        }
        if (supporting.some((root) => root.state.kind === 'UNKNOWN' || root.state.kind === 'UNSUPPORTED')) {
            return { tokenSafety: 'UNKNOWN', reason: 'Authority state is incomplete or unsupported' };
        }
        const violating = supporting.filter((root) => root.state.kind === 'PRESENT');
        if (!violating.length) {
            return { tokenSafety: 'PASS', reason: 'Evaluated rule has no proven violation; complete-rule coverage is not asserted' };
        }
        const bank = violating[0].bank;
        const proofId = `hvp_${randomUUID()}`;
        const unsigned = {
            proofId,
            ruleId: rule.ruleId,
            subject,
            evidenceIds: violating.map((root) => root.evidenceId).sort(),
            bank,
            issuedAtSlot: bank.slot,
            status: 'ACTIVE',
        };
        const proof = Object.freeze({ ...unsigned, proofHash: digest(unsigned) });
        return { tokenSafety: 'FAIL', proof };
    }
}
//# sourceMappingURL=hard-veto-kernel.js.map