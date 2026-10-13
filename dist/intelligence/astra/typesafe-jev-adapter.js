/**
 * Bounded TypeSafe hosted Jev adapter.
 *
 * The only permitted output is a typed, traceable advisory record.  This
 * adapter is intentionally not imported by command, execution, capital, or
 * signer code.  Missing configuration and every remote failure become an
 * explicit unavailable result; neither is treated as a safe score.
 */
import { createHash } from 'node:crypto';
export const HOSTED_JEV_QUESTION_SCHEMA = Object.freeze({
    organic_continuation: { type: 'noul', instructions: 'The observed state supports organic continuation. Return low when evidence is absent, stale, conflicting, or indicates concentration, bundling, wash flow, or liquidity risk.' },
    reflexive_chase: { type: 'noul', instructions: 'The observed state supports reflexive chasing rather than organic continuation. Return low when evidence is absent, stale, or conflicting.' },
    distribution: { type: 'noul', instructions: 'The observed state supports distribution risk. Return low when evidence is absent, stale, or conflicting.' },
    exhaustion: { type: 'noul', instructions: 'The observed state supports exhaustion risk. Return low when evidence is absent, stale, or conflicting.' },
    liquidity_failure: { type: 'noul', instructions: 'The observed state supports liquidity-failure risk. Return low when evidence is absent, stale, or conflicting.' },
    synthetic_flow: { type: 'noul', instructions: 'The observed state supports synthetic-flow risk. Return low when evidence is absent, stale, or conflicting.' },
    evidence_sufficiency: { type: 'noul', instructions: 'All supplied observations are sufficient, timely, internally consistent, and provenance-bound for a read-only advisory assessment.' },
});
export const HOSTED_JEV_QUESTION_NAMES = Object.freeze(Object.keys(HOSTED_JEV_QUESTION_SCHEMA).sort());
export const TYPESAFE_SYSTEMONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_HOSTED_JEV_MODEL = 'typesafe/jev-1.13';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validProbability = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const validAnswer = (value) => {
    if (!value || typeof value !== 'object' || !['choice', 'score', 'noul'].includes(value.type ?? ''))
        return false;
    const answer = value;
    return (answer.confidence === undefined || validProbability(answer.confidence)) &&
        (answer.probabilities === undefined || Object.values(answer.probabilities).every(validProbability)) &&
        (answer.score === undefined || Number.isFinite(answer.score)) && (answer.noul === undefined || validProbability(answer.noul));
};
export const hostedJevState = (context) => Object.freeze({
    tokenId: context.snapshot.mint, snapshotHash: context.snapshot.snapshotHash, featureSchemaVersion: context.snapshot.featureSchemaVersion,
    capturedAtMs: context.snapshot.timestampMs,
    values: Object.fromEntries(Object.entries(context.observations).map(([name, observation]) => [name, typeof observation?.value === 'number' ? observation.value : null])),
    missingOrRejected: Object.freeze([...context.rejected, ...Object.entries(context.observations).filter(([, observation]) => typeof observation?.value !== 'number').map(([name]) => `${name}:MISSING`)].sort()),
});
export const hostedContextIssue = (context) => Object.values(context.observations).some(observation => observation?.source === 'master-orchestrator-pit' || observation?.correlationGroup === 'master-truth-adapter')
    ? 'SYNTHETIC_MASTER_FEATURE_FALLBACK' : null;
const unavailable = (context, requestHash, status, latencyMs, errorCode, requestedModel = DEFAULT_HOSTED_JEV_MODEL) => Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status, tokenId: context.snapshot.mint,
    featureSnapshotHash: context.snapshot.snapshotHash, requestSchemaHash: digest(HOSTED_JEV_QUESTION_SCHEMA), requestHash, outputHash: null, requestedModel, resolvedModel: null, answers: null, latencyMs, ...(errorCode ? { errorCode } : {}) });
