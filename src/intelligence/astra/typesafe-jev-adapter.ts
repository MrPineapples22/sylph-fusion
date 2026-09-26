/**
 * Bounded TypeSafe hosted Jev adapter.
 *
 * The only permitted output is a typed, traceable advisory record.  This
 * adapter is intentionally not imported by command, execution, capital, or
 * signer code.  Missing configuration and every remote failure become an
 * explicit unavailable result; neither is treated as a safe score.
 */
import { createHash } from 'node:crypto';
import type { AstraFeatureContext } from './contracts.js';

export type HostedJevStatus = 'AVAILABLE' | 'DISABLED' | 'TIMEOUT' | 'REMOTE_ERROR' | 'INVALID_RESPONSE';
export interface HostedJevConfig {
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
  /** Pin a resolved vendor model; aliases such as jev-latest are prohibited. */
  readonly requestedModel?: 'jev-1.13.0';
}
export interface HostedJevAnswer {
  readonly type: 'choice' | 'score' | 'noul';
  readonly choice?: string;
  readonly score?: number;
  readonly noul?: number;
  readonly confidence?: number;
  readonly probabilities?: Readonly<Record<string, number>>;
}
export interface HostedJevAdvisory {
  readonly authority: 'ADVISORY_ONLY';
  readonly executionAuthorized: false;
  readonly status: HostedJevStatus;
  readonly tokenId: string;
  readonly featureSnapshotHash: string;
  readonly requestSchemaHash: string;
  readonly requestHash: string;
  readonly outputHash: string | null;
  readonly requestedModel: 'jev-1.13.0';
  readonly resolvedModel: string | null;
  readonly answers: Readonly<Record<string, HostedJevAnswer>> | null;
  readonly latencyMs: number;
  readonly errorCode?: string;
}

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const requestSchema = Object.freeze({
  organic_continuation: { type: 'noul', instructions: 'The observed state supports organic continuation. Return low when evidence is absent, stale, conflicting, or indicates concentration, bundling, wash flow, or liquidity risk.' },
  reflexive_chase: { type: 'noul', instructions: 'The observed state supports reflexive chasing rather than organic continuation. Return low when evidence is absent, stale, or conflicting.' },
  distribution: { type: 'noul', instructions: 'The observed state supports distribution risk. Return low when evidence is absent, stale, or conflicting.' },
  exhaustion: { type: 'noul', instructions: 'The observed state supports exhaustion risk. Return low when evidence is absent, stale, or conflicting.' },
  liquidity_failure: { type: 'noul', instructions: 'The observed state supports liquidity-failure risk. Return low when evidence is absent, stale, or conflicting.' },
  synthetic_flow: { type: 'noul', instructions: 'The observed state supports synthetic-flow risk. Return low when evidence is absent, stale, or conflicting.' },
  evidence_sufficiency: { type: 'noul', instructions: 'All supplied observations are sufficient, timely, internally consistent, and provenance-bound for a read-only advisory assessment.' },
});
const questionNames = Object.freeze(Object.keys(requestSchema).sort());
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validProbability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const validAnswer = (value: unknown): value is HostedJevAnswer => {
  if (!value || typeof value !== 'object' || !['choice', 'score', 'noul'].includes((value as { type?: string }).type ?? '')) return false;
  const answer = value as HostedJevAnswer;
  return (answer.confidence === undefined || validProbability(answer.confidence)) &&
    (answer.probabilities === undefined || Object.values(answer.probabilities).every(validProbability)) &&
    (answer.score === undefined || Number.isFinite(answer.score)) && (answer.noul === undefined || validProbability(answer.noul));
};
const allowlistedState = (context: AstraFeatureContext) => Object.freeze({
  tokenId: context.snapshot.mint, snapshotHash: context.snapshot.snapshotHash, featureSchemaVersion: context.snapshot.featureSchemaVersion,
  capturedAtMs: context.snapshot.timestampMs,
  values: Object.fromEntries(Object.entries(context.observations).map(([name, observation]) => [name, typeof observation?.value === 'number' ? observation.value : null])),
  missingOrRejected: Object.freeze([...context.rejected, ...Object.entries(context.observations).filter(([, observation]) => typeof observation?.value !== 'number').map(([name]) => `${name}:MISSING`)].sort()),
});
const unavailable = (context: AstraFeatureContext, requestHash: string, status: Exclude<HostedJevStatus, 'AVAILABLE'>, latencyMs: number, errorCode?: string): HostedJevAdvisory =>
  Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status, tokenId: context.snapshot.mint,
    featureSnapshotHash: context.snapshot.snapshotHash, requestSchemaHash: digest(requestSchema), requestHash, outputHash: null, requestedModel: 'jev-1.13.0', resolvedModel: null, answers: null, latencyMs, ...(errorCode ? { errorCode } : {}) });

