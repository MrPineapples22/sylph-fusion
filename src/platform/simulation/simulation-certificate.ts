/**
 * Research-only certificate for a simulation observation. It is not a signer,
 * execution, settlement, or release authority.
 */
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { verifyProgramRootForestIntegrity, verifyProgramRootIntegrity, verifyRuntimeRootIntegrity, type ProgramRoot, type RuntimeRoot } from '../truth/runtime-program-root.js';

export type SimulationLane = 'SHADOW_SIMULATION' | 'EXACT_FINAL_SIMULATION';
export type SimulationOutcome = 'SUCCESS' | 'FAILURE' | 'UNKNOWN';

export interface SimulationCertificate {
  readonly schemaVersion: '2.0.0' | '2.1.0';
  readonly simulationLane: SimulationLane;
  readonly transactionVersion: 'legacy' | 'v0';
  readonly messageHash: string;
  readonly wireTransactionHash: string;
  readonly routeHash: string;
  readonly quoteHash: string;
  readonly accountSetHash: string;
  readonly provider: string;
  readonly runtimeRoot: RuntimeRoot;
  readonly programRoots: readonly ProgramRoot[];
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly minContextSlot: number;
  readonly simulationSlot: number;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
  readonly sigVerify: boolean;
  readonly replaceRecentBlockhash: boolean;
  readonly error: unknown;
  readonly simulationOutcome: SimulationOutcome;
  readonly logsHash: string;
  /** @deprecated Legacy digest of the flat invokedPrograms list; this is not a CPI graph. */
  readonly cpiGraphHash: string;
  /** Schema 2.1 explicitly records that a structured CPI trace was not supplied. */
  readonly cpiTraceStatus?: 'UNAVAILABLE';
  readonly invokedPrograms: readonly string[];
  readonly unitsConsumed: number;
  readonly loadedAccountsDataSize: number;
  readonly requestedComputeLimit: number;
  readonly priorityFeeLamports: bigint;
  readonly simulatedFeeLamports: bigint;
  readonly preSolLamports: bigint;
  readonly postSolLamports: bigint;
  readonly preTokensRaw: bigint;
  readonly postTokensRaw: bigint;
  readonly simulatedOutputRaw: bigint;
  readonly criticalAccounts: readonly string[];
  readonly isSimulationSuccess: boolean;
  readonly evidenceHash: string;
}

export interface SimulationCertificateInput {
  readonly lane: SimulationLane;
  readonly transactionVersion: 'legacy' | 'v0';
  readonly messageHash: string;
  readonly wireTransactionHash: string;
  readonly routeHash: string;
  readonly quoteHash: string;
  readonly accountKeys: readonly string[];
  readonly provider: string;
  readonly runtimeRoot: RuntimeRoot;
  readonly programRoots: readonly ProgramRoot[];
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly minContextSlot: number;
  readonly simulationSlot: number;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
  /** Explicit null means RPC success; explicit undefined or malformed primitive means unknown. */
  readonly error: unknown;
  readonly logs: readonly string[];
  readonly invokedPrograms: readonly string[];
  readonly unitsConsumed: number;
  readonly loadedAccountsDataSize: number;
  readonly requestedComputeLimit: number;
  readonly priorityFeeLamports: bigint;
  readonly simulatedFeeLamports: bigint;
  readonly preSolLamports: bigint;
  readonly postSolLamports: bigint;
  readonly preTokensRaw: bigint;
  readonly postTokensRaw: bigint;
  readonly simulatedOutputRaw: bigint;
  readonly criticalAccounts: readonly string[];
}