export class TypeSafeHostedJevAdapter {
    config;
    fetchImpl;
    constructor(config, fetchImpl = fetch) {
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    insufficientEvidence(context) {
        const request = Object.freeze({ state: JSON.stringify(hostedJevState(context)), model: this.config.requestedModel ?? DEFAULT_HOSTED_JEV_MODEL, questions: HOSTED_JEV_QUESTION_SCHEMA });
        return unavailable(context, digest(request), 'INSUFFICIENT_EVIDENCE', 0, 'CERTIFIED_FEATURE_EVIDENCE_INSUFFICIENT', this.config.requestedModel ?? DEFAULT_HOSTED_JEV_MODEL);
    }
    async assess(context) {
        const started = Date.now();
        const state = hostedJevState(context);
        const requestedModel = this.config.requestedModel ?? DEFAULT_HOSTED_JEV_MODEL;
        const request = Object.freeze({ state: JSON.stringify(state), model: requestedModel, questions: HOSTED_JEV_QUESTION_SCHEMA });
        const requestHash = digest(request);
        const contextIssue = hostedContextIssue(context);
        if (contextIssue)
            return unavailable(context, requestHash, 'UNVERIFIED_CONTEXT', 0, contextIssue, requestedModel);
        if (!this.config.apiKey?.trim())
            return unavailable(context, requestHash, 'DISABLED', 0, 'TYPESAFE_API_KEY_UNCONFIGURED', requestedModel);
        const endpoint = this.config.apiUrl?.trim() || TYPESAFE_SYSTEMONE_ENDPOINT;
        let parsedEndpoint;
        try {
            parsedEndpoint = new URL(endpoint);
        }
        catch {
            return unavailable(context, requestHash, 'DISABLED', 0, 'TYPESAFE_ENDPOINT_INVALID', requestedModel);
        }
        if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash || !parsedEndpoint.pathname.endsWith('/v1/systemone')) {
            return unavailable(context, requestHash, 'DISABLED', 0, 'TYPESAFE_ENDPOINT_INVALID', requestedModel);
        }
        const timeoutMs = this.config.timeoutMs ?? 1500;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
            return unavailable(context, requestHash, 'DISABLED', 0, 'TYPESAFE_TIMEOUT_INVALID', requestedModel);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await this.fetchImpl(endpoint, { method: 'POST', signal: controller.signal, redirect: 'error',
                headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(request) });
            const latencyMs = Date.now() - started;
            if (!response.ok)
                return unavailable(context, requestHash, 'REMOTE_ERROR', latencyMs, `TYPESAFE_HTTP_${response.status}`, requestedModel);
            const contentLength = response.headers.get('content-length');
            if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > 262_144)) {
                return unavailable(context, requestHash, 'INVALID_RESPONSE', latencyMs, 'TYPESAFE_RESPONSE_TOO_LARGE', requestedModel);
            }
            const raw = await response.text();
            if (raw.length > 262_144)
                return unavailable(context, requestHash, 'INVALID_RESPONSE', Date.now() - started, 'TYPESAFE_RESPONSE_TOO_LARGE', requestedModel);
            let body;
            try {
                body = JSON.parse(raw);
            }
            catch {
                return unavailable(context, requestHash, 'INVALID_RESPONSE', Date.now() - started, 'TYPESAFE_RESPONSE_JSON_INVALID', requestedModel);
            }
            const record = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
            const model = record?.model;
            const answers = record?.answers;
            const answerMap = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : null;
            const resolvedModelMatches = model === requestedModel ||
                (requestedModel === 'typesafe/jev-1.13' && model === 'jev-1.13.0');
            if (!resolvedModelMatches || !answerMap ||
                JSON.stringify(Object.keys(answerMap).sort()) !== JSON.stringify(HOSTED_JEV_QUESTION_NAMES) ||
                !Object.values(answerMap).every(value => validAnswer(value) && value.type === 'noul' && validProbability(value.noul)))
                return unavailable(context, requestHash, 'INVALID_RESPONSE', latencyMs, 'TYPESAFE_RESPONSE_SCHEMA_INVALID', requestedModel);
            return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status: 'AVAILABLE', tokenId: context.snapshot.mint,
                featureSnapshotHash: context.snapshot.snapshotHash, requestSchemaHash: digest(HOSTED_JEV_QUESTION_SCHEMA), requestHash, outputHash: digest(answers), requestedModel, resolvedModel: model,
                answers: Object.freeze({ ...answers }), latencyMs });
        }
        catch (error) {
            const latencyMs = Date.now() - started;
            return unavailable(context, requestHash, error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'REMOTE_ERROR', latencyMs, error instanceof Error && error.name === 'AbortError' ? 'TYPESAFE_TIMEOUT' : 'TYPESAFE_NETWORK_FAILURE', requestedModel);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
/** Secret-free construction seam: unset credentials leave the lane disabled. */
export function hostedJevFromEnvironment(env = process.env, fetchImpl = fetch) {
    const rawTimeout = env.TYPESAFE_JEV_TIMEOUT_MS?.trim();
    const rawModel = env.TYPESAFE_JEV_MODEL?.trim();
    const requestedModel = rawModel === 'jev-1.13.0' ? rawModel : DEFAULT_HOSTED_JEV_MODEL;
    return new TypeSafeHostedJevAdapter({ apiKey: env.TYPESAFE_API_KEY?.trim() || null,
        apiUrl: env.TYPESAFE_API_URL?.trim() || TYPESAFE_SYSTEMONE_ENDPOINT,
        requestedModel,
        ...(rawTimeout ? { timeoutMs: Number(rawTimeout) } : {}) }, fetchImpl);
}
//# sourceMappingURL=typesafe-jev-adapter.js.map