export class TypeSafeHostedJevAdapter {
  constructor(private readonly config: HostedJevConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async assess(context: AstraFeatureContext): Promise<HostedJevAdvisory> {
    const started = Date.now();
    const state = allowlistedState(context);
    const requestedModel = this.config.requestedModel ?? 'jev-1.13.0';
    const request = Object.freeze({ state: JSON.stringify(state), model: requestedModel, questions: requestSchema });
    const requestHash = digest(request);
    if (!this.config.apiKey?.trim()) return unavailable(context, requestHash, 'DISABLED', 0, 'TYPESAFE_API_KEY_UNCONFIGURED');
    const timeoutMs = this.config.timeoutMs ?? 1500;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) return unavailable(context, requestHash, 'DISABLED', 0, 'TYPESAFE_TIMEOUT_INVALID');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, { method: 'POST', signal: controller.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request) });
      const latencyMs = Date.now() - started;
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (!response.ok) return unavailable(context, requestHash, 'REMOTE_ERROR', latencyMs, `TYPESAFE_HTTP_${response.status}`);
      if (!Number.isFinite(contentLength) || contentLength > 262_144) return unavailable(context, requestHash, 'INVALID_RESPONSE', latencyMs, 'TYPESAFE_RESPONSE_TOO_LARGE');
      const body: unknown = await response.json();
      const model = body && typeof body === 'object' ? (body as { model?: unknown }).model : undefined;
      const answers = body && typeof body === 'object' ? (body as { answers?: unknown }).answers : undefined;
      const answerMap = answers as Record<string, unknown>;
      if (model !== requestedModel || !answers || typeof answers !== 'object' ||
          JSON.stringify(Object.keys(answerMap).sort()) !== JSON.stringify(questionNames) ||
          !Object.values(answerMap).every(value => validAnswer(value) && value.type === 'noul' && validProbability(value.noul))) return unavailable(context, requestHash, 'INVALID_RESPONSE', latencyMs, 'TYPESAFE_RESPONSE_SCHEMA_INVALID');
      return Object.freeze({ authority: 'ADVISORY_ONLY', executionAuthorized: false, status: 'AVAILABLE', tokenId: context.snapshot.mint,
        featureSnapshotHash: context.snapshot.snapshotHash, requestSchemaHash: digest(requestSchema), requestHash, outputHash: digest(answers), requestedModel, resolvedModel: model,
        answers: Object.freeze({ ...(answers as Record<string, HostedJevAnswer>) }), latencyMs });
    } catch (error) {
      const latencyMs = Date.now() - started;
      return unavailable(context, requestHash, error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'REMOTE_ERROR', latencyMs,
        error instanceof Error && error.name === 'AbortError' ? 'TYPESAFE_TIMEOUT' : 'TYPESAFE_NETWORK_FAILURE');
    } finally { clearTimeout(timer); }
  }
}

/** Secret-free construction seam: unset credentials leave the lane disabled. */
export function hostedJevFromEnvironment(env: NodeJS.ProcessEnv = process.env): TypeSafeHostedJevAdapter {
  const rawTimeout = env.TYPESAFE_JEV_TIMEOUT_MS?.trim();
  return new TypeSafeHostedJevAdapter({ apiKey: env.TYPESAFE_API_KEY?.trim() || null,
    ...(rawTimeout ? { timeoutMs: Number(rawTimeout) } : {}) });
}
