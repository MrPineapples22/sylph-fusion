/**
 * Research-only alpha threshold checks and release-gate assertion summaries.
 * Caller metrics and booleans are not independently verified evidence. Nothing
 * here certifies production readiness, promotes a model, or authorizes capital.
 * Historical authority-shaped class names remain for compatibility.
 */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
function requireValue(condition, reason) { if (!condition)
    throw new Error(reason); }
/** Accept primitive own data properties only, without running caller code. */
function snapshotFields(value, keys) {
    requireValue(value !== null && typeof value === 'object' && !types.isProxy(value), 'INVALID_RESEARCH_INPUT');
    const prototype = Object.getPrototypeOf(value);
    requireValue(prototype === Object.prototype || prototype === null, 'INVALID_RESEARCH_PROTOTYPE');
    requireValue(Object.getOwnPropertySymbols(value).length === 0, 'UNEXPECTED_RESEARCH_FIELDS');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    requireValue(Object.keys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key)), 'MISSING_OR_UNEXPECTED_RESEARCH_FIELDS');
    const snapshot = Object.create(null);
    for (const key of keys) {
        const descriptor = descriptors[key];
        requireValue(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'RESEARCH_ACCESSORS_UNSUPPORTED');
        requireValue(['string', 'number', 'boolean'].includes(typeof descriptor.value), 'INVALID_RESEARCH_VALUE');
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}
function textValue(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function inRange(value, low, high) { return finite(value) && value >= low && value <= high; }
const trialKeys = Object.freeze(['trialId', 'hypothesis', 'featureName', 'targetBarrier', 'targetHorizon']);
const evaluationKeys = Object.freeze(['trialId', 'walkForwardIc', 'entityHoldoutIc', 'regimeRobustnessScore', 'netExecutableEvSol', 'latencySurvivalRatio', 'ablationDeltaBrierScore']);
export class AlphaCourtEngine {
    #ledger = new Map();
    /** Records a local research declaration; does not prove dataset pre-registration. */
    preRegisterHypothesis(input) {
        const values = snapshotFields(input, trialKeys);
        requireValue(trialKeys.every(key => textValue(values[key])), 'INVALID_TRIAL_REGISTRATION');
        const registration = values;
        requireValue(!this.#ledger.has(registration.trialId), 'TRIAL_ALREADY_REGISTERED');
        const trial = Object.freeze({ ...registration, registeredAtMs: Date.now(), isRegistered: true });
        this.#ledger.set(trial.trialId, trial);
        return trial;
    }
    adjudicateFeature(input) {
        const values = snapshotFields(input, evaluationKeys);
        requireValue(textValue(values.trialId) && inRange(values.walkForwardIc, -1, 1) && inRange(values.entityHoldoutIc, -1, 1)
            && inRange(values.regimeRobustnessScore, 0, 1) && finite(values.netExecutableEvSol)
            && inRange(values.latencySurvivalRatio, 0, 1) && inRange(values.ablationDeltaBrierScore, -1, 1), 'INVALID_COURT_METRICS');
        const metrics = values;
        requireValue(this.#ledger.has(metrics.trialId), 'ALPHA_COURT_UNREGISTERED');
        const temporalCourt = metrics.walkForwardIc >= 0.03 ? 'PASS' : 'FAIL';
        const entityCourt = metrics.entityHoldoutIc >= 0.02 ? 'PASS' : 'FAIL';
        const regimeCourt = metrics.regimeRobustnessScore >= 0.70 ? 'PASS' : 'FAIL';
        const economicCourt = metrics.netExecutableEvSol > 0 ? 'PASS' : 'FAIL';
        const executionCourt = metrics.latencySurvivalRatio >= 0.60 ? 'PASS' : 'FAIL';
        const ablationCourt = metrics.ablationDeltaBrierScore >= 0.005 ? 'PASS' : 'FAIL';
        const allPassed = [temporalCourt, entityCourt, regimeCourt, economicCourt, executionCourt, ablationCourt].every(verdict => verdict === 'PASS');
        return Object.freeze({
            trialId: metrics.trialId, temporalCourt, entityCourt, regimeCourt, economicCourt, executionCourt, ablationCourt,
            allCourtsPassed: allPassed, promotionVerdict: allPassed ? 'SURVIVED_RESEARCH_COURTS' : 'REJECTED_RESEARCH_COURTS',
            authority: 'RESEARCH_ONLY', evidenceStatus: 'CALLER_METRICS_ONLY', isProductionApproved: false,
            reason: allPassed ? 'Supplied metrics meet research thresholds; datasets and methodology have not been independently verified.'
                : 'Supplied metrics fail one or more research thresholds.',
        });
    }
}
const gateDefinitions = Object.freeze([
    ['transactionCompletenessPassed', 'TRANSACTION_COMPLETENESS'], ['versionCompatibilityPassed', 'VERSION_COMPATIBILITY'],
    ['parserAgreementPassed', 'PARSER_AGREEMENT'], ['providerQuorumPassed', 'PROVIDER_QUORUM'],
    ['pointInTimeCorrectnessPassed', 'POINT_IN_TIME_CORRECTNESS'], ['calibrationSharpnessPassed', 'CALIBRATION_SHARPNESS'],
    ['deterministicIntentsPassed', 'DETERMINISTIC_INTENTS'], ['retrySafetyPassed', 'RETRY_SAFETY'],
    ['isolatedSigningPassed', 'ISOLATED_SIGNING'], ['reservationCorrectnessPassed', 'RESERVATION_CORRECTNESS'],
    ['restartSafetyPassed', 'RESTART_SAFETY'], ['realizedNetPnlProofPassed', 'REALIZED_NET_PNL_PROOF'],
].map(pair => Object.freeze(pair)));
/** Legacy name; this class has no production certification authority. */
export class ProductionCertificationAuthority {
    static evaluateAllGates(evidence) {
        let assertions;
        let validationError;
        try {
            assertions = snapshotFields(evidence, gateDefinitions.map(([key]) => key));
            requireValue(Object.values(assertions).every(value => typeof value === 'boolean'), 'INVALID_GATE_ASSERTION');
        }
        catch (error) {
            assertions = undefined;
            validationError = error instanceof Error ? error.message : 'INVALID_GATE_ASSERTION';
        }
        const gates = Object.freeze(gateDefinitions.map(([key, gateName], index) => Object.freeze({
            gateIndex: index + 1, gateName, isPassed: assertions?.[key] === true,
            evidenceSummary: validationError ? 'Invalid caller assertions; no evidence verified.'
                : 'Caller assertion only; independent release evidence has not been verified.',
        })));
        const payload = {
            evaluatedAtMs: Date.now(), gates, allGatesPassed: gates.every(gate => gate.isPassed),
            authority: 'RESEARCH_ONLY', evidenceStatus: 'CALLER_ASSERTIONS_ONLY',
            isProductionCertified: false, liveCapitalAuthorization: 'BLOCKED_FAIL_CLOSED',
            ...(validationError ? { validationError } : {}),
        };
        const hash = createHash('sha256').update('sylph/research-gate-report/v1\n').update(JSON.stringify(payload)).digest('hex');
        return Object.freeze({ certificationId: `research_gate_${hash}`, ...payload, hash });
    }
}
//# sourceMappingURL=alpha-court-x.js.map