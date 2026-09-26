/**
 * Read-only, bounded System-1 shadow lane for JEV + Laya.
 *
 * This lane is deliberately not an agent gateway: it has no command,
 * execution, capital, provider, signer, or policy dependency.  Its sole job
 * is to turn a certified point-in-time feature context into replayable
 * advisory evidence that an operator may inspect.
 */
import { createHash } from 'node:crypto';
import { JevEngine, LayaEngine, assessDisagreement, certificateFor } from './jev-laya.js';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/**
 * A bounded hash-chained journal.  Capacity eviction never changes a retained
 * record's hash or sequence; it only limits in-memory operator projection.
 */
export class JevShadowLane {
    capacity;
    jev;
    laya;
    records = [];
    latest = new Map();
    chainHead = null;
    constructor(capacity = 500, jev = new JevEngine(), laya = new LayaEngine()) {
        this.capacity = capacity;
        this.jev = jev;
        this.laya = laya;
        if (!Number.isSafeInteger(capacity) || capacity < 1)
            throw new Error('Shadow lane capacity must be a positive safe integer');
    }
    evaluate(tokenId, context, now = Date.now()) {
        if (!tokenId || !Number.isSafeInteger(now) || now <= 0)
            throw new Error('Invalid shadow evaluation identity/time');
        const startedAt = now;
        const decision = this.jev.decide(tokenId, context, now);
        const assessment = this.laya.assess(tokenId, context, decision, now);
        const disagreement = assessDisagreement(decision, assessment);
        const certificates = Object.freeze([
            certificateFor('JEV', decision.decisionId, context, decision, startedAt, now),
            certificateFor('LAYA', assessment.assessmentId, context, assessment, startedAt, now),
        ]);
        const sequence = this.records.length === 0 ? 1 : this.records[this.records.length - 1].sequence + 1;
        const material = { sequence, tokenId, createdAt: now, previousHash: this.chainHead, authority: 'ADVISORY_ONLY', executionAuthorized: false,
            decision, assessment, disagreement, certificates };
        const record = Object.freeze({ ...material, recordHash: digest(material) });
        this.records.push(record);
        this.latest.set(tokenId, record);
        this.chainHead = record.recordHash;
        if (this.records.length > this.capacity) {
            const evicted = this.records.shift();
            if (this.latest.get(evicted.tokenId) === evicted)
                this.latest.delete(evicted.tokenId);
        }
        return record;
    }
    project() {
        return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, totalRecords: this.records.length,
            latestByToken: Object.freeze(Object.fromEntries(this.latest)), chainHead: this.chainHead });
    }
    exportRecords() { return Object.freeze([...this.records]); }
    verifyRetainedChain() {
        for (let index = 0; index < this.records.length; index += 1) {
            const record = this.records[index];
            const expectedPrevious = index === 0 ? record.previousHash : this.records[index - 1].recordHash;
            if (index > 0 && record.previousHash !== expectedPrevious)
                return false;
            const { recordHash: _, ...material } = record;
            if (digest(material) !== record.recordHash)
                return false;
        }
        return true;
    }
}
//# sourceMappingURL=jev-shadow-lane.js.map