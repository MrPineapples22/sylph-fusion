import { request as httpsRequest } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { ComputeBudgetProgram, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { decodeSingleSignerMessage } from '../execution/transaction-artifact.js';
import { SigningFirewall } from '../signing/signing-firewall.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
function fail(code) { throw new Error(code); }
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const string = (value) => typeof value === 'string' && value.length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/**
 * Deliberately PRIVATE trusted bootstrap. Request handlers never receive this
 * factory, control updater, or disclosure issuer. No arbitrary transport,
 * firewall, clock, or gate callbacks can enter through this API. Production
 * integration requires independently reviewed operator/control authorities.
 * The offline test harness exposes this lexical function only in memory.
 */
function composeUnsignedObservationRoot(input) {
    // Copy all trusted bootstrap fields, including arrays, before any await.
    const cfg = Object.freeze({ ...input, policy: Object.freeze({ ...input.policy,
            allowedPrograms: Object.freeze([...input.policy.allowedPrograms]),
            allowedFeePayers: Object.freeze([...input.policy.allowedFeePayers]),
        }) });
    const endpoint = new URL(cfg.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash ||
        cfg.cluster !== 'devnet' || !string(cfg.audience) || !string(cfg.configurationRevision) || !string(cfg.credentialRevision) ||
        !string(cfg.expectedGenesis) || !['confirmed', 'finalized'].includes(cfg.commitment) ||
        !integer(cfg.timeoutMs, 1, 60_000) || !integer(cfg.maxResponseBytes, 1, 4_194_304) ||
        !integer(cfg.maxUnits, 1, 1_400_000) || !integer(cfg.maxLifetimeMs, 1, 60_000))
        fail('BOOTSTRAP_INVALID');
    new PublicKey(cfg.expectedGenesis);
    const p = cfg.policy;
    if (!string(p.version) || !string(p.hash) || p.mainnetEnabled !== false ||
        !string(p.expectedDestination) || p.expectedMint !== '' ||
        !integer(p.maxSlippageBps, 0, 10_000) || typeof p.maxAmountLamports !== 'bigint' || p.maxAmountLamports < 0n ||
        typeof p.maxPriorityFeeLamports !== 'bigint' || p.maxPriorityFeeLamports < 0n ||
        !p.allowedPrograms.every(string) || !p.allowedFeePayers.every(string))
        fail('POLICY_INVALID');
    // Path/query may contain API secrets: neither may enter evidence or its hash.
    // Trusted bootstrap supplies non-secret origin and explicit revision labels.
    // Exact secret-bearing URL stays private and is used only for transport.
    const provider = hash(JSON.stringify([endpoint.origin, cfg.configurationRevision, cfg.credentialRevision, cfg.cluster,
        cfg.expectedGenesis, cfg.commitment, cfg.timeoutMs, cfg.maxResponseBytes]));
    const firewall = new SigningFirewall();
    let epoch = 0;
    let controls = Object.freeze({ journalHealthy: false, killSwitchClear: false,
        providerHealthy: false, disclosureAllowed: false });
    const permits = new WeakMap();
    const consumed = new WeakSet();
    const receipts = new WeakMap();
    const now = () => { const value = Date.now(); if (!integer(value, 0))
        fail('CLOCK_INVALID'); return value; };
    function check(record) {
        const time = now();
        if (record.epoch !== epoch || !controls.journalHealthy || !controls.killSwitchClear ||
            !controls.providerHealthy || !controls.disclosureAllowed || time < record.issuedAt ||
            time >= record.expiresAt)
            fail('AUTHORITY_UNAVAILABLE');
    }
    function precheck(record) {
        check(record);
        const result = firewall.evaluate({ requestId: record.requestId, environment: cfg.cluster,
            messageBytes: Buffer.from(record.messageBase64, 'base64'), messageHash: record.messageHash,
            expectedSigner: record.signer, feePayer: record.signer, policyVersion: p.version, policyHash: p.hash,
            intentId: record.intentId, simulationId: record.simulationId, expiresAt: record.expiresAt }, null, p, { journalHealthy: controls.journalHealthy, killSwitchClear: controls.killSwitchClear,
            providerGateHealthy: controls.providerHealthy, simulationPassed: false }, now());
        if (result.approved || result.reasonCodes.length !== 1 || result.reasonCodes[0] !== 'SIMULATION_UNAVAILABLE') {
            fail('POLICY_PRECHECK_DENIED');
        }
    }
    // No redirect following, endpoint fallback, shared pool, external transaction
    // object, or caller transport. HTTPS verifies the peer using platform trust.
    function rpc(body, id, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error('CANCELLED'));
                return;
            }
            let finished = false;
            const finish = (error, value) => {
                if (finished)
                    return;
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error)
                    reject(error);
                else
                    resolve(value);
            };
            // Explicit true overrides NODE_TLS_REJECT_UNAUTHORIZED=0. Do not replace
            // Node's default checkServerIdentity: hostname verification stays enabled.
            const req = httpsRequest(endpoint, { method: 'POST', rejectUnauthorized: true, headers: {
                    'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
                } }, res => {
                if (res.statusCode !== 200) {
                    finish(new Error('RPC_HTTP_ERROR'));
                    req.destroy();
                    return;
                }
                let size = 0;
                const chunks = [];
                res.on('data', (chunk) => {
                    if (finished)
                        return;
                    size += chunk.length;
                    if (size > cfg.maxResponseBytes) {
                        finish(new Error('RPC_RESPONSE_TOO_LARGE'));
                        req.destroy();
                        return;
                    }
                    chunks.push(Buffer.from(chunk));
                });
                res.on('error', () => finish(new Error('RPC_RESPONSE_ERROR')));
                res.on('aborted', () => finish(new Error('RPC_RESPONSE_ABORTED')));
                res.on('end', () => {
                    if (finished)
                        return;
                    try {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        const parsed = JSON.parse(raw);
                        if (!object(parsed) || parsed.jsonrpc !== '2.0' || parsed.id !== id ||
                            Object.hasOwn(parsed, 'error') || !Object.hasOwn(parsed, 'result'))
                            fail('RPC_ENVELOPE_INVALID');
                        finish(undefined, { result: parsed.result, digest: hash(raw) });
                    }
                    catch {
                        finish(new Error('RPC_ENVELOPE_INVALID'));
                    }
                });
            });
            const abort = () => { finish(new Error('CANCELLED')); req.destroy(); };
            const timer = setTimeout(() => { finish(new Error('RPC_TIMEOUT')); req.destroy(); }, cfg.timeoutMs);
            signal?.addEventListener('abort', abort, { once: true });
            req.on('error', () => finish(new Error('RPC_TRANSPORT_ERROR')));
            req.end(body);
        });
    }
    function issueDisclosure(request) {
        // Only the trusted root receives this issuer. A request cannot authorize itself.
        const bytes = Uint8Array.from(request.messageBytes);
        const r = { intentId: request.intentId, generation: request.generation, signer: request.signer,
            stage: request.stage, minContextSlot: request.minContextSlot, expiresAt: request.expiresAt };
        const issuedAt = now();
        if (!string(r.intentId) || !string(r.signer) || !integer(r.generation, 0) ||
            !['ESTIMATE', 'FINAL'].includes(r.stage) || !integer(r.minContextSlot, 0) ||
            !integer(r.expiresAt, 0) || r.expiresAt <= issuedAt || r.expiresAt - issuedAt > cfg.maxLifetimeMs)
            fail('REQUEST_INVALID');
        const message = decodeSingleSignerMessage(bytes, new PublicKey(r.signer));
        let messageLimit;
        for (const ix of message.compiledInstructions) {
            if (message.staticAccountKeys[ix.programIdIndex]?.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2) {
                if (messageLimit !== undefined || ix.data.length !== 5 || ix.accountKeyIndexes.length !== 0)
                    fail('COMPUTE_LIMIT_INVALID');
                messageLimit = Buffer.from(ix.data).readUInt32LE(1);
            }
        }
        if (!integer(messageLimit, 1, 1_400_000))
            fail('COMPUTE_LIMIT_REQUIRED');
        const transaction = new VersionedTransaction(message);
        const wire = transaction.serialize();
        const roundtrip = VersionedTransaction.deserialize(wire);
        if (!Buffer.from(roundtrip.message.serialize()).equals(Buffer.from(bytes)) ||
            roundtrip.signatures.length !== 1 || roundtrip.signatures.some(sig => sig.some(byte => byte !== 0)))
            fail('UNSIGNED_WIRE_INVALID');
        const requestId = randomUUID();
        const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'simulateTransaction', params: [
                Buffer.from(wire).toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false,
                    commitment: cfg.commitment, minContextSlot: r.minContextSlot },
            ] });
        const prepared = Object.freeze({ ...r, issuedAt, epoch, requestId, simulationId: randomUUID(),
            body, messageBase64: Buffer.from(bytes).toString('base64'), messageHash: hash(bytes), requestHash: hash(body), messageLimit });
        precheck(prepared);
        const permit = Object.freeze(Object.create(null));
        permits.set(permit, prepared);
        return permit;
    }
    async function observe(permit, signal) {
        const record = permits.get(permit);
        if (!record || consumed.has(permit))
            fail('DISCLOSURE_PERMIT_INVALID');
        precheck(record);
        if (signal?.aborted)
            fail('CANCELLED');
        consumed.add(permit); // synchronous atomic one-shot before any dispatch/await
        const genesisId = randomUUID();
        const genesis = await rpc(JSON.stringify({ jsonrpc: '2.0', id: genesisId, method: 'getGenesisHash', params: [] }), genesisId, signal);
        check(record);
        if (signal?.aborted)
            fail('CANCELLED');
        if (genesis.result !== cfg.expectedGenesis)
            fail('GENESIS_MISMATCH');
        precheck(record);
        const response = await rpc(record.body, record.requestId, signal);
        check(record);
        if (signal?.aborted)
            fail('CANCELLED');
        const result = response.result;
        if (!object(result) || !object(result.context) || !object(result.value) || result.value.err !== null ||
            !integer(result.context.slot, record.minContextSlot) ||
            !integer(result.value.unitsConsumed, 1, Math.min(record.messageLimit, cfg.maxUnits)) ||
            (result.value.replacementBlockhash !== undefined && result.value.replacementBlockhash !== null))
            fail('SIMULATION_RESPONSE_INVALID');
        const metadata = Object.freeze({ audience: cfg.audience, intentId: record.intentId,
            generation: record.generation, requestId: record.requestId, simulationId: record.simulationId, stage: record.stage,
            signer: record.signer, messageHash: record.messageHash, requestHash: record.requestHash, responseHash: response.digest,
            provider, cluster: cfg.cluster, genesis: cfg.expectedGenesis, configurationRevision: cfg.configurationRevision,
            credentialRevision: cfg.credentialRevision,
            policyVersion: p.version, policyHash: p.hash, epoch: record.epoch, commitment: cfg.commitment,
            minContextSlot: record.minContextSlot, slot: result.context.slot, unitsConsumed: result.value.unitsConsumed,
            issuedAt: record.issuedAt, completedAt: now(), expiresAt: record.expiresAt });
        check(record);
        const receipt = Object.freeze(Object.create(null));
        receipts.set(receipt, metadata);
        return receipt;
    }
    const client = Object.freeze({ observe, inspect(receipt) {
            const metadata = receipts.get(receipt);
            if (!metadata)
                fail('OBSERVATION_UNKNOWN');
            const time = now();
            return Object.freeze({ metadata, expired: time < metadata.issuedAt || time >= metadata.expiresAt,
                epochChanged: metadata.epoch !== epoch, authorizesSigning: false });
        } });
    return Object.freeze({ client, issueDisclosure, updateControls(update) {
            const copy = { journalHealthy: update.journalHealthy, killSwitchClear: update.killSwitchClear,
                providerHealthy: update.providerHealthy, disclosureAllowed: update.disclosureAllowed };
            if (Object.values(copy).some(value => typeof value !== 'boolean') || epoch >= Number.MAX_SAFE_INTEGER)
                fail('CONTROLS_INVALID');
            controls = Object.freeze(copy);
            epoch += 1; // even revoke-and-restore invalidates all previous permits/observations
        } });
}
//# sourceMappingURL=unsigned-observation-verifier.js.map