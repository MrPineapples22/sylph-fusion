/**
 * SYLPH FUSION — CERTIFIED LIVE EXECUTION COORDINATOR
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1-10)
 *
 * Incomplete coordinator prototype; production live composition remains blocked.
 * Byte identity checks do not grant economic authority. Durable recovery,
 * enforced evidence transitions and reconciliation remain incomplete.
 * Intended (not yet fully implemented) execution chain:
 * 1.  validateEconomicIntent
 * 2.  verifyTransactionCapability
 * 3.  verifyTokenSemantics
 * 4.  acquireDurableReservation (exact bigint lamports)
 * 5.  allocateExecutionGeneration (DurableGenerationFenceAuthority)
 * 6.  buildFinalUnsignedTransaction
 * 7.  simulateFinalTransaction
 * 8.  revalidateState (freshness & curve)
 * 9.  sealExecutionAuthorizationRoot (cryptographic digest)
 * 10. prepareDurableSigning (TwoPhaseSideEffectFence DB PREPARE)
 * 11. invokeIsolatedSigner (ExecutionSignerGateway / KMS)
 * 12. recordDurableSignedGeneration (TwoPhaseSideEffectFence DB RESULT)
 * 13. submitExactBytes (Exact-byte submission without alteration)
 * 14. reconcileFinalChainOutcome -> FinalizedSettlementCertificate | NoLandCertificate
 */
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { DurableGenerationFenceAuthority } from './durable-generation-fence.js';
import { TwoPhaseSideEffectFence } from '../storage/two-phase-side-effect-fence.js';
import { HierarchicalReservationEngine, } from '../../intelligence/capital/reservations.js';
import { SigningFirewall } from '../signing/signing-firewall.js';
import { assembleVerifiedTransaction, decodeSingleSignerMessage, transactionHash } from './transaction-artifact.js';
export class CertifiedLiveExecutionCoordinator {
    cfg;
    rpc;
    market;
    signerGateway;
    generationFence;
    sideEffectFence;
    reservationEngine;
    signingFirewall;
    // Process-local identity bindings only; not a durable execution authority.
    sealedMessages = new WeakMap();
    signedArtifacts = new Map();
    constructor(cfg, rpc, market, signerGateway, reservationEngine, generationFence, sideEffectFence, signingFirewall) {
        this.cfg = cfg;
        this.rpc = rpc;
        this.market = market;
        this.signerGateway = signerGateway;
        if (cfg.MODE !== 'live') {
            throw new Error(`CertifiedLiveExecutionCoordinator requires live config mode (got ${cfg.MODE})`);
        }
        if (!signerGateway || !signerGateway.publicKey || signerGateway.publicKey.equals(PublicKey.default)) {
            throw new Error('CertifiedLiveExecutionCoordinator requires a valid, isolated ExecutionSignerGateway');
        }
        if (!rpc || !rpc.endpoints || !rpc.endpoints.length) {
            throw new Error('CertifiedLiveExecutionCoordinator requires an active RpcPool with at least one confirmed endpoint');
        }
        this.reservationEngine = reservationEngine ?? new HierarchicalReservationEngine();
        this.generationFence = generationFence ?? new DurableGenerationFenceAuthority();
        this.sideEffectFence = sideEffectFence ?? new TwoPhaseSideEffectFence();
        this.signingFirewall = signingFirewall ?? new SigningFirewall();
    }
    /**
     * Step 1: Validate Economic Intent
     */
    validateEconomicIntent(intent) {
        if (!intent.intentId || intent.intentId.trim().length === 0) {
            throw new Error('INVALID_ECONOMIC_INTENT: Missing intentId');
        }
        if (intent.amountLamportsOrTokens <= 0n) {
            throw new Error(`INVALID_ECONOMIC_INTENT: Amount must be positive bigint (got ${intent.amountLamportsOrTokens})`);
        }
        if (intent.maxSlippageBps <= 0 || intent.maxSlippageBps > 5000) {
            throw new Error(`INVALID_ECONOMIC_INTENT: Slippage bps must be in 1..5000 (got ${intent.maxSlippageBps})`);
        }
        if (!intent.callerPublicKey || intent.callerPublicKey.equals(PublicKey.default)) {
            throw new Error('INVALID_ECONOMIC_INTENT: Invalid caller public key');
        }
        // Invariant 7: Processing intent must be strictly LIVE to create live economic authority
        if (intent.processingIntent && intent.processingIntent !== 'LIVE') {
            throw new Error(`ECONOMIC_AUTHORITY_DENIED: ProcessingIntent must be LIVE (got ${intent.processingIntent})`);
        }
        if (intent.authorityEnvelope && intent.authorityEnvelope.processingIntent !== 'LIVE') {
            throw new Error(`ECONOMIC_AUTHORITY_DENIED: Authority envelope processingIntent must be LIVE (got ${intent.authorityEnvelope.processingIntent})`);
        }
    }
    /**
     * Step 2: Verify Transaction Capability
     */
    verifyTransactionCapability(intent) {
        // Verifies protocol routing capability
        if (intent.side !== 'buy' && intent.side !== 'sell') {
            throw new Error(`UNSUPPORTED_TRANSACTION_CAPABILITY: Invalid side ${intent.side}`);
        }
    }
    /**
     * Step 3: Verify Token Semantics
     */
    verifyTokenSemantics(snapshot) {
        if (snapshot.curve.complete) {
            throw new Error('TOKEN_SEMANTICS_VETO: Direct bonding curve execution unavailable on graduated token');
        }
    }
    /**
     * Step 4: Acquire Durable Reservation (Exact bigint lamports)
     */
    acquireDurableReservation(intent, snapshotSlot) {
        const worstCase = this.reservationEngine.calculateWorstCaseLamports({
            input_lamports: intent.amountLamportsOrTokens,
            max_slippage_bps: intent.maxSlippageBps,
            needs_ata_creation: intent.side === 'buy',
        });
        const econIntent = this.reservationEngine.createEconomicIntent({
            economic_intent_id: intent.intentId,
            candidate_transaction_id: `tx_${intent.intentId}_1`,
            owner: {
                hot_wallet_address: this.signerGateway.publicKey.toBase58(),
                portfolio_id: intent.portfolioId,
                strategy_id: intent.strategyId,
                token_mint: intent.mint.toBase58(),
                economic_intent_id: intent.intentId,
            },
            accounting: {
                max_input_sol: Number(worstCase.max_input_lamports) / 1e9,
                max_base_fee_sol: Number(worstCase.max_base_fee_lamports) / 1e9,
                max_priority_fee_sol: Number(worstCase.max_priority_fee_lamports) / 1e9,
                max_jito_tip_sol: Number(worstCase.max_jito_tip_lamports) / 1e9,
                ata_rent_sol: Number(worstCase.ata_rent_lamports) / 1e9,
                max_slippage_bps: worstCase.max_slippage_bps,
                total_worst_case_sol: Number(worstCase.total_worst_case_lamports) / 1e9,
                exact_lamports: worstCase,
            },
            exact_accounting: worstCase,
            state_version: 1,
            expires_at_slot: snapshotSlot + 300,
        });
        return econIntent.capability;
    }
    /**
     * Step 5: Allocate Execution Generation (Starts at Generation 1)
     */
    async allocateExecutionGeneration(intentId, initialSignature, lastValidBlockHeight) {
        const entry = await this.generationFence.acquireInitialGeneration(intentId, initialSignature, lastValidBlockHeight);
        return entry.generation;
    }
    /**
     * Step 9: Seal Execution Authorization Root
     */
    sealExecutionAuthorizationRoot(params) {
        const messageBase64 = Buffer.from(params.candidateTransactionBytes).toString('base64');
        decodeSingleSignerMessage(Buffer.from(messageBase64, 'base64'), this.signerGateway.publicKey);
        const canonicalHash = createHash('sha256').update(params.candidateTransactionBytes).digest('hex');
        const envHash = params.authorityEnvelope
            ? createHash('sha256').update(JSON.stringify(params.authorityEnvelope)).digest('hex')
            : 'NO_AUTHORITY_ENVELOPE';
        const authRootHash = createHash('sha256')
            .update('EXECUTION_AUTHORIZATION_ROOT:')
            .update(params.intentId)
            .update(`:${params.generation}:`)
            .update(params.reservationId)
            .update(`:${canonicalHash}:`)
            .update(`${params.simulationComputeUnits}:`)
            .update(`${params.estimatedNetSolDelta}:`)
            .update(`${params.expiresAtBlockHeight}:`)
            .update(envHash)
            .digest('hex');
        const root = Object.freeze({
            authRootHash,
            intentId: params.intentId,
            generation: params.generation,
            reservationId: params.reservationId,
            get candidateTransactionBytes() { return Uint8Array.from(Buffer.from(messageBase64, 'base64')); },
            simulationComputeUnits: params.simulationComputeUnits,
            estimatedNetSolDelta: params.estimatedNetSolDelta,
            expiresAtBlockHeight: params.expiresAtBlockHeight,
            sealedAt: Date.now(),
            authorityEnvelope: params.authorityEnvelope ? Object.freeze({ ...params.authorityEnvelope }) : undefined,
        });
        this.sealedMessages.set(root, { messageBase64, signer: this.signerGateway.publicKey.toBase58() });
        return root;
    }
    /**
     * Steps 10-12: Two-Phase Isolated Signer Invocation
     */
    async invokeCertifiedSigning(authRoot) {
        const sealed = this.sealedMessages.get(authRoot);
        if (!sealed)
            throw new Error('SIGNING_ROOT_NOT_ISSUED_BY_COORDINATOR');
        const expectedSigner = new PublicKey(sealed.signer);
        if (!this.signerGateway.publicKey.equals(expectedSigner))
            throw new Error('SIGNING_GATEWAY_IDENTITY_CHANGED');
        const messageBytes = Uint8Array.from(Buffer.from(sealed.messageBase64, 'base64'));
        const externalCallId = `kms_sign_${authRoot.intentId}_gen${authRoot.generation}_${authRoot.authRootHash.slice(0, 16)}`;
        // Step 10: DB PREPARE SIGNING
        const { fenceId, isResumed } = this.sideEffectFence.prepare({
            intentId: authRoot.intentId,
            generation: authRoot.generation,
            phase: 'SIGNING',
            externalCallId,
            payload: messageBytes,
        });
        if (isResumed)
            throw new Error('SIGNING_OUTCOME_UNKNOWN: Reconciliation required before resumption');
        // Step 11: Call Isolated Signer Gateway
        const signatureBytes = await this.signerGateway.signTransactionMessage(Uint8Array.from(messageBytes));
        const artifact = assembleVerifiedTransaction(messageBytes, signatureBytes, expectedSigner);
        const signedBytes = Uint8Array.from(Buffer.from(artifact.wireBase64, 'base64'));
        // Step 12: DB RESULT COMMIT
        this.sideEffectFence.commit(fenceId, signedBytes);
        this.signedArtifacts.set(JSON.stringify([authRoot.intentId, authRoot.generation]), artifact);
        return signedBytes;
    }
    /**
     * Step 13: Submit Exact Bytes (No Mutation)
     */
    async submitExactBytes(intentId, generation, signedWire, signature) {
        const artifact = this.signedArtifacts.get(JSON.stringify([intentId, generation]));
        const wireCopy = Uint8Array.from(signedWire);
        if (!artifact || transactionHash(wireCopy) !== artifact.wireHash || signature !== artifact.signature) {
            throw new Error('SUBMISSION_SIGNED_ARTIFACT_MISMATCH');
        }
        const externalCallId = `submit_${intentId}_gen${generation}_${signature}`;
        // DB PREPARE SUBMISSION
        const { fenceId, isResumed } = this.sideEffectFence.prepare({
            intentId,
            generation,
            phase: 'SUBMISSION',
            externalCallId,
            payload: wireCopy,
        });
        if (isResumed)
            throw new Error('SUBMISSION_OUTCOME_UNKNOWN: Reconciliation required before resumption');
        // Dispatches exact bytes through confirmed RPC pool
        const rpcSignature = await this.rpc.connection.sendRawTransaction(wireCopy, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });
        if (rpcSignature !== artifact.signature)
            throw new Error('SUBMISSION_RPC_SIGNATURE_MISMATCH');
        // DB RESULT COMMIT
        this.sideEffectFence.commit(fenceId, signature);
        return signature;
    }
    /**
     * Step 14: Reconcile Final Chain Outcome
     * All observations remain UNKNOWN. Terminal certification is quarantined
     * until signature-bound, independently verified chain evidence is available.
     */
    async reconcileFinalChainOutcome(params) {
        const { signature } = params;
        try {
            await this.rpc.connection.getTransaction(signature, {
                commitment: 'finalized',
                maxSupportedTransactionVersion: 1,
            });
        }
        catch {
            throw new Error('TRANSACTION_OUTCOME_UNKNOWN: Finalized transaction lookup failed; retain reservation and generation');
        }
        // A missing transaction is not proof of absence from finalized history.
        // Expiry prevents future inclusion but does not prove it never landed.
        // RpcPool also cannot attribute this observation to endpoints[0].
        // Present transactions are not yet verified against the signed generation,
        // cluster, finality and exact effects. Never invent SUCCESS or zero deltas.
        throw new Error('TRANSACTION_OUTCOME_UNKNOWN: Terminal evidence verification is unavailable; retain reservation and generation');
    }
}
//# sourceMappingURL=certified-live-coordinator.js.map