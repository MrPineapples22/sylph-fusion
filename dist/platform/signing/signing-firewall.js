import { createHash } from 'node:crypto';
import { VeritasWireDecoder } from './veritas-wire-decoder.js';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class InMemoryDurableReplayStore {
    items = new Set();
    has(key) { return this.items.has(key); }
    add(key) { this.items.add(key); }
    getAll() { return Array.from(this.items); }
}
export class SigningFirewall {
    consumed = new Set();
    replayStore;
    constructor(replayStore) {
        this.replayStore = replayStore;
        if (replayStore && typeof replayStore.getAll === 'function') {
            const existing = replayStore.getAll();
            for (const k of existing)
                this.consumed.add(k);
        }
    }
    evaluate(request, decoded, policy, gates, now = Date.now()) {
        const reasons = [];
        if (!request.requestId || !request.intentId || !request.simulationId || !request.messageBytes.byteLength)
            reasons.push('REQUEST_INVALID');
        const actualHash = sha256(request.messageBytes);
        if (actualHash !== request.messageHash)
            reasons.push('MESSAGE_HASH_MISMATCH');
        if (request.expiresAt <= now)
            reasons.push('AUTHORIZATION_EXPIRED');
        if (this.consumed.has(request.requestId) || this.consumed.has(request.messageHash) || (this.replayStore && (this.replayStore.has(request.requestId) || this.replayStore.has(request.messageHash))))
            reasons.push('REPLAY_DETECTED');
        if (request.policyVersion !== policy.version || request.policyHash !== policy.hash)
            reasons.push('POLICY_VERSION_MISMATCH');
        if (request.environment === 'mainnet-beta' && !policy.mainnetEnabled)
            reasons.push('MAINNET_INTERLOCK_CLOSED');
        if (!gates.journalHealthy)
            reasons.push('JOURNAL_UNHEALTHY');
        if (!gates.killSwitchClear)
            reasons.push('KILL_SWITCH_ACTIVE');
        if (!gates.providerGateHealthy)
            reasons.push('PROVIDER_GATE_UNHEALTHY');
        if (!gates.simulationPassed)
            reasons.push('SIMULATION_UNAVAILABLE');
        let effectiveDecoded = null;
        if (request.messageBytes?.byteLength) {
            try {
                effectiveDecoded = VeritasWireDecoder.decode(request.messageBytes, {
                    simulationId: request.simulationId,
                });
                if (decoded) {
                    const fields = ['complete', 'frozen', 'messageHash', 'signer', 'feePayer', 'amountLamports',
                        'mint', 'destination', 'maxSlippageBps', 'priorityFeeLamports', 'simulationId'];
                    const sameSet = (a, b) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
                    if (fields.some(field => decoded[field] !== effectiveDecoded[field])
                        || !sameSet(decoded.programIds, effectiveDecoded.programIds)
                        || !sameSet(decoded.writableAccounts, effectiveDecoded.writableAccounts)) {
                        reasons.push('CALLER_MANIFEST_SPOOF_DETECTED');
                    }
                }
            }
            catch (err) {
                effectiveDecoded = null;
                reasons.push(`NATIVE_DECODE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (!effectiveDecoded || !effectiveDecoded.complete)
            reasons.push('TRANSACTION_DECODER_INCOMPLETE');
        else {
            if (!effectiveDecoded.frozen)
                reasons.push('TRANSACTION_NOT_FROZEN');
            if (effectiveDecoded.messageHash !== actualHash)
                reasons.push('DECODED_MESSAGE_MISMATCH');
            if (effectiveDecoded.signer !== request.expectedSigner || effectiveDecoded.feePayer !== request.feePayer)
                reasons.push('SIGNER_OR_FEE_PAYER_MISMATCH');
            if (!policy.allowedFeePayers.includes(effectiveDecoded.feePayer))
                reasons.push('FEE_PAYER_DENIED');
            if (effectiveDecoded.programIds.some(id => !policy.allowedPrograms.includes(id)))
                reasons.push('UNKNOWN_PROGRAM_DENIED');
            if (effectiveDecoded.amountLamports < 0n || effectiveDecoded.amountLamports > policy.maxAmountLamports)
                reasons.push('AMOUNT_POLICY_DENIED');
            if (effectiveDecoded.maxSlippageBps < 0 || effectiveDecoded.maxSlippageBps > policy.maxSlippageBps)
                reasons.push('SLIPPAGE_POLICY_DENIED');
            if (effectiveDecoded.priorityFeeLamports < 0n || effectiveDecoded.priorityFeeLamports > policy.maxPriorityFeeLamports)
                reasons.push('PRIORITY_FEE_POLICY_DENIED');
            if ((policy.expectedMint && effectiveDecoded.mint !== policy.expectedMint) || (policy.expectedDestination && effectiveDecoded.destination !== policy.expectedDestination))
                reasons.push('INTENT_BINDING_MISMATCH');
            if (effectiveDecoded.simulationId !== request.simulationId)
                reasons.push('SIMULATION_BINDING_MISMATCH');
        }
        if (reasons.length)
            return Object.freeze({ approved: false, reasonCodes: Object.freeze(reasons) });
        this.consumed.add(request.requestId);
        this.consumed.add(request.messageHash);
        if (this.replayStore) {
            this.replayStore.add(request.requestId);
            this.replayStore.add(request.messageHash);
        }
        return Object.freeze({ approved: true, messageHash: actualHash });
    }
}
//# sourceMappingURL=signing-firewall.js.map