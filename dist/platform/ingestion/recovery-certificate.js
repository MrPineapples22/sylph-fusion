import { createHash } from 'node:crypto';
const certificateFields = [
    'certificateId', 'gapId', 'startSlot', 'endSlot', 'providerId', 'classification', 'lane',
    'recoveredEventIds', 'perSlotStatus', 'stateRoot', 'coverageRoot', 'isVerified', 'certifiedAtMs',
];
const certificateFieldSet = new Set(certificateFields);
const acceptedSlotStatuses = new Set(['RECOVERED', 'SKIPPED', 'DEAD_FORK', 'EMPTY', 'UNAVAILABLE']);
const acceptedClassifications = new Set([
    'SKIPPED_SLOT', 'DEAD_FORK', 'MISSING_OBSERVATION', 'PROVIDER_LOSS',
    'UNAVAILABLE_HISTORY', 'PARTIAL_RECOVERY', 'PROVIDER_DISAGREEMENT', 'UNKNOWN',
]);
const acceptedLanes = new Set(['CHAIN_BLOCK', 'PUMP_TRANSACTION', 'ACCOUNT_WRITE', 'ENTRY', 'FORK_LINEAGE', 'BLOCK_FOOTER']);
/** Copy caller data using data descriptors only; accessors and unknown fields are rejected. */
export function snapshotRecoveryCertificate(input, maxSlots) {
    try {
        if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || !input || typeof input !== 'object' || Array.isArray(input) ||
            (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null))
            return null;
        const descriptors = Object.getOwnPropertyDescriptors(input);
        const keys = Reflect.ownKeys(descriptors);
        if (keys.some(key => typeof key !== 'string' || !certificateFieldSet.has(key)))
            return null;
        const values = Object.create(null);
        for (const key of certificateFields) {
            const descriptor = descriptors[key];
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
                return null;
            values[key] = descriptor.value;
        }
        const rawIds = values.recoveredEventIds;
        if (!Array.isArray(rawIds) || rawIds.length > maxSlots)
            return null;
        const idDescriptors = Object.getOwnPropertyDescriptors(rawIds);
        const ids = [];
        for (let index = 0; index < rawIds.length; index++) {
            const descriptor = idDescriptors[String(index)];
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
                typeof descriptor.value !== 'string' || descriptor.value.length < 1 || descriptor.value.length > 256)
                return null;
            ids.push(descriptor.value);
        }
        if (Reflect.ownKeys(idDescriptors).length !== rawIds.length + 1)
            return null;
        const rawStatuses = values.perSlotStatus;
        if (!rawStatuses || typeof rawStatuses !== 'object' || Array.isArray(rawStatuses) ||
            (Object.getPrototypeOf(rawStatuses) !== Object.prototype && Object.getPrototypeOf(rawStatuses) !== null))
            return null;
        const statusDescriptors = Object.getOwnPropertyDescriptors(rawStatuses);
        const statusKeys = Reflect.ownKeys(statusDescriptors);
        if (statusKeys.length > maxSlots)
            return null;
        const statuses = Object.create(null);
        for (const key of statusKeys) {
            if (typeof key !== 'string')
                return null;
            const descriptor = statusDescriptors[key];
            if (!/^\d{1,16}$/.test(key) || !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
                typeof descriptor.value !== 'string' || !acceptedSlotStatuses.has(descriptor.value))
                return null;
            statuses[key] = descriptor.value;
        }
        return Object.freeze({
            certificateId: values.certificateId,
            gapId: values.gapId,
            startSlot: values.startSlot,
            endSlot: values.endSlot,
            providerId: values.providerId,
            classification: values.classification,
            lane: values.lane,
            recoveredEventIds: Object.freeze(ids),
            perSlotStatus: Object.freeze(statuses),
            stateRoot: values.stateRoot,
            coverageRoot: values.coverageRoot,
            isVerified: values.isVerified,
            certifiedAtMs: values.certifiedAtMs,
        });
    }
    catch {
        return null;
    }
}
export function serializeRecoveryCertificate(input, maxSlots = 100_000, maxBytes = 32 * 1024 * 1024) {
    const certificate = snapshotRecoveryCertificate(input, maxSlots);
    if (!certificate || certificate.isVerified !== true)
        return null;
    if (typeof certificate.certificateId !== 'string' || certificate.certificateId.length < 1 || certificate.certificateId.length > 128 ||
        typeof certificate.gapId !== 'string' || certificate.gapId.length < 1 || certificate.gapId.length > 256 ||
        !Number.isSafeInteger(certificate.startSlot) || certificate.startSlot < 1 ||
        !Number.isSafeInteger(certificate.endSlot) || certificate.endSlot < certificate.startSlot ||
        certificate.endSlot - certificate.startSlot + 1 > maxSlots ||
        typeof certificate.providerId !== 'string' || certificate.providerId.length < 1 || certificate.providerId.length > 128 ||
        !acceptedClassifications.has(certificate.classification) || !acceptedLanes.has(certificate.lane) ||
        typeof certificate.stateRoot !== 'string' || !/^[a-f0-9]{64}$/.test(certificate.stateRoot) ||
        typeof certificate.coverageRoot !== 'string' || !/^[a-f0-9]{64}$/.test(certificate.coverageRoot) ||
        !Number.isSafeInteger(certificate.certifiedAtMs) || certificate.certifiedAtMs < 0 || certificate.certifiedAtMs > Date.now())
        return null;
    const expectedStatusCount = certificate.endSlot - certificate.startSlot + 1;
    if (Object.keys(certificate.perSlotStatus).length !== expectedStatusCount)
        return null;
    for (let slot = certificate.startSlot; slot <= certificate.endSlot; slot++) {
        const status = certificate.perSlotStatus[slot];
        if (!status || status === 'UNAVAILABLE')
            return null;
    }
    const certificateJson = JSON.stringify(certificate);
    if (Buffer.byteLength(certificateJson, 'utf8') > maxBytes)
        return null;
    return {
        certificate,
        certificateJson,
        certificateSha256: createHash('sha256').update(certificateJson, 'utf8').digest('hex'),
    };
}
//# sourceMappingURL=recovery-certificate.js.map