const inputKeys = [
  'lane', 'transactionVersion', 'messageHash', 'wireTransactionHash', 'routeHash', 'quoteHash',
  'accountKeys', 'provider', 'runtimeRoot', 'programRoots', 'commitment', 'minContextSlot',
  'simulationSlot', 'blockhash', 'lastValidBlockHeight', 'error', 'logs', 'invokedPrograms',
  'unitsConsumed', 'loadedAccountsDataSize', 'requestedComputeLimit', 'priorityFeeLamports',
  'simulatedFeeLamports', 'preSolLamports', 'postSolLamports', 'preTokensRaw', 'postTokensRaw',
  'simulatedOutputRaw', 'criticalAccounts',
] as const;
const certificateKeys = [
  'schemaVersion', 'simulationLane', 'transactionVersion', 'messageHash', 'wireTransactionHash',
  'routeHash', 'quoteHash', 'accountSetHash', 'provider', 'runtimeRoot', 'programRoots',
  'commitment', 'minContextSlot', 'simulationSlot', 'blockhash', 'lastValidBlockHeight',
  'sigVerify', 'replaceRecentBlockhash', 'error', 'simulationOutcome', 'logsHash', 'cpiGraphHash',
  'invokedPrograms', 'unitsConsumed', 'loadedAccountsDataSize', 'requestedComputeLimit',
  'priorityFeeLamports', 'simulatedFeeLamports', 'preSolLamports', 'postSolLamports',
  'preTokensRaw', 'postTokensRaw', 'simulatedOutputRaw', 'criticalAccounts',
  'isSimulationSuccess', 'evidenceHash',
] as const;
const certificateOptionalKeys = ['cpiTraceStatus'] as const;
const runtimeKeys = [
  'cluster', 'genesisHash', 'epoch', 'contextSlot', 'agaveVersion', 'activeFeatureSetHash',
  'transactionVersionSupported', 'resourcePolicyVersion', 'runtimeRootHash',
] as const;
const runtimeOptionalKeys = ['runtimeRootHashSchemaVersion'] as const;
const programKeys = [
  'programId', 'programDataAddress', 'deploymentSlot', 'executableBytecodeHash',
  'upgradeAuthority', 'isImmutable', 'transitiveCpiProgramRoots', 'programRootHash',
] as const;
const MAX_CONTAINER_ITEMS = 16_384;
const MAX_OBJECT_KEYS = 4_096;
const MAX_VALUE_DEPTH = 32;
const MAX_VALUE_NODES = 100_000;
const MAX_TOTAL_TEXT_CHARS = 2_000_000;
const MAX_TEXT_FIELD_CHARS = 65_536;

interface ComplexityBudget { nodes: number; textChars: number }
function spendBudget(budget: ComplexityBudget, textChars = 0): void {
  budget.nodes += 1;
  budget.textChars += textChars;
  if (budget.nodes > MAX_VALUE_NODES || budget.textChars > MAX_TOTAL_TEXT_CHARS) throw new TypeError('SIMULATION_INPUT_TOO_COMPLEX');
}

function ownDataRecord(value: unknown, required: readonly string[], optional: readonly string[] = [], label = 'input'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError(`SIMULATION_${label.toUpperCase()}_INVALID`);
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`SIMULATION_${label.toUpperCase()}_INVALID`);
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_OBJECT_KEYS || keys.some(key => typeof key === 'string' && key.length > 1024)) throw new TypeError(`SIMULATION_${label.toUpperCase()}_TOO_LARGE`);
  if (keys.some(key => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))) ||
      required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new TypeError(`SIMULATION_${label.toUpperCase()}_SCHEMA_INVALID`);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of [...required, ...optional]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`SIMULATION_${label.toUpperCase()}_DATA_INVALID`);
    result[key] = descriptor.value;
  }
  return result;
}

function plainArray(value: unknown, label: string, maxLength = MAX_CONTAINER_ITEMS): unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`SIMULATION_${label}_INVALID`);
  if (value.length > maxLength) throw new TypeError(`SIMULATION_${label}_TOO_LARGE`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
    throw new TypeError(`SIMULATION_${label}_INVALID`);
  }
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`SIMULATION_${label}_INVALID`);
    copy.push(descriptor.value);
  }
  return copy;
}

