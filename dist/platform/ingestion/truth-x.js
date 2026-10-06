/**
 * SYLPH FUSION — SOL AGENT 1: SOLANA DATA / TRUTH ENGINE (TRUTH-X)
 * Specifications: Sections 3 (Sol Agent 1), 7 (Four Truth Classes), 8 (Canonical Economic Event Reconstruction),
 * 33 (Context Coherence), 34 (Provider Consensus).
 *
 * Implements:
 * 1. TXV1-TRUTH-X: Legacy, V0, and V1 Solana transaction decoder with fail-closed unknown version handling.
 * 2. ECONOMIC-DELTA-X: Net token and lamport balance delta extractor, fee splits, and balance drain detection.
 * 3. PARSER-CANARY-X: Synthetic and historical parser canaries detecting on-chain ABI or program layout drift.
 * 4. COMMITMENT-LADDER-X: Processed -> Confirmed -> Finalized progression tracking with strict safety fences.
 * 5. FORK-REVERSAL-X: Fork reorg tracking, bank tree lineage, and state rollback on abandoned forks.
 * 6. SLOT-CAUSAL-CLOCK-X: Monotonic causal slot clock enforcing state skew budget.
 * 7. PROVIDER-TRUST-LEDGER-X & EVIDENCE-QUORUM-X: Dynamic provider scoring and Byzantine quorum consensus.
 */
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
export class TruthClassificationValidator {
    static validateClass(obj, expected) {
        if (obj.truthClass !== expected) {
            throw new Error(`TRUTH_CLASS_VIOLATION: Expected ${expected} but received ${obj.truthClass}. Derived intelligence must never masquerade as chain truth.`);
        }
    }
    static isChainTruth(obj) {
        return obj.truthClass === 'CHAIN_TRUTH';
    }
}
export class TxV1TruthEngine {
    static decodeTransaction(raw) {
        let versionTag = 'UNKNOWN';
        if (raw.version === undefined || raw.version === 'legacy') {
            versionTag = 'LEGACY';
        }
        else if (raw.version === 0) {
            versionTag = 'V0';
        }
        else if (raw.version === 1) {
            versionTag = 'V1';
        }
        else {
            // Invariant: Fail-closed on unknown transaction versions (Section 8)
            throw new Error(`TXV1_TRUTH_UNKNOWN_VERSION: Unknown transaction version ${String(raw.version)}. Refusing to decode.`);
        }
        if (!Number.isSafeInteger(raw.slot) || raw.slot < 0)
            throw new Error('TXV1_TRUTH_INVALID_SLOT');
        if (typeof raw.signature !== 'string' || raw.signature.length === 0)
            throw new Error('TXV1_TRUTH_INVALID_SIGNATURE');
        if (!(raw.rawMessageBytes instanceof Uint8Array) || raw.rawMessageBytes.byteLength === 0) {
            throw new Error('TXV1_TRUTH_RAW_MESSAGE_REQUIRED');
        }
        const accounts = [...raw.accountKeys];
        if (accounts.length === 0 || accounts.some(key => typeof key !== 'string' || key.length === 0)) {
            throw new Error('TXV1_TRUTH_INVALID_ACCOUNT_KEYS');
        }
        const instructions = [];
        const innerGroups = raw.innerInstructions ?? null;
        let innerInstructionTraceStatus = 'UNAVAILABLE';
        if (innerGroups !== null) {
            if (!Array.isArray(innerGroups) || innerGroups.length > 256)
                throw new Error('TXV1_TRUTH_INVALID_INNER_GROUPS');
            const validatedInnerGroups = innerGroups;
            const seenGroupIndexes = new Set();
            let innerInstructionCount = 0;
            let allStackHeightsKnown = true;
            for (const group of validatedInnerGroups) {
                if (!group || !Number.isSafeInteger(group.index) || group.index < 0 || group.index >= raw.compiledInstructions.length ||
                    seenGroupIndexes.has(group.index) || !Array.isArray(group.instructions)) {
                    throw new Error('TXV1_TRUTH_INVALID_INNER_GROUP');
                }
                seenGroupIndexes.add(group.index);
                innerInstructionCount += group.instructions.length;
                if (innerInstructionCount > 16_384)
                    throw new Error('TXV1_TRUTH_INNER_TRACE_TOO_LARGE');
                for (const inner of group.instructions) {
                    const height = inner?.stackHeight;
                    if (height === undefined || height === null) {
                        allStackHeightsKnown = false;
                    }
                    else if (!Number.isSafeInteger(height) || height < 2 || height > 32) {
                        throw new Error('TXV1_TRUTH_INVALID_INNER_STACK_HEIGHT');
                    }
                }
            }
            innerInstructionTraceStatus = allStackHeightsKnown ? 'COMPLETE' : 'PARTIAL';
        }
        const resolveIndex = (index, kind) => {
            if (!Number.isSafeInteger(index) || index < 0 || index >= accounts.length) {
                throw new Error(`TXV1_TRUTH_INVALID_${kind}_INDEX: ${String(index)}`);
            }
            return accounts[index];
        };
        const decodeData = (instruction) => {
            const supplied = [instruction.data !== undefined, instruction.dataBase58 !== undefined, instruction.dataHex !== undefined].filter(Boolean).length;
            if (supplied > 1)
                throw new Error('TXV1_TRUTH_AMBIGUOUS_INSTRUCTION_DATA');
            if (instruction.data !== undefined) {
                if (!(instruction.data instanceof Uint8Array))
                    throw new Error('TXV1_TRUTH_INVALID_INSTRUCTION_DATA');
                return Uint8Array.from(instruction.data);
            }
            if (instruction.dataBase58 !== undefined) {
                try {
                    return Uint8Array.from(bs58.decode(instruction.dataBase58));
                }
                catch {
                    throw new Error('TXV1_TRUTH_INVALID_BASE58_INSTRUCTION_DATA');
                }
            }
            if (instruction.dataHex !== undefined) {
                if (instruction.dataHex.length % 2 !== 0 || !/^(?:[0-9a-fA-F]{2})*$/.test(instruction.dataHex)) {
                    throw new Error('TXV1_TRUTH_INVALID_HEX_INSTRUCTION_DATA');
                }
                return Uint8Array.from(Buffer.from(instruction.dataHex, 'hex'));
            }
            throw new Error('TXV1_TRUTH_INSTRUCTION_DATA_MISSING');
        };
        // Validate instruction indices first
        for (const ci of raw.compiledInstructions) {
            resolveIndex(ci.programIdIndex, 'PROGRAM');
            for (const idx of ci.accountIndices) {
                resolveIndex(idx, 'ACCOUNT');
            }
        }
        if (!raw.meta || !Object.prototype.hasOwnProperty.call(raw.meta, 'err') || raw.meta.err === undefined) {
            throw new Error('TXV1_TRUTH_TRANSACTION_OUTCOME_UNKNOWN');
        }
        const feeValue = raw.meta?.fee ?? raw.feeLamports;
        if ((typeof feeValue !== 'bigint' && (typeof feeValue !== 'number' || !Number.isSafeInteger(feeValue))) || feeValue < 0) {
            throw new Error('TXV1_TRUTH_FEE_EVIDENCE_REQUIRED_OR_INVALID');
        }
        for (let i = 0; i < raw.compiledInstructions.length; i++) {
            const ci = raw.compiledInstructions[i];
            const programId = resolveIndex(ci.programIdIndex, 'PROGRAM');
            const instrAccounts = ci.accountIndices.map(idx => resolveIndex(idx, 'ACCOUNT'));
            const data = decodeData(ci);
            // Find inner instructions for this top-level instruction
            const innerGroup = raw.innerInstructions?.find(ig => ig.index === i);
            const innerList = [];
            if (innerGroup) {
                for (const inner of innerGroup.instructions) {
                    innerList.push({
                        programId: resolveIndex(inner.programIdIndex, 'INNER_PROGRAM'),
                        accounts: inner.accountIndices.map(idx => resolveIndex(idx, 'INNER_ACCOUNT')),
                        data: decodeData(inner),
                        stackHeight: inner.stackHeight ?? null,
                    });
                }
            }
            instructions.push({
                programId,
                accounts: instrAccounts,
                data,
                innerInstructions: innerList.length > 0 ? innerList : undefined,
            });
        }
        const rawMessageBytes = Uint8Array.from(raw.rawMessageBytes);
        const messageHash = createHash('sha256').update(rawMessageBytes).digest('hex');
        return {
            signature: raw.signature,
            version: versionTag,
            slot: raw.slot,
            blockTimeMs: raw.blockTimeMs,
            feeLamports: BigInt(feeValue),
            accounts,
            instructions,
            innerInstructionTraceStatus,
            rawMessageBytes,
            messageHash,
            isSuccess: raw.meta.err === null,
            err: raw.meta.err === null ? undefined : String(raw.meta.err),
        };
    }
}
export class EconomicDeltaEngine {
    static calculateDeltas(input) {
        const priorityFeeLamports = input.priorityFeeLamports ?? 0n;
        if (input.feeLamports < 0n || (input.priorityFeeLamports !== undefined && (priorityFeeLamports < 0n || priorityFeeLamports > input.feeLamports)) ||
            (input.feeBurnedLamports !== undefined && (input.feeBurnedLamports < 0n || input.feeBurnedLamports > input.feeLamports))) {
            throw new Error('ECONOMIC_DELTA_INVALID_FEE_COMPONENTS');
        }
        const lamportDeltas = [];
        const preLamportMap = new Map();
        for (const pre of input.preBalances) {
            if (preLamportMap.has(pre.account) || pre.lamports < 0n)
                throw new Error('ECONOMIC_DELTA_INVALID_PRE_BALANCES');
            preLamportMap.set(pre.account, pre.lamports);
        }
        const postLamportMap = new Map();
        for (const pb of input.postBalances) {
            if (postLamportMap.has(pb.account) || pb.lamports < 0n)
                throw new Error('ECONOMIC_DELTA_INVALID_POST_BALANCES');
            postLamportMap.set(pb.account, pb.lamports);
        }
        for (const account of new Set([...preLamportMap.keys(), ...postLamportMap.keys()])) {
            const pre = preLamportMap.get(account) ?? 0n;
            const post = postLamportMap.get(account) ?? 0n;
            const delta = post - pre;
            if (delta !== 0n) {
                lamportDeltas.push({ account, preLamports: pre, postLamports: post, delta });
            }
        }
        const tokenDeltas = [];
        const tokenKey = (account, mint) => JSON.stringify([account, mint]);
        const preTokenMap = new Map();
        for (const pre of input.preTokenBalances) {
            const key = tokenKey(pre.account, pre.mint);
            if (preTokenMap.has(key) || pre.amount < 0n)
                throw new Error('ECONOMIC_DELTA_INVALID_PRE_TOKEN_BALANCES');
            preTokenMap.set(key, pre);
        }
        const postTokenMap = new Map();
        for (const pt of input.postTokenBalances) {
            const key = tokenKey(pt.account, pt.mint);
            if (postTokenMap.has(key) || pt.amount < 0n)
                throw new Error('ECONOMIC_DELTA_INVALID_POST_TOKEN_BALANCES');
            postTokenMap.set(key, pt);
        }
        for (const key of new Set([...preTokenMap.keys(), ...postTokenMap.keys()])) {
            const pre = preTokenMap.get(key);
            const post = postTokenMap.get(key);
            if (pre && post && pre.owner !== post.owner)
                throw new Error('ECONOMIC_DELTA_TOKEN_OWNER_CHANGED');
            const identity = pre ?? post;
            const preAmount = pre?.amount ?? 0n;
            const postAmount = post?.amount ?? 0n;
            const delta = postAmount - preAmount;
            if (delta !== 0n) {
                tokenDeltas.push({ account: identity.account, owner: identity.owner, mint: identity.mint, preAmount, postAmount, delta });
            }
        }
        return {
            signature: input.signature,
            slot: input.slot,
            tokenDeltas,
            lamportDeltas,
            feeBurnedLamports: input.feeBurnedLamports,
            priorityFeeLamports: input.priorityFeeLamports,
            tradeAttribution: 'UNKNOWN',
        };
    }
}
export class ParserCanaryEngine {
    static registeredCanaries = [];
    static registerCanary(canary) {
        if (!canary.canaryId || !canary.targetProgram || !canary.expectedAction || typeof canary.parseAction !== 'function') {
            throw new Error('PARSER_CANARY_INVALID_CONTRACT');
        }
        if (this.registeredCanaries.some(c => c.canaryId === canary.canaryId)) {
            throw new Error(`PARSER_CANARY_DUPLICATE_ID: ${canary.canaryId}`);
        }
        this.registeredCanaries.push(canary);
    }
    static runAllCanaries() {
        const results = [];
        let allPassed = true;
        for (const c of this.registeredCanaries) {
            const start = Date.now();
            try {
                if (c.payload.programId !== c.targetProgram)
                    throw new Error('PARSER_CANARY_PROGRAM_MISMATCH');
                const actualAction = c.parseAction(c.payload);
                const isValid = actualAction === c.expectedAction;
                if (!isValid)
                    throw new Error(`PARSER_CANARY_ACTION_MISMATCH: expected ${c.expectedAction}, got ${actualAction}`);
                const latencyMs = Date.now() - start;
                results.push({
                    canaryId: c.canaryId,
                    targetProgram: c.targetProgram,
                    expectedInstruction: c.expectedAction,
                    passed: true,
                    latencyMs,
                });
            }
            catch (e) {
                allPassed = false;
                results.push({
                    canaryId: c.canaryId,
                    targetProgram: c.targetProgram,
                    expectedInstruction: c.expectedAction,
                    passed: false,
                    latencyMs: Date.now() - start,
                    err: String(e),
                });
            }
        }
        return { allPassed, results };
    }
}
export class CommitmentLadderEngine {
    commitments = new Map();
    recordProcessed(signature, slot, timestampMs = Date.now()) {
        if (!signature || !Number.isSafeInteger(slot) || slot < 0 || !Number.isSafeInteger(timestampMs) || timestampMs < 0) {
            throw new Error('COMMITMENT_LADDER_INVALID_OBSERVATION');
        }
        const existing = this.commitments.get(signature);
        if (existing) {
            if (existing.slot !== slot)
                throw new Error('COMMITMENT_LADDER_SIGNATURE_SLOT_CONFLICT');
            return { ...existing };
        }
        const rec = {
            signature,
            slot,
            tier: 'PROCESSED',
            observedAtMs: timestampMs,
        };
        this.commitments.set(signature, rec);
        return { ...rec };
    }
    advanceToConfirmed(signature, timestampMs = Date.now()) {
        const rec = this.commitments.get(signature);
        if (!rec) {
            throw new Error(`COMMITMENT_LADDER_NOT_FOUND: Signature ${signature} not registered in commitment ladder.`);
        }
        if (!Number.isSafeInteger(timestampMs) || timestampMs < rec.observedAtMs ||
            (rec.confirmedAtMs !== undefined && timestampMs < rec.confirmedAtMs)) {
            throw new Error('COMMITMENT_LADDER_INVALID_OR_NONMONOTONIC_TIME');
        }
        if (rec.tier === 'FINALIZED')
            return { ...rec };
        rec.tier = 'CONFIRMED';
        rec.confirmedAtMs = timestampMs;
        return { ...rec };
    }
    advanceToFinalized(signature, timestampMs = Date.now()) {
        const rec = this.commitments.get(signature);
        if (!rec) {
            throw new Error(`COMMITMENT_LADDER_NOT_FOUND: Signature ${signature} not registered in commitment ladder.`);
        }
        if (rec.tier === 'PROCESSED')
            throw new Error('COMMITMENT_LADDER_CONFIRMATION_REQUIRED');
        if (!Number.isSafeInteger(timestampMs) || timestampMs < (rec.confirmedAtMs ?? rec.observedAtMs) ||
            (rec.finalizedAtMs !== undefined && timestampMs < rec.finalizedAtMs)) {
            throw new Error('COMMITMENT_LADDER_INVALID_OR_NONMONOTONIC_TIME');
        }
        if (rec.tier === 'FINALIZED')
            return { ...rec };
        rec.tier = 'FINALIZED';
        rec.finalizedAtMs = timestampMs;
        return { ...rec };
    }
    getCommitment(signature) {
        return this.commitments.get(signature)?.tier;
    }
    isConfirmedOrFinalized(signature) {
        const t = this.getCommitment(signature);
        return t === 'CONFIRMED' || t === 'FINALIZED';
    }
}
export class SlotCausalClock {
    maxObservedSlot = 0;
    maxAllowedSkewSlots;
    constructor(maxAllowedSkewSlots = 5) {
        if (!Number.isSafeInteger(maxAllowedSkewSlots) || maxAllowedSkewSlots < 0) {
            throw new Error('SLOT_CAUSAL_CLOCK_INVALID_SKEW_BUDGET');
        }
        this.maxAllowedSkewSlots = maxAllowedSkewSlots;
    }
    observeSlot(slot) {
        if (!Number.isSafeInteger(slot) || slot < 0)
            throw new Error('SLOT_CAUSAL_CLOCK_INVALID_SLOT');
        const prevMax = this.maxObservedSlot;
        if (slot > this.maxObservedSlot) {
            this.maxObservedSlot = slot;
            return {
                currentMaxSlot: this.maxObservedSlot,
                lastReportedSlot: slot,
                isMonotonic: true,
                skewSlots: 0,
            };
        }
        const skew = prevMax - slot;
        if (skew > this.maxAllowedSkewSlots) {
            throw new Error(`SLOT_CAUSAL_SKEW_EXCEEDED: Slot ${slot} is ${skew} slots behind maximum observed slot ${prevMax} (allowed: ${this.maxAllowedSkewSlots}). Rejecting Frankenstate.`);
        }
        return {
            currentMaxSlot: this.maxObservedSlot,
            lastReportedSlot: slot,
            isMonotonic: false,
            skewSlots: skew,
        };
    }
    getCurrentSlot() {
        return this.maxObservedSlot;
    }
}
export class ForkReversalEngine {
    banks = new Map();
    activeTipHash;
    rootHash;
    registerBank(node) {
        if (!node.bankHash || !Number.isSafeInteger(node.slot) || node.slot < 0)
            throw new Error('FORK_REVERSAL_INVALID_BANK');
        const existing = this.banks.get(node.bankHash);
        if (existing && JSON.stringify(existing) !== JSON.stringify(node))
            throw new Error('FORK_REVERSAL_BANK_IDENTITY_CONFLICT');
        if (node.parentBankHash) {
            const parent = this.banks.get(node.parentBankHash);
            if (!parent || parent.slot >= node.slot)
                throw new Error('FORK_REVERSAL_PARENT_MISSING_OR_NONCAUSAL');
        }
        else if (!node.isRoot && this.banks.size > 0) {
            throw new Error('FORK_REVERSAL_NONROOT_MISSING_PARENT');
        }
        if (node.isRoot && this.rootHash) {
            const ancestors = this.getAncestorHashes(node.bankHash, node.parentBankHash);
            if (!ancestors.includes(this.rootHash))
                throw new Error('FORK_REVERSAL_ROOT_CONFLICT');
        }
        this.banks.set(node.bankHash, node);
        if (node.isRoot)
            this.rootHash = node.bankHash;
        if (!this.activeTipHash) {
            this.activeTipHash = node.bankHash;
        }
    }
    setActiveTip(bankHash) {
        const target = this.banks.get(bankHash);
        if (!target) {
            throw new Error(`FORK_REVERSAL_UNKNOWN_BANK: Bank hash ${bankHash} not found in lineage graph.`);
        }
        if (!this.activeTipHash || this.activeTipHash === bankHash) {
            this.activeTipHash = bankHash;
            return { reorgOccurred: false, rolledBackSlots: 0 };
        }
        const currentTip = this.banks.get(this.activeTipHash);
        const targetAncestors = this.getAncestorHashes(bankHash);
        if (this.rootHash && !targetAncestors.includes(this.rootHash))
            throw new Error('FORK_REVERSAL_TIP_BEHIND_ROOT');
        const targetSet = new Set(targetAncestors);
        const currentAncestors = this.getAncestorHashes(this.activeTipHash);
        const commonAncestor = currentAncestors.find(hash => targetSet.has(hash));
        if (!commonAncestor)
            throw new Error('FORK_REVERSAL_DISCONNECTED_LINEAGE');
        const currentDepth = currentAncestors.indexOf(commonAncestor);
        const rolledBackSlots = currentDepth === 0 ? 0 : currentTip.slot - this.banks.get(commonAncestor).slot;
        const isExtension = targetAncestors.indexOf(this.activeTipHash) > -1;
        this.activeTipHash = bankHash;
        return { reorgOccurred: !isExtension && currentDepth > 0, rolledBackSlots: isExtension ? 0 : rolledBackSlots };
    }
    getAncestorHashes(startHash, firstParent) {
        const ancestors = [];
        let hash = startHash;
        if (firstParent !== undefined)
            hash = firstParent;
        while (hash) {
            if (ancestors.includes(hash))
                throw new Error('FORK_REVERSAL_CYCLE');
            const node = this.banks.get(hash);
            if (!node)
                throw new Error('FORK_REVERSAL_PARENT_MISSING_OR_NONCAUSAL');
            ancestors.push(hash);
            hash = node.parentBankHash;
        }
        return ancestors;
    }
    getActiveTip() {
        return this.activeTipHash ? this.banks.get(this.activeTipHash) : undefined;
    }
}
export class ProviderTrustLedger {
    providers = new Map();
    latencySamples = new Map();
    registerProvider(providerId, failureDomain) {
        if (!providerId || !failureDomain)
            throw new Error('PROVIDER_TRUST_FAILURE_DOMAIN_REQUIRED');
        if (this.providers.has(providerId))
            throw new Error('PROVIDER_TRUST_DUPLICATE_PROVIDER');
        this.providers.set(providerId, {
            providerId,
            failureDomain,
            score: 1.0,
            latencyP50Ms: 50,
            slotLag: 0,
            isQuarantined: false,
            consecutiveErrors: 0,
        });
        this.latencySamples.set(providerId, []);
    }
    recordObservation(providerId, latencyMs, slotLag) {
        const card = this.providers.get(providerId);
        if (!card)
            throw new Error('PROVIDER_TRUST_UNKNOWN_PROVIDER');
        if (!Number.isFinite(latencyMs) || latencyMs < 0 || !Number.isSafeInteger(slotLag) || slotLag < 0) {
            throw new Error('PROVIDER_TRUST_INVALID_OBSERVATION');
        }
        const samples = this.latencySamples.get(providerId);
        samples.push(latencyMs);
        if (samples.length > 101)
            samples.shift();
        const sorted = [...samples].sort((a, b) => a - b);
        card.latencyP50Ms = sorted[Math.floor((sorted.length - 1) / 2)];
        card.slotLag = slotLag;
        card.consecutiveErrors = 0;
        if (slotLag > 5 || latencyMs > 800) {
            card.score = Math.max(0.1, card.score - 0.6);
        }
        else {
            card.score = Math.min(1.0, card.score + 0.05);
        }
        card.isQuarantined = card.score < 0.5 || slotLag > 5 || latencyMs > 1000;
    }
    recordFailure(providerId) {
        const card = this.providers.get(providerId);
        if (!card)
            throw new Error('PROVIDER_TRUST_UNKNOWN_PROVIDER');
        card.consecutiveErrors++;
        card.score = Math.max(0.0, card.score - 0.25);
        if (card.score < 0.5 || card.consecutiveErrors >= 3) {
            card.isQuarantined = true;
        }
    }
    getQuorumAgreedValue(observations) {
        if (observations.length === 0 || observations.some(o => !o.contextId || !Number.isSafeInteger(o.slot) || o.slot < 0)) {
            return { agreed: false };
        }
        const contextIds = new Set(observations.map(o => o.contextId));
        const slots = new Set(observations.map(o => o.slot));
        if (contextIds.size !== 1 || slots.size !== 1)
            return { agreed: false };
        const valid = observations.filter(o => {
            const p = this.providers.get(o.providerId);
            return p && !p.isQuarantined;
        });
        const valuesByDomain = new Map();
        const conflictingDomains = new Set();
        const parsedValues = new Map();
        try {
            for (const observation of valid) {
                const domain = this.providers.get(observation.providerId).failureDomain;
                const key = JSON.stringify(observation.value, (_property, value) => typeof value === 'bigint' ? `${value}n` : value);
                if (key === undefined)
                    return { agreed: false };
                const previous = valuesByDomain.get(domain);
                if (previous !== undefined && previous !== key)
                    conflictingDomains.add(domain);
                else
                    valuesByDomain.set(domain, key);
                parsedValues.set(key, observation.value);
            }
        }
        catch {
            return { agreed: false };
        }
        for (const domain of conflictingDomains)
            valuesByDomain.delete(domain);
        const domains = new Set(valuesByDomain.keys());
        if (domains.size < 4) {
            return { agreed: false };
        }
        const toleratedFaults = Math.floor((domains.size - 1) / 3);
        const requiredVotes = Math.floor((domains.size + toleratedFaults) / 2) + 1;
        const valueCounts = new Map();
        for (const key of valuesByDomain.values()) {
            valueCounts.set(key, (valueCounts.get(key) ?? 0) + 1);
        }
        for (const [key, count] of valueCounts) {
            if (count >= requiredVotes) {
                return { agreed: true, consensusValue: parsedValues.get(key) };
            }
        }
        return { agreed: false };
    }
    getScorecard(providerId) {
        const card = this.providers.get(providerId);
        return card ? { ...card } : undefined;
    }
}
//# sourceMappingURL=truth-x.js.map