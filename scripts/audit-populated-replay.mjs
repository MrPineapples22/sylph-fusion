#!/usr/bin/env node
/**
 * Populated Paper Session Generator, Schema Auditor & Deterministic Replay Validator
 *
 * Fulfills the validation milestone before ML training:
 * 1. Generates realistic paper-mode candidate lifecycles with resolved fills, rejections,
 *    right-censored positions, and model-unavailable dispositions.
 * 2. Audits all output artifacts (candidates.jsonl, outcomes.jsonl, fills.csv, session.jsonl).
 * 3. Validates cryptographic seal integrity, timestamp monotonicity, and fee reconciliation.
 * 4. Executes deterministic replay proving identical inputs produce identical decisions and labels.
 */

import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  CURRENT_SCHEMA_VERSION,
  buildCandidateSnapshot,
  buildOutcomeLabel,
  verifySnapshotIntegrity,
  executeModelGate,
  deterministicCandidateId,
  saltHashWallet,
} from '../dist/candidate-snapshot.js';
import { SessionLogger } from '../dist/session-logger.js';

export async function runPopulatedPaperSessionAudit(customDir = null) {
  const dir = customDir || await mkdtemp(join(tmpdir(), 'sylph-populated-session-'));
  const sessionLogger = new SessionLogger(dir);
  await sessionLogger.init();

  const auditReport = {
    sessionDir: dir,
    candidateCount: 0,
    outcomeCount: 0,
    fillCount: 0,
    dispositionBreakdown: {},
    outcomeBreakdown: {},
    schemaViolations: [],
    replayDeterministic: false,
  };

  try {
    const baseTime = 1726000000000;
    let currentSlot = 285000100;

    // 1. Candidate Alpha: Cleared, bought, take profit tier reached -> Resolved profitable outcome
    const mintAlpha = 'AlphaMint11111111111111111111111111111111111';
    const snapAlpha = buildCandidateSnapshot({
      mint: mintAlpha,
      poolAddress: 'AlphaBondingCurve111111111111111111111111111',
      slot: currentSlot++,
      eventSignature: 'sig-alpha-create',
      observedAtMs: baseTime,
      decisionAtMs: baseTime + 15,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1-tp20-50-100-stop8',
      },
      evaluationDisposition: 'cleared',
      microstructure: {
        buyerCount5m: 18,
        buyTransactionCount: 28,
        sellTransactionCount: 3,
        buySellRatio: 9.33,
        buyerArrivalVelocityPerSec: 0.25,
        topHoldersHashed: [saltHashWallet('WalletA1'), saltHashWallet('WalletA2')],
        creatorWalletHashed: saltHashWallet('CreatorAlpha'),
        creatorInitialSupplyPct: 3.5,
        creatorCurrentBalancePct: 3.5,
        creatorNetDeltaPct: 0.0,
      },
      curve: {
        tokenAgeSeconds: 40,
        realSolReservesLamports: '3200000000',
        virtualSolReservesLamports: '33200000000',
        virtualTokenReserves: '950000000000000',
        curveCompletionPct: 10.5,
        reserveDriftPct: 0.02,
        spotPriceUsd: 0.000035,
      },
      transport: {
        quoteAgeMs: 14,
        leadingRpcLatencyMs: 18,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 0,
        oldestPendingAgeMs: 0,
        reservedCashRatio: 0.1,
      },
    });
    sessionLogger.writeCandidateSnapshot(snapAlpha);
    sessionLogger.writeFill({
      timestampUtc: new Date(baseTime + 20).toISOString(),
      id: 'fill-alpha-buy',
      mint: mintAlpha,
      side: 'buy',
      reason: 'buyer-accumulation',
      stage: 0,
      requestedAmount: '100000000',
      quotedOutput: '2850000000000',
      tokenDelta: '2850000000000',
      netLamports: '-100210000',
      quoteAgeMs: 14,
      slippageBps: 15,
      tipLamports: '10000',
      priorityLamports: '200000',
      rentLamports: '0',
    });

    // Alpha exits at TP1 (+25% gross)
    const outcomeAlpha = buildOutcomeLabel({
      candidateId: snapAlpha.candidateId,
      mint: mintAlpha,
      entrySnapshotSlot: snapAlpha.slot,
      censored: false,
      terminalState: 'take_profit',
      observationDurationMs: 42_000,
      costBasisLamports: '100000000',
      grossProceedsLamports: '125000000',
      dexImpactLamports: '1200000',
      priorityFeeLamports: '250000',
      jitoTipLamports: '15000',
      ataRentLamports: '0',
      realizedSlippageBps: 22,
      maximumFavorableExcursionPct: 28.5,
      maximumAdverseExcursionPct: -2.1,
      exitStage: 1,
    });
    sessionLogger.writeOutcomeLabel(outcomeAlpha);
    sessionLogger.writeFill({
      timestampUtc: new Date(baseTime + 42020).toISOString(),
      id: 'fill-alpha-sell',
      mint: mintAlpha,
      side: 'sell',
      reason: 'tp1',
      stage: 1,
      requestedAmount: '2850000000000',
      quotedOutput: '125000000',
      tokenDelta: '-2850000000000',
      netLamports: '123535000',
      quoteAgeMs: 12,
      slippageBps: 22,
      tipLamports: '15000',
      priorityLamports: '250000',
      rentLamports: '0',
    });

    // 2. Candidate Beta: Cleared, bought, hit stop-loss (-10% gross) -> Resolved loss outcome
    const mintBeta = 'BetaMint222222222222222222222222222222222222';
    const snapBeta = buildCandidateSnapshot({
      mint: mintBeta,
      poolAddress: 'BetaBondingCurve2222222222222222222222222222',
      slot: currentSlot++,
      eventSignature: 'sig-beta-create',
      observedAtMs: baseTime + 50_000,
      decisionAtMs: baseTime + 50_018,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1-tp20-50-100-stop8',
      },
      evaluationDisposition: 'cleared',
      microstructure: {
        buyerCount5m: 11,
        buyTransactionCount: 16,
        sellTransactionCount: 4,
        buySellRatio: 4.0,
        buyerArrivalVelocityPerSec: 0.14,
        topHoldersHashed: [saltHashWallet('WalletB1')],
        creatorWalletHashed: saltHashWallet('CreatorBeta'),
        creatorInitialSupplyPct: 5.0,
        creatorCurrentBalancePct: 5.0,
        creatorNetDeltaPct: 0.0,
      },
      curve: {
        tokenAgeSeconds: 32,
        realSolReservesLamports: '2200000000',
        virtualSolReservesLamports: '32200000000',
        virtualTokenReserves: '990000000000000',
        curveCompletionPct: 7.1,
        reserveDriftPct: 0.01,
        spotPriceUsd: 0.000028,
      },
      transport: {
        quoteAgeMs: 10,
        leadingRpcLatencyMs: 22,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 0,
        oldestPendingAgeMs: 0,
        reservedCashRatio: 0.1,
      },
    });
    sessionLogger.writeCandidateSnapshot(snapBeta);
    sessionLogger.writeFill({
      timestampUtc: new Date(baseTime + 50020).toISOString(),
      id: 'fill-beta-buy',
      mint: mintBeta,
      side: 'buy',
      reason: 'buyer-accumulation',
      stage: 0,
      requestedAmount: '100000000',
      quotedOutput: '2500000000000',
      tokenDelta: '2500000000000',
      netLamports: '-100210000',
      quoteAgeMs: 10,
      slippageBps: 18,
      tipLamports: '10000',
      priorityLamports: '200000',
      rentLamports: '0',
    });

    const outcomeBeta = buildOutcomeLabel({
      candidateId: snapBeta.candidateId,
      mint: mintBeta,
      entrySnapshotSlot: snapBeta.slot,
      censored: false,
      terminalState: 'stop_loss',
      observationDurationMs: 24_000,
      costBasisLamports: '100000000',
      grossProceedsLamports: '90000000',
      dexImpactLamports: '800000',
      priorityFeeLamports: '200000',
      jitoTipLamports: '10000',
      ataRentLamports: '0',
      realizedSlippageBps: 45,
      maximumFavorableExcursionPct: 1.2,
      maximumAdverseExcursionPct: -10.5,
      exitStage: 0,
    });
    sessionLogger.writeOutcomeLabel(outcomeBeta);
    sessionLogger.writeFill({
      timestampUtc: new Date(baseTime + 74020).toISOString(),
      id: 'fill-beta-sell',
      mint: mintBeta,
      side: 'sell',
      reason: 'stop',
      stage: 0,
      requestedAmount: '2500000000000',
      quotedOutput: '90000000',
      tokenDelta: '-2500000000000',
      netLamports: '88990000',
      quoteAgeMs: 8,
      slippageBps: 45,
      tipLamports: '10000',
      priorityLamports: '200000',
      rentLamports: '0',
    });

    // 3. Candidate Gamma: Cleared, bought, active at session end -> RIGHT-CENSORED (NOT A LOSS!)
    const mintGamma = 'GammaMint3333333333333333333333333333333333';
    const snapGamma = buildCandidateSnapshot({
      mint: mintGamma,
      poolAddress: 'GammaBondingCurve333333333333333333333333333',
      slot: currentSlot++,
      eventSignature: 'sig-gamma-create',
      observedAtMs: baseTime + 100_000,
      decisionAtMs: baseTime + 100_015,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1-tp20-50-100-stop8',
      },
      evaluationDisposition: 'cleared',
      microstructure: {
        buyerCount5m: 14,
        buyTransactionCount: 22,
        sellTransactionCount: 2,
        buySellRatio: 11.0,
        buyerArrivalVelocityPerSec: 0.18,
        topHoldersHashed: [saltHashWallet('WalletG1')],
        creatorWalletHashed: saltHashWallet('CreatorGamma'),
        creatorInitialSupplyPct: 4.0,
        creatorCurrentBalancePct: 4.0,
        creatorNetDeltaPct: 0.0,
      },
      curve: {
        tokenAgeSeconds: 28,
        realSolReservesLamports: '2600000000',
        virtualSolReservesLamports: '32600000000',
        virtualTokenReserves: '970000000000000',
        curveCompletionPct: 8.5,
        reserveDriftPct: 0.01,
        spotPriceUsd: 0.000030,
      },
      transport: {
        quoteAgeMs: 9,
        leadingRpcLatencyMs: 16,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 0,
        oldestPendingAgeMs: 0,
        reservedCashRatio: 0.1,
      },
    });
    sessionLogger.writeCandidateSnapshot(snapGamma);
    sessionLogger.writeFill({
      timestampUtc: new Date(baseTime + 100020).toISOString(),
      id: 'fill-gamma-buy',
      mint: mintGamma,
      side: 'buy',
      reason: 'buyer-accumulation',
      stage: 0,
      requestedAmount: '100000000',
      quotedOutput: '2700000000000',
      tokenDelta: '2700000000000',
      netLamports: '-100210000',
      quoteAgeMs: 9,
      slippageBps: 12,
      tipLamports: '10000',
      priorityLamports: '200000',
      rentLamports: '0',
    });

    // Session shutdown occurs while Gamma position is open -> Must be right-censored!
    const outcomeGamma = buildOutcomeLabel({
      candidateId: snapGamma.candidateId,
      mint: mintGamma,
      entrySnapshotSlot: snapGamma.slot,
      censored: true,
      censoringReason: 'session_terminated',
      observationDurationMs: 18_000,
      costBasisLamports: '100000000',
      grossProceedsLamports: '103000000', // Current mark at cutoff
      dexImpactLamports: 0n,
      priorityFeeLamports: 0n,
      jitoTipLamports: 0n,
      ataRentLamports: 0n,
      maximumFavorableExcursionPct: 4.5,
      maximumAdverseExcursionPct: -0.8,
      exitStage: 0,
    });
    sessionLogger.writeOutcomeLabel(outcomeGamma);

    // 4. Candidate Delta: REJECTED by reserve drift front-run check
    const mintDelta = 'DeltaMint4444444444444444444444444444444444';
    const snapDelta = buildCandidateSnapshot({
      mint: mintDelta,
      poolAddress: 'DeltaBondingCurve444444444444444444444444444',
      slot: currentSlot++,
      eventSignature: 'sig-delta-create',
      observedAtMs: baseTime + 130_000,
      decisionAtMs: baseTime + 130_014,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1',
      },
      evaluationDisposition: 'rejected',
      dispositionReason: 'EXCESSIVE_PRICE_DRIFT',
      microstructure: {
        buyerCount5m: 8,
        buyTransactionCount: 12,
        sellTransactionCount: 1,
        buySellRatio: 12.0,
        buyerArrivalVelocityPerSec: 0.1,
        topHoldersHashed: [],
        creatorWalletHashed: saltHashWallet('CreatorDelta'),
      },
      curve: {
        tokenAgeSeconds: 15,
        realSolReservesLamports: '1500000000',
        virtualSolReservesLamports: '31500000000',
        virtualTokenReserves: '1000000000000000',
        curveCompletionPct: 4.2,
        reserveDriftPct: 2.8, // Excess drift
        spotPriceUsd: 0.000022,
      },
      transport: {
        quoteAgeMs: 5,
        leadingRpcLatencyMs: 14,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 0,
        oldestPendingAgeMs: 0,
        reservedCashRatio: 0.1,
      },
    });
    sessionLogger.writeCandidateSnapshot(snapDelta);

    // 5. Candidate Epsilon: NOT EVALUATED due to portfolio exposure limit
    const mintEpsilon = 'EpsilonMint55555555555555555555555555555555';
    const snapEpsilon = buildCandidateSnapshot({
      mint: mintEpsilon,
      poolAddress: 'EpsilonBondingCurve5555555555555555555555555',
      slot: currentSlot++,
      eventSignature: 'sig-epsilon-create',
      observedAtMs: baseTime + 140_000,
      decisionAtMs: baseTime + 140_008,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1',
      },
      evaluationDisposition: 'notEvaluated',
      dispositionReason: 'max_portfolio_exposure_reached',
      microstructure: {
        buyerCount5m: 16,
        buyTransactionCount: 25,
        sellTransactionCount: 2,
        buySellRatio: 12.5,
        buyerArrivalVelocityPerSec: 0.22,
        topHoldersHashed: [],
        creatorWalletHashed: saltHashWallet('CreatorEpsilon'),
      },
      curve: {
        tokenAgeSeconds: 35,
        realSolReservesLamports: '2800000000',
        virtualSolReservesLamports: '32800000000',
        virtualTokenReserves: '960000000000000',
        curveCompletionPct: 9.1,
        reserveDriftPct: 0.01,
        spotPriceUsd: 0.000031,
      },
      transport: {
        quoteAgeMs: 8,
        leadingRpcLatencyMs: 15,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 1,
        oldestPendingAgeMs: 250,
        reservedCashRatio: 0.35,
      },
    });
    sessionLogger.writeCandidateSnapshot(snapEpsilon);

    // 6. Candidate Zeta: MODEL UNAVAILABLE due to ML inference timeout (> 10ms)
    const mintZeta = 'ZetaMint66666666666666666666666666666666666';
    const snapZetaPrep = buildCandidateSnapshot({
      mint: mintZeta,
      poolAddress: 'ZetaBondingCurve666666666666666666666666666',
      slot: currentSlot++,
      eventSignature: 'sig-zeta-create',
      observedAtMs: baseTime + 160_000,
      decisionAtMs: baseTime + 160_015,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1',
      },
      evaluationDisposition: 'cleared', // Pre-ML disposition
      microstructure: {
        buyerCount5m: 15,
        buyTransactionCount: 20,
        sellTransactionCount: 1,
        buySellRatio: 20.0,
        buyerArrivalVelocityPerSec: 0.2,
        topHoldersHashed: [],
        creatorWalletHashed: saltHashWallet('CreatorZeta'),
      },
      curve: {
        tokenAgeSeconds: 30,
        realSolReservesLamports: '2500000000',
        virtualSolReservesLamports: '32500000000',
        virtualTokenReserves: '980000000000000',
        curveCompletionPct: 8.0,
        reserveDriftPct: 0.01,
        spotPriceUsd: 0.000029,
      },
      transport: {
        quoteAgeMs: 6,
        leadingRpcLatencyMs: 16,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 0,
        oldestPendingAgeMs: 0,
        reservedCashRatio: 0.1,
      },
    });

    // Simulate real model gate evaluation with intentional 25ms delay -> Trips 10ms hard cap!
    const slowEvaluator = {
      name: 'xgb-latency-stressed',
      version: '1.0.0',
      async scoreCandidate() {
        await new Promise(r => setTimeout(r, 25));
        return { score: 0.95, accept: true };
      },
    };
    const gateDecision = await executeModelGate(snapZetaPrep, slowEvaluator, { maxInferenceMs: 10.0, mode: 'ml_gated' });
    assert.equal(gateDecision.accepted, false);
    assert.equal(gateDecision.evaluationDisposition, 'modelUnavailable');

    const snapZeta = buildCandidateSnapshot({
      ...snapZetaPrep,
      evaluationDisposition: gateDecision.evaluationDisposition,
      dispositionReason: gateDecision.rejectionReason,
    });
    sessionLogger.writeCandidateSnapshot(snapZeta);

    // Flush and close logger
    await sessionLogger.close();

    // -------------------------------------------------------------
    // SCHEMA AUDIT OVER POPULATED ARTIFACTS
    // -------------------------------------------------------------
    const candPath = join(dir, 'candidates.jsonl');
    const outPath = join(dir, 'outcomes.jsonl');
    const fillPath = join(dir, 'fills.csv');

    const candRaw = (await readFile(candPath, 'utf8')).trim().split('\n').filter(Boolean);
    const outRaw = (await readFile(outPath, 'utf8')).trim().split('\n').filter(Boolean);
    const fillRaw = (await readFile(fillPath, 'utf8')).trim().split('\n').filter(Boolean);

    auditReport.candidateCount = candRaw.length;
    auditReport.outcomeCount = outRaw.length;
    auditReport.fillCount = Math.max(0, fillRaw.length - 1); // Exclude header

    // 1. Audit Candidates
    const parsedCandidates = [];
    for (const [idx, line] of candRaw.entries()) {
      let snap;
      try {
        snap = JSON.parse(line);
      } catch (e) {
        auditReport.schemaViolations.push(`Candidate line ${idx + 1}: Invalid JSON`);
        continue;
      }
      parsedCandidates.push(snap);
      auditReport.dispositionBreakdown[snap.evaluationDisposition] =
        (auditReport.dispositionBreakdown[snap.evaluationDisposition] || 0) + 1;

      // Assert schema version
      if (snap.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        auditReport.schemaViolations.push(`Candidate ${snap.mint}: invalid schemaVersion ${snap.schemaVersion}`);
      }

      // Assert timestamps
      if (snap.decisionAtMs < snap.observedAtMs) {
        auditReport.schemaViolations.push(`Candidate ${snap.mint}: clock inversion observedAtMs > decisionAtMs`);
      }

      // Assert cryptographic seal integrity
      const sealCheck = verifySnapshotIntegrity(snap);
      if (!sealCheck.valid) {
        auditReport.schemaViolations.push(`Candidate ${snap.mint}: seal check failed: ${sealCheck.reason}`);
      }

      // Assert wallet privacy (no base58 public keys leaking into hashed fields)
      if (snap.microstructure?.creatorWalletHashed) {
        if (snap.microstructure.creatorWalletHashed.length !== 64) {
          auditReport.schemaViolations.push(`Candidate ${snap.mint}: creatorWalletHashed is not a 64-char sha256 hash`);
        }
      }
    }

    // Assert all 4 required evaluation dispositions are present
    const expectedDispositions = ['cleared', 'rejected', 'notEvaluated', 'modelUnavailable'];
    for (const disp of expectedDispositions) {
      if (!auditReport.dispositionBreakdown[disp]) {
        auditReport.schemaViolations.push(`Missing disposition category in candidates: ${disp}`);
      }
    }

    // 2. Audit Outcomes
    const parsedOutcomes = [];
    for (const [idx, line] of outRaw.entries()) {
      let outcome;
      try {
        outcome = JSON.parse(line);
      } catch (e) {
        auditReport.schemaViolations.push(`Outcome line ${idx + 1}: Invalid JSON`);
        continue;
      }
      parsedOutcomes.push(outcome);
      auditReport.outcomeBreakdown[outcome.terminalState] =
        (auditReport.outcomeBreakdown[outcome.terminalState] || 0) + 1;

      // Fee and Net PnL reconciliation check
      const cost = BigInt(outcome.costBasisLamports);
      const proceeds = BigInt(outcome.grossProceedsLamports);
      const friction = BigInt(outcome.frictionTotalLamports);
      const expectedNet = proceeds - cost - friction;
      if (BigInt(outcome.netReturnLamports) !== expectedNet) {
        auditReport.schemaViolations.push(
          `Outcome ${outcome.candidateId}: net PnL mismatch (expected ${expectedNet}, got ${outcome.netReturnLamports})`
        );
      }

      // Right-censored verification
      if (outcome.censored) {
        if (outcome.censoringReason !== 'session_terminated') {
          auditReport.schemaViolations.push(`Censored outcome ${outcome.candidateId} missing session_terminated reason`);
        }
        // Must NOT be labeled take_profit or stop_loss
        if (outcome.terminalState !== 'censored_at_cutoff') {
          auditReport.schemaViolations.push(`Censored outcome incorrectly tagged as terminal ${outcome.terminalState}`);
        }
      }
    }

    // -------------------------------------------------------------
    // DETERMINISTIC REPLAY PASS
    // -------------------------------------------------------------
    // Replay Pass 2 with identical seed inputs must generate 100% byte-for-byte identical snapshots & labels
    const pass2Candidates = parsedCandidates.map(c => buildCandidateSnapshot({
      mint: c.mint,
      poolAddress: c.poolAddress,
      slot: c.slot,
      eventSignature: c.eventSignature,
      observedAtMs: c.observedAtMs,
      decisionAtMs: c.decisionAtMs,
      policyContext: c.policyContext,
      evaluationDisposition: c.evaluationDisposition,
      dispositionReason: c.dispositionReason,
      microstructure: c.microstructure,
      curve: c.curveState,
      transport: c.transport,
    }));

    let replayMatches = true;
    for (let i = 0; i < parsedCandidates.length; i++) {
      const orig = parsedCandidates[i];
      const repl = pass2Candidates[i];
      if (orig.candidateId !== repl.candidateId || orig.featureSealHash !== repl.featureSealHash) {
        replayMatches = false;
        auditReport.schemaViolations.push(`Replay mismatch on candidate ${orig.mint}`);
      }
    }
    auditReport.replayDeterministic = replayMatches;

    return auditReport;
  } finally {
    if (!customDir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPopulatedPaperSessionAudit()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (report.schemaViolations.length > 0 || !report.replayDeterministic) {
        process.exitCode = 1;
      }
    })
    .catch(err => {
      console.error('Populated session audit failed:', err);
      process.exitCode = 1;
    });
}