function cloneJsonLike(value: unknown, active = new Set<object>(), depth = 0, budget: ComplexityBudget = { nodes: 0, textChars: 0 }): unknown {
  spendBudget(budget, typeof value === 'string' ? value.length : 0);
  if (depth > MAX_VALUE_DEPTH || (typeof value === 'string' && value.length > MAX_TEXT_FIELD_CHARS)) throw new TypeError('SIMULATION_INPUT_TOO_COMPLEX');
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SIMULATION_NUMBER_INVALID');
    return value;
  }
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'object' || utilTypes.isProxy(value)) throw new TypeError('SIMULATION_VALUE_INVALID');
  if (active.has(value)) throw new TypeError('SIMULATION_CYCLIC_VALUE');
  active.add(value);
  try {
    if (Array.isArray(value)) return plainArray(value, 'NESTED_ARRAY').map(item => cloneJsonLike(item, active, depth + 1, budget));
    const record = ownDataRecord(value, Reflect.ownKeys(value).filter((key): key is string => typeof key === 'string'), [], 'nested_object');
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record)) Object.defineProperty(output, key, {
      value: cloneJsonLike(record[key], active, depth + 1, budget), enumerable: true, configurable: true, writable: true,
    });
    return output;
  } finally { active.delete(value); }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function cloneRuntimeRoot(value: unknown): RuntimeRoot {
  const root = ownDataRecord(value, runtimeKeys, runtimeOptionalKeys, 'runtime_root');
  const hashSchemaVersion = Object.prototype.hasOwnProperty.call(root, 'runtimeRootHashSchemaVersion')
    ? root.runtimeRootHashSchemaVersion
    : 1;
  if (typeof root.cluster !== 'string' || !['mainnet-beta', 'devnet', 'testnet', 'localnet'].includes(root.cluster) ||
      typeof root.genesisHash !== 'string' || typeof root.agaveVersion !== 'string' ||
      typeof root.activeFeatureSetHash !== 'string' || typeof root.resourcePolicyVersion !== 'string' ||
      typeof root.runtimeRootHash !== 'string' || typeof root.transactionVersionSupported !== 'string' ||
      !['legacy', 'v0', 'all'].includes(root.transactionVersionSupported) ||
      (hashSchemaVersion !== 1 && hashSchemaVersion !== 2) ||
      (hashSchemaVersion === 1 && !/^[a-f0-9]{16}$/.test(root.activeFeatureSetHash)) ||
      (hashSchemaVersion === 2 && (!/^[a-f0-9]{64}$/.test(root.activeFeatureSetHash) ||
        [root.genesisHash, root.agaveVersion, root.resourcePolicyVersion].some(value => value.length < 1))) ||
      [root.genesisHash, root.agaveVersion, root.activeFeatureSetHash, root.resourcePolicyVersion, root.runtimeRootHash].some(value => value.length > 4096) ||
      !Number.isSafeInteger(root.epoch) || !Number.isSafeInteger(root.contextSlot) || Number(root.epoch) < 0 || Number(root.contextSlot) < 0) {
    throw new TypeError('SIMULATION_RUNTIME_ROOT_INVALID');
  }
  if (!verifyRuntimeRootIntegrity(value)) throw new TypeError('SIMULATION_RUNTIME_ROOT_HASH_MISMATCH');
  return Object.freeze({ ...root }) as unknown as RuntimeRoot;
}

