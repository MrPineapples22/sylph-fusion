const required = ['EXECUTION_REVIEW', 'LIVE_RECONCILIATION', 'SIGNER', 'FIREWALL', 'JOURNAL', 'PROVIDERS', 'SIMULATION'];
export function executionCapabilityMatrix(attestations, now = Date.now()) {
    const bad = [];
    if (!Number.isSafeInteger(now) || now < 0) {
        bad.push('CLOCK_INVALID');
        return matrix(bad);
    }
    if (!Array.isArray(attestations)) {
        bad.push('ATTESTATIONS_INVALID');
        return matrix(bad);
    }
    const records = new Map();
    for (const capability of required)
        records.set(capability, []);
    let malformed = false;
    for (const value of attestations) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            malformed = true;
            continue;
        }
        const capability = value.capability;
        if (typeof capability !== 'string' || !records.has(capability)) {
            malformed = true;
            continue;
        }
        records.get(capability).push(value);
    }
    if (malformed)
        bad.push('ATTESTATIONS_INVALID');
    for (const capability of required) {
        const values = records.get(capability);
        if (values.length === 0) {
            bad.push(`${capability}_UNAVAILABLE`);
            continue;
        }
        if (values.length !== 1) {
            bad.push(`${capability}_AMBIGUOUS`);
            continue;
        }
        const a = values[0];
        const validIdentity = ['adapterId', 'implementationVersion', 'configHash'].every(key => typeof a[key] === 'string' && a[key].trim().length > 0);
        const validTests = a.selfTestPassed === true && a.fixtureTestPassed === true && a.liveProbePassed === true;
        const validTimes = Number.isSafeInteger(a.verifiedAt) && Number(a.verifiedAt) >= 0 && Number.isSafeInteger(a.expiresAt) && Number(a.expiresAt) >= 0;
        if (!validIdentity || !validTests || !validTimes) {
            bad.push(`${capability}_INVALID`);
            continue;
        }
        if (Number(a.expiresAt) <= now) {
            bad.push(`${capability}_EXPIRED`);
            continue;
        }
        if (Number(a.verifiedAt) > now || Number(a.expiresAt) <= Number(a.verifiedAt)) {
            bad.push(`${capability}_INVALID`);
            continue;
        }
        if (a.state !== 'HEALTHY')
            bad.push(`${capability}_${typeof a.state === 'string' ? a.state : 'INVALID'}`);
    }
    return matrix(bad);
}
function matrix(bad) {
    const ready = bad.length === 0;
    return Object.freeze({ open: ready ? 'AVAILABLE' : 'BLOCKED', increase: ready ? 'AVAILABLE' : 'BLOCKED', reduce: ready ? 'AVAILABLE' : 'BLOCKED', close: ready ? 'AVAILABLE' : 'BLOCKED', reconcile: ready ? 'AVAILABLE' : 'BLOCKED', blockers: Object.freeze(bad) });
}
//# sourceMappingURL=execution-authority-readiness.js.map