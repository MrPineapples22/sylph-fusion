import { createHash, createPublicKey, verify } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import bs58 from 'bs58';
import { Message, MessageV0, PublicKey } from '@solana/web3.js';
const DEFAULT_MAX_SLOTS = 64;
const HARD_MAX_SLOTS = 256;
const DEFAULT_BLOCK_CONCURRENCY = 4;
const HARD_MAX_BLOCK_CONCURRENCY = 8;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const MAX_META_CANONICAL_NODES = 100_000;
const MAX_META_CANONICAL_BYTES = 2_000_000;
const UNAVAILABLE_STATUSES = new Set([
    'UNAVAILABLE_NULL', 'UNAVAILABLE_RPC_ERROR', 'UNSUPPORTED_TRANSACTION_VERSION',
    'MALFORMED_BLOCK', 'BLOCK_PARENT_MISMATCH', 'HISTORY_PRUNED_OR_UNAVAILABLE', 'NOT_FINALIZED_AT_ENDPOINT',
    'CLUSTER_MISMATCH',
    'RANGE_UNAVAILABLE', 'INVALID_PROVIDER_SLOT_LIST',
]);
function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    try {
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }
    catch {
        return false;
    }
}
function isMessageRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    try {
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null || prototype?.constructor?.name === 'Message' || prototype?.constructor?.name === 'MessageV0';
    }
    catch {
        return false;
    }
}
function errorKind(error) {
    const message = error instanceof Error ? error.message : '';
    return /maxSupportedTransactionVersion|unsupported[^\n]{0,80}transaction[^\n]{0,40}version|transaction[^\n]{0,40}version[^\n]{0,40}not supported/i.test(message)
        ? 'UNSUPPORTED_TRANSACTION_VERSION'
        : 'UNAVAILABLE_RPC_ERROR';
}
function validSlotList(value, startSlot, endSlot) {
    if (!Array.isArray(value))
        return false;
    if (value.length > endSlot - startSlot + 1)
        return false;
    let previous = startSlot - 1;
    for (const slot of value) {
        if (!Number.isSafeInteger(slot) || slot < startSlot || slot > endSlot || slot <= previous)
            return false;
        previous = slot;
    }
    return true;
}
function canonicalRpcJson(value, budget = { nodes: 0, bytes: 0 }, active = new Set(), depth = 0) {
    budget.nodes++;
    if (budget.nodes > MAX_META_CANONICAL_NODES || depth > 32)
        throw new Error('RPC_METADATA_TOO_COMPLEX');
    const append = (text) => {
        budget.bytes += Buffer.byteLength(text, 'utf8');
        if (budget.bytes > MAX_META_CANONICAL_BYTES)
            throw new Error('RPC_METADATA_TOO_LARGE');
        return text;
    };
    if (value === null)
        return append('null');
    if (typeof value === 'boolean')
        return append(value ? 'true' : 'false');
    if (typeof value === 'string')
        return append(JSON.stringify(value));
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('RPC_METADATA_NUMBER_INVALID');
        return append(JSON.stringify(value));
    }
    if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || active.has(value))
        throw new Error('RPC_METADATA_VALUE_INVALID');
    active.add(value);
    try {
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_META_CANONICAL_NODES)
                throw new Error('RPC_METADATA_ARRAY_INVALID');
            const keys = Reflect.ownKeys(value);
            if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' &&
                (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
                throw new Error('RPC_METADATA_ARRAY_INVALID');
            }
            const items = [];
            for (let index = 0; index < value.length; index++) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
                    throw new Error('RPC_METADATA_ARRAY_INVALID');
                items.push(canonicalRpcJson(descriptor.value, budget, active, depth + 1));
            }
            return append(`[${items.join(',')}]`);
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            throw new Error('RPC_METADATA_OBJECT_INVALID');
        const keys = Reflect.ownKeys(value);
        if (keys.length > 4096 || keys.some(key => typeof key !== 'string'))
            throw new Error('RPC_METADATA_OBJECT_INVALID');
        const entries = [];
        for (const key of keys.sort()) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
                throw new Error('RPC_METADATA_OBJECT_INVALID');
            entries.push(`${append(JSON.stringify(key))}:${canonicalRpcJson(descriptor.value, budget, active, depth + 1)}`);
        }
        return append(`{${entries.join(',')}}`);
    }
    finally {
        active.delete(value);
    }
}
function freezeJsonTree(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value))
        return;
    for (const child of Object.values(value))
        freezeJsonTree(child);
    Object.freeze(value);
}
const MAX_TARGETED_CPI_INSTRUCTIONS = 2_048;
const MAX_TARGETED_CPI_ACCOUNT_REFERENCES = 65_536;
const MAX_TARGETED_CPI_TRACE_BYTES = 2_000_000;
function publicKeyString(value) {
    try {
        if (value instanceof PublicKey)
            return value.toBase58();
        if (typeof value === 'string')
            return new PublicKey(value).toBase58();
    }
    catch { /* malformed RPC address */ }
    return null;
}
function unavailableCpi(signature, status, topLevelInstructionCount = 0) {
    return Object.freeze({ signature, status, transactionError: null, transactionOutcome: 'UNAVAILABLE', balanceEvidenceStatus: 'UNAVAILABLE',
        messageSignatureBinding: 'UNAVAILABLE', preBalances: null, postBalances: null, topLevelInstructionCount, innerInstructionCount: 0, instructions: Object.freeze([]) });
}
function balanceArray(value, keyCount) {
    if (!Array.isArray(value) || value.length !== keyCount)
        return null;
    const result = [];
    for (const amount of value) {
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)
            return null;
        result.push(String(amount));
    }
    return result;
}
function verifyFirstSignature(signature, message, messageBytes) {
    try {
        const required = message.header.numRequiredSignatures;
        const signer = message instanceof MessageV0 ? message.staticAccountKeys[0] : message.accountKeys[0];
        if (!Number.isSafeInteger(required) || required < 1 || !signer)
            return 'UNAVAILABLE';
        const signatureBytes = Uint8Array.from(bs58.decode(signature));
        if (signatureBytes.length !== 64 || bs58.encode(signatureBytes) !== signature)
            return 'MISMATCH';
        const publicKey = createPublicKey({
            key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), signer.toBuffer()]),
            format: 'der', type: 'spki',
        });
        return verify(null, messageBytes, publicKey, signatureBytes) ? 'VERIFIED' : 'MISMATCH';
    }
    catch {
        return 'UNAVAILABLE';
    }
}
function extractTransactionCpiEvidence(transaction, signature) {
    if (!isRecord(transaction) || !isRecord(transaction.transaction) || !Array.isArray(transaction.transaction.signatures) ||
        transaction.transaction.signatures[0] !== signature)
        return unavailableCpi(signature, 'NOT_IN_BLOCK');
    if (transaction.meta === null || !isRecord(transaction.meta))
        return unavailableCpi(signature, 'UNAVAILABLE_META');
    const message = transaction.transaction.message;
    if (!(message instanceof Message) && !(message instanceof MessageV0))
        return unavailableCpi(signature, 'UNAVAILABLE_ACCOUNT_KEYS');
    const compiled = message.compiledInstructions;
    if (!Array.isArray(compiled) || compiled.length > 256)
        return unavailableCpi(signature, 'MALFORMED_TRACE');
    let staticKeys;
    let loadedWritable = [];
    let loadedReadonly = [];
    if (message instanceof MessageV0) {
        staticKeys = message.staticAccountKeys;
        const lookups = message.addressTableLookups;
        const loaded = transaction.meta.loadedAddresses;
        const expectedWritable = Array.isArray(lookups) ? lookups.reduce((sum, lookup) => sum + lookup.writableIndexes.length, 0) : -1;
        const expectedReadonly = Array.isArray(lookups) ? lookups.reduce((sum, lookup) => sum + lookup.readonlyIndexes.length, 0) : -1;
        if (expectedWritable < 0 || expectedReadonly < 0)
            return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
        if (expectedWritable + expectedReadonly > 0 && !isRecord(loaded))
            return unavailableCpi(signature, 'UNAVAILABLE_ACCOUNT_KEYS', compiled.length);
        if (loaded !== undefined && loaded !== null) {
            if (!isRecord(loaded) || !Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly) ||
                loaded.writable.length !== expectedWritable || loaded.readonly.length !== expectedReadonly) {
                return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
            }
            loadedWritable = loaded.writable;
            loadedReadonly = loaded.readonly;
        }
    }
    else {
        staticKeys = message.accountKeys;
        if (transaction.meta.loadedAddresses !== undefined && transaction.meta.loadedAddresses !== null) {
            const loaded = transaction.meta.loadedAddresses;
            if (!isRecord(loaded) || !Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly) ||
                loaded.writable.length !== 0 || loaded.readonly.length !== 0)
                return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
        }
    }
    if (!Array.isArray(staticKeys) || staticKeys.length === 0 || staticKeys.length + loadedWritable.length + loadedReadonly.length > 256) {
        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
    }
    const keys = [...staticKeys, ...loadedWritable, ...loadedReadonly].map(publicKeyString);
    if (keys.some(key => key === null))
        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
    const rawGroups = transaction.meta.innerInstructions;
    if (rawGroups === null || rawGroups === undefined)
        return unavailableCpi(signature, 'UNAVAILABLE_TRACE', compiled.length);
    if (!Array.isArray(rawGroups) || rawGroups.length > 256)
        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
    const seenGroups = new Set();
    const instructions = [];
    let accountReferences = 0;
    let partial = false;
    let previousGroup = -1;
    try {
        for (const group of rawGroups) {
            if (!isRecord(group) || typeof group.index !== 'number' || !Number.isSafeInteger(group.index) || group.index < 0 || group.index >= compiled.length ||
                group.index <= previousGroup || seenGroups.has(group.index) || !Array.isArray(group.instructions) || group.instructions.length === 0) {
                return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
            }
            const topIndex = group.index;
            seenGroups.add(topIndex);
            previousGroup = topIndex;
            const parsedGroup = [];
            let reachableMax = 1;
            let partialGroup = false;
            for (const instruction of group.instructions) {
                if (!isRecord(instruction) || typeof instruction.programIdIndex !== 'number' || !Number.isSafeInteger(instruction.programIdIndex) || instruction.programIdIndex < 0 ||
                    instruction.programIdIndex >= keys.length || !Array.isArray(instruction.accounts) || instruction.accounts.length > 256 ||
                    !instruction.accounts.every(index => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < keys.length) ||
                    typeof instruction.data !== 'string' || instruction.data.length > 200_000) {
                    return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
                }
                accountReferences += instruction.accounts.length;
                if (accountReferences > MAX_TARGETED_CPI_ACCOUNT_REFERENCES || instructions.length + parsedGroup.length >= MAX_TARGETED_CPI_INSTRUCTIONS) {
                    return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
                }
                let data;
                try {
                    data = Buffer.from(bs58.decode(instruction.data));
                    if (bs58.encode(data) !== instruction.data)
                        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
                }
                catch {
                    return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
                }
                const rawHeight = instruction.stackHeight;
                const height = rawHeight === null || rawHeight === undefined ? null : typeof rawHeight === 'number' ? rawHeight : NaN;
                if (height === null) {
                    partialGroup = true;
                    reachableMax = Math.min(32, reachableMax + 1);
                }
                else {
                    if (!Number.isSafeInteger(height) || height < 2 || height > 32 || height > Math.min(32, reachableMax + 1)) {
                        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
                    }
                    reachableMax = height;
                }
                parsedGroup.push({
                    topLevelInstructionIndex: topIndex,
                    innerInstructionIndex: parsedGroup.length,
                    programId: keys[instruction.programIdIndex],
                    accountKeys: Object.freeze(instruction.accounts.map((index) => keys[index])),
                    dataSha256: createHash('sha256').update(data).digest('hex'),
                    stackHeight: height,
                    parent: null,
                });
            }
            if (partialGroup)
                partial = true;
            else {
                const stack = new Map();
                for (const node of parsedGroup) {
                    const height = node.stackHeight;
                    for (const priorHeight of stack.keys())
                        if (priorHeight >= height)
                            stack.delete(priorHeight);
                    const parent = height === 2
                        ? { kind: 'TOP_LEVEL', topLevelInstructionIndex: topIndex }
                        : stack.has(height - 1)
                            ? { kind: 'INNER', topLevelInstructionIndex: topIndex, innerInstructionIndex: stack.get(height - 1) }
                            : null;
                    if (!parent)
                        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
                    Object.assign(node, { parent });
                    stack.set(height, node.innerInstructionIndex);
                }
            }
            instructions.push(...parsedGroup);
        }
        const status = partial ? 'PARTIAL' : 'STRUCTURALLY_VALID';
        for (const instruction of instructions)
            if (instruction.parent)
                Object.freeze(instruction.parent);
        for (const instruction of instructions)
            Object.freeze(instruction);
        const hasTransactionError = Object.prototype.hasOwnProperty.call(transaction.meta, 'err');
        const transactionError = hasTransactionError ? JSON.parse(canonicalRpcJson(transaction.meta.err)) : null;
        if (hasTransactionError)
            freezeJsonTree(transactionError);
        const transactionOutcome = !hasTransactionError ? 'UNAVAILABLE'
            : transactionError === null ? 'REPORTED_SUCCESS' : 'REPORTED_FAILURE';
        const messageBytes = message.serialize();
        const preBalances = balanceArray(transaction.meta.preBalances, keys.length);
        const postBalances = balanceArray(transaction.meta.postBalances, keys.length);
        const balanceEvidenceStatus = (transaction.meta.preBalances === undefined || transaction.meta.preBalances === null || transaction.meta.postBalances === undefined || transaction.meta.postBalances === null)
            ? 'UNAVAILABLE'
            : preBalances && postBalances ? 'AVAILABLE' : 'MALFORMED';
        const tokenBalanceEvidenceSha256 = createHash('sha256').update(canonicalRpcJson({
            preTokenBalances: Object.prototype.hasOwnProperty.call(transaction.meta, 'preTokenBalances') ? transaction.meta.preTokenBalances : { state: 'MISSING' },
            postTokenBalances: Object.prototype.hasOwnProperty.call(transaction.meta, 'postTokenBalances') ? transaction.meta.postTokenBalances : { state: 'MISSING' },
        }), 'utf8').digest('hex');
        const trace = {
            signature, status,
            transactionError,
            transactionOutcome,
            messageSha256: createHash('sha256').update(messageBytes).digest('hex'),
            messageSignatureBinding: verifyFirstSignature(signature, message, messageBytes),
            accountKeys: Object.freeze(keys),
            balanceEvidenceStatus,
            preBalances: balanceEvidenceStatus === 'AVAILABLE' ? Object.freeze(preBalances) : null,
            postBalances: balanceEvidenceStatus === 'AVAILABLE' ? Object.freeze(postBalances) : null,
            tokenBalanceEvidenceSha256,
            topLevelInstructionCount: compiled.length,
            innerInstructionCount: instructions.length, instructions,
        };
        const traceBytes = canonicalRpcJson(trace);
        if (Buffer.byteLength(traceBytes, 'utf8') > MAX_TARGETED_CPI_TRACE_BYTES)
            return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
        return Object.freeze({ ...trace, instructions: Object.freeze(instructions),
            traceHash: createHash('sha256').update(traceBytes, 'utf8').digest('hex') });
    }
    catch {
        return unavailableCpi(signature, 'MALFORMED_TRACE', compiled.length);
    }
}
function inspectBlock(value, transactionSignature) {
    if (!isRecord(value) || typeof value.blockhash !== 'string' || value.blockhash.length < 32 || value.blockhash.length > 44 || !BASE58.test(value.blockhash) ||
        typeof value.previousBlockhash !== 'string' || value.previousBlockhash.length < 32 || value.previousBlockhash.length > 44 || !BASE58.test(value.previousBlockhash) ||
        !Number.isSafeInteger(value.parentSlot) || value.parentSlot < 0 || !Array.isArray(value.transactions)) {
        return { status: 'MALFORMED_BLOCK' };
    }
    const signatures = [];
    const metadataHasher = createHash('sha256');
    let nullMetaCount = 0;
    let metadataTransactionCount = 0;
    let targetedTransactionCpi;
    for (const item of value.transactions) {
        // web3.js converts RPC message JSON into Message/MessageV0 instances before returning a block.
        if (!isRecord(item) || !isRecord(item.transaction) || !isMessageRecord(item.transaction.message) || !Array.isArray(item.transaction.signatures)) {
            return { status: 'MALFORMED_BLOCK' };
        }
        const version = item.version === undefined ? 'legacy' : item.version;
        if (version !== 'legacy' && version !== 0) {
            if (typeof version === 'number' && Number.isSafeInteger(version) && version > 0)
                return { status: 'UNSUPPORTED_TRANSACTION_VERSION' };
            return { status: 'MALFORMED_BLOCK' };
        }
        if (!item.transaction.signatures.every(signature => typeof signature === 'string' && signature.length >= 87 && signature.length <= 88 && BASE58.test(signature))) {
            return { status: 'MALFORMED_BLOCK' };
        }
        if (transactionSignature && item.transaction.signatures[0] === transactionSignature) {
            if (targetedTransactionCpi)
                return { status: 'MALFORMED_BLOCK' };
            targetedTransactionCpi = extractTransactionCpiEvidence(item, transactionSignature);
        }
        if (item.meta === null)
            nullMetaCount++;
        else if (!isRecord(item.meta))
            return { status: 'MALFORMED_BLOCK' };
        else {
            try {
                const canonicalMeta = canonicalRpcJson(item.meta);
                const row = JSON.stringify([item.transaction.signatures, version, canonicalMeta]);
                metadataHasher.update(`${Buffer.byteLength(row, 'utf8')}:${row}\n`, 'utf8');
                metadataTransactionCount++;
            }
            catch {
                return { status: 'MALFORMED_BLOCK' };
            }
        }
        signatures.push({ signatures: [...item.transaction.signatures], version });
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
        blockhash: value.blockhash,
        previousBlockhash: value.previousBlockhash,
        parentSlot: value.parentSlot,
        transactions: signatures,
    })).digest('hex');
    return {
        status: nullMetaCount > 0 ? 'AVAILABLE_WITH_NULL_META' : 'AVAILABLE',
        fingerprint,
        ...(nullMetaCount === 0 ? { transactionMetadataFingerprint: metadataHasher.digest('hex') } : {}),
        metadataTransactionCount,
        ...(transactionSignature ? { targetedTransactionCpi: targetedTransactionCpi ?? unavailableCpi(transactionSignature, 'NOT_IN_BLOCK') } : {}),
        blockhash: value.blockhash,
        previousBlockhash: value.previousBlockhash,
        parentSlot: value.parentSlot,
        transactionCount: signatures.length,
        nullMetaCount,
    };
}
async function mapBounded(items, concurrency, mapper) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length)
                return;
            results[index] = await mapper(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
function createSemaphore(limit) {
    let active = 0;
    const waiters = [];
    return async (task) => {
        let permitTransferred = false;
        if (active >= limit) {
            await new Promise(resolve => waiters.push(resolve));
            permitTransferred = true;
        }
        if (!permitTransferred)
            active++;
        try {
            return await task();
        }
        finally {
            const next = waiters.shift();
            if (next)
                next();
            else
                active--;
        }
    };
}
async function auditProvider(provider, slots, startSlot, endSlot, concurrency, withBlockPermit, transactionSignature) {
    const boundedByRetentionAndFinality = new Map();
    let genesisHash;
    let finalizedSlot;
    let firstAvailableBlock;
    try {
        [genesisHash, finalizedSlot, firstAvailableBlock] = await Promise.all([
            provider.getGenesisHash(),
            provider.getFinalizedSlot(),
            provider.getFirstAvailableBlock(),
        ]);
    }
    catch {
        return {
            providerId: provider.providerId,
            rangeStatus: 'UNAVAILABLE',
            observations: slots.map(slot => ({ slot, status: 'RANGE_UNAVAILABLE' })),
        };
    }
    if (genesisHash !== MAINNET_GENESIS_HASH) {
        return {
            providerId: provider.providerId,
            rangeStatus: 'INVALID_RESPONSE',
            observations: slots.map(slot => ({ slot, status: 'CLUSTER_MISMATCH' })),
        };
    }
    if (!Number.isSafeInteger(finalizedSlot) || finalizedSlot < 0 ||
        !Number.isSafeInteger(firstAvailableBlock) || firstAvailableBlock < 0 ||
        firstAvailableBlock > finalizedSlot) {
        return {
            providerId: provider.providerId,
            rangeStatus: 'INVALID_RESPONSE',
            observations: slots.map(slot => ({ slot, status: 'RANGE_UNAVAILABLE' })),
        };
    }
    const finalizedThrough = Math.min(endSlot, finalizedSlot);
    const queryStart = Math.max(startSlot, firstAvailableBlock);
    const canQuery = queryStart <= finalizedThrough;
    const eligibleSlots = canQuery ? slots.filter(slot => slot >= queryStart && slot <= finalizedThrough) : [];
    for (const slot of slots) {
        if (slot < firstAvailableBlock)
            boundedByRetentionAndFinality.set(slot, 'HISTORY_PRUNED_OR_UNAVAILABLE');
        else if (slot > finalizedSlot)
            boundedByRetentionAndFinality.set(slot, 'NOT_FINALIZED_AT_ENDPOINT');
    }
    if (eligibleSlots.length === 0) {
        return {
            providerId: provider.providerId,
            rangeStatus: 'READ',
            observations: slots.map(slot => ({ slot, status: boundedByRetentionAndFinality.get(slot) ?? 'RANGE_UNAVAILABLE' })),
        };
    }
    let listedSlots;
    try {
        listedSlots = await provider.getBlocks(queryStart, finalizedThrough, 'finalized');
    }
    catch {
        return {
            providerId: provider.providerId,
            rangeStatus: 'UNAVAILABLE',
            observations: slots.map(slot => ({ slot, status: boundedByRetentionAndFinality.get(slot) ?? 'RANGE_UNAVAILABLE' })),
        };
    }
    if (!validSlotList(listedSlots, queryStart, finalizedThrough)) {
        return {
            providerId: provider.providerId,
            rangeStatus: 'INVALID_RESPONSE',
            observations: slots.map(slot => ({ slot, status: boundedByRetentionAndFinality.get(slot) ?? 'INVALID_PROVIDER_SLOT_LIST' })),
        };
    }
    const listed = new Set(listedSlots);
    const observations = await mapBounded(eligibleSlots, concurrency, async (slot) => {
        if (!listed.has(slot))
            return { slot, status: 'SKIPPED_BY_GETBLOCKS' };
        let block;
        try {
            block = await withBlockPermit(() => provider.getBlock(slot, {
                commitment: 'finalized',
                maxSupportedTransactionVersion: 0,
                transactionDetails: 'full',
                rewards: false,
            }));
        }
        catch (error) {
            return { slot, status: errorKind(error) };
        }
        if (block === null)
            return { slot, status: 'UNAVAILABLE_NULL' };
        const inspected = inspectBlock(block, transactionSignature);
        if (!('fingerprint' in inspected)) {
            return { slot, status: inspected.status };
        }
        if (inspected.parentSlot >= slot)
            return { slot, status: 'MALFORMED_BLOCK' };
        return {
            slot,
            status: inspected.status,
            blockFingerprint: inspected.fingerprint,
            blockhash: inspected.blockhash,
            previousBlockhash: inspected.previousBlockhash,
            parentSlot: inspected.parentSlot,
            transactionCount: inspected.transactionCount,
            nullMetaCount: inspected.nullMetaCount,
            ...(inspected.transactionMetadataFingerprint ? { transactionMetadataFingerprint: inspected.transactionMetadataFingerprint } : {}),
            metadataTransactionCount: inspected.metadataTransactionCount,
            ...(inspected.targetedTransactionCpi ? { targetedTransactionCpi: inspected.targetedTransactionCpi } : {}),
        };
    });
    let finalFinalizedSlot;
    let finalFirstAvailableBlock;
    let boundsRecheckSucceeded = false;
    try {
        [finalFinalizedSlot, finalFirstAvailableBlock] = await Promise.all([
            provider.getFinalizedSlot(),
            provider.getFirstAvailableBlock(),
        ]);
        boundsRecheckSucceeded = Number.isSafeInteger(finalFinalizedSlot) && finalFinalizedSlot >= 0 &&
            Number.isSafeInteger(finalFirstAvailableBlock) && finalFirstAvailableBlock >= 0 &&
            finalFirstAvailableBlock <= finalFinalizedSlot;
    }
    catch {
        // Returned blocks remain observations, but omissions are no longer safely classifiable.
    }
    const bySlot = new Map(observations.map(observation => [observation.slot, observation]));
    for (const slot of eligibleSlots) {
        const observation = bySlot.get(slot);
        if (observation?.status === 'SKIPPED_BY_GETBLOCKS') {
            if (!boundsRecheckSucceeded)
                bySlot.set(slot, { slot, status: 'RANGE_UNAVAILABLE' });
            else if (slot < finalFirstAvailableBlock)
                bySlot.set(slot, { slot, status: 'HISTORY_PRUNED_OR_UNAVAILABLE' });
            else if (slot > finalFinalizedSlot)
                bySlot.set(slot, { slot, status: 'NOT_FINALIZED_AT_ENDPOINT' });
        }
        if (observation && (observation.status === 'AVAILABLE' || observation.status === 'AVAILABLE_WITH_NULL_META') &&
            boundsRecheckSucceeded && (slot < finalFirstAvailableBlock || slot > finalFinalizedSlot)) {
            bySlot.set(slot, { slot, status: 'RANGE_UNAVAILABLE' });
        }
    }
    for (let index = 1; index < listedSlots.length; index++) {
        const previousSlot = listedSlots[index - 1];
        const currentSlot = listedSlots[index];
        const previous = bySlot.get(previousSlot);
        const current = bySlot.get(currentSlot);
        const previousAvailable = previous?.status === 'AVAILABLE' || previous?.status === 'AVAILABLE_WITH_NULL_META';
        const currentAvailable = current?.status === 'AVAILABLE' || current?.status === 'AVAILABLE_WITH_NULL_META';
        if (previousAvailable && currentAvailable &&
            (current.parentSlot !== previousSlot || current.previousBlockhash !== previous.blockhash)) {
            bySlot.set(currentSlot, { ...current, status: 'BLOCK_PARENT_MISMATCH' });
        }
    }
    return {
        providerId: provider.providerId,
        rangeStatus: 'READ',
        observations: slots.map(slot => bySlot.get(slot) ?? {
            slot,
            status: boundedByRetentionAndFinality.get(slot) ?? 'RANGE_UNAVAILABLE',
        }),
    };
}
/**
 * Read-only, bounded comparison of finalized getBlocks/getBlock observations.
 * Omitted getBlocks slots are labeled according to Solana's documented skipped-slot semantics;
 * the response itself is still an unauthenticated provider assertion and never a certificate.
 */
export async function auditFinalizedBlockRange(providers, startSlot, endSlot, options = {}) {
    const maxSlots = options.maxSlots ?? DEFAULT_MAX_SLOTS;
    const concurrency = options.blockConcurrency ?? DEFAULT_BLOCK_CONCURRENCY;
    const transactionSignature = options.transactionSignature;
    if (!Number.isSafeInteger(startSlot) || startSlot < 0 || !Number.isSafeInteger(endSlot) || endSlot < startSlot ||
        !Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > HARD_MAX_SLOTS || endSlot - startSlot + 1 > maxSlots ||
        !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > HARD_MAX_BLOCK_CONCURRENCY ||
        !Array.isArray(providers) || providers.length < 1 || providers.length > 16 ||
        (transactionSignature !== undefined && (typeof transactionSignature !== 'string' || transactionSignature.length < 87 ||
            transactionSignature.length > 88 || !BASE58.test(transactionSignature)))) {
        throw new Error('FINALIZED_BLOCK_AUDIT_INPUT_INVALID');
    }
    const providerIds = providers.map(provider => provider?.providerId);
    if (providerIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 128) || new Set(providerIds).size !== providers.length ||
        providers.some(provider => typeof provider?.getGenesisHash !== 'function' || typeof provider?.getFinalizedSlot !== 'function' ||
            typeof provider?.getFirstAvailableBlock !== 'function' || typeof provider?.getBlocks !== 'function' || typeof provider?.getBlock !== 'function')) {
        throw new Error('FINALIZED_BLOCK_AUDIT_PROVIDER_INVALID');
    }
    const slots = Array.from({ length: endSlot - startSlot + 1 }, (_, index) => startSlot + index);
    const startedAtMs = Date.now();
    const withBlockPermit = createSemaphore(concurrency);
    const providerAudits = await Promise.all(providers.map(provider => auditProvider(provider, slots, startSlot, endSlot, concurrency, withBlockPermit, transactionSignature)));
    const comparisons = slots.map(slot => {
        const observations = providerAudits.map(provider => ({
            providerId: provider.providerId,
            observation: provider.observations[slot - startSlot],
        }));
        const available = observations.filter(({ observation }) => observation.status === 'AVAILABLE' || observation.status === 'AVAILABLE_WITH_NULL_META');
        const skipped = observations.filter(({ observation }) => observation.status === 'SKIPPED_BY_GETBLOCKS');
        const unavailable = observations.filter(({ observation }) => UNAVAILABLE_STATUSES.has(observation.status));
        const fingerprints = [...new Set(available.map(({ observation }) => observation.blockFingerprint))].sort();
        const hasNullMetadata = available.some(({ observation }) => observation.status === 'AVAILABLE_WITH_NULL_META');
        const completeMetadata = available.filter(({ observation }) => observation.nullMetaCount === 0 &&
            observation.metadataTransactionCount === observation.transactionCount && typeof observation.transactionMetadataFingerprint === 'string');
        const transactionMetadataFingerprints = [...new Set(completeMetadata.map(({ observation }) => observation.transactionMetadataFingerprint))].sort();
        const transactionMetadataStatus = completeMetadata.length === 0
            ? 'UNAVAILABLE'
            : completeMetadata.length !== available.length || completeMetadata.length !== providers.length
                ? 'PARTIAL'
                : transactionMetadataFingerprints.length > 1 ? 'DISAGREEMENT'
                    : providers.length === 1 ? 'SINGLE_ENDPOINT_OBSERVATION' : 'MATCHED_CONFIGURED_ENDPOINTS';
        const targetedCpiEvidence = observations.map(({ observation }) => observation.targetedTransactionCpi).filter((item) => item !== undefined);
        const targetedCpiAvailable = targetedCpiEvidence.filter(item => item.status === 'STRUCTURALLY_VALID' || item.status === 'PARTIAL');
        const targetedTransactionCpiFingerprints = [...new Set(targetedCpiAvailable.map(item => item.traceHash).filter((value) => Boolean(value)))].sort();
        const targetedTransactionCpiStatus = transactionSignature === undefined
            ? 'NOT_REQUESTED'
            : targetedCpiEvidence.length > 0 && targetedCpiEvidence.every(item => item.status === 'NOT_IN_BLOCK')
                ? 'NOT_IN_BLOCK'
                : targetedCpiAvailable.length === 0 ? 'UNAVAILABLE'
                    : targetedCpiEvidence.length !== providers.length || targetedCpiAvailable.length !== providers.length ||
                        targetedCpiAvailable.some(item => item.status !== 'STRUCTURALLY_VALID') ? 'PARTIAL'
                        : targetedTransactionCpiFingerprints.length > 1 ? 'DISAGREEMENT'
                            : providers.length === 1 ? 'SINGLE_ENDPOINT_OBSERVATION' : 'MATCHED_CONFIGURED_ENDPOINTS';
        let status;
        if (available.length === 0 && skipped.length === providers.length)
            status = 'SKIPPED_CONFIGURED_ENDPOINTS';
        else if (available.length === 0)
            status = 'NO_BLOCK_EVIDENCE';
        else if (fingerprints.length > 1 || transactionMetadataStatus === 'DISAGREEMENT' || targetedTransactionCpiStatus === 'DISAGREEMENT' || skipped.length > 0)
            status = 'DISAGREEMENT';
        else if (unavailable.length > 0 || available.length !== providers.length || hasNullMetadata || targetedTransactionCpiStatus === 'PARTIAL')
            status = 'PARTIAL';
        else if (providers.length === 1)
            status = 'SINGLE_ENDPOINT_OBSERVATION';
        else
            status = 'MATCHED_CONFIGURED_ENDPOINTS';
        return {
            slot,
            status,
            availableProviderIds: available.map(({ providerId }) => providerId),
            unavailableProviderIds: unavailable.map(({ providerId }) => providerId),
            skippedProviderIds: skipped.map(({ providerId }) => providerId),
            fingerprints,
            transactionMetadataStatus,
            transactionMetadataFingerprints,
            targetedTransactionCpiStatus,
            targetedTransactionCpiFingerprints,
        };
    });
    return {
        schemaVersion: 1,
        startSlot,
        endSlot,
        requestedCommitment: 'finalized',
        ...(transactionSignature ? { transactionSignature } : {}),
        startedAtMs,
        completedAtMs: Date.now(),
        configuredEndpointCount: providers.length,
        providerAudits,
        comparisons,
        authorityEligible: false,
        limitations: [
            'RPC observations, mainnet genesis identity, finalized watermark, and first-available-block boundary are endpoint assertions; labels do not authenticate operators or establish independent infrastructure.',
            'getBlocks omissions are classified as skipped only inside endpoint-reported retained/finalized bounds that remain stable across the read; no cryptographic range-completeness proof is computed.',
            'Block fingerprints compare reported blockhash, parent linkage, and ordered transaction signatures/version; transaction-metadata fingerprints separately compare canonical RPC-reported meta bytes when all transaction metadata is present. Signature-targeted evidence binds the provider-decoded message hash, verifies the reported first Ed25519 signature against the first required signer and decoded message, and records runtime account-key order, balance arrays, token-balance metadata digest, and CPI trace. This proves only signature/message consistency for the provider-decoded pair; it does not authenticate the RPC block membership, finality, metadata, or independent reconciliation. Unsafe/incomplete lamport arrays remain unavailable, and token-balance rows are committed as reported rather than interpreted as wallet deltas.',
            'This audit emits no RecoveryCertificate and cannot resolve ingestion gaps or advance a coverage frontier.',
            'The pinned web3.js decoder supports legacy/v0 only here; unsupported newer transaction versions remain unavailable.',
        ],
    };
}
//# sourceMappingURL=finalized-block-auditor.js.map