function cloneProgramRoot(value: unknown, active = new Set<object>(), depth = 0, rootCount = { value: 0 }, runtimeContextSlot?: number): ProgramRoot {
  rootCount.value += 1;
  if (rootCount.value > 512) throw new TypeError('SIMULATION_PROGRAM_ROOTS_TOO_LARGE');
  if (depth > MAX_VALUE_DEPTH || !value || typeof value !== 'object' || utilTypes.isProxy(value)) throw new TypeError('SIMULATION_PROGRAM_ROOT_INVALID');
  if (active.has(value)) throw new TypeError('SIMULATION_CYCLIC_PROGRAM_ROOT');
  active.add(value);
  try {
    const root = ownDataRecord(value, ['programId', 'deploymentSlot', 'executableBytecodeHash', 'isImmutable', 'transitiveCpiProgramRoots', 'programRootHash'], ['programDataAddress', 'upgradeAuthority'], 'program_root');
    if (typeof root.programId !== 'string' || typeof root.executableBytecodeHash !== 'string' || typeof root.programRootHash !== 'string' ||
        typeof root.isImmutable !== 'boolean' || !Number.isSafeInteger(root.deploymentSlot) || Number(root.deploymentSlot) < 0 ||
        (root.programDataAddress !== undefined && typeof root.programDataAddress !== 'string') ||
        (root.upgradeAuthority !== undefined && typeof root.upgradeAuthority !== 'string') ||
        [root.programId, root.executableBytecodeHash, root.programRootHash, root.programDataAddress, root.upgradeAuthority]
          .some(value => typeof value === 'string' && value.length > 4096)) throw new TypeError('SIMULATION_PROGRAM_ROOT_INVALID');
    if (runtimeContextSlot !== undefined && Number(root.deploymentSlot) > runtimeContextSlot) throw new TypeError('SIMULATION_PROGRAM_DEPLOYMENT_AFTER_RUNTIME_CONTEXT');
    const children = plainArray(root.transitiveCpiProgramRoots, 'PROGRAM_CHILDREN', 64)
      .map(child => cloneProgramRoot(child, active, depth + 1, rootCount, runtimeContextSlot));
    if (root.isImmutable !== !(root.upgradeAuthority ?? '')) throw new TypeError('SIMULATION_PROGRAM_ROOT_IMMUTABILITY_MISMATCH');
    if (!verifyProgramRootIntegrity(value)) throw new TypeError('SIMULATION_PROGRAM_ROOT_HASH_MISMATCH');
    return Object.freeze({
      programId: root.programId,
      ...(Object.prototype.hasOwnProperty.call(root, 'programDataAddress') ? { programDataAddress: root.programDataAddress } : {}),
      deploymentSlot: root.deploymentSlot,
      executableBytecodeHash: root.executableBytecodeHash,
      ...(Object.prototype.hasOwnProperty.call(root, 'upgradeAuthority') ? { upgradeAuthority: root.upgradeAuthority } : {}),
      isImmutable: root.isImmutable,
      transitiveCpiProgramRoots: Object.freeze(children),
      programRootHash: root.programRootHash,
    }) as ProgramRoot;
  } finally { active.delete(value); }
}

function cloneStrings(value: unknown, label: string, maxCount: number): readonly string[] {
  const strings = plainArray(value, label, maxCount);
  if (strings.some(item => typeof item !== 'string' || item.length > 16_384 || (label !== 'LOGS' && item.trim().length === 0)) ||
      strings.reduce<number>((total, item) => total + (typeof item === 'string' ? item.length : 0), 0) > 1_000_000) throw new TypeError(`SIMULATION_${label}_INVALID`);
  return Object.freeze(strings as string[]);
}

function canonical(value: unknown, active = new Set<object>(), depth = 0, budget: ComplexityBudget = { nodes: 0, textChars: 0 }): string {
  spendBudget(budget, typeof value === 'string' ? value.length : 0);
  if (depth > MAX_VALUE_DEPTH || (typeof value === 'string' && value.length > MAX_TEXT_FIELD_CHARS)) throw new TypeError('SIMULATION_INPUT_TOO_COMPLEX');
  if (value === null) return 'null;';
  if (value === undefined) return 'undefined;';
  if (typeof value === 'string') return `string:${JSON.stringify(value)};`;
  if (typeof value === 'boolean') return value ? 'boolean:true;' : 'boolean:false;';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SIMULATION_NUMBER_INVALID');
    return `number:${JSON.stringify(value)};`;
  }
  if (typeof value === 'bigint') return `bigint:${JSON.stringify(value.toString())};`;
  if (typeof value !== 'object' || utilTypes.isProxy(value)) throw new TypeError('SIMULATION_VALUE_INVALID');
  if (active.has(value)) throw new TypeError('SIMULATION_CYCLIC_VALUE');
  active.add(value);
  try {
    if (Array.isArray(value)) return `array:${plainArray(value, 'CANONICAL_ARRAY').map(item => canonical(item, active, depth + 1, budget)).join('')}end-array;`;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) throw new TypeError('SIMULATION_SYMBOL_KEY_INVALID');
    const record = ownDataRecord(value, keys as string[], [], 'canonical_object');
    return `object:{${Object.keys(record).sort().map(key => `${canonical(key, active, depth + 1, budget)}${canonical(record[key], active, depth + 1, budget)}`).join('')}}end-object;`;
  } finally { active.delete(value); }
}

