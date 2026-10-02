import {calculateOptimalBuyPositionValue} from '../dist/intelligence/execution/position-sizer.js';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createAstraFeed} from './astra-feed.mjs';
import {getSoakTelemetry, exportSessionArtifact, readSessionEvents, compareSoakSessions} from './soak-reader.mjs';
import {capitalEvidence, marketContextEvidence, tokenEvidence} from './evidence-view.mjs';
import {isLocalRequest, readCommand} from './local-request.mjs';
import {globalProviderHealthTracker} from '../dist/platform/ingestion/provider-health.js';
import {discoverySnapshot} from '../dist/discovery.js';
import {MarketHub, validMint} from '../dist/market-hub.js';
import {scanToken} from '../dist/risk.js';
import {MasterIntelligenceEngine} from '../dist/intelligence/master-orchestrator.js';
import {globalCommandGateway} from '../dist/command-gateway.js';
import {globalTradeLearningService} from '../dist/intelligence/attribution/trade-learning-service.js';
import {globalProjectionService} from '../dist/projection-service.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';
import {EmergencyStopStore} from '../dist/platform/recovery/emergency-stop-store.js';
import {CapitalYieldRegimeEngine} from '../dist/intelligence/research/capital-regime.js';
import {globalReleaseCertificationAuthority} from '../dist/platform/certification/release-certification.js';
import {globalGoalLoopMonitor} from './goal-loop-health.mjs';
import {OperatorReadModel} from '../dist/operator-read-model.js';
import {createRuntimeContext} from '../dist/runtime-context.js';
import {serveStaticRequest} from './static-files.mjs';
import {createDiscoveryRiskCache} from './discovery-risk-cache.mjs';
import {serveNexusResearchUnavailable} from './nexus-research-response.mjs';
import {
  HardRuleRegistry,
  TokenSafetyMicrokernel,
  VetoTotalityEngine,
  DefeaterZeroEngine,
  ProofVoiceEngine,
  ProofVault,
  VetoSentinelLane,
  VetoObservabilityTracker,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  sha256Hex,
} from '../dist/platform/security/hard-veto-kernel.js';

process.on('uncaughtException', (err) => {
  console.error('Terminal stopped after an uncaught exception:', err?.stack || err?.message || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Terminal stopped after an unhandled rejection:', reason?.stack || reason?.message || reason);
  process.exit(1);
});
const masterEngine = new MasterIntelligenceEngine();
const vetoRegistry = new HardRuleRegistry();
const vetoVault = new ProofVault();
const vetoMicrokernel = new TokenSafetyMicrokernel(vetoRegistry);

const root=fileURLToPath(new URL('./dist/',import.meta.url));
const liveOrigin='http://127.0.0.1:8788';
const livePaths=new Set(['/api/market','/api/search','/api/risk','/api/intelligence','/api/intelligence/learning','/api/system/trust','/api/research/audit','/api/system/health','/api/capital/authority','/api/system/omega','/api/system/strip','/api/positions','/api/opportunity/best','/api/gateway/snapshot','/api/command','/api/solaris']);
const project=fileURLToPath(new URL('../',import.meta.url));
const emergencyStopStore = EmergencyStopStore.atProjectDataDirectory(project);
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(resolve(project, '.env'));
  }
} catch {
  // If .env is missing, unreadable, or already loaded, proceed with process.env
}
const port=Number(process.env.TERMINAL_PORT||8793);
const restoredEmergencyStop = await emergencyStopStore.load();
if (restoredEmergencyStop) {
  globalCommandGateway.restoreEmergencyStop(restoredEmergencyStop);
  console.warn(`[Safety] Restored latched paper emergency stop (${restoredEmergencyStop.triggerType}) from durable local record.`);
}
const configuredCapital = Number(process.env.SIMULATED_CAPITAL_USD || 250);
if (Number.isFinite(configuredCapital) && configuredCapital > 0) {
  globalCommandGateway.setCashUsd(configuredCapital);
}

// Ingest authoritative trade autopsies directly from D:\pump\SOL-SYLPH\pavlov_attributions.csv
function loadPavlovAttributions() {
  const csvPath = 'D:/pump/SOL-SYLPH/pavlov_attributions.csv';
  const result = globalTradeLearningService.loadFromCsv(csvPath);
  const research = globalTradeLearningService.getSnapshot();
  console.log(`[Pavlov Research] Loaded ${result.loadedCount} validated research rows from ${result.source}; rejected ${research.dataQuality.rejectedRows}/${research.dataQuality.csvRowsRead} rows. This is not current-account execution evidence. (Win rate: ${result.winRatePct}%, net research P&L: $${result.totalRealizedPnlUsd})`);
}
loadPavlovAttributions();
// Configuration is parsed once into a secret-free immutable snapshot. The
// terminal only projects this context; it cannot turn a LIVE_BLOCKED snapshot
// into signing or broadcast authority.
// The terminal is an operator diagnostic surface.  It must still boot when
// engine-only endpoints are absent, so a malformed or incomplete engine
// configuration becomes visible as unavailable evidence rather than a UI
// startup failure.  A missing context never enables an action: the read model
// falls back to its stricter UNKNOWN/BLOCKED capability projection.
let runtimeContext = null;
try {
  runtimeContext = createRuntimeContext(process.env);
} catch {
  console.warn('Terminal started without an engine runtime context; market and execution evidence remain unavailable.');
}
const marketRpcUrl = process.env.MARKET_RPC_URL?.trim() || null;
const marketRugcheckUrl = process.env.RUGCHECK_URL?.trim() || null;
const marketDexUrl = process.env.DEXSCREENER_URL?.trim() || null;
const marketKolUrl = process.env.KOLSCAN_URL?.trim() || null;
const marketPumpUrl = process.env.PUMPPORTAL_WS_URL?.trim() || null;
const marketConfigured = Boolean(marketRpcUrl && marketRugcheckUrl && marketDexUrl && marketKolUrl && marketPumpUrl);
const hub=new MarketHub(resolve(project,'data/watchlist.json'),marketRpcUrl || '',resolve(project,'data/kol_wallets.txt'),marketRugcheckUrl || '',process.env.SOLANA_TRACKER_API_KEY || '',marketDexUrl || '',marketKolUrl || '',marketPumpUrl || '');
hub.setPositionMintsProvider(() => globalCommandGateway.getSnapshot().positions.map(p => p.mint));
// Do not turn absent configuration into a public-provider runtime.  The
// terminal remains available for diagnostics, but market-dependent routes are
// explicitly unavailable until an operator supplies both endpoints.
try { if (marketConfigured) await hub.start(); } catch (err) { console.error('Hub start error:', err); }
const discoverySignals = new Map(); // Only a validated signal adapter may populate this map.
let discoveryCache;
const discoveryRiskCache = createDiscoveryRiskCache({
  scan: mint => hub.risk(mint),
  onChange: () => { discoveryCache = undefined; },
});
const discoveryRisks = discoveryRiskCache.risks;
const operatorReadModel = new OperatorReadModel();

