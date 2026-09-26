import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const CSV_HEADER = [
    'timestamp_utc',
    'id',
    'mint',
    'side',
    'reason',
    'stage',
    'requested_amount',
    'quoted_output',
    'token_delta',
    'net_lamports',
    'quote_age_ms',
    'slippage_bps',
    'tip_lamports',
    'priority_lamports',
    'rent_lamports',
].join(',') + '\n';
const csvEscape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};
import { sanitizeLogFields } from './core.js';
export class SessionLogger {
    dir;
    jsonlStream = null;
    csvStream = null;
    candidateStream = null;
    outcomeStream = null;
    ready = false;
    constructor(dir) {
        this.dir = dir;
    }
    async init() {
        if (!this.dir)
            return;
        await mkdir(this.dir, { recursive: true });
        this.jsonlStream = createWriteStream(join(this.dir, 'session.jsonl'), { flags: 'a', encoding: 'utf8' });
        const csvPath = join(this.dir, 'fills.csv');
        this.csvStream = createWriteStream(csvPath, { flags: 'a', encoding: 'utf8' });
        this.candidateStream = createWriteStream(join(this.dir, 'candidates.jsonl'), { flags: 'a', encoding: 'utf8' });
        this.outcomeStream = createWriteStream(join(this.dir, 'outcomes.jsonl'), { flags: 'a', encoding: 'utf8' });
        // Write CSV header if starting a new file
        await new Promise((resolve, reject) => {
            this.csvStream.write(CSV_HEADER, err => (err ? reject(err) : resolve()));
        });
        this.ready = true;
    }
    writeEvent(event, fields = {}) {
        if (!this.ready || !this.jsonlStream)
            return;
        const sanitized = sanitizeLogFields(fields);
        const payload = JSON.stringify({
            time: new Date().toISOString(),
            event,
            ...sanitized,
        }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n';
        this.jsonlStream.write(payload);
    }
    writeCandidateSnapshot(snapshot) {
        if (!this.ready)
            return;
        const payload = JSON.stringify(snapshot, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n';
        if (this.candidateStream) {
            this.candidateStream.write(payload);
        }
        this.writeEvent('candidate_snapshot_v1', {
            candidateId: snapshot.candidateId,
            mint: snapshot.mint,
            slot: snapshot.slot,
            evaluationDisposition: snapshot.evaluationDisposition,
            dispositionReason: snapshot.dispositionReason,
            featureSealHash: snapshot.featureSealHash,
        });
    }
    writeOutcomeLabel(outcome) {
        if (!this.ready)
            return;
        const payload = JSON.stringify(outcome, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n';
        if (this.outcomeStream) {
            this.outcomeStream.write(payload);
        }
        this.writeEvent('candidate_outcome_v1', {
            candidateId: outcome.candidateId,
            mint: outcome.mint,
            censored: outcome.censored,
            netReturnPct: outcome.financials.netReturnPct,
            netPnlLamports: outcome.financials.netPnlLamports,
        });
    }
    writeFill(fill) {
        if (!this.ready)
            return;
        const row = [
            fill.timestampUtc,
            fill.id,
            fill.mint,
            fill.side,
            fill.reason,
            fill.stage,
            fill.requestedAmount,
            fill.quotedOutput,
            fill.tokenDelta,
            fill.netLamports,
            fill.quoteAgeMs,
            fill.slippageBps,
            fill.tipLamports,
            fill.priorityLamports,
            fill.rentLamports,
        ].map(csvEscape).join(',') + '\n';
        if (this.csvStream) {
            this.csvStream.write(row);
        }
        this.writeEvent('fill_recorded', { ...fill });
    }
    async close() {
        const promises = [];
        if (this.jsonlStream) {
            promises.push(new Promise(resolve => this.jsonlStream.end(() => resolve())));
            this.jsonlStream = null;
        }
        if (this.csvStream) {
            promises.push(new Promise(resolve => this.csvStream.end(() => resolve())));
            this.csvStream = null;
        }
        if (this.candidateStream) {
            promises.push(new Promise(resolve => this.candidateStream.end(() => resolve())));
            this.candidateStream = null;
        }
        if (this.outcomeStream) {
            promises.push(new Promise(resolve => this.outcomeStream.end(() => resolve())));
            this.outcomeStream = null;
        }
        this.ready = false;
        await Promise.all(promises);
    }
}
//# sourceMappingURL=session-logger.js.map