/** Registration in one local SQLite namespace only. Neither the caller-supplied
 * digest nor the returned identity proves economics or authorizes any side effect.
 * MISSING and failed acknowledgements must never be used as execution permission.
 */
export interface InitialGenerationRegistration {
  readonly intentId: string;
  readonly registrationRequestId: string;
  readonly intentSha256: string;
}
export interface RegisteredGenerationIdentity extends InitialGenerationRegistration {
  readonly generation: 1;
  readonly state: 'REGISTERED';
  readonly registeredAtMs: number;
}
export type RegistrationResult = {
  readonly disposition: 'CREATED' | 'ALREADY_REGISTERED';
  readonly identity: RegisteredGenerationIdentity;
};
export type GenerationIdentityRead =
  | { readonly kind: 'MISSING' }
  | { readonly kind: 'REGISTERED'; readonly identity: RegisteredGenerationIdentity }
  | { readonly kind: 'LEGACY_TOMBSTONE'; readonly intentId: string; readonly legacyState: 'PREPARED' | 'SIGNED' };
export interface LocalGenerationIdentityStore {
  registerInitialGeneration(input: InitialGenerationRegistration): Promise<RegistrationResult>;
  readGenerationIdentity(intentId: string): Promise<GenerationIdentityRead>;
}
export const storageErrorCodes = [
  'INVALID_REGISTRATION', 'IDENTITY_CONFLICT', 'REQUEST_ID_CONFLICT', 'LEGACY_INTENT_BLOCKED',
  'REGISTRATION_STORAGE_UNSUPPORTED', 'SQLITE_RUNTIME_UNSUPPORTED', 'SCHEMA_UNSUPPORTED',
  'STORAGE_BUSY', 'STORAGE_FAILURE', 'STORAGE_OUTCOME_UNKNOWN', 'STORAGE_INVARIANT_FAILURE',
] as const;
export type StorageErrorCode = typeof storageErrorCodes[number];
export class GenerationStorageError extends Error {
  constructor(readonly code: StorageErrorCode, readonly sqliteCode?: number, options?: ErrorOptions) {
    super(code, options);
    this.name = 'GenerationStorageError';
  }
}
export function validateGenerationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9]/.test(value) || /[^A-Za-z0-9._:-]/.test(value) ||
      /^(?:__proto__|constructor|prototype)$/i.test(value)) {
    throw new GenerationStorageError('INVALID_REGISTRATION');
  }
}
/** Read data descriptors once: accessors, symbols, hidden fields and prototypes
 * cannot supply a different request during serialization. */
export function snapshotRegistration(value: unknown): InitialGenerationRegistration {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new GenerationStorageError('INVALID_REGISTRATION');
  }
  const keys = Reflect.ownKeys(value);
  const fields = ['intentId', 'registrationRequestId', 'intentSha256'] as const;
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key as typeof fields[number]))) {
    throw new GenerationStorageError('INVALID_REGISTRATION');
  }
  const entries = fields.map(key => {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !('value' in desc) || !desc.enumerable || typeof desc.value !== 'string') {
      throw new GenerationStorageError('INVALID_REGISTRATION');
    }
    return desc.value as string;
  });
  const [intentId, registrationRequestId, intentSha256] = entries;
  validateGenerationId(intentId); validateGenerationId(registrationRequestId);
  if (intentSha256.length !== 64 || /[^a-f0-9]/.test(intentSha256)) throw new GenerationStorageError('INVALID_REGISTRATION');
  return { intentId, registrationRequestId, intentSha256 };
}
