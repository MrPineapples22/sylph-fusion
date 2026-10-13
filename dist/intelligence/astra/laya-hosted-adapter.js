/**
 * Bounded hosted Laya adapter using the same question schema and feature state
 * as the TypeSafe Jev adapter. Results are comparisons only and never authority.
 */
import { createHash } from 'node:crypto';
import { JevEngine } from './jev-laya.js';
import { HOSTED_JEV_QUESTION_NAMES, HOSTED_JEV_QUESTION_SCHEMA, hostedContextIssue, hostedJevState, hostedJevFromEnvironment, } from './typesafe-jev-adapter.js';
const LAYA_ENDPOINT = 'https://api.laya-ai.com/v1/systemone';
const RESPONSE_LIMIT = 262_144;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const probability = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const unavailable = (context, requestHash, status, requestedModel, latencyMs, errorCode, inputTokens = null) => Object.freeze({
    authority: 'ADVISORY_ONLY', executionAuthorized: false, status, tokenId: context.snapshot.mint,
    featureSnapshotHash: context.snapshot.snapshotHash, requestSchemaHash: digest(HOSTED_JEV_QUESTION_SCHEMA), requestHash,
    outputHash: null, requestedModel, resolvedModel: null, answers: null, latencyMs, inputTokens, errorCode,
});
export class HostedLayaAdapter {
    config;
    fetchImpl;
    constructor(config, fetchImpl = fetch) {
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    insufficientEvidence(context) {
        const request = Object.freeze({ state: JSON.stringify(hostedJevState(context)), model: this.config.requestedModel ?? 'clef-flash', questions: HOSTED_JEV_QUESTION_SCHEMA });
        return unavailable(context, digest(request), 'INSUFFICIENT_EVIDENCE', this.config.requestedModel ?? 'clef-flash', 0, 'CERTIFIED_FEATURE_EVIDENCE_INSUFFICIENT');
    }
    async assess(context) {
        const started = Date.now();
        const requestedModel = this.config.requestedModel ?? 'clef-flash';
        const request = Object.freeze({ state: JSON.stringify(hostedJevState(context)), model: requestedModel, questions: HOSTED_JEV_QUESTION_SCHEMA });
        const requestHash = digest(request);
        const contextIssue = hostedContextIssue(context);
        if (contextIssue)
            return unavailable(context, requestHash, 'UNVERIFIED_CONTEXT', requestedModel, 0, contextIssue);
        if (!this.config.apiKey?.trim())
            return unavailable(context, requestHash, 'DISABLED', requestedModel, 0, 'LAYA_API_KEY_UNCONFIGURED');
        const timeoutMs = this.config.timeoutMs ?? 2500;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
            return unavailable(context, requestHash, 'DISABLED', requestedModel, 0, 'LAYA_TIMEOUT_INVALID');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await this.fetchImpl(LAYA_ENDPOINT, { method: 'POST', signal: controller.signal, redirect: 'error',
                headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
            const latencyMs = Date.now() - started;
            const contentLength = Number(response.headers.get('content-length') ?? '0');
            if (!response.ok)
                return unavailable(context, requestHash, 'REMOTE_ERROR', requestedModel, latencyMs, `LAYA_HTTP_${response.status}`);
            if (!Number.isFinite(contentLength) || contentLength > RESPONSE_LIMIT)
                return unavailable(context, requestHash, 'INVALID_RESPONSE', requestedModel, latencyMs, 'LAYA_RESPONSE_TOO_LARGE');
            const raw = await response.text();
            if (raw.length > RESPONSE_LIMIT)
                return unavailable(context, requestHash, 'INVALID_RESPONSE', requestedModel, latencyMs, 'LAYA_RESPONSE_TOO_LARGE');
            let body;
            try {
                body = JSON.parse(raw);
            }
            catch {
                return unavailable(context, requestHash, 'INVALID_RESPONSE', requestedModel, latencyMs, 'LAYA_RESPONSE_JSON_INVALID');
            }
            const record = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
            const model = record?.model;
            const routing = record?.routing && typeof record.routing === 'object' ? record.routing : null;
            const resolvedModel = typeof routing?.model === 'string' ? routing.model : model;
            const answers = record?.answers;
            const answerMap = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : null;
            const usage = record?.usage && typeof record.usage === 'object' ? record.usage.input_tokens : undefined;
            const inputTokens = usage === undefined ? null : Number.isSafeInteger(usage) && usage >= 0 ? usage : -1;
            if (!answerMap || typeof resolvedModel !== 'string' || resolvedModel.length === 0 || resolvedModel.length > 128
                || model !== requestedModel && routing?.model !== requestedModel || inputTokens === -1 ||
                JSON.stringify(Object.keys(answerMap).sort()) !== JSON.stringify(HOSTED_JEV_QUESTION_NAMES) ||
                !HOSTED_JEV_QUESTION_NAMES.every(name => {
                    const answer = answerMap[name];
                    return !!answer && typeof answer === 'object' && !Array.isArray(answer) &&
                        answer.type === 'noul' && probability(answer.noul);
                }))
                return unavailable(context, requestHash, 'INVALID_RESPONSE', requestedModel, latencyMs, 'LAYA_RESPONSE_SCHEMA_INVALID', inputTokens === -1 ? null : inputTokens);
            const cleanAnswers = Object.freeze(Object.fromEntries(HOSTED_JEV_QUESTION_NAMES.map(name => [name, Object.freeze({ ...answerMap[name] })])));
            return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status: 'AVAILABLE', tokenId: context.snapshot.mint,
                featureSnapshotHash: context.snapshot.snapshotHash, requestSchemaHash: digest(HOSTED_JEV_QUESTION_SCHEMA), requestHash,
                outputHash: digest(cleanAnswers), requestedModel, resolvedModel, answers: cleanAnswers, latencyMs, inputTokens });
        }
        catch (error) {
            const latencyMs = Date.now() - started;
            const timeout = error instanceof Error && error.name === 'AbortError';
            return unavailable(context, requestHash, timeout ? 'TIMEOUT' : 'REMOTE_ERROR', requestedModel, latencyMs, timeout ? 'LAYA_TIMEOUT' : 'LAYA_NETWORK_FAILURE');
        }
        finally {
            clearTimeout(timer);
        }
    }
}
export function hostedLayaFromEnvironment(env = process.env) {
    const rawTimeout = env.LAYA_TIMEOUT_MS?.trim();
    return new HostedLayaAdapter({ apiKey: env.LAYA_API_KEY?.trim() || null,
        ...(rawTimeout ? { timeoutMs: Number(rawTimeout) } : {}), requestedModel: 'clef-flash' });
}
/** Runs local JEV plus both hosted decision models against the exact same frozen feature snapshot. */
export class HostedJevLayaComparison {
    typesafe;
    laya;
    jev;
    constructor(typesafe = hostedJevFromEnvironment(), laya = hostedLayaFromEnvironment(), jev = new JevEngine()) {
        this.typesafe = typesafe;
        this.laya = laya;
        this.jev = jev;
    }
    async assess(tokenId, context, now = Date.now()) {
        const localJev = this.jev.decide(tokenId, context, now);
        const contextIssue = hostedContextIssue(context);
        if (contextIssue) {
            const typesafeJev = Object.freeze({ ...this.typesafe.insufficientEvidence(context), status: 'UNVERIFIED_CONTEXT', errorCode: contextIssue });
            const layaResult = Object.freeze({ ...this.laya.insufficientEvidence(context), status: 'UNVERIFIED_CONTEXT', errorCode: contextIssue });
            return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status: 'UNVERIFIED_CONTEXT', tokenId,
                featureSnapshotHash: context.snapshot.snapshotHash, localJev, typesafeJev, laya: layaResult,
                hostedProbabilityDeltas: null, maximumHostedProbabilityDelta: null, calibrationState: 'NOT_ESTABLISHED' });
        }
        if (localJev.classification === 'NEED_MORE_EVIDENCE') {
            const typesafeJev = this.typesafe.insufficientEvidence(context);
            const layaResult = this.laya.insufficientEvidence(context);
            return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status: 'INSUFFICIENT_EVIDENCE', tokenId,
                featureSnapshotHash: context.snapshot.snapshotHash, localJev, typesafeJev, laya: layaResult,
                hostedProbabilityDeltas: null, maximumHostedProbabilityDelta: null, calibrationState: 'NOT_ESTABLISHED' });
        }
        const [typesafeJev, layaResult] = await Promise.all([this.typesafe.assess(context), this.laya.assess(context)]);
        const available = typesafeJev.status === 'AVAILABLE' && layaResult.status === 'AVAILABLE';
        const hostedProbabilityDeltas = available ? Object.freeze(Object.fromEntries(HOSTED_JEV_QUESTION_NAMES.map(name => [name,
            Math.abs(typesafeJev.answers[name].noul - layaResult.answers[name].noul)]))) : null;
        return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false,
            status: available ? 'AVAILABLE' : typesafeJev.status === 'AVAILABLE' || layaResult.status === 'AVAILABLE' ? 'PARTIAL' : 'UNAVAILABLE',
            tokenId, featureSnapshotHash: context.snapshot.snapshotHash, localJev, typesafeJev, laya: layaResult,
            hostedProbabilityDeltas, maximumHostedProbabilityDelta: hostedProbabilityDeltas ? Math.max(...Object.values(hostedProbabilityDeltas)) : null,
            calibrationState: 'NOT_ESTABLISHED' });
    }
}
//# sourceMappingURL=laya-hosted-adapter.js.map