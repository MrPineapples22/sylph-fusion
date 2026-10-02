export const storageErrorCodes = [
    'INVALID_REGISTRATION', 'IDENTITY_CONFLICT', 'REQUEST_ID_CONFLICT', 'LEGACY_INTENT_BLOCKED',
    'REGISTRATION_STORAGE_UNSUPPORTED', 'SQLITE_RUNTIME_UNSUPPORTED', 'SCHEMA_UNSUPPORTED',
    'STORAGE_BUSY', 'STORAGE_FAILURE', 'STORAGE_OUTCOME_UNKNOWN', 'STORAGE_INVARIANT_FAILURE',
];
export class GenerationStorageError extends Error {
    code;
    sqliteCode;
    constructor(code, sqliteCode, options) {
        super(code, options);
        this.code = code;
        this.sqliteCode = sqliteCode;
        this.name = 'GenerationStorageError';
    }
}
export function validateGenerationId(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9]/.test(value) || /[^A-Za-z0-9._:-]/.test(value) ||
        /^(?:__proto__|constructor|prototype)$/i.test(value)) {
        throw new GenerationStorageError('INVALID_REGISTRATION');
    }
}
/** Read data descriptors once: accessors, symbols, hidden fields and prototypes
 * cannot supply a different request during serialization. */
export function snapshotRegistration(value) {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new GenerationStorageError('INVALID_REGISTRATION');
    }
    const keys = Reflect.ownKeys(value);
    const fields = ['intentId', 'registrationRequestId', 'intentSha256'];
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) {
        throw new GenerationStorageError('INVALID_REGISTRATION');
    }
    const entries = fields.map(key => {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (!desc || !('value' in desc) || !desc.enumerable || typeof desc.value !== 'string') {
            throw new GenerationStorageError('INVALID_REGISTRATION');
        }
        return desc.value;
    });
    const [intentId, registrationRequestId, intentSha256] = entries;
    validateGenerationId(intentId);
    validateGenerationId(registrationRequestId);
    if (intentSha256.length !== 64 || /[^a-f0-9]/.test(intentSha256))
        throw new GenerationStorageError('INVALID_REGISTRATION');
    return { intentId, registrationRequestId, intentSha256 };
}
//# sourceMappingURL=generation-identity.js.map