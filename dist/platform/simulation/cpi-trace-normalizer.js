import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { PublicKey } from '@solana/web3.js';
const MAX_TOP_LEVEL_INSTRUCTIONS = 256;
const MAX_GROUPS = 256;
const MAX_INNER_INSTRUCTIONS = 16_384;
const MAX_ACCOUNTS_PER_INSTRUCTION = 256;
const MAX_STACK_HEIGHT = 32;
const MAX_VALUE_DEPTH = 32;
const MAX_CANONICAL_NODES = 65_536;
const MAX_TRACE_BYTES = 2_000_000;
const MAX_CONTAINER_ENTRIES = 16_384;
const MAX_OBJECT_PROPERTIES = 4_096;
const MAX_STRING_BYTES = 1_000_000;
const MAX_OBJECT_KEY_BYTES = 1_024;
function invalid(code) {
    throw new TypeError(code);
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactDataRecord(value, required, optional, code) {
    if (!isRecord(value) || utilTypes.isProxy(value))
        invalid(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        invalid(code);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string'))
        invalid(code);
    const names = keys;
    const allowed = new Set([...required, ...optional]);
    if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) || names.some(key => !allowed.has(key)))
        invalid(code);
    for (const key of names) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
            invalid(code);
    }
    return value;
}
function ownDataRecordSnapshot(value, code) {
    if (!isRecord(value) || utilTypes.isProxy(value))
        invalid(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        invalid(code);
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_OBJECT_PROPERTIES || keys.some(key => typeof key !== 'string'))
        invalid(code);
    const snapshot = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable ||
            Buffer.byteLength(key, 'utf8') > MAX_OBJECT_KEY_BYTES)
            invalid(code);
        Object.defineProperty(snapshot, key, { value: descriptor.value, enumerable: true, configurable: false, writable: false });
    }
    return snapshot;
}
function measuredChunk(value, budget) {
    const bytes = Buffer.byteLength(value, 'utf8');
    budget.bytes += bytes;
    if (budget.bytes > MAX_TRACE_BYTES)
        invalid('CPI_TRACE_TOO_LARGE');
    return bytes;
}
function measureCanonicalBytes(value, budget, depth = 0) {
    budget.nodes += 1;
    if (budget.nodes > MAX_CANONICAL_NODES || depth > MAX_VALUE_DEPTH)
        invalid('CPI_TRACE_TOO_COMPLEX');
    if (value === null)
        return measuredChunk('null;', budget);
    if (typeof value === 'boolean')
        return measuredChunk(value ? 'boolean:true;' : 'boolean:false;', budget);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            invalid('CPI_TRACE_NUMBER_INVALID');
        return measuredChunk(`number:${JSON.stringify(Object.is(value, -0) ? 0 : value)};`, budget);
    }
    if (typeof value === 'string') {
        if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES)
            invalid('CPI_TRACE_STRING_TOO_LARGE');
        return measuredChunk(`string:${JSON.stringify(value)};`, budget);
    }
    if (Array.isArray(value)) {
        const items = exactArray(value, 'CPI_TRACE_ARRAY_INVALID', MAX_CONTAINER_ENTRIES);
        if (budget.active.has(value))
            invalid('CPI_TRACE_VALUE_INVALID');
        budget.active.add(value);
        try {
            let bytes = measuredChunk('array:', budget) + measuredChunk('end-array;', budget);
            for (const item of items)
                bytes += measureCanonicalBytes(item, budget, depth + 1);
            return bytes;
        }
        finally {
            budget.active.delete(value);
        }
    }
    if (isRecord(value)) {
        if (utilTypes.isProxy(value) || budget.active.has(value))
            invalid('CPI_TRACE_VALUE_INVALID');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            invalid('CPI_TRACE_OBJECT_INVALID');
        const keys = Reflect.ownKeys(value);
        if (keys.length > MAX_OBJECT_PROPERTIES || keys.some(key => typeof key !== 'string'))
            invalid('CPI_TRACE_OBJECT_INVALID');
        budget.active.add(value);
        try {
            let bytes = measuredChunk('object:{', budget) + measuredChunk('}end-object;', budget);
            for (const key of keys.sort()) {
                if (Buffer.byteLength(key, 'utf8') > MAX_OBJECT_KEY_BYTES)
                    invalid('CPI_TRACE_OBJECT_KEY_TOO_LARGE');
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
                    invalid('CPI_TRACE_OBJECT_INVALID');
                bytes += measureCanonicalBytes(key, budget, depth + 1);
                bytes += measureCanonicalBytes(descriptor.value, budget, depth + 1);
            }
            return bytes;
        }
        finally {
            budget.active.delete(value);
        }
    }
    invalid('CPI_TRACE_VALUE_INVALID');
}
function exactArray(value, code, maxLength) {
    if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength)
        invalid(code);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string'))
        invalid(code);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
            invalid(code);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !('value' in lengthDescriptor))
        invalid(code);
    return value;
}
function address(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64)
        return false;
    try {
        return new PublicKey(value).toBase58() === value;
    }
    catch {
        return false;
    }
}
function encode(value, budget, depth = 0) {
    budget.nodes += 1;
    if (budget.nodes > MAX_CANONICAL_NODES || depth > MAX_VALUE_DEPTH)
        invalid('CPI_TRACE_TOO_COMPLEX');
    let encoded;
    if (value === null)
        encoded = 'null;';
    else if (typeof value === 'boolean')
        encoded = value ? 'boolean:true;' : 'boolean:false;';
    else if (typeof value === 'number') {
        if (!Number.isFinite(value))
            invalid('CPI_TRACE_NUMBER_INVALID');
        encoded = `number:${JSON.stringify(Object.is(value, -0) ? 0 : value)};`;
    }
    else if (typeof value === 'string') {
        if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES)
            invalid('CPI_TRACE_STRING_TOO_LARGE');
        encoded = `string:${JSON.stringify(value)};`;
    }
    else if (Array.isArray(value)) {
        if (utilTypes.isProxy(value) || budget.active.has(value))
            invalid('CPI_TRACE_VALUE_INVALID');
        budget.active.add(value);
        try {
            const items = exactArray(value, 'CPI_TRACE_ARRAY_INVALID', MAX_CONTAINER_ENTRIES);
            const prefix = `array:`;
            budget.bytes += Buffer.byteLength(prefix, 'utf8');
            if (budget.bytes > MAX_TRACE_BYTES)
                invalid('CPI_TRACE_TOO_LARGE');
            const encodedItems = items.map(item => encode(item, budget, depth + 1));
            const suffix = 'end-array;';
            budget.bytes += Buffer.byteLength(suffix, 'utf8');
            if (budget.bytes > MAX_TRACE_BYTES)
                invalid('CPI_TRACE_TOO_LARGE');
            encoded = `${prefix}${encodedItems.join('')}${suffix}`;
        }
        finally {
            budget.active.delete(value);
        }
    }
    else if (isRecord(value)) {
        if (utilTypes.isProxy(value) || budget.active.has(value))
            invalid('CPI_TRACE_VALUE_INVALID');
        budget.active.add(value);
        try {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null)
                invalid('CPI_TRACE_OBJECT_INVALID');
            const keys = Reflect.ownKeys(value);
            if (keys.length > MAX_OBJECT_PROPERTIES || keys.some(key => typeof key !== 'string'))
                invalid('CPI_TRACE_OBJECT_INVALID');
            const properties = keys.sort();
            const entries = [];
            for (const key of properties) {
                if (Buffer.byteLength(key, 'utf8') > MAX_OBJECT_KEY_BYTES)
                    invalid('CPI_TRACE_OBJECT_KEY_TOO_LARGE');
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
                    invalid('CPI_TRACE_OBJECT_INVALID');
                entries.push(encode(key, budget, depth + 1), encode(descriptor.value, budget, depth + 1));
            }
            const prefix = 'object:{';
            const suffix = '}end-object;';
            budget.bytes += Buffer.byteLength(prefix, 'utf8') + Buffer.byteLength(suffix, 'utf8');
            if (budget.bytes > MAX_TRACE_BYTES)
                invalid('CPI_TRACE_TOO_LARGE');
            encoded = `${prefix}${entries.join('')}${suffix}`;
        }
        finally {
            budget.active.delete(value);
        }
    }
    else
        invalid('CPI_TRACE_VALUE_INVALID');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        budget.bytes += Buffer.byteLength(encoded, 'utf8');
        if (budget.bytes > MAX_TRACE_BYTES)
            invalid('CPI_TRACE_TOO_LARGE');
    }
    return encoded;
}
function hash(domain, value, budget = { nodes: 0, bytes: 0, active: new Set() }) {
    const encoded = encode(value, budget);
    return createHash('sha256').update(domain, 'utf8').update(encoded, 'utf8').digest('hex');
}
function detachJsonValue(value, nodes, depth = 0) {
    nodes.count += 1;
    if (nodes.count > MAX_CANONICAL_NODES || depth > MAX_VALUE_DEPTH)
        invalid('CPI_TRACE_TOO_COMPLEX');
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            invalid('CPI_TRACE_NUMBER_INVALID');
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) {
        const items = exactArray(value, 'CPI_TRACE_ARRAY_INVALID', MAX_CONTAINER_ENTRIES);
        return Object.freeze(items.map(item => detachJsonValue(item, nodes, depth + 1)));
    }
    if (isRecord(value)) {
        if (utilTypes.isProxy(value))
            invalid('CPI_TRACE_OBJECT_INVALID');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            invalid('CPI_TRACE_OBJECT_INVALID');
        const keys = Reflect.ownKeys(value);
        if (keys.length > MAX_OBJECT_PROPERTIES || keys.some(key => typeof key !== 'string'))
            invalid('CPI_TRACE_OBJECT_INVALID');
        const output = Object.create(null);
        for (const key of keys.sort()) {
            if (Buffer.byteLength(key, 'utf8') > MAX_OBJECT_KEY_BYTES)
                invalid('CPI_TRACE_OBJECT_KEY_TOO_LARGE');
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
                invalid('CPI_TRACE_OBJECT_INVALID');
            Object.defineProperty(output, key, {
                value: detachJsonValue(descriptor.value, nodes, depth + 1), enumerable: true, configurable: false, writable: false,
            });
        }
        return Object.freeze(output);
    }
    invalid('CPI_TRACE_VALUE_INVALID');
}
function deepFreeze(value, active = new Set()) {
    if (!value || typeof value !== 'object' || active.has(value))
        return value;
    active.add(value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor)
            deepFreeze(descriptor.value, active);
    }
    return Object.freeze(value);
}
function buildTrace(recordingRequested, responseFieldState, topLevelInstructionCount, status, groups) {
    const payload = {
        normalizationVersion: 1,
        status,
        coverage: 'REPORTED_NODES_ONLY',
        recordingRequested,
        responseFieldState,
        topLevelInstructionCount,
        groups,
    };
    const traceHash = hash('SYLPH_CPI_TRACE\0v1\0', payload);
    return deepFreeze({ ...payload, traceHash });
}
function encodeWithinTraceBudget(value) {
    const encoded = encode(value, { nodes: 0, bytes: 0, active: new Set() });
    if (Buffer.byteLength(encoded, 'utf8') > MAX_TRACE_BYTES)
        invalid('CPI_TRACE_TOO_LARGE');
    return encoded;
}
function unavailable(recordingRequested, responseFieldState, topLevelInstructionCount) {
    return buildTrace(recordingRequested, responseFieldState, topLevelInstructionCount, 'UNAVAILABLE', []);
}
function parseInstruction(value, sourceBudget, sourceMeasureBudget, sourceSnapshotBudget) {
    if (!isRecord(value) || utilTypes.isProxy(value))
        invalid('CPI_TRACE_INSTRUCTION_INVALID');
    const parsed = Object.prototype.hasOwnProperty.call(value, 'parsed');
    const sourceKind = parsed ? 'PARSED' : 'PARTIALLY_DECODED';
    const required = parsed ? ['parsed', 'program', 'programId'] : ['accounts', 'data', 'programId'];
    const optional = ['stackHeight'];
    const instruction = exactDataRecord(value, required, optional, 'CPI_TRACE_INSTRUCTION_INVALID');
    if (!address(instruction.programId))
        invalid('CPI_TRACE_PROGRAM_ID_INVALID');
    let sourceFields;
    if (parsed) {
        if (typeof instruction.program !== 'string' || instruction.program.length === 0 || Buffer.byteLength(instruction.program, 'utf8') > 256 ||
            !isRecord(instruction.parsed) || Array.isArray(instruction.parsed))
            invalid('CPI_TRACE_PARSED_INSTRUCTION_INVALID');
        sourceFields = {
            kind: 'PARSED', parsed: instruction.parsed, program: instruction.program, programId: instruction.programId,
        };
    }
    else {
        const accounts = exactArray(instruction.accounts, 'CPI_TRACE_ACCOUNTS_INVALID', MAX_ACCOUNTS_PER_INSTRUCTION);
        if (accounts.some(account => !address(account)) || typeof instruction.data !== 'string' ||
            Buffer.byteLength(instruction.data, 'utf8') > 16_384) {
            invalid('CPI_TRACE_PARTIAL_INSTRUCTION_INVALID');
        }
        sourceFields = {
            kind: 'PARTIALLY_DECODED', accounts, data: instruction.data, programId: instruction.programId,
        };
    }
    const hasStackHeight = Object.prototype.hasOwnProperty.call(instruction, 'stackHeight');
    const rawHeight = hasStackHeight ? instruction.stackHeight : null;
    if (hasStackHeight && rawHeight === undefined)
        invalid('CPI_TRACE_STACK_HEIGHT_INVALID');
    if (rawHeight !== null && (!Number.isSafeInteger(rawHeight) || Number(rawHeight) < 2 || Number(rawHeight) > MAX_STACK_HEIGHT)) {
        invalid('CPI_TRACE_STACK_HEIGHT_INVALID');
    }
    // Hash the nested source object before holding it in the returned trace. The digest
    // commits to its exact validated JSON data while avoiding unbounded raw payload copies.
    measureCanonicalBytes(sourceFields, sourceMeasureBudget);
    const instructionHash = hash('SYLPH_CPI_INSTRUCTION\0v1\0', sourceFields, sourceBudget);
    const detachedSourceFields = detachJsonValue(sourceFields, sourceSnapshotBudget);
    return { programId: instruction.programId, stackHeight: rawHeight, sourceKind,
        sourceFields: detachedSourceFields, instructionHash };
}
/**
 * Normalize Solana simulation inner-instruction evidence. This pure adapter proves
 * deterministic structure for reported nodes only; it does not authenticate an RPC,
 * establish trace completeness, or authorize execution. Observed-evidence construction
 * must call it only from the private receipt-bound observer path.
 */
export function normalizeSimulationCpiTrace(recordingRequested, topLevelInstructionCount, innerInstructions) {
    if (typeof recordingRequested !== 'boolean' || !Number.isSafeInteger(topLevelInstructionCount) ||
        topLevelInstructionCount < 0 || topLevelInstructionCount > MAX_TOP_LEVEL_INSTRUCTIONS) {
        invalid('CPI_TRACE_REQUEST_INVALID');
    }
    const responseFieldState = innerInstructions === undefined
        ? 'MISSING'
        : innerInstructions === null ? 'NULL' : Array.isArray(innerInstructions) ? 'ARRAY' : invalid('CPI_TRACE_RESPONSE_INVALID');
    if (!recordingRequested || responseFieldState !== 'ARRAY') {
        return unavailable(recordingRequested, responseFieldState, topLevelInstructionCount);
    }
    const rawGroups = exactArray(innerInstructions, 'CPI_TRACE_GROUPS_INVALID', MAX_GROUPS);
    const groups = [];
    const seenIndexes = new Set();
    let previousIndex = -1;
    let nodeCount = 0;
    let partial = false;
    const sourceBudget = { nodes: 0, bytes: 0, active: new Set() };
    const sourceMeasureBudget = { nodes: 0, bytes: 0, active: new Set() };
    const sourceSnapshotBudget = { count: 0 };
    for (const rawGroup of rawGroups) {
        const group = exactDataRecord(rawGroup, ['index', 'instructions'], [], 'CPI_TRACE_GROUP_INVALID');
        const topLevelIndex = group.index;
        if (!Number.isSafeInteger(topLevelIndex) || Number(topLevelIndex) < 0 || Number(topLevelIndex) >= topLevelInstructionCount ||
            Number(topLevelIndex) <= previousIndex || seenIndexes.has(Number(topLevelIndex)))
            invalid('CPI_TRACE_GROUP_ORDER_INVALID');
        seenIndexes.add(Number(topLevelIndex));
        previousIndex = Number(topLevelIndex);
        const rawInstructions = exactArray(group.instructions, 'CPI_TRACE_INSTRUCTIONS_INVALID', MAX_INNER_INSTRUCTIONS);
        if (rawInstructions.length === 0)
            invalid('CPI_TRACE_EMPTY_GROUP_INVALID');
        nodeCount += rawInstructions.length;
        if (nodeCount > MAX_INNER_INSTRUCTIONS)
            invalid('CPI_TRACE_TOO_LARGE');
        const parsedInstructions = rawInstructions.map(instruction => parseInstruction(instruction, sourceBudget, sourceMeasureBudget, sourceSnapshotBudget));
        // This pass proves that every known value can occur in some legal path while
        // leaving missing heights unknown. A reported decrease unwinds deeper frames.
        let reachableMax = 1;
        let groupPartial = false;
        for (const instruction of parsedInstructions) {
            const nextMax = Math.min(MAX_STACK_HEIGHT, reachableMax + 1);
            if (instruction.stackHeight === null) {
                groupPartial = true;
                reachableMax = nextMax;
            }
            else {
                if (instruction.stackHeight > nextMax)
                    invalid('CPI_TRACE_STACK_PATH_INVALID');
                reachableMax = instruction.stackHeight;
            }
        }
        let normalizedInstructions;
        if (groupPartial) {
            partial = true;
            normalizedInstructions = parsedInstructions.map(({ programId, stackHeight, sourceKind, sourceFields, instructionHash }) => ({
                programId, stackHeight, sourceKind, sourceFields, instructionHash,
            }));
        }
        else {
            const stack = new Map();
            normalizedInstructions = parsedInstructions.map(({ programId, stackHeight, sourceKind, sourceFields, instructionHash }, innerIndex) => {
                const height = stackHeight;
                for (const priorHeight of stack.keys())
                    if (priorHeight >= height)
                        stack.delete(priorHeight);
                let parent;
                if (height === 2)
                    parent = { kind: 'TOP_LEVEL', topLevelIndex: Number(topLevelIndex) };
                else {
                    const parentIndex = stack.get(height - 1);
                    if (parentIndex === undefined)
                        invalid('CPI_TRACE_PARENT_UNRESOLVED');
                    parent = { kind: 'INNER', topLevelIndex: Number(topLevelIndex), innerIndex: parentIndex };
                }
                stack.set(height, innerIndex);
                return { programId, stackHeight, sourceKind, sourceFields, instructionHash, parent };
            });
        }
        groups.push({ topLevelIndex: Number(topLevelIndex), instructions: normalizedInstructions });
    }
    return buildTrace(recordingRequested, responseFieldState, topLevelInstructionCount, partial ? 'PARTIAL' : 'STRUCTURALLY_VALID', groups);
}
/** Verify a serialized normalized trace by rebuilding it from its retained sourceFields. */
export function verifyNormalizedCpiTrace(value) {
    try {
        const trace = exactDataRecord(value, ['normalizationVersion', 'status', 'coverage', 'recordingRequested', 'responseFieldState',
            'topLevelInstructionCount', 'groups', 'traceHash'], [], 'CPI_TRACE_CERTIFICATE_INVALID');
        if (trace.normalizationVersion !== 1 ||
            !['UNAVAILABLE', 'PARTIAL', 'STRUCTURALLY_VALID'].includes(String(trace.status)) ||
            trace.coverage !== 'REPORTED_NODES_ONLY' || typeof trace.recordingRequested !== 'boolean' ||
            !['MISSING', 'NULL', 'ARRAY'].includes(String(trace.responseFieldState)) ||
            !Number.isSafeInteger(trace.topLevelInstructionCount) || typeof trace.traceHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(trace.traceHash))
            return false;
        const groups = exactArray(trace.groups, 'CPI_TRACE_GROUPS_INVALID', MAX_GROUPS);
        let aggregateInstructions = 0;
        let normalizedWrapperNodes = 17; // trace object, its eight key/value pairs, and groups array
        const aggregateSourceBudget = { nodes: 0, bytes: 0, active: new Set() };
        // Preflight every group and retained source payload before building any
        // reconstructed instruction arrays. This prevents individually valid groups
        // from multiplying into an unbounded intermediate certificate.
        for (const rawGroup of groups) {
            const group = exactDataRecord(rawGroup, ['topLevelIndex', 'instructions'], [], 'CPI_TRACE_GROUP_INVALID');
            const nodes = exactArray(group.instructions, 'CPI_TRACE_INSTRUCTIONS_INVALID', MAX_INNER_INSTRUCTIONS);
            aggregateInstructions += nodes.length;
            if (aggregateInstructions > MAX_INNER_INSTRUCTIONS)
                invalid('CPI_TRACE_TOO_LARGE');
            normalizedWrapperNodes += 5; // group object, its two key/value pairs, and instruction array
            let groupHasUnknownHeight = false;
            const knownHeights = [];
            for (const rawNode of nodes) {
                const node = exactDataRecord(rawNode, ['programId', 'stackHeight', 'sourceKind', 'sourceFields', 'instructionHash'], ['parent'], 'CPI_TRACE_INSTRUCTION_INVALID');
                const sourceFields = ownDataRecordSnapshot(node.sourceFields, 'CPI_TRACE_SOURCE_FIELDS_INVALID');
                const sourceKind = node.sourceKind;
                if (sourceFields.kind !== sourceKind || sourceFields.programId !== node.programId ||
                    !['PARSED', 'PARTIALLY_DECODED'].includes(String(sourceKind)))
                    invalid('CPI_TRACE_SOURCE_FIELDS_INVALID');
                if (sourceKind === 'PARSED') {
                    exactDataRecord(sourceFields, ['kind', 'parsed', 'program', 'programId'], [], 'CPI_TRACE_SOURCE_FIELDS_INVALID');
                }
                else {
                    exactDataRecord(sourceFields, ['kind', 'accounts', 'data', 'programId'], [], 'CPI_TRACE_SOURCE_FIELDS_INVALID');
                }
                if (node.stackHeight === null)
                    groupHasUnknownHeight = true;
                else if (Number.isSafeInteger(node.stackHeight))
                    knownHeights.push(Number(node.stackHeight));
                else
                    invalid('CPI_TRACE_STACK_HEIGHT_INVALID');
                measureCanonicalBytes(sourceFields, aggregateSourceBudget);
            }
            if (groupHasUnknownHeight)
                normalizedWrapperNodes += nodes.length * 10;
            else
                for (const height of knownHeights)
                    normalizedWrapperNodes += height === 2 ? 16 : 18;
            if (normalizedWrapperNodes + aggregateSourceBudget.nodes > MAX_CANONICAL_NODES)
                invalid('CPI_TRACE_TOO_COMPLEX');
        }
        // Validate the exact hashed preimage, including untrusted parent fields,
        // before rebuilding or canonical encoding can allocate aggregate strings.
        const preimage = {
            normalizationVersion: trace.normalizationVersion,
            status: trace.status,
            coverage: trace.coverage,
            recordingRequested: trace.recordingRequested,
            responseFieldState: trace.responseFieldState,
            topLevelInstructionCount: trace.topLevelInstructionCount,
            groups: trace.groups,
        };
        measureCanonicalBytes(preimage, { nodes: 0, bytes: 0, active: new Set() });
        const rebuiltGroups = groups.map(rawGroup => {
            const group = exactDataRecord(rawGroup, ['topLevelIndex', 'instructions'], [], 'CPI_TRACE_GROUP_INVALID');
            const nodes = exactArray(group.instructions, 'CPI_TRACE_INSTRUCTIONS_INVALID', MAX_INNER_INSTRUCTIONS);
            const instructions = nodes.map(rawNode => {
                const node = exactDataRecord(rawNode, ['programId', 'stackHeight', 'sourceKind', 'sourceFields', 'instructionHash'], ['parent'], 'CPI_TRACE_INSTRUCTION_INVALID');
                const sourceFields = ownDataRecordSnapshot(node.sourceFields, 'CPI_TRACE_SOURCE_FIELDS_INVALID');
                if (node.sourceKind === 'PARSED') {
                    const source = exactDataRecord(sourceFields, ['kind', 'parsed', 'program', 'programId'], [], 'CPI_TRACE_SOURCE_FIELDS_INVALID');
                    return { parsed: source.parsed, program: source.program, programId: source.programId, stackHeight: node.stackHeight };
                }
                const source = exactDataRecord(sourceFields, ['kind', 'accounts', 'data', 'programId'], [], 'CPI_TRACE_SOURCE_FIELDS_INVALID');
                return { accounts: source.accounts, data: source.data, programId: source.programId, stackHeight: node.stackHeight };
            });
            return { index: group.topLevelIndex, instructions };
        });
        const recordingRequested = trace.recordingRequested;
        const responseFieldState = trace.responseFieldState;
        const response = responseFieldState === 'MISSING' ? undefined
            : responseFieldState === 'NULL' ? null : rebuiltGroups;
        const rebuilt = normalizeSimulationCpiTrace(recordingRequested, trace.topLevelInstructionCount, response);
        const { traceHash: _rebuiltHash, ...rebuiltPreimage } = rebuilt;
        return rebuilt.traceHash === trace.traceHash &&
            encodeWithinTraceBudget(rebuiltPreimage) === encodeWithinTraceBudget(preimage);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=cpi-trace-normalizer.js.map