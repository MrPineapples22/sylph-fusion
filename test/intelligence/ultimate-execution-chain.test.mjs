import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

import { TokenSemanticEngine } from '../../dist/platform/truth/token-semantic-root.js';
import { MarketAuthenticityEngine } from '../../dist/platform/authenticity/market-authenticity.js';
import { LifecycleXEngine } from '../../dist/intelligence/lifecycle/lifecycle-x.js';
import { CapitalFlowEngine } from '../../dist/intelligence/flow/capital-flow-x.js';
import { MarketGrammarEngine } from '../../dist/intelligence/grammar/market-grammar.js';
import { MultiplierResearchHeuristicEngine } from '../../dist/intelligence/multiplier/competing-hazards-multiplier.js';
import { ExitabilityEngine } from '../../dist/intelligence/exitability/exitability-certificate.js';
import { MasterOpportunityDecisionEngine } from '../../dist/intelligence/decision/master-opportunity-decision.js';
const runtimeTestDist=process.env.RUNTIME_ROOT_SCHEMA_TEST_DIST;
const runtimeModule=runtimeTestDist?pathToFileURL(join(runtimeTestDist,'platform/truth/runtime-program-root.js')).href:
  new URL('../../dist/platform/truth/runtime-program-root.js',import.meta.url).href;
const {EnvironmentCertificationEngine}=await import(runtimeModule);
import { UltimateExecutionPermitAuthority } from '../../dist/intelligence/execution/ultimate-execution-permit.js';
import { UltimateExecutionRecordLedger } from '../../dist/platform/evidence/ultimate-execution-record.js';

test('MasterOpportunityDecisionEngine: keeps uncalibrated research scores out of EV and approval', () => {
  const mint = 'CleanOpportunityMint1111111111111111111111';
  const slot = 280_000_000;

  const semantics = TokenSemanticEngine.evaluateSemantics({
    mint,
    slot,
    decodedState: {
      decimals: 6,
      rawSupply: 1_000_000_000_000n,
      isInitialized: true,
      mintAuthority: { kind: 'ABSENT_PROVEN' },
      freezeAuthority: { kind: 'ABSENT_PROVEN' },
      permanentDelegate: { kind: 'ABSENT_PROVEN' },
      transferHook: { kind: 'ABSENT_PROVEN' },
      parsedExtensions: [],
    },
  });

  const authenticity = MarketAuthenticityEngine.evaluateAuthenticity({
    mint,
    walletCount: 40,
    uniqueEntityCount: 36,
    washTradingVolumeSol: 1.0,
    totalVolumeSol: 80.0,
    creatorControlledSupplyPct: 0.5,
    insiderSupplyPct: 1.0,
    coordinatedSupplyPct: 0.0,
    funderConcentrationScore: 0.12,
    sustainedCapitalInflowSol: 35.0,
    sellerAbsorptionRate: 0.90,
    observationSlot: slot,
    observedAtMs: Date.now(),
  });

  const lifecycleEngine = new LifecycleXEngine();
  const lifecycle = lifecycleEngine.evaluateLifecycle({
    mint,
    ageSeconds: 50,
    bondingCurveProgressPct: 55.0,
    isMigratedToAmm: false,
    poolLiquiditySol: 60.0,
    peakLiquiditySol: 60.0,
    recentVolumeSol: 25.0,
    netCapitalFlowSol: 12.0,
    devHoldingPct: 0.5,
    isDevSold: false,
    currentSlot: slot,
    timestampMs: 1_000_000,
  });

  const flowEngine = new CapitalFlowEngine();
  const flow = flowEngine.evaluateFlow({
    mint,
    timestampMs: 1_000_000,
    slot,
    grossBuySol: 15.0,
    grossSellSol: 1.0,
    independentEntityInflowSol: 14.0,
    uniqueBuyerCount: 20,
    uniqueEntityCount: 18,
    repeatBuyerCount: 6,
    creatorSellSol: 0.0,
    whaleBuySol: 2.0,
    poolLiquiditySol: 60.0,
  });

  const grammarEngine = new MarketGrammarEngine();
  grammarEngine.recordEvent(mint, { type: 'CREATOR_INIT', entityId: 'c1', solAmount: 0.1, slot: 1, timestampMs: 1000 });
  grammarEngine.recordEvent(mint, { type: 'ORGANIC_BUY', entityId: 'b1', solAmount: 1.0, slot: 2, timestampMs: 2000 });
  grammarEngine.recordEvent(mint, { type: 'REPEAT_BUY', entityId: 'b1', solAmount: 1.5, slot: 3, timestampMs: 3000 });
  grammarEngine.recordEvent(mint, { type: 'LIQUIDITY_ADD', entityId: 'b2', solAmount: 5.0, slot: 4, timestampMs: 4000 });
  const grammar = grammarEngine.evaluateGrammar(mint);

  const multiplierResearch = MultiplierResearchHeuristicEngine.evaluateResearchHeuristics({
    mint,
    netCapitalFlowVelocity: 2.5,
    netCapitalFlowAcceleration: 0.8,
    poolLiquiditySol: 60.0,
    bondingCurveProgressPct: 55.0,
    authenticityProbability: authenticity.probabilities.pAuthentic,
    manipulationResistanceScore: authenticity.manipulationResistanceScore,
    entityCount: 36,
    sellerAbsorptionRate: 0.90,
    currentMcapSol: 80.0,
    ageSeconds: 50,
    observationSlot: slot,
    timestampMs: 1_000_000,
  });

  const exitability = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 10_000_000n,
    intendedPositionSolValue: 1.0,
    tokenSemanticRoot: semantics,
    poolSolReserve: 60.0,
    poolTokenReserve: 600_000_000,
    availableRoutes: ['PUMP_BONDING_CURVE'],
    slot,
  });

  const decision = MasterOpportunityDecisionEngine.evaluateOpportunity({
    candidateId: 'cand_clean_001',
    mint,
    slot,
    tokenSemanticRoot: semantics,
    authenticityCertificate: authenticity,
    lifecycleState: lifecycle,
    capitalFlowState: flow,
    marketGrammarState: grammar,
    multiplierResearch,
    exitabilityCertificate: exitability,
    proposedSizeSol: 1.0,
  });

  assert.equal(decision.decisionStatus, 'RESEARCH_ONLY_UNCALIBRATED');
  assert.equal(decision.expectedAfterCostEvSol, null);
  assert.equal(decision.expectedCapturedMultiple, null);
  assert.equal(decision.pEntryLand, null);
  assert.equal(decision.pExitLand, null);
  assert.ok(decision.disqualificationReasons.includes('CALIBRATED_OUTCOME_AND_EXECUTION_EVIDENCE_UNAVAILABLE'));
  assert.ok(decision.decisionDigest.length === 64);
  assert.throws(() => MasterOpportunityDecisionEngine.evaluateOpportunity({
    candidateId: 'bad', mint, slot: -1, tokenSemanticRoot: semantics,
    authenticityCertificate: authenticity, lifecycleState: lifecycle, capitalFlowState: flow,
    marketGrammarState: grammar, multiplierResearch, exitabilityCertificate: exitability,
  }), /INVALID_OPPORTUNITY_DECISION_CONTEXT/);
});

test('UltimateExecutionPermitAuthority & RecordLedger: issue permit and seal tamper-proof 19-link evidence chain', () => {
  const runtime = EnvironmentCertificationEngine.createRuntimeRoot({ epoch: 650, contextSlot: 280_000_000 });
  const program = EnvironmentCertificationEngine.createProgramRoot({
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    deploymentSlot: 200_000_000,
    executableBytecodeHash: 'bytecode_clean_001',
  });

  const mint = 'ExecuteMint1111111111111111111111111111111';
  const exactWireTxHash = 'exact_wire_hash_abc123';

  // 1. Issue Execution Permit
  const permit = UltimateExecutionPermitAuthority.issuePermit({
    intentId: 'intent_001',
    candidateId: 'cand_001',
    exactTransactionHash: exactWireTxHash,
    mint,
    routeHash: 'route_pump_direct',
    runtimeRoot: runtime,
    programRoots: [program],
    simulationCertificateHash: 'sim_cert_hash_001',
    exitabilityCertificateHash: 'exit_cert_hash_001',
    portfolioSnapshotHash: 'port_snap_hash_001',
    stateLeaseHash: 'state_lease_hash_001',
    maximumSolLamports: 1_000_000_000n, // 1 SOL
    maximumTokensRaw: 10_000_000n,
    minimumOutputTokensRaw: 9_500_000n,
  });

  assert.equal(permit.authorityVersion, 'SYLPH_EXECUTION_AUTHORITY_V2');
  assert.ok(permit.permitSealSignature.length === 64);

  // Validate permit succeeds on valid transaction
  const valid = UltimateExecutionPermitAuthority.validatePermit(permit, {
    wireTransactionHash: exactWireTxHash,
    currentSolLamportsToMove: 1_000_000_000n,
    currentDeliveryPath: 'JITO_BUNDLE',
  });
  assert.equal(valid.isValid, true);

  // Validate permit fails on tampered wire hash
  const tampered = UltimateExecutionPermitAuthority.validatePermit(permit, {
    wireTransactionHash: 'tampered_wire_hash_xyz999',
    currentSolLamportsToMove: 1_000_000_000n,
    currentDeliveryPath: 'JITO_BUNDLE',
  });
  assert.equal(tampered.isValid, false);
  assert.ok(tampered.violationReason.includes('TRANSACTION_HASH_MISMATCH'));

  // 2. Seal Ultimate Execution Record (19-link chain)
  const executionRecord = UltimateExecutionRecordLedger.sealRecord({
    intentId: 'intent_001',
    mint,
    canonicalEventsHash: 'events_hash_001',
    tokenTruthCertificateHash: 'truth_hash_001',
    authenticityCertificateHash: 'auth_hash_001',
    opportunityDecisionHash: 'decision_hash_001',
    exitabilityCertificateHash: 'exit_hash_001',
    quoteHash: 'quote_hash_001',
    transactionRootHash: 'tx_root_hash_001',
    runtimeRootHash: runtime.runtimeRootHash,
    programRootsHash: program.programRootHash,
    simulationCertificateHash: 'sim_cert_hash_001',
    stateLeaseHash: 'state_lease_hash_001',
    executionPermitHash: permit.permitSealSignature,
    signingIntentHash: 'signing_intent_hash_001',
    deliveryReceiptHash: 'delivery_rcpt_hash_001',
    landedOutcomeCertificateHash: 'landed_cert_hash_001',
    positionRecordHash: 'pos_rec_hash_001',
    exitDecisionHash: 'exit_dec_hash_001',
    settlementRecordHash: 'settle_hash_001',
    calibrationRecordHash: 'calib_hash_001',
    counterfactualRegretHash: 'regret_hash_001',
  });

  assert.ok(executionRecord.provenanceChainSeal.length === 64);
  const isIntegrityVerified = UltimateExecutionRecordLedger.verifyRecordIntegrity(executionRecord);
  assert.equal(isIntegrityVerified, true);
});