function digest(preimage: Omit<SimulationCertificate, 'evidenceHash'>): string {
  return createHash('sha256').update('SYLPH_SIMULATION_CERTIFICATE\0v2\0').update(canonical(preimage)).digest('hex');
}

const transactionErrorVariants = new Set([
  'AccountInUse', 'AccountLoadedTwice', 'AccountNotFound', 'ProgramAccountNotFound', 'InsufficientFundsForFee',
  'InvalidAccountForFee', 'AlreadyProcessed', 'BlockhashNotFound', 'InstructionError', 'CallChainTooDeep',
  'MissingSignatureForFee', 'InvalidAccountIndex', 'SignatureFailure', 'InvalidProgramForExecution', 'SanitizeFailure',
  'ClusterMaintenance', 'AccountBorrowOutstanding', 'WouldExceedMaxBlockCostLimit', 'UnsupportedVersion',
  'InvalidWritableAccount', 'WouldExceedMaxAccountCostLimit', 'WouldExceedMaxVoteCostLimit', 'WouldExceedAccountDataBlockLimit',
  'TooManyAccountLocks', 'AddressLookupTableNotFound', 'InvalidAddressLookupTableIndex', 'InvalidRentPayingAccount',
  'InvalidAddressLookupTableOwner', 'InvalidAddressLookupTableData', 'WouldExceedAccountDataTotalLimit',
  'DuplicateInstruction', 'InsufficientFundsForRent',
  'MaxLoadedAccountsDataSizeExceeded', 'InvalidLoadedAccountsDataSizeLimit', 'ResanitizationNeeded',
  'ProgramExecutionTemporarilyRestricted', 'UnbalancedTransaction', 'ProgramCacheHitMaxLimit', 'CommitCancelled',
  'BailOut',
]);
const instructionErrorVariants = new Set([
  'GenericError', 'InvalidArgument', 'InvalidInstructionData', 'InvalidAccountData', 'AccountDataTooSmall',
  'InsufficientFunds', 'IncorrectProgramId', 'MissingRequiredSignature', 'AccountAlreadyInitialized',
  'UninitializedAccount', 'UnbalancedInstruction', 'ModifiedProgramId', 'ExternalAccountLamportSpend',
  'ExternalAccountDataModified', 'ReadonlyLamportChange', 'ReadonlyDataModified', 'DuplicateAccountIndex',
  'ExecutableModified', 'RentEpochModified', 'NotEnoughAccountKeys', 'AccountDataSizeChanged',
  'AccountNotExecutable', 'AccountBorrowFailed', 'AccountBorrowOutstanding', 'DuplicateAccountOutOfSync',
  'Custom', 'InvalidError', 'ExecutableDataModified', 'ExecutableLamportChange', 'ExecutableAccountNotRentExempt',
  'UnsupportedProgramId', 'CallDepth', 'MissingAccount', 'ReentrancyNotAllowed', 'MaxSeedLengthExceeded',
  'InvalidSeeds', 'InvalidRealloc', 'ComputationalBudgetExceeded', 'PrivilegeEscalation',
  'ProgramEnvironmentSetupFailure', 'ProgramFailedToComplete', 'ProgramFailedToCompile', 'Immutable',
  'IncorrectAuthority', 'BorshIoError', 'AccountNotRentExempt', 'InvalidAccountOwner', 'ArithmeticOverflow',
  'UnsupportedSysvar', 'IllegalOwner', 'MaxAccountsDataAllocationsExceeded', 'MaxAccountsExceeded',
  'MaxInstructionTraceLengthExceeded', 'BuiltinProgramsMustConsumeComputeUnits', 'BailOut',
]);
function isTrustedInstructionError(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const record = ownDataRecord(value, Reflect.ownKeys(value).filter((key): key is string => typeof key === 'string'), [], 'instruction_error');
  const keys = Object.keys(record);
  if (keys.length !== 1 || !instructionErrorVariants.has(keys[0])) return false;
  if (keys[0] === 'Custom') return Number.isSafeInteger(record.Custom) && Number(record.Custom) >= 0 && Number(record.Custom) <= 0xffffffff;
  if (keys[0] === 'BorshIoError') return typeof record.BorshIoError === 'string';
  return record[keys[0]] === null;
}
function isTrustedTransactionError(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const record = ownDataRecord(value, Reflect.ownKeys(value).filter((key): key is string => typeof key === 'string'), [], 'transaction_error');
  const keys = Object.keys(record);
  if (keys.length !== 1 || !transactionErrorVariants.has(keys[0])) return false;
  if (keys[0] === 'InstructionError') {
    const tuple = plainArray(record.InstructionError, 'INSTRUCTION_ERROR');
    return tuple.length === 2 && Number.isSafeInteger(tuple[0]) && Number(tuple[0]) >= 0 && Number(tuple[0]) <= 255 && isTrustedInstructionError(tuple[1]);
  }
  if (keys[0] === 'DuplicateInstruction') return Number.isSafeInteger(record.DuplicateInstruction) && Number(record.DuplicateInstruction) >= 0 && Number(record.DuplicateInstruction) <= 255;
  if (keys[0] === 'InsufficientFundsForRent' || keys[0] === 'ProgramExecutionTemporarilyRestricted') {
    if (!record[keys[0]] || typeof record[keys[0]] !== 'object' || Array.isArray(record[keys[0]])) return false;
    const details = ownDataRecord(record[keys[0]], ['account_index'], [], 'transaction_error_details');
    return Number.isSafeInteger(details.account_index) && Number(details.account_index) >= 0 && Number(details.account_index) <= 255;
  }
  return record[keys[0]] === null;
}
function outcomeFor(error: unknown): SimulationOutcome {
  if (error === null) return 'SUCCESS';
  if (error === undefined) return 'UNKNOWN';
  if (typeof error === 'string') return 'FAILURE';
  if (typeof error === 'object' && error !== null) {
    try { return isTrustedTransactionError(error) ? 'FAILURE' : 'UNKNOWN'; }
    catch { return 'UNKNOWN'; }
  }
  return 'UNKNOWN';
}