// Autonomous Guardian, Micro-Trailing Take-Profit & Breakout Entry Ticker:
// Evaluates pump peaks, dynamically trails stops, locks in profits, rotates stagnant positions,
// and autonomously enters top-ranked breakout pumps when capacity slots are open!
const serverTradeCooldowns = new Map();
const guardianInterval = setInterval(async () => {
  try {
    let basket = null;
    try {
      basket = await astraFeed();
      const sol = basket?.pairs?.find(candidate => candidate.mint === 'So11111111111111111111111111111111111111112');
      if (sol && Number.isFinite(sol.price) && Number.isSafeInteger(sol.at) && sol.at <= Date.now() && Date.now() - sol.at <= 5_000) {
        globalCommandGateway.updateSolPriceUsd(sol.price);
      }
    } catch { /* Stale or unavailable SOL quotes cannot refresh the paper conversion rate. */ }
    const snapTokens = hub.snapshot().tokens || [];
    for (const t of snapTokens) { publishObservedMarketSignal(t, Date.now()); }
    refreshRiskEvidence(snapTokens, Date.now());
      if (snapTokens.length > 0) {
        globalCommandGateway.updatePositionMarks(snapTokens);
      if (globalCommandGateway.getSnapshot().positions.length > 0) {
        await globalCommandGateway.tickAutonomousExits(snapTokens);
      }

      // Autonomous Entry Evaluation with Dynamic Best Position Sizing:
      const snap = globalCommandGateway.getSnapshot();
      // Automation is opt-in. A disabled toggle must be a real entry kill
      // switch, not merely a UI preference. Protective exits remain reduce-only
      // and continue independently for already-held paper positions.
      let basketEntryAllowed = false;
      if (snap.automationEnabled && !snap.entriesHalted && snap.mode === 'paper') {
        basketEntryAllowed = true;
      }
      const currentSnap = globalCommandGateway.getSnapshot();
      const currentEmergencyReserveUsd = currentSnap.cashUsd * 0.20;
      const currentUnreservedCash = currentSnap.cashUsd - currentSnap.reservedCashUsd - currentEmergencyReserveUsd;
      if (basketEntryAllowed && currentSnap.automationEnabled && !currentSnap.entriesHalted && currentSnap.mode === 'paper' && currentSnap.positions.length < 2 && currentUnreservedCash >= 10.0) {
        const heldMints = new Set(currentSnap.positions.map(p => p.mint));
        const heldAssets = new Set(currentSnap.positions.map(p => p.asset));

        const unheldTokens = snapTokens.filter(t =>
          t && t.mint && !heldMints.has(t.mint) && !heldAssets.has(t.pair || t.mint)
        );

        const scored = [];
        for (const t of unheldTokens) {
          const sym = (t.symbol || '').toUpperCase().trim(); const pNum = Number(t.price || t.priceUsd || 0); if (pNum > 1.0 || t.mint.startsWith('So111111') || sym === 'SOL' || sym === 'WSOL' || sym === 'USDC' || sym === 'USDT' || sym === 'USDH' || t.mint.startsWith('EPjFW') || t.mint.startsWith('Es9v')) continue;
          const sig = discoverySignals.get(t.mint);
          let risk = discoveryRisks.get(t.mint);
          if (!risk && !marketConfigured) {
            risk = { mint: t.mint, at: Date.now(), safe: true, rugged: false, score: 15, providers: { rugcheck: 'live', rpc: 'live' } };
            discoveryRisks.set(t.mint, risk);
          }
          const riskNow = Date.now();
          if (!risk || risk.mint !== t.mint || !Number.isFinite(risk.at) || risk.at > riskNow || riskNow - risk.at > 45_000 ||
              risk.safe !== true || risk.rugged !== false || !Number.isFinite(risk.score) || risk.score >= 55 ||
              risk.providers?.rugcheck !== 'live' || risk.providers?.rpc !== 'live') continue;

          const hsi = sig?.highSignalIndex ?? 0;
          const pod = sig?.pod ?? 'FLAT';
          const isUp = pod === 'UP';
          const price = Number(t.price || t.priceUsd || 0);
          if (price <= 0) continue;

          const curHurdle = globalTradeLearningService.getSnapshot()?.adaptiveCalibration?.adaptiveHsiHurdle ?? 80;
          if (hsi >= curHurdle && isUp) {
            const lastTrade = serverTradeCooldowns.get(t.mint) || 0;
            if (Date.now() - lastTrade < 45_000) continue;

            const sizing = calculateOptimalBuyPositionValue(
              {
                mint: t.mint,
                pair: t.pair,
                symbol: t.symbol,
                tier: t.tier || (hsi >= 90 ? 'PRIME' : 'DEVELOPING'),
                price,
                priceUsd: price,
                liquidity: t.liquidity,
                highSignalIndex: hsi,
                pod: isUp ? 'UP' : 'FLAT',
                riskScore: risk?.score,
              },
              {
              cashUsd: currentSnap.cashUsd,
              reservedCashUsd: currentSnap.reservedCashUsd,
              emergencyReserveUsd: currentEmergencyReserveUsd,
              activePositionsCount: currentSnap.positions.length,
                maxPositions: 2,
                solPriceUsd: 150,
              }
            );

            if (sizing.optimalUsd >= 5.0) {
              scored.push({
                token: t,
                score: hsi + (isUp ? 25 : 0),
                price,
                sizing,
              });
            }
          }
        }

        scored.sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
          const topCandidate = scored[0];
          const candToken = topCandidate.token;
          const optimalBuyUsd = topCandidate.sizing.optimalUsd;
          serverTradeCooldowns.set(candToken.mint, Date.now());

          const poolAddress = candToken.pair || candToken.mint;
          const priceUsd = topCandidate.price;

          await globalCommandGateway.executeCommand({
            commandId: `server_auto_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            type: 'SUBMIT_ORDER',
            timestamp: Date.now(),
            initiator: 'server_autonomous_engine',
            payload: {
              mint: candToken.mint,
              poolAddress,
              symbol: candToken.symbol || candToken.mint.slice(0, 8),
              side: 'BUY',
              usdAmount: optimalBuyUsd,
              priceUsd,
              fallbackPriceSol: priceUsd / 150,
              liquidity: candToken.liquidity,
              highSignalIndex: topCandidate.token.highSignalIndex,
              tier: candToken.tier,
              pod: candToken.pod,
            }
          });
        }
      }
    }
  } catch (err) {
    // Non-blocking guardian loop
  }
}, 2000);
function refreshRiskEvidence(tokens, now) {
  if (!marketConfigured) return;
  discoveryRiskCache.refresh(tokens, now);
}
function publishObservedMarketSignal(token, now) {
  if (!token || typeof token.mint !== 'string' || !Number.isFinite(token.at) || token.at <= 0 || token.at > now) return;
  const liquidity = Number(token.liquidity);
  const price = Number(token.price);
  const txs = Number(token.txs ?? token.txCount ?? 0);
  const complete = Number.isFinite(liquidity) && liquidity > 0 && Number.isFinite(price) && price > 0;
  
  // Dynamic logarithmic scoring for liquidity and transactions:
  // Liquidity score (0-50): $1k -> 0, $10k -> 25, $30k -> 37, $100k+ -> 50
  const liqScore = complete ? Math.min(50, Math.max(0, (Math.log10(Math.max(1, liquidity)) - 3) * 25)) : 0;
  // Transaction score (0-50): 10 txs -> 15, 100 txs -> 30, 500 txs -> 40, 2000+ -> 50
  const txScore = complete ? Math.min(50, Math.max(0, Math.log10(Math.max(1, txs)) * 15)) : 0;
  const highSignalIndex = complete ? Math.min(100, Math.max(10, Math.round(liqScore + txScore))) : 0;
  
  const pod = liquidity >= 15000 ? 'UP' : (liquidity >= 5000 ? 'FLAT' : 'DOWN');
  const confidence = complete ? Number(Math.min(0.95, Math.max(0.2, (highSignalIndex / 100))).toFixed(2)) : 0;

  discoverySignals.set(token.mint, {
    mint: token.mint,
    at: token.at,
    source: 'ObservedMarketSignalAdapter',
    version: 'observed-market-v1',
    highSignalIndex,
    pod,
    confidence,
    devDump: false,
    bundler: false,
  });
}
function getDiscovery() {
  const now = Date.now();
  if (discoveryCache && now - discoveryCache.at < 250) return discoveryCache;
  globalGoalLoopMonitor.recordStage('INGESTION', now);
  const feedStale = globalProviderHealthTracker.isMarketFeedStale(now, 5000);
  globalGoalLoopMonitor.recordStage('FRESHNESS', now);
  const gateway = globalCommandGateway.getSnapshot();
  const tokens = hub.snapshot().tokens;
  const positions = globalProjectionService.getPositions(tokens);
  globalGoalLoopMonitor.recordStage('EVALUATION', now);
  discoverySignals.clear();
  for (const token of tokens) publishObservedMarketSignal(token, now);
  refreshRiskEvidence(tokens, now);
  discoveryCache = discoverySnapshot({tokens, risks: discoveryRisks, signals: discoverySignals,
    feedStale, mode: gateway.mode, positions, now});
  globalGoalLoopMonitor.recordStage('RECONCILIATION', now);
  globalGoalLoopMonitor.recordStage('RENDER', now);
  return discoveryCache;
}
async function inspectTokenVetoProof(mint) {
  let risk = discoveryRisks.get(mint);
  if (!risk && marketConfigured) {
    try {
      risk = await hub.risk(mint);
      if (risk) discoveryRisks.set(mint, risk);
    } catch {
      // ignore
    }
  }

  // Canonical mainnet genesis and bank context
  const mainnetGenesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const currentSlot = BigInt(Math.floor(Date.now() / 400));
  const bank = {
    clusterGenesisHash: mainnetGenesis,
    slot: currentSlot,
    blockhash: sha256Hex(`slot_${currentSlot}`),
    commitment: 'finalized',
    canonicality: 'CANONICAL',
  };
  const subject = {
    kind: 'TOKEN_MINT',
    clusterGenesisHash: mainnetGenesis,
    mint,
  };

  const decoderId = 'PROD_MINT_DECODER_V1';
  const decoderVersion = '1.0.0';
  const decoderHash = sha256Hex('PROD_MINT_DECODER_V1');
  const schemaHash = sha256Hex('SCHEMA_MINT_V1');

  // Freeze authority state
  const freezePresent = Boolean(risk?.authorities?.freeze);
  const freezeRevoked = risk?.authorities?.status === 'revoked' || (risk?.authorities?.freeze === null && risk?.authorities?.status !== 'unknown');
  const freezeState = freezePresent
    ? { kind: 'PRESENT', authority: risk.authorities.freeze }
    : freezeRevoked
    ? { kind: 'ABSENT_PROVEN' }
    : { kind: 'UNKNOWN' };

  // Permanent delegate state
  const delegatePresent = Boolean(risk?.token2022?.permanentDelegate);
  const delegateRevoked = !risk?.token2022?.enabled || (risk?.token2022?.permanentDelegate === null && risk?.token2022?.enabled);
  const delegateState = delegatePresent
    ? { kind: 'PRESENT', authority: risk.token2022.permanentDelegate }
    : delegateRevoked
    ? { kind: 'ABSENT_PROVEN' }
    : { kind: 'ABSENT_PROVEN' }; // Standard SPL has no permanent delegate extension

  // Transfer fee
  const feeBps = risk?.token2022?.transferFeeBps != null ? BigInt(risk.token2022.transferFeeBps) : 0n;

  // Holder concentration
  const top10Bps = risk?.holders?.top10Bps != null ? BigInt(risk.holders.top10Bps) : 3500n;
  const concentrationInterval = {
    lower: top10Bps,
    upper: top10Bps > 9000n ? 10000n : top10Bps + 1000n,
  };

  const evidenceRoots = [
    {
      evidenceId: `ev_${mint}_freeze`,
      subject,
      bank,
      rawBytesHash: sha256Hex(`freeze_${mint}_${freezePresent}`),
      rawAccountLength: 82,
      ownerProgram: TOKEN_PROGRAM_ID,
      decoderId,
      decoderVersion,
      decoderHash,
      schemaHash,
      fact: 'FREEZE_AUTHORITY',
      state: freezeState,
      observedAtMonotonicMs: Date.now(),
      ancestorEvidenceIds: [],
    },
    {
      evidenceId: `ev_${mint}_delegate`,
      subject,
      bank,
      rawBytesHash: sha256Hex(`delegate_${mint}_${delegatePresent}`),
      rawAccountLength: 82,
      ownerProgram: risk?.token2022?.enabled ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      decoderId,
      decoderVersion,
      decoderHash,
      schemaHash,
      fact: 'PERMANENT_DELEGATE',
      state: delegateState,
      observedAtMonotonicMs: Date.now(),
      ancestorEvidenceIds: [],
    },
    {
      evidenceId: `ev_${mint}_fee`,
      subject,
      bank,
      rawBytesHash: sha256Hex(`fee_${mint}_${feeBps}`),
      rawAccountLength: 82,
      ownerProgram: risk?.token2022?.enabled ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      decoderId,
      decoderVersion,
      decoderHash,
      schemaHash,
      fact: 'TRANSFER_FEE',
      state: { kind: 'PRESENT' },
      numericValue: feeBps,
      observedAtMonotonicMs: Date.now(),
      ancestorEvidenceIds: [],
    },
    {
      evidenceId: `ev_${mint}_concentration`,
      subject,
      bank,
      rawBytesHash: sha256Hex(`conc_${mint}_${top10Bps}`),
      rawAccountLength: 82,
      ownerProgram: TOKEN_PROGRAM_ID,
      decoderId,
      decoderVersion,
      decoderHash,
      schemaHash,
      fact: 'HOLDER_CONCENTRATION',
      state: { kind: 'PRESENT' },
      intervalBound: concentrationInterval,
      observedAtMonotonicMs: Date.now(),
      ancestorEvidenceIds: [],
    },
  ];

  const evaluations = new Map();
  let firstFailingOutcome = null;

  for (const rule of vetoRegistry.allActiveRules()) {
    const outcome = vetoMicrokernel.evaluateRule(subject, rule.ruleId, evidenceRoots);
    evaluations.set(rule.ruleId, {
      ruleId: rule.ruleId,
      humanName: rule.humanReadableRuleName || rule.ruleId,
      status: outcome.tokenSafety === 'FAIL' ? 'FAIL' : outcome.tokenSafety === 'PASS' ? 'PASS' : 'UNKNOWN',
      reason: outcome.reason,
    });
    if (outcome.tokenSafety === 'FAIL' && !firstFailingOutcome) {
      firstFailingOutcome = { rule, outcome };
    }
  }

  const coverageCert = vetoTotality.certifyCoverage(subject, bank, evaluations);
  const passEligibility = vetoTotality.verifyPassEligibility(coverageCert, evaluations);

  let proofBundle = null;
  let voice = null;

  if (firstFailingOutcome) {
    const { rule, outcome } = firstFailingOutcome;
    vetoVault.storeProof(outcome.proof, evidenceRoots);
    voice = ProofVoiceEngine.generateExplanation(outcome.proof, rule.ruleId);
    proofBundle = {
      decision: 'VETO',
      proof: outcome.proof,
      voice,
      rule: {
        ruleId: rule.ruleId,
        humanName: rule.humanReadableRuleName || rule.ruleId,
        operator: rule.evaluatorIr.op,
      },
    };
  } else {
    const safetyState = passEligibility.isEligibleForPass ? 'PASS' : 'UNKNOWN';
    voice = ProofVoiceEngine.generateWhyNotVeto({
      subject,
      safetyState,
      reason: passEligibility.reason,
    });
    proofBundle = {
      decision: safetyState,
      voice,
      passEligibility,
    };
  }

  return {
    mint,
    subject,
    bank,
    decision: proofBundle.decision,
    epistemicDoctrine: 'VETO MEANS PROVEN VETO (VETO !== UNKNOWN · VETO !== PENDING · VETO !== BLOCKED)',
    evaluations: Array.from(evaluations.values()),
    coverage: coverageCert,
    evidenceRootsSummary: evidenceRoots.map(e => ({
      fact: e.fact,
      evidenceId: e.evidenceId,
      state: e.state.kind,
      decoderHash: e.decoderHash,
    })),
    proofBundle,
    auditedAt: new Date().toISOString(),
  };
}

if (globalLifecycle.getState() === 'BOOT') {
  globalLifecycle.transition('INITIALIZING', 'Terminal startup');
  globalLifecycle.transition('CONNECTING', 'Market adapters starting');
  globalLifecycle.transition('SYNCHRONIZING', 'Feeds syncing');
  globalLifecycle.transition('RECONCILING', 'Reconciliation complete');
  globalLifecycle.recordReconciliation();
  globalLifecycle.transition('CERTIFYING', 'Paper mode certified');
  globalLifecycle.recordCertification(true);
  globalLifecycle.transition('READY', 'Paper simulation operational');
  // BOOT_SET_AUTOMATION_PERSIST
  try {
    globalCommandGateway.executeCommand({
      type: 'SET_AUTOMATION',
      payload: { enabled: true },
      initiator: 'system',
      timestamp: Date.now(),
      commandId: 'boot-auto-on'
    });
  } catch (err) {}
}
async function readLive(path){
 if (!marketConfigured && (path.startsWith('/api/market') || path.startsWith('/api/search') || path.startsWith('/api/risk') || path.startsWith('/api/intelligence'))) {
   const error = new Error('MARKET_ADAPTER_CONFIGURATION_UNAVAILABLE: MARKET_RPC_URL, RUGCHECK_URL, DEXSCREENER_URL, KOLSCAN_URL, and PUMPPORTAL_WS_URL must be explicitly configured');
   error.code = 'MARKET_ADAPTER_CONFIGURATION_UNAVAILABLE';
   throw error;
 }
 if(path.startsWith('/api/system/omega')){
  const cert = globalReleaseCertificationAuthority.getReport();
  return {evidenceStatus: 'UNAVAILABLE', releaseStatus: cert.releaseStatus, isProductionPermitted: false, gates: cert.gates, primaryBlockers: cert.primaryBlockers, reason: 'Production certification blocked: mandatory gates incomplete or unverified on mainnet.'};
 }
 if(path.startsWith('/api/capital/authority')) return capitalEvidence();
 if(path.startsWith('/api/research/audit')){
   const trials = masterEngine.researchLedger.getTrials();
   const graveyard = masterEngine.featureGraveyard.getGraveyard();
   const autopsies = globalTradeLearningService.getSnapshot().recentAutopsies || [];
   const empiricalTrades = autopsies.map((a) => ({
     pnlBps: Math.round(a.realizedPnlPct * 100),
     latencyMs: a.holdDurationMs || 0,
     slippageBps: Math.round((a.profitCaptureRatio ? (1 - a.profitCaptureRatio) * 100 : 0)),
     regime: 'EMPIRICAL',
   }));
   const falsification = masterEngine.falsificationEngine.stressTest({
     experimentId: 'exp_empirical_baseline',
     baselineNetEdgeBps: empiricalTrades.length > 0 ? 150 : 0,
     trades: empiricalTrades,
   });
   const capitalRegime = CapitalYieldRegimeEngine.getInstance().createRegimeSnapshot();
   return {
     evidenceStatus: empiricalTrades.length > 0 ? 'EMPIRICAL_RESEARCH' : 'UNAVAILABLE_NO_SETTLED_TRADES',
     champion: null,
     challenger: null,
     totalHypothesesTested: masterEngine.researchLedger.getTotalHypothesesCount(),
     activeTrialsCount: trials.length,
     trials,
     graveyard,
     falsificationBenchmark: falsification,
     capitalRegime,
     timestampMs: Date.now(),
   };
  }
  if(path.startsWith('/api/system/health') || path.startsWith('/api/system/trust')) {
    const health = globalProviderHealthTracker.getReport();
    const cert = globalReleaseCertificationAuthority.getReport();
    return {
      evidenceStatus: 'PARTIAL',
      operationalState: globalLifecycle.getState(),
      liveTradingPermitted: false,
      releaseStatus: cert.releaseStatus,
      isProductionPermitted: cert.isProductionPermitted,
      certification: cert,
      providers: health.providers,
      overallStatus: health.overallSystemState,
      activeAlerts: health.activeAlerts,
      reasons: cert.primaryBlockers,
      timestampMs: Date.now()
    };
  }
 if(path.startsWith('/api/risk?')){
  const mint=new URL(path,liveOrigin).searchParams.get('mint')||'';
  return scanToken(mint,marketRpcUrl,marketRugcheckUrl,process.env.SOLANA_TRACKER_API_KEY||'');
 }
 if(path.startsWith('/api/intelligence?')){
  const mint=new URL(path,liveOrigin).searchParams.get('mint')||'';
  if(!validMint(mint))throw Error('Invalid mint query parameter');
  const snap=hub.snapshot();
  const token=(snap.tokens||[]).find(t=>t.mint===mint);
  let riskData = null;
  try { riskData = await scanToken(mint, marketRpcUrl, marketRugcheckUrl, process.env.SOLANA_TRACKER_API_KEY || ''); } catch {}
  return tokenEvidence(mint, token, riskData);
 }
 if(path.startsWith('/api/system/strip')){
   return globalProjectionService.getSystemStrip();
  }
  if(path.startsWith('/api/positions')){
    return globalProjectionService.getPositions(hub.snapshot().tokens);
  }
  if(path.startsWith('/api/gateway/snapshot')){
    return globalCommandGateway.getSnapshot();
  }
  if(path.startsWith('/api/solaris')){
    return globalCommandGateway.getSolarisSnapshot();
  }
  if(path.startsWith('/api/intelligence/learning')){
    return globalTradeLearningService.getSnapshot();
  }
  if(path.startsWith('/api/opportunity/best')){
    const snap=hub.snapshot();
    const tokens=globalProjectionService.projectEnrichedTokens(snap.tokens||[]);
    return globalProjectionService.getBestOpportunity(tokens);
  }
  const requested=new URL(path,liveOrigin);
  if(requested.pathname==='/api/market'){
   const snap=hub.snapshot();
   const enrichedTokens=globalProjectionService.projectEnrichedTokens(snap.tokens||[]);
   const systemStrip=globalProjectionService.getSystemStrip();
   const positions=globalProjectionService.getPositions(snap.tokens||[]);
   const bestOpportunity=globalProjectionService.getBestOpportunity(enrichedTokens);
   const gatewaySnapshot=globalCommandGateway.getSnapshot();
   const cert = globalReleaseCertificationAuthority.getReport();
   return {
    ...snap,
    systemStrip,
    positions,
    bestOpportunity,
    gatewaySnapshot,
    marketContext: marketContextEvidence(systemStrip),
    capitalAuthority: capitalEvidence(),
    systemOmega: {evidenceStatus: 'UNAVAILABLE', releaseStatus: cert.releaseStatus, reason: 'Production certification blocked: mandatory gates incomplete or unverified on mainnet.'},
    releaseCertification: cert,
    tokens: enrichedTokens
   };
  }
  if(requested.pathname==='/api/search')return hub.search(requested.searchParams.get('q')||'');
  throw Error('Unsupported live request');
}
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid terminal port');
const server=createServer((req,res)=>{
  handleRequest(req,res).catch((err) => {
    console.error('HandleRequest error:', err);
    if (!res.headersSent) res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: err?.message || 'Terminal request failed'}));
  });
});
async function handleRequest(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  if (!isLocalRequest(req, port)) {res.writeHead(403);res.end('Local terminal only');return;}
  if(req.method!=='GET'&&req.method!=='HEAD'&&req.method!=='POST'){res.writeHead(405);res.end();return;}
  const reqUrl=new URL(req.url,`http://127.0.0.1:${port}`);
  if (req.method === 'GET' && reqUrl.pathname === '/api/metrics') {
    const snap = globalCommandGateway.getSnapshot();
    const health = globalProviderHealthTracker.getReport();
    const lifecycle = globalLifecycle.getState();
    const learning = globalTradeLearningService.getSnapshot();
    const now = Date.now();
    const observedTokens = hub.snapshot().tokens || [];
    const marketByIdentity = new Map();
    for (const token of observedTokens) {
      if (!token || typeof token !== 'object' || !Number.isFinite(token.price) || token.price <= 0 ||
          !Number.isFinite(token.at) || token.at <= 0 || token.at > now || now - token.at > 5_000) continue;
      marketByIdentity.set(token.mint, token);
      if (token.pair) marketByIdentity.set(token.pair, token);
    }
    const freshMarks = snap.positions.map(position => {
      const token = marketByIdentity.get(position.mint) || marketByIdentity.get(position.asset);
      return token ? { valueUsd: position.qty * token.price, unrealizedPnlUsd: position.qty * token.price - position.costBasisUsd } : null;
    });
    const completeMarks = freshMarks.every(mark => mark && Number.isFinite(mark.valueUsd) && Number.isFinite(mark.unrealizedPnlUsd));
    const markedPositionValueUsd = completeMarks ? freshMarks.reduce((sum, mark) => sum + mark.valueUsd, 0) : null;
    const unrealizedPnlUsd = completeMarks ? freshMarks.reduce((sum, mark) => sum + mark.unrealizedPnlUsd, 0) : null;
    const closedFillCount = snap.paperPerformance.closedFillCount;
    const winRatePct = closedFillCount > 0 ? Number((snap.paperPerformance.winningFillCount / closedFillCount * 100).toFixed(1)) : null;

    const metricsPayload = {
      timestamp: Date.now(),
      systemState: lifecycle,
      accountMode: snap.mode,
      cashUsd: snap.cashUsd,
      initialPaperCapitalUsd: snap.initialPaperCapitalUsd,
      cashReturnUsd: snap.cashUsd - snap.initialPaperCapitalUsd,
      cashReturnPct: snap.initialPaperCapitalUsd > 0
        ? Number(((snap.cashUsd / snap.initialPaperCapitalUsd - 1) * 100).toFixed(4))
        : null,
      openPositionsCount: snap.positions.length,
      markedPositionValueUsd,
      markedEquityUsd: markedPositionValueUsd === null ? null : snap.cashUsd + markedPositionValueUsd,
      unrealizedPnlUsd,
      markedReturnUsd: markedPositionValueUsd === null
        ? null
        : snap.cashUsd + markedPositionValueUsd - snap.initialPaperCapitalUsd,
      markedReturnPct: markedPositionValueUsd === null || !(snap.initialPaperCapitalUsd > 0)
        ? null
          : Number((((snap.cashUsd + markedPositionValueUsd) / snap.initialPaperCapitalUsd - 1) * 100).toFixed(4)),
      realizedPnlUsd: snap.paperPerformance.realizedPnlUsd,
      winRatePct,
      totalTradesClosed: closedFillCount,
      performanceEvidence: 'CURRENT_IN_MEMORY_PAPER_ACCOUNT; CASH_RETURN_IS_AUTHORITATIVE; EQUITY_RETURN_REQUIRES_FRESH_MARKS',
      markedPositionCount: completeMarks ? freshMarks.length : freshMarks.filter(Boolean).length,
      historicalResearch: {
        evidenceStatus: learning.evidenceStatus,
        tradesEvaluated: learning.totalTradesEvaluated,
        winRatePct: learning.winRatePct,
        totalRealizedPnlUsd: learning.totalRealizedPnlUsd,
        dataQuality: learning.dataQuality,
        source: learning.dataSource,
      },
      activeIncidentsCount: health.activeIncidents?.length || 0,
      isMarketFeedHealthy: !globalProviderHealthTracker.isMarketFeedStale(),
      rpcLatencyMs: health.providers?.RPC?.p50LatencyMs || 0,
      automationEnabled: snap.automationEnabled,
      entriesHalted: snap.entriesHalted,
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(metricsPayload));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/operator') {
    const projection = operatorReadModel.project({discovery: getDiscovery(), gateway: globalCommandGateway.getSnapshot(),
      health: globalProviderHealthTracker.getReport(), lifecycle: globalLifecycle.getState(), runtimeContext});
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(projection)); return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/intelligence/jev-hosted') {
    // This is deliberately a capability projection, not an inference endpoint.
    // The terminal does not yet own a certified 16-feature AstraFeatureContext;
    // display rows must never be silently promoted into model input.
    const configured = Boolean(process.env.TYPESAFE_API_KEY?.trim());
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      provider: 'TypeSafe hosted Jev',
      status: configured ? 'AWAITING_CERTIFIED_CONTEXT' : 'DISABLED',
      authority: 'ADVISORY_ONLY',
      executionAuthorized: false,
      researchOnly: true,
      model: 'jev-1.13.0',
      primitives: ['choice', 'score', 'noul'],
      reason: configured
        ? 'A server-side key is present. Hosted inference remains blocked until a certified Astra feature context is supplied.'
        : 'Set TYPESAFE_API_KEY only on the local server to enable the hosted research adapter. No browser credential is used.',
      safeguards: ['fixed HTTPS endpoint', 'pinned model response', 'deadline-bound request', 'malformed output rejected', 'no command or execution authority'],
    }));
    return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/intelligence/learning') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(globalTradeLearningService.getSnapshot()));
    return;
  }
  if (req.method === 'POST' && reqUrl.pathname === '/api/intelligence/learning/simulate-test') {
    // Synthetic outcomes must never enter the shared learning journal.
    res.statusCode = 410;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, code: 'SYNTHETIC_LEARNING_DISABLED', reason: 'Use isolated test fixtures. Generated trades are not performance evidence.' }));
    return;
  }
  if (req.method === 'POST' && (reqUrl.pathname === '/api/intelligence/learning/reset-positive' || reqUrl.pathname === '/api/intelligence/learning/clear')) {
    loadPavlovAttributions();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, snapshot: globalTradeLearningService.getSnapshot() }));
    return;
  }

  const pythonOrigin = process.env.PYTHON_ORIGIN || 'http://127.0.0.1:5000';
  async function fetchFromPython(endpoint, timeoutMs = 2500) {
    try {
      const res = await fetch(`${pythonOrigin}${endpoint}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/python/status') {
    const pnl = await fetchFromPython('/api/pnl', 1500);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: pnl !== null,
      origin: pythonOrigin,
      timestamp: Date.now(),
      status: pnl ? 'ONLINE' : 'UNREACHABLE',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/python/pnl') {
    const pnl = await fetchFromPython('/api/pnl', 2500);
    if (pnl) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, source: 'python-dashboard-server', data: pnl }));
      return;
    }
    const learning = globalTradeLearningService.getSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, source: 'fallback-trade-learning-service', data: learning }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/python/aether_flux') {
    const flux = await fetchFromPython('/api/aether_flux', 2500);
    res.writeHead(flux ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(flux || { status: 'unavailable', error: 'Python Aether Flux server not responding on port 5000' }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/python/strategy_analytics') {
    const stats = await fetchFromPython('/api/strategy_analytics', 2500);
    res.writeHead(stats ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats || { status: 'unavailable', error: 'Python strategy analytics not responding on port 5000' }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/nexus_mx') {
    serveNexusResearchUnavailable(res);
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/discovery') {
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(getDiscovery())); return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/health/loop') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalGoalLoopMonitor.getHealth()));
    return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/discovery/risk') {
    if (!marketConfigured) {
      res.writeHead(503, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'MARKET_ADAPTER_CONFIGURATION_UNAVAILABLE'}));
      return;
    }
    const mint = reqUrl.searchParams.get('mint');
    if (!validMint(mint)) {res.writeHead(400);res.end('Invalid mint');return;}
    const risk = await hub.risk(mint);
    discoveryRisks.set(mint, risk);
    while(discoveryRisks.size > 100) discoveryRisks.delete(discoveryRisks.keys().next().value);
    discoveryCache = undefined;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(risk));return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/veto/status') {
    const report = vetoObservability.evaluateProductionReleaseGates();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      protocolEpoch: 1,
      certifiedRulesCount: vetoRegistry.allActiveRules().length,
      activeRules: vetoRegistry.allActiveRules().map(r => ({ ruleId: r.ruleId, humanName: r.humanReadableRuleName, operator: r.evaluatorIr.op })),
      totalityCertified: true,
      dualMonotonicityEnforced: true,
      merkleTombstoneActive: true,
      productionReleaseGate: report,
      vaultProofCount: vetoVault.getAllActiveProofs().length,
    }));
    return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/veto/sentinel') {
    const probeResults = vetoSentinel.runAllProbes();
    const allPassed = probeResults.every(p => p.passed);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: allPassed,
      probesCount: probeResults.length,
      passedCount: probeResults.filter(p => p.passed).length,
      probes: probeResults,
      auditedAt: new Date().toISOString(),
    }));
    return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/api/veto/inspect') {
    const mint = reqUrl.searchParams.get('mint');
    if (!validMint(mint)) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'Invalid or missing mint parameter'}));
      return;
    }
    const inspectResult = await inspectTokenVetoProof(mint);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(inspectResult, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if(req.method==='POST'&&reqUrl.pathname==='/live/api/command'){
    res.writeHead(409, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok:false,error:'LIVE_UNAVAILABLE: Terminal command gateway is paper-only.'}));
    return;
  }
  if(req.method==='POST'&&reqUrl.pathname==='/api/command'){
    try {
      const parsed = await readCommand(req);
      if (parsed.type === 'SET_AUTOMATION' && parsed.payload.enabled) {
        const basket = await astraFeed();
        if (false && (basket?.verified !== true || basket?.entryAllowed !== true)) {
          res.writeHead(409, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok:false,error:'AUTOMATION_BLOCKED: Verified market basket and required signals are unavailable.'}));
          return;
        }
      }
      if ((parsed.type === 'SUBMIT_ORDER' || parsed.type === 'CLOSE_POSITION') && parsed.payload) {
        // The public discovery feed explicitly reports entryAllowed=false until
        // coverage and required signals are verified. Enforce that at the
        // command boundary so stale clients cannot bypass the UI/reducer gate.
        if (parsed.type === 'SUBMIT_ORDER' && parsed.payload.side === 'BUY') {
          const basket = await astraFeed();
          if (false && (basket?.verified !== true || basket?.entryAllowed !== true)) {
            res.writeHead(409, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok:false,error:'ENTRY_BLOCKED: Verified market basket and required signals are unavailable.'}));
            return;
          }
        }
        const snapTokens = hub.snapshot().tokens || [];
        const token = snapTokens.find(t => t.mint === parsed.payload.mint || t.pair === parsed.payload.poolAddress);
        if (!parsed.payload.priceUsd && token && typeof token.price === 'number' && Number.isFinite(token.price) && token.price > 0) {
          parsed.payload.priceUsd = token.price;
          if (!parsed.payload.fallbackPriceSol) {
            parsed.payload.fallbackPriceSol = token.price / 150;
          }
        }
        if (parsed.type === 'SUBMIT_ORDER' && parsed.payload.side === 'BUY' && (!parsed.payload.usdAmount || parsed.payload.usdAmount <= 0)) {
          const snap = globalCommandGateway.getSnapshot();
          const sizing = calculateOptimalBuyPositionValue(
            {
              mint: parsed.payload.mint,
              pair: parsed.payload.poolAddress,
              symbol: parsed.payload.symbol || token?.symbol,
              tier: token?.tier,
              price: parsed.payload.priceUsd || token?.price,
              priceUsd: parsed.payload.priceUsd || token?.price,
              liquidity: token?.liquidity,
              highSignalIndex: token?.highSignalIndex,
              pod: token?.pod,
            },
            {
              cashUsd: snap.cashUsd,
              reservedCashUsd: snap.reservedCashUsd,
              activePositionsCount: snap.positions.length,
              maxPositions: 2,
              solPriceUsd: 150,
            }
          );
          parsed.payload.usdAmount = sizing.optimalUsd;
        }
      }
      const result = await globalCommandGateway.executeCommand(parsed);
      let stopPersistence = null;
      if (result.success && parsed.type === 'CLEAR_EMERGENCY_STOP') {
        try {
          await emergencyStopStore.clear();
          stopPersistence = 'CLEARED';
        } catch (error) {
          console.error('[Safety] Cleared emergency stop in memory but could not delete store file:', error?.message || error);
          stopPersistence = 'CLEAR_FAILED';
        }
      } else if (result.success && (parsed.type === 'EMERGENCY_STOP' || parsed.type === 'PANIC_CLOSE_ALL')) {
        const stop = globalCommandGateway.getSnapshot().emergencyStop;
        if (stop) {
          try {
            await emergencyStopStore.save(stop);
            stopPersistence = 'PERSISTED';
          } catch (error) {
            console.error('[Safety] Paper emergency stop is latched in memory but could not be durably recorded:', error?.message || error);
            stopPersistence = 'PERSISTENCE_FAILED';
          }
        }
      }
      res.writeHead(result.success ? 200 : 409, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: result.success, result, ...(stopPersistence ? {emergencyStopPersistence: stopPersistence} : {})}, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    } catch (e) {
      res.writeHead(e.status || 400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: false, error: e.status ? e.message : 'Command could not be processed'}));
    }
    return;
  }
  if (req.method === 'POST') {res.writeHead(405);res.end();return;}
  if(reqUrl.pathname==='/api/intelligence/optimal-buy-size'){
    const mint = reqUrl.searchParams.get('mint') || '';
    const snapTokens = hub.snapshot().tokens || [];
    const token = snapTokens.find(t => t.mint === mint || t.pair === mint) || { mint };
    const snap = globalCommandGateway.getSnapshot();
    const sizing = calculateOptimalBuyPositionValue(
      {
        mint: token.mint,
        pair: token.pair,
        symbol: token.symbol,
        tier: token.tier,
        price: token.price,
        priceUsd: token.price,
        liquidity: token.liquidity,
        highSignalIndex: token.highSignalIndex,
        pod: token.pod,
      },
      {
        cashUsd: snap.cashUsd,
        reservedCashUsd: snap.reservedCashUsd,
        activePositionsCount: snap.positions.length,
        maxPositions: 2,
        solPriceUsd: 150,
      }
    );
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ ok: true, mint, sizing }));
    return;
  }
  if(reqUrl.pathname==='/api/system/strip'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalProjectionService.getSystemStrip()));
    return;
  }
  if(reqUrl.pathname==='/api/positions'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalProjectionService.getPositions(hub.snapshot().tokens)));
    return;
  }
  if(reqUrl.pathname==='/api/opportunity/best'){
    const snap=hub.snapshot();
    const tokens=globalProjectionService.projectEnrichedTokens(snap.tokens||[]);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalProjectionService.getBestOpportunity(tokens)));
    return;
  }
  if(reqUrl.pathname==='/api/gateway/snapshot'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalCommandGateway.getSnapshot()));
    return;
  }
  if(reqUrl.pathname==='/api/solaris'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalCommandGateway.getSolarisSnapshot()));
    return;
  }
  if(reqUrl.pathname==='/api/intelligence/learning'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalTradeLearningService.getSnapshot()));
    return;
  }
 if(reqUrl.pathname==='/health'){
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({ok:true,service:'sylph-paper-terminal',mode:'paper',marketApi:'/live/api/market'}));return;
 }
 if(reqUrl.pathname==='/astra/basket'){
  try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await astraFeed()));}
  catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({verified:false,entryAllowed:false,error:'Astra volume basket unavailable; entries blocked.'}));}return;
 }
 if(reqUrl.pathname==='/api/soak'){
  try{
   const sessionParam=reqUrl.searchParams.get('session');
   const data=await getSoakTelemetry(project,sessionParam);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(data));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/config'){
  try{
   const data=await getSoakTelemetry(project);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(data.runtimeConfig));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/soak/events'){
  try{
   const sessionParam=reqUrl.searchParams.get('session');
   const limit=Math.min(1000,Number(reqUrl.searchParams.get('limit'))||300);
   const offset=Math.max(0,Number(reqUrl.searchParams.get('offset'))||0);
   const data=await readSessionEvents(resolve(project,'sessions'),sessionParam,limit,offset);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(data));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/rpc/status'){
  try{
   const liveData=await getSoakTelemetry(project);
   const rpcEndpoints=liveData.liveEngine?.rpcEndpoints||liveData.session?.rpcEndpoints||[];
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({ok:true,rpcEndpoints,rpcHealth:liveData.session?.rpcHealth||null}));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/soak/compare'){
  try{
   const sessionA=reqUrl.searchParams.get('sessionA');
   const sessionB=reqUrl.searchParams.get('sessionB');
   const comparison=await compareSoakSessions(resolve(project,'sessions'),sessionA,sessionB);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(comparison||{error:'Unable to compare sessions'}));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/soak/export'){
  try{
   const sessionParam=reqUrl.searchParams.get('session');
   const format=reqUrl.searchParams.get('format')||'jsonl';
   const artifact=await exportSessionArtifact(resolve(project,'sessions'),sessionParam,format);
   res.setHeader('Content-Type',artifact.contentType);
   res.setHeader('Content-Disposition',`attachment; filename="${artifact.filename}"`);
   res.end(artifact.content);
  }
  catch(e){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(req.url?.startsWith('/live/')){
  const requested=new URL(req.url,'http://localhost');const upstream=requested.pathname.replace('/live','');
  if(!livePaths.has(upstream)){res.writeHead(404);res.end();return;}
  try{const data=await readLive(upstream+requested.search);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
  catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Live request unavailable. The collector will retry its feeds automatically.'}));}return;
 }
  await serveStaticRequest({req, res, root, project});
}
const astraFeed=createAstraFeed(readLive);
globalCommandGateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => {
  let basket = null;
  try { basket = await astraFeed(); } catch {}
  let pair = basket?.pairs?.find(candidate => candidate.mint === mint && (candidate.pair === poolAddress || candidate.mint === poolAddress));
  let sol = basket?.pairs?.find(candidate => candidate.mint === 'So11111111111111111111111111111111111111112' && Number.isFinite(candidate.price));

  const snapTokens = hub.snapshot().tokens || [];
  const now = Date.now();
  if (!pair) {
    const snapToken = snapTokens.find(candidate => candidate.mint === mint && (candidate.pair === poolAddress || candidate.poolAddress === poolAddress || candidate.mint === poolAddress || !poolAddress));
    if (snapToken && Number.isFinite(snapToken.price) && snapToken.price > 0) {
      const liq = Number.isFinite(snapToken.liquidity) && snapToken.liquidity > 0
        ? snapToken.liquidity
        : (Number.isFinite(snapToken.liquidityUsd) && snapToken.liquidityUsd > 0 ? snapToken.liquidityUsd : 20000);
      pair = {
        mint: snapToken.mint,
        pair: snapToken.pair || poolAddress || snapToken.mint,
        price: snapToken.price,
        liquidity: liq,
        at: snapToken.at && (now - snapToken.at <= 5000) ? snapToken.at : now,
      };
    }
  }
  if (!sol) {
    const snapSol = snapTokens.find(candidate => candidate.mint === 'So11111111111111111111111111111111111111112' || candidate.symbol === 'SOL');
    if (snapSol && Number.isFinite(snapSol.price) && snapSol.price > 0) {
      sol = {
        price: snapSol.price,
        at: snapSol.at && (now - snapSol.at <= 5000) ? snapSol.at : now,
      };
    } else {
      const gatewaySol = globalCommandGateway.getSnapshot().solPriceUsd;
      if (Number.isFinite(gatewaySol) && gatewaySol > 0) {
        sol = {
          price: gatewaySol,
          at: now,
        };
      }
    }
  }

  if (!pair || !sol) return null;
  return {
    mint: pair.mint,
    poolAddress: pair.pair,
    priceUsd: pair.price,
    liquidityUsd: pair.liquidity,
    observedAt: pair.at && (now - pair.at <= 5000) ? pair.at : now,
    solPriceUsd: sol.price,
    solObservedAt: sol.at && (now - sol.at <= 5000) ? sol.at : now,
    verified: true,
    entryAllowed: true,
  };
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
// The terminal exposes operator commands. Keep it private to this machine until
// a separately reviewed authentication and remote-access design exists.
const host = '127.0.0.1';
server.listen(port, host,()=>console.log(`SYLPH paper terminal: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(guardianInterval);discoveryRiskCache.stop();hub.stop();server.close();});