function expectedOutcomeConsistency(cert: Record<string, unknown>): boolean {
  const state = outcomeFor(cert.error);
  return cert.simulationOutcome === state && cert.isSimulationSuccess === (state === 'SUCCESS') &&
    cert.sigVerify === (cert.simulationLane === 'EXACT_FINAL_SIMULATION') &&
    cert.replaceRecentBlockhash === (cert.simulationLane === 'SHADOW_SIMULATION');
}

export function verifySimulationCertificate(value: unknown): value is SimulationCertificate {
  try {
    const cert = ownDataRecord(value, certificateKeys, certificateOptionalKeys, 'certificate');
    const hasCpiTraceStatus = Object.prototype.hasOwnProperty.call(cert, 'cpiTraceStatus');
    const schemaCompatible = cert.schemaVersion === '2.0.0'
      ? !hasCpiTraceStatus
      : cert.schemaVersion === '2.1.0' && cert.cpiTraceStatus === 'UNAVAILABLE';
    if (!schemaCompatible || !['SHADOW_SIMULATION', 'EXACT_FINAL_SIMULATION'].includes(String(cert.simulationLane)) ||
        !['legacy', 'v0'].includes(String(cert.transactionVersion)) || !['processed', 'confirmed', 'finalized'].includes(String(cert.commitment)) ||
        !expectedOutcomeConsistency(cert)) return false;
    const strings = ['messageHash', 'wireTransactionHash', 'routeHash', 'quoteHash', 'accountSetHash', 'provider',
      'blockhash', 'logsHash', 'cpiGraphHash', 'evidenceHash'] as const;
    if (strings.some(field => typeof cert[field] !== 'string' || cert[field].length > (field === 'provider' ? 256 : 4096) ||
        (field !== 'wireTransactionHash' && cert[field].trim().length === 0)) ||
        ['accountSetHash', 'logsHash', 'cpiGraphHash', 'evidenceHash'].some(field => !/^[a-f0-9]{64}$/.test(String(cert[field])))) return false;
    for (const field of ['minContextSlot', 'simulationSlot', 'lastValidBlockHeight', 'unitsConsumed',
      'loadedAccountsDataSize', 'requestedComputeLimit'] as const) {
      if (!Number.isSafeInteger(cert[field]) || Number(cert[field]) < 0) return false;
    }
    if (cert.simulationLane === 'EXACT_FINAL_SIMULATION' && (cert.wireTransactionHash as string).trim().length === 0) return false;
    for (const field of ['priorityFeeLamports', 'simulatedFeeLamports', 'preSolLamports', 'postSolLamports',
      'preTokensRaw', 'postTokensRaw', 'simulatedOutputRaw'] as const) if (typeof cert[field] !== 'bigint' || cert[field] < 0n) return false;
    const runtimeRoot = cloneRuntimeRoot(cert.runtimeRoot);
    if (Number(cert.simulationSlot) < Math.max(Number(cert.minContextSlot), runtimeRoot.contextSlot)) return false;
    if (runtimeRoot.transactionVersionSupported !== 'all' && runtimeRoot.transactionVersionSupported !== cert.transactionVersion) return false;
    const rawProgramRoots = plainArray(cert.programRoots, 'PROGRAM_ROOTS', 256);
    if (!verifyProgramRootForestIntegrity(rawProgramRoots, runtimeRoot.contextSlot)) return false;
    const programRootCount = { value: 0 };
    rawProgramRoots.forEach(root =>
      cloneProgramRoot(root, new Set<object>(), 0, programRootCount, runtimeRoot.contextSlot));
    cloneStrings(cert.invokedPrograms, 'INVOKED_PROGRAMS', 256);
    cloneStrings(cert.criticalAccounts, 'CRITICAL_ACCOUNTS', 256);
    cloneJsonLike(cert.error);
    const { evidenceHash, ...preimage } = cert;
    return typeof evidenceHash === 'string' && /^[a-f0-9]{64}$/.test(evidenceHash) && digest(preimage as Omit<SimulationCertificate, 'evidenceHash'>) === evidenceHash;
  } catch { return false; }
}

export class SimulationCertificateBuilder {
  public static buildCertificate(params: SimulationCertificateInput): SimulationCertificate {
    const input = ownDataRecord(params, inputKeys, [], 'input');
    if (!['SHADOW_SIMULATION', 'EXACT_FINAL_SIMULATION'].includes(String(input.lane)) ||
        !['legacy', 'v0'].includes(String(input.transactionVersion)) ||
        !['processed', 'confirmed', 'finalized'].includes(String(input.commitment))) throw new TypeError('SIMULATION_ENUM_INVALID');
    for (const field of ['messageHash', 'wireTransactionHash', 'routeHash', 'quoteHash', 'provider', 'blockhash'] as const) {
      if (typeof input[field] !== 'string' || input[field].length > (field === 'provider' ? 256 : 4096) ||
          (field !== 'wireTransactionHash' && input[field].trim().length === 0)) throw new TypeError(`SIMULATION_${field.toUpperCase()}_INVALID`);
    }
    for (const field of ['minContextSlot', 'simulationSlot', 'lastValidBlockHeight', 'unitsConsumed', 'loadedAccountsDataSize', 'requestedComputeLimit'] as const) {
      if (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0) throw new TypeError(`SIMULATION_${field.toUpperCase()}_INVALID`);
    }
    if (Number(input.simulationSlot) < Number(input.minContextSlot)) throw new TypeError('SIMULATION_SLOT_BELOW_MIN_CONTEXT_SLOT');
    if (input.lane === 'EXACT_FINAL_SIMULATION' && (input.wireTransactionHash as string).trim().length === 0) {
      throw new TypeError('SIMULATION_EXACT_FINAL_WIRE_HASH_REQUIRED');
    }
    for (const field of ['priorityFeeLamports', 'simulatedFeeLamports', 'preSolLamports', 'postSolLamports', 'preTokensRaw', 'postTokensRaw', 'simulatedOutputRaw'] as const) {
      if (typeof input[field] !== 'bigint' || input[field] < 0n) throw new TypeError(`SIMULATION_${field.toUpperCase()}_INVALID`);
    }

    const accountKeys = cloneStrings(input.accountKeys, 'ACCOUNT_KEYS', 256);
    const logs = cloneStrings(input.logs, 'LOGS', 10_000);
    const invokedPrograms = cloneStrings(input.invokedPrograms, 'INVOKED_PROGRAMS', 256);
    const criticalAccounts = cloneStrings(input.criticalAccounts, 'CRITICAL_ACCOUNTS', 256);
    const runtimeRoot = cloneRuntimeRoot(input.runtimeRoot);
    if (Number(input.simulationSlot) < runtimeRoot.contextSlot) throw new TypeError('SIMULATION_SLOT_BELOW_RUNTIME_CONTEXT_SLOT');
    if (runtimeRoot.transactionVersionSupported !== 'all' && runtimeRoot.transactionVersionSupported !== input.transactionVersion) {
      throw new TypeError('SIMULATION_TRANSACTION_VERSION_UNSUPPORTED_BY_RUNTIME');
    }
    const rawProgramRoots = plainArray(input.programRoots, 'PROGRAM_ROOTS', 256);
    if (!verifyProgramRootForestIntegrity(rawProgramRoots, runtimeRoot.contextSlot)) throw new TypeError('SIMULATION_PROGRAM_ROOT_FOREST_INVALID');
    const programRootCount = { value: 0 };
    const programRoots = Object.freeze(rawProgramRoots
      .map(root => cloneProgramRoot(root, new Set<object>(), 0, programRootCount, runtimeRoot.contextSlot)));
    const error = deepFreeze(cloneJsonLike(input.error));
    const simulationOutcome = outcomeFor(error);
    const sigVerify = input.lane === 'EXACT_FINAL_SIMULATION';
    const replaceRecentBlockhash = input.lane === 'SHADOW_SIMULATION';
    const payload = Object.freeze({
      schemaVersion: '2.1.0' as const,
      simulationLane: input.lane as SimulationLane,
      transactionVersion: input.transactionVersion as 'legacy' | 'v0',
      messageHash: input.messageHash as string,
      wireTransactionHash: input.wireTransactionHash as string,
      routeHash: input.routeHash as string,
      quoteHash: input.quoteHash as string,
      accountSetHash: createHash('sha256').update(canonical([...accountKeys].sort())).digest('hex'),
      provider: input.provider as string,
      runtimeRoot,
      programRoots,
      commitment: input.commitment as 'processed' | 'confirmed' | 'finalized',
      minContextSlot: input.minContextSlot as number,
      simulationSlot: input.simulationSlot as number,
      blockhash: input.blockhash as string,
      lastValidBlockHeight: input.lastValidBlockHeight as number,
      sigVerify,
      replaceRecentBlockhash,
      error,
      simulationOutcome,
      logsHash: createHash('sha256').update(canonical(logs)).digest('hex'),
      cpiGraphHash: createHash('sha256').update(canonical(invokedPrograms)).digest('hex'),
      cpiTraceStatus: 'UNAVAILABLE' as const,
      invokedPrograms,
      unitsConsumed: input.unitsConsumed as number,
      loadedAccountsDataSize: input.loadedAccountsDataSize as number,
      requestedComputeLimit: input.requestedComputeLimit as number,
      priorityFeeLamports: input.priorityFeeLamports as bigint,
      simulatedFeeLamports: input.simulatedFeeLamports as bigint,
      preSolLamports: input.preSolLamports as bigint,
      postSolLamports: input.postSolLamports as bigint,
      preTokensRaw: input.preTokensRaw as bigint,
      postTokensRaw: input.postTokensRaw as bigint,
      simulatedOutputRaw: input.simulatedOutputRaw as bigint,
      criticalAccounts,
      isSimulationSuccess: simulationOutcome === 'SUCCESS',
    });
    const certificate = Object.freeze({ ...payload, evidenceHash: digest(payload) });
    if (!verifySimulationCertificate(certificate)) throw new Error('SIMULATION_CERTIFICATE_SELF_VERIFY_FAILED');
    return certificate;
  }
}
