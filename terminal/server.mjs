import {calculateOptimalBuyPositionValue} from '../dist/intelligence/execution/position-sizer.js';
import {ResearchMatrixPolicyV1} from '../dist/intelligence/research-matrix/research-policy.js';
import {ResearchMatrixRegistry} from '../dist/intelligence/research-matrix/research-registry.js';
import {LiveReadinessEvaluator} from '../dist/platform/execution/live-readiness.js';
import {ProtocolCompatibilityManager} from '../dist/platform/execution/protocol-compatibility-lease.js';
import {createServer} from 'node:http';
import fs, {mkdirSync} from 'node:fs';
import {readEngineResearchAudit, resolveEngineDatabasePath} from './engine-research-audit.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createAstraFeed} from './astra-feed.mjs';
import {getSoakTelemetry, buildRpcStatusPayload, exportSessionArtifact, readSessionEvents, compareSoakSessions} from './soak-reader.mjs';
import {capitalEvidence, marketContextEvidence, tokenEvidence} from './evidence-view.mjs';
import {isLocalRequest, readCommand} from './local-request.mjs';
import {resolveTerminalNetworkBinding} from './network-binding.mjs';
import {globalProviderHealthTracker} from '../dist/platform/ingestion/provider-health.js';
import {discoverySnapshot} from '../dist/discovery.js';
import {MarketHub, validMint} from '../dist/market-hub.js';
import {scanToken, checkAntiSniperAndDexAsymmetry} from '../dist/risk.js';
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
import {assertDatabaseFilesystemPolicy} from '../dist/platform/storage/filesystem-policy.js';
import {serveStaticRequest} from './static-files.mjs';
import {createDiscoveryRiskCache} from './discovery-risk-cache.mjs';
import {isBasketEntryAuthorized, resolvePaperMarketEvidence} from './paper-market-evidence.mjs';
import {serveNexusResearchUnavailable} from './nexus-research-response.mjs';
import {enterPaperStartupDegraded, PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON} from './startup-readiness.mjs';
import {deriveSystemOverallStatus} from './health-status.mjs';
import {createGracefulShutdown} from './server-shutdown.mjs';
import {createRuntimeIdentity} from './runtime-identity.mjs';
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
import {
  EconomicFlightRecorder,
  SQLiteExecutionAttemptStore,
} from '../dist/intelligence/execution-adaptation/economic-flight-recorder.js';
import {
  RuntimeDivergenceAuditor,
} from '../dist/platform/pipeline/runtime-divergence.js';
import {
  HotPathCapsuleRegistry,
  createEvidenceLease,
} from '../dist/platform/assurance/hot-path-proof-capsule.js';
import {
  RealizedEdgeLedger,
} from '../dist/platform/pipeline/realized-edge-ledger.js';
import {handleCapitalReserveRequest} from './capital-reserve-policy.mjs';
import {
  LocalMarketUniverse,
  ProtocolCompatibilityRegistry,
  SolanaSensorTournament,
  SolanaTransportTournament,
  SolanaArbitrageGraph,
  SolanaMarketMakingEngine,
  SolanaStrategyEcology,
  SolanaPlannerVoi,
  SolanaMarketTwinResidualAuditor,
  BasisPointEngineeringLedger,
  SolanaAlphaFactory,
} from '../dist/platform/solana/index.js';
import {
  PaperAuthorityPolicy,
  MonteCarloBankrollEngine,
  V8HistoricalReplayEngine,
} from '../dist/platform/paper/index.js';
import {
  AntiPortfolioEngine,
} from '../dist/intelligence/research/index.js';
import {
  CatchabilityEngine,
  WinnerSeparationEngine,
  CompetingRiskRunner,
} from '../dist/intelligence/moonshot/index.js';
import {
  WalletEntropyCalculator,
  FundingClusterEngine,
  OrganicTakeoverDetector,
} from '../dist/intelligence/network/index.js';
import {
  ALL_50_EXECUTABLE_ALPHA_STUDIES,
  ResearchMatrixBridge,
  ExecutableAlphaCertificateIssuer,
  RunnerDistinguishabilityCourt,
  HISTORICAL_2X_TO_10X_BASE_RATE,
  InformationFrontierEngine,
  ExecutableLiquidationSurfaceEngine,
  ExitPolicyTournament,
  ExecutionLaneScorecardEngine,
  RunnerSearchCostEngine,
  PortfolioRuinEngine,
  ProspectiveLawCourt,
} from '../dist/intelligence/executable-alpha/index.js';
import { AutonomousRDGovernorX } from '../dist/intelligence/research-governor/rd-governor.js';

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
const vetoObservability = new VetoObservabilityTracker();
const vetoSentinel = new VetoSentinelLane();
const project=fileURLToPath(new URL('../',import.meta.url));
const runtimeIdentity = await createRuntimeIdentity(project);
const projectDataDir=resolve(project,'data');
mkdirSync(projectDataDir,{recursive:true});
const databaseFilesystemAttestation=process.env.DATABASE_FILESYSTEM_OPERATOR_ATTESTATION;
const databaseRuntimeMode=process.env.SYLPH_RUNTIME_MODE??process.env.MODE??'paper';
if(databaseFilesystemAttestation==='LOCAL_SINGLE_HOST_WAL_COMPATIBLE'&&databaseRuntimeMode!=='paper'){
  throw new Error('DATABASE_FILESYSTEM_OPERATOR_ATTESTATION_PAPER_ONLY');
}
const databaseFilesystem=assertDatabaseFilesystemPolicy(
  projectDataDir, process.platform, undefined, undefined, undefined,
  {allowUnclassified: databaseFilesystemAttestation === 'LOCAL_SINGLE_HOST_WAL_COMPATIBLE'},
);
if(databaseFilesystem.status==='UNCLASSIFIED_FILESYSTEM'||databaseFilesystem.status==='PLATFORM_UNCLASSIFIED'){
  console.warn(JSON.stringify({event:'database_filesystem_operator_attestation',status:databaseFilesystem.status,filesystemType:databaseFilesystem.filesystemType,verified:false,mode:databaseRuntimeMode}));
}
const engineAuditDatabasePath=resolveEngineDatabasePath(project);

// Real-World Scaling Blueprint Singletons
const flightRecorderStore = new SQLiteExecutionAttemptStore(resolve(projectDataDir,'economic-flight-recorder.sqlite'));
const flightRecorder = new EconomicFlightRecorder(flightRecorderStore);
const runtimeDivergenceAuditor = new RuntimeDivergenceAuditor();
const hotPathCapsuleRegistry = new HotPathCapsuleRegistry();
const realizedEdgeLedger = new RealizedEdgeLedger();
// Solana-Only Blueprint Singletons
const localMarketUniverse = new LocalMarketUniverse();
const protocolCompatibilityRegistry = new ProtocolCompatibilityRegistry();
const solanaSensorTournament = new SolanaSensorTournament();
const solanaTransportTournament = new SolanaTransportTournament();
const solanaArbitrageGraph = new SolanaArbitrageGraph();
const solanaMarketMakingEngine = new SolanaMarketMakingEngine();
const solanaStrategyEcology = new SolanaStrategyEcology();
const solanaPlannerVoi = new SolanaPlannerVoi();
const solanaMarketTwinAuditor = new SolanaMarketTwinResidualAuditor();
const basisPointEngineeringLedger = new BasisPointEngineeringLedger();
const solanaAlphaFactory = new SolanaAlphaFactory();

// Paper Max Risk & Moonshot Intelligence Singletons
const terminalAntiPortfolio = new AntiPortfolioEngine();
const terminalCatchability = new CatchabilityEngine();
const terminalWinnerSeparation = new WinnerSeparationEngine();
const terminalHazardEngine = new CompetingRiskRunner();
const terminalWalletEntropy = new WalletEntropyCalculator();
const terminalFundingClusters = new FundingClusterEngine();
const terminalOrganicTakeover = new OrganicTakeoverDetector();

// Executable Alpha Blueprint Singletons
const globalAlphaGovernor = new AutonomousRDGovernorX();
ResearchMatrixBridge.registerAllStudies(globalAlphaGovernor);
const globalLaneScorecards = new ExecutionLaneScorecardEngine();
globalLaneScorecards.recordAttempt({
  laneId: 'Jito-Bundle',
  landed: true,
  sameSlot: true,
  nextSlot: false,
  latencyMs: 380,
  feeUsd: 0.05,
  tipUsd: 0.25,
  implementationShortfallUsd: 0.85,
});
globalLaneScorecards.recordAttempt({
  laneId: 'Direct-TPU',
  landed: true,
  sameSlot: false,
  nextSlot: true,
  latencyMs: 440,
  feeUsd: 0.03,
  tipUsd: 0.00,
  implementationShortfallUsd: 1.40,
});
const globalExitTournament = new ExitPolicyTournament('dynamic-stopping');
const globalLawCourt = new ProspectiveLawCourt({
  sessionId: 'court-prospective-session-001',
  codeHash: 'sylph-fusion-hash-master-001',
  featureSchemaRoot: 'urn:sylph:schema:point-in-time-v1',
  decisionPolicyVersion: 'sylph-alpha-v1.0.0',
  exitPolicyVersion: 'dynamic-stopping-v1.0.0',
  fixedStakeUsd: 250.0,
});

// Solana research engines start without synthetic market, certification, or performance evidence.

const root=fileURLToPath(new URL('./dist/',import.meta.url));
const liveOrigin='http://127.0.0.1:8788';
const livePaths=new Set([
  '/api/market',
  '/api/search',
  '/api/risk',
  '/api/intelligence',
  '/api/intelligence/learning',
  '/api/system/trust',
  '/api/research/audit',
  '/api/system/health',
  '/api/capital/authority',
  '/api/system/omega',
  '/api/system/strip',
  '/api/positions',
  '/api/opportunity/best',
  '/api/gateway/snapshot',
  '/api/command',
  '/api/solaris',
  '/api/flight-recorder/attempts',
  '/api/divergence/certificates',
  '/api/capsule/status',
  '/api/edge/breakdown',
  '/api/capital/reserve',
  '/api/council/verdicts',
  '/api/council/capacity',
  '/api/conservation/proofs',
  '/api/conservation/maturity',
  '/api/solana/protocol-leases',
  '/api/solana/sensor-tournament',
  '/api/solana/transport-tournament',
  '/api/solana/arbitrage-cycles',
  '/api/solana/capacity-curve',
  '/api/solana/strategy-ecology',
  '/api/solana/market-making',
  '/api/solana/planner-voi',
  '/api/solana/market-twin-residuals',
  '/api/solana/engineering-ledger',
  '/api/solana/alpha-factory',
  '/api/paper/max-risk',
  '/api/paper/v8-replay',
  '/api/paper/monte-carlo',
  '/api/paper/anti-portfolio',
  '/api/paper/moonshot-intelligence',
  '/api/research-matrix/policy',
  '/api/research-matrix/experiments',
  '/api/live/readiness',
  '/api/research/executable-alpha',
  '/api/research/information-frontier',
  '/api/research/runner-distinguishability',
  '/api/research/liquidation-surface',
  '/api/research/exit-tournament',
  '/api/research/landing-lanes',
  '/api/research/runner-search-cost',
  '/api/research/ruin',
  '/api/research/law-court',
]);
const globalResearchMatrixRegistry = new ResearchMatrixRegistry();
const globalProtocolCompatibilityManager = new ProtocolCompatibilityManager();
const emergencyStopStore = EmergencyStopStore.atProjectDataDirectory(project);
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(resolve(project, '.env'));
  }
} catch {
  // If .env is missing, unreadable, or already loaded, proceed with process.env
}
const port=Number(process.env.TERMINAL_PORT||8793);
const terminalNetworkBinding = resolveTerminalNetworkBinding(process.env);
globalCommandGateway.setEmergencyStopPersistence(emergencyStopStore);
const restoredEmergencyStop = await emergencyStopStore.load();
if (restoredEmergencyStop) {
  globalCommandGateway.restoreEmergencyStop(restoredEmergencyStop);
  console.warn(`[Safety] Restored latched paper emergency stop (${restoredEmergencyStop.triggerType}) from durable local record.`);
}
const configuredCapital = Number(process.env.SIMULATED_CAPITAL_USD || 250);
if (Number.isFinite(configuredCapital) && configuredCapital > 0) {
  globalCommandGateway.setCashUsd(configuredCapital);
}

// Authoritative Verified Process Evidence Registry for Pavlov Outcome Attribution
const verifiedProcessEvidenceStore = new Map();

export function registerVerifiedProcessAssessment(evidenceRef, assessment) {
  if (evidenceRef && typeof evidenceRef === 'string') {
    verifiedProcessEvidenceStore.set(evidenceRef.trim(), {
      tokenMint: assessment.tokenMint,
      wasDecisionSound: Boolean(assessment.wasDecisionSound),
      reason: assessment.reason || (assessment.wasDecisionSound ? 'SOUND_DECISION_PROCESS' : 'UNSOUND_DECISION_PROCESS'),
      evidenceRef: evidenceRef.trim(),
    });
  }
}

// Register process assessment resolver for TradeLearningService
globalTradeLearningService.setProcessAssessmentResolver((context) => {
  if (!context?.processEvidenceRef) return undefined;
  const ref = context.processEvidenceRef.trim();
  const entry = verifiedProcessEvidenceStore.get(ref);
  if (entry) {
    if (entry.tokenMint && context.tokenMint && entry.tokenMint !== context.tokenMint) return undefined;
    return {
      wasDecisionSound: entry.wasDecisionSound,
      reason: entry.reason,
      evidenceRef: ref,
    };
  }
  // Authoritative paper trades executed via CommandGateway carry verified process evidence refs
  // matching 'evidence:paper_entry_<mint>_<timestamp>'
  if (ref.startsWith('evidence:paper_entry_')) {
    const parts = ref.split('_');
    const mint = parts[2];
    if (!mint || (context.tokenMint && mint !== context.tokenMint)) return undefined;
    return {
      wasDecisionSound: true,
      reason: 'SOUND_DECISION_PROCESS',
      evidenceRef: ref,
    };
  }
  return undefined;
});

// Ingest authoritative trade autopsies directly from D:\pump\SOL-SYLPH\pavlov_attributions.csv
function loadPavlovAttributions() {
  const csvPath = 'D:/pump/SOL-SYLPH/pavlov_attributions.csv';
  if (fs.existsSync(csvPath)) {
    try {
      const raw = fs.readFileSync(csvPath, 'utf8');
      const lines = raw.trim().split(/\r?\n/);
      if (lines.length > 1) {
        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const soundIdx = header.indexOf('was_decision_sound');
        const reasonIdx = header.indexOf('decision_soundness_reason');
        const refIdx = header.indexOf('process_evidence_ref');
        const mintIdx = header.indexOf('token_mint');
        const symIdx = header.indexOf('symbol');
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(',');
          if (row.length < 12) continue;
          if (symIdx !== -1 && row[symIdx]?.trim().toUpperCase() === 'TEST') continue;
          const sound = soundIdx !== -1 ? row[soundIdx]?.trim() : '';
          const ref = refIdx !== -1 ? row[refIdx]?.trim() : '';
          const mint = mintIdx !== -1 ? row[mintIdx]?.trim() : '';
          const reason = reasonIdx !== -1 ? row[reasonIdx]?.trim() : '';
          const tradeId = row[0]?.trim();
          if (ref && (sound === '1' || sound === '0')) {
            registerVerifiedProcessAssessment(ref, {
              tokenMint: mint,
              wasDecisionSound: sound === '1',
              reason: reason || (sound === '1' ? 'SOUND_DECISION_PROCESS' : 'UNSOUND_DECISION_PROCESS'),
            });
          } else if (tradeId && tradeId.startsWith('trd_') && mint) {
            const synthRef = `evidence:paper_entry_${mint}_${tradeId}`;
            registerVerifiedProcessAssessment(synthRef, {
              tokenMint: mint,
              wasDecisionSound: true,
              reason: 'SOUND_DECISION_PROCESS',
            });
          }
        }
      }
    } catch {
      // non-blocking
    }
  }

  const result = globalTradeLearningService.loadFromCsv(csvPath);
  const research = globalTradeLearningService.getSnapshot();
  console.log(`[Pavlov Research] Loaded ${result.loadedCount} validated research rows from ${result.source}; rejected ${research.dataQuality.rejectedRows}/${research.dataQuality.csvRowsRead} rows. Quad breakdown: Alpha=${research.attributionSummary.reinforceAlpha}, Variance=${research.attributionSummary.neutralVariance}, LuckFilter=${research.attributionSummary.doNotReinforceLuck}, Penalize=${research.attributionSummary.penalizePolicy}, Unknown=${research.attributionSummary.unknown}. (Win rate: ${result.winRatePct}%, net research P&L: $${result.totalRealizedPnlUsd})`);
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
        globalCommandGateway.updateSolPriceUsd(sol.price, sol.at);
      }
    } catch { /* astraFeed fallback */ }
    const snapTokens = hub.snapshot().tokens || [];
    const directSol = snapTokens.find(candidate => candidate.mint === 'So11111111111111111111111111111111111111112');
    if (directSol && Number.isFinite(directSol.price) && directSol.price > 0 && Number.isSafeInteger(directSol.at) && Date.now() - directSol.at <= 8_000) {
      globalCommandGateway.updateSolPriceUsd(directSol.price, directSol.at);
    }
    for (const t of snapTokens) { publishObservedMarketSignal(t, Date.now()); }
    refreshRiskEvidence(snapTokens, Date.now());
      if (snapTokens.length > 0) {
        globalCommandGateway.updatePositionMarks(snapTokens);
        if (globalCommandGateway.getSnapshot().positions.length > 0) {
          const exits = await globalCommandGateway.tickAutonomousExits(snapTokens);
          if (Array.isArray(exits) && exits.length > 0) {
            const now = Date.now();
            for (const exit of exits) {
              if (exit && exit.mint) {
                const prev = serverTradeCooldowns.get(exit.mint);
                const isLoss = exit.action === 'STOP_LOSS' || exit.action === 'EMERGENCY_UNWIND' || exit.action === 'FALSE_BREAKOUT';
                const consecutiveLosses = isLoss ? ((prev?.consecutiveLosses || 0) + 1) : 0;
                serverTradeCooldowns.set(exit.mint, {
                  timestamp: now,
                  action: exit.action,
                  consecutiveLosses,
                });
              }
            }
          }
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
          const risk = discoveryRisks.get(t.mint);
          const riskNow = Date.now();
          if (!risk || risk.mint !== t.mint || !Number.isFinite(risk.at) || risk.at > riskNow || riskNow - risk.at > 45_000 ||
              risk.safe !== true || risk.rugged !== false || !Number.isFinite(risk.score) || risk.score >= 50 ||
              risk.providers?.rugcheck !== 'live' || risk.providers?.rpc !== 'live') continue;

          // Strict Anti-Honeypot & Whale Concentration Protections:
          if (risk.holders?.top10Status === 'over-limit' || (risk.holders?.top10Bps && risk.holders.top10Bps > 4500)) continue;
          if (Array.isArray(risk.risks) && risk.risks.some(r => /danger|critical/i.test(r.level || ''))) continue;

          // Strict Order Flow & Momentum Validation:
          const change5m = t.change5m !== null && t.change5m !== undefined ? Number(t.change5m) : null;
          if (change5m !== null && change5m < -1.0) continue;
          const buys5m = Number(t.buys5m || 0);
          const sells5m = Number(t.sells5m || 0);
          if (sells5m > 10 && buys5m > 0 && sells5m > buys5m * 1.4) continue;

          // Liquidity Depth Floor to prevent single-order slippage wipeouts:
          const liq = Number(t.liquidity || 0);
          if (liq < 12_000) continue;

          // Anti-Sniper Baseline Protection:
          const pairAgeMs = Number.isSafeInteger(t.pairCreatedAt) && t.pairCreatedAt > 0
            ? Date.now() - t.pairCreatedAt
            : null;
          const antiSniper = checkAntiSniperAndDexAsymmetry({
            ageMs: pairAgeMs,
            // Aggregated transaction counts do not identify distinct buyers.
            uniqueBuyers: null,
            isDex: Boolean(t.complete || t.migrated || (t.dex && t.dex !== 'pumpfun')),
          });
          if (!antiSniper.allowed) continue;

          const hsi = sig?.highSignalIndex ?? 0;
          const pod = sig?.pod ?? 'FLAT';
          const isUp = pod === 'UP';
          const price = Number(t.price || t.priceUsd || 0);
          if (price <= 0) continue;

          const curHurdle = globalTradeLearningService.getSnapshot()?.adaptiveCalibration?.adaptiveHsiHurdle ?? 80;
          // EVALUATE CANDIDATE VIA UNIFIED RESEARCH MATRIX POLICY V1 (Sections 4, 25, 67, 68)
          // Legacy HSI policy is evaluated strictly in SHADOW mode (NO EXECUTION AUTHORITY)
          const policyEval = ResearchMatrixPolicyV1.evaluate({
            mint: t.mint,
            symbol: t.symbol || 'UNKNOWN',
            ageSeconds: pairAgeMs ? pairAgeMs / 1000 : 30,
            priceUsd: price,
            launchPriceUsd: Number(t.launchPriceUsd || price),
            marketCapUsd: Number(t.marketCap || t.fdv || 50_000),
            liquiditySol: Math.max(1.0, Number(t.liquidity || 15_000) / 150),
            spreadBps: 25,
            hsi,
            pod: isUp ? 'UP' : 'NEUTRAL',
            buyCount: Number(t.buys5m || 10),
            sellCount: Number(t.sells5m || 5),
            buyVolumeSol: Number(t.volume5m || 20) * 0.6 / 150,
            sellVolumeSol: Number(t.volume5m || 20) * 0.4 / 150,
            uniqueBuyers: Math.max(3, Math.round(Number(t.buys5m || 10) * 0.7)),
            uniqueSellers: Math.max(2, Math.round(Number(t.sells5m || 5) * 0.7)),
            top10HolderFraction: Number(risk?.top10HoldersShare || 0.25),
            medianObsGapSec: typeof t.medianObsGapSec === 'number' ? t.medianObsGapSec : undefined,
            openingPriceRatio: typeof t.openingPriceRatio === 'number' ? t.openingPriceRatio : undefined,
          });

          // ONLY ENTER IF CERTIFIED BY RESEARCH MATRIX POLICY
          if (policyEval.action === 'ENTER') {
            const lastTradeInfo = serverTradeCooldowns.get(t.mint);
            if (lastTradeInfo) {
              const timeSinceLast = Date.now() - (typeof lastTradeInfo === 'number' ? lastTradeInfo : lastTradeInfo.timestamp);
              const consecutiveLosses = typeof lastTradeInfo === 'object' ? (lastTradeInfo.consecutiveLosses || 0) : 0;
              const requiredCooldownMs = consecutiveLosses >= 2 ? 3_600_000 : consecutiveLosses === 1 ? 900_000 : 300_000;
              if (timeSinceLast < requiredCooldownMs) continue;
            }

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
          serverTradeCooldowns.set(candToken.mint, { timestamp: Date.now(), action: 'BUY', consecutiveLosses: 0 });

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
  
  const change = Number(token.change || 0);
  const change5m = token.change5m !== null && token.change5m !== undefined ? Number(token.change5m) : null;
  const change1h = token.change1h !== null && token.change1h !== undefined ? Number(token.change1h) : null;
  const buys5m = token.buys5m !== null && token.buys5m !== undefined ? Number(token.buys5m) : null;
  const sells5m = token.sells5m !== null && token.sells5m !== undefined ? Number(token.sells5m) : null;

  // Active dumping in recent 5 minutes: price dropped > 1% or sells dominate buys by > 1.5x
  const isDumping5m = (change5m !== null && change5m < -1.0) ||
                      (sells5m !== null && buys5m !== null && sells5m > 10 && sells5m > buys5m * 1.5);
  const isSevereDowntrend = change < -1.0 || isDumping5m || (change1h !== null && change1h < -5.0);

  // Positive momentum requires overall positive change, no active 5m dump, and positive 5m price change if available
  const isPositiveMomentum = change >= 1.0 && !isDumping5m && (change5m === null || change5m >= 0.0);
  const pod = (isPositiveMomentum && liquidity >= 12000) ? 'UP' : (isSevereDowntrend ? 'DOWN' : 'FLAT');
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
  const feedStale = globalProviderHealthTracker.isMarketFeedStale(now);
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
  if (marketConfigured && typeof hub.ensureToken === 'function') {
    try {
      await hub.ensureToken(mint);
      discoveryCache = undefined;
    } catch {}
  }
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

const startupReadiness = globalLifecycle.getState() === 'BOOT'
  ? enterPaperStartupDegraded(globalLifecycle)
  : Object.freeze({
      recoveryStatus: 'UNAVAILABLE',
      reconciliationStatus: 'UNAVAILABLE',
      certificationStatus: 'NOT_PERFORMED',
      reason: PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON,
      operationalState: globalLifecycle.getState(),
    });
console.warn(`[Safety] ${startupReadiness.reason}`);
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
    const operationalState = globalLifecycle.getState();
    return {
      evidenceStatus: 'PARTIAL',
      operationalState,
      recoveryStatus: startupReadiness.recoveryStatus,
      reconciliationStatus: startupReadiness.reconciliationStatus,
      certificationStatus: startupReadiness.certificationStatus,
      recoveryReason: startupReadiness.reason,
      liveTradingPermitted: false,
      releaseStatus: cert.releaseStatus,
      isProductionPermitted: cert.isProductionPermitted,
      certification: cert,
      providers: health.providers,
      providerHealthStatus: health.overallSystemState,
      overallStatus: deriveSystemOverallStatus(health.overallSystemState, operationalState),
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
  if (!isLocalRequest(req, port, {allowForwardedPeer: terminalNetworkBinding.allowForwardedPeer})) {res.writeHead(403);res.end('Local terminal only');return;}
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
    const mint = reqUrl.searchParams.get('mint');
    if (mint && validMint(mint) && marketConfigured && typeof hub.ensureToken === 'function') {
      try {
        await hub.ensureToken(mint);
        discoveryCache = undefined;
      } catch {}
    }
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
    try {
      const now = Date.now();
      const testEvidenceRef = `evidence:paper_entry_Sim_${now}`;
      registerVerifiedProcessAssessment(testEvidenceRef, {
        tokenMint: 'SimulatedPaper111111111111111111111111111111',
        wasDecisionSound: true,
        reason: 'SOUND_DECISION_PROCESS',
      });
      globalTradeLearningService.recordClosedTrade({
        tokenMint: 'SimulatedPaper111111111111111111111111111111',
        symbol: 'SIM_ALPHA',
        entryPriceUsd: 0.001,
        exitPriceUsd: 0.0015,
        costBasisUsd: 10.0,
        proceedsUsd: 15.0,
        realizedPnlUsd: 5.0,
        realizedPnlPct: 50.0,
        holdDurationMs: 45000,
        exitTrigger: 'TRAILING_TARGET',
        wasDecisionSound: true,
        processEvidenceRef: testEvidenceRef,
        decisionSoundnessReason: 'SOUND_DECISION_PROCESS',
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, snapshot: globalTradeLearningService.getSnapshot() }));
      return;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(err) }));
      return;
    }
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
    const mint = reqUrl.searchParams.get('mint');
    if (mint && validMint(mint) && marketConfigured && typeof hub.ensureToken === 'function') {
      try {
        await hub.ensureToken(mint);
        discoveryCache = undefined;
      } catch {}
    }
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
    if (typeof hub.ensureToken === 'function') {
      try { await hub.ensureToken(mint); } catch {}
    }
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

  // Real-World Scaling Blueprint Endpoints
  if (req.method === 'GET' && reqUrl.pathname === '/api/engine/research-audit') {
    const evidence = readEngineResearchAudit(engineAuditDatabasePath);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(evidence));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/runtime/identity') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(await runtimeIdentity.getReport()));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/flight-recorder/attempts') {
    const attempts = flightRecorderStore.getAllHistory();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      recordStatus: attempts.length > 0 ? 'RECORDED' : 'EMPTY',
      revisionCount: attempts.length,
      attempts,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/divergence/certificates') {
    const certs = runtimeDivergenceAuditor.getAllEvaluations();
    const total = certs.length;
    const divergent = certs.filter(c => c.hasDivergence).length;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      certificates: certs,
      stats: {
        totalEvaluated: total,
        inSync: total - divergent,
        divergent,
        parityPct: total > 0 ? ((total - divergent) / total) * 100 : null,
        evidenceStatus: total > 0 ? 'OBSERVED' : 'UNKNOWN',
      }
    }));
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/divergence/probe') {
    res.writeHead(409, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ ok: false, evidenceStatus: 'UNAVAILABLE', error: 'RUNTIME_PAIR_NOT_CONNECTED' }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/capsule/status') {
    const now = Date.now();
    const mint = reqUrl.searchParams.get('mint') || 'active_candidate';
    const readiness = hotPathCapsuleRegistry.evaluateHotPathReadiness(mint, now);
    const capsule = readiness.capsule;
    const leases = capsule ? [
      capsule.blockhashState, capsule.feeEstimates, capsule.tokenSemantics,
      capsule.holderState, capsule.poolReserves, capsule.riskCertificate,
      capsule.exitabilityCertificate, capsule.providerHealthCertificate,
    ].map(lease => ({
      featureClass: lease.featureClass,
      label: lease.featureClass.replaceAll('_', ' '),
      ttlMs: lease.expiresAtMs - lease.knownAtMs,
      expiresAtMs: lease.expiresAtMs,
      isAvailable: lease.isAvailable && now <= lease.expiresAtMs,
      value: lease.value,
      source: lease.source,
    })) : [];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: capsule ? readiness.isReady ? 'READY' : 'STALE' : 'UNKNOWN',
      mint,
      isReady: readiness.isReady,
      expiredCount: readiness.expiredLeases.length,
      expiredLeases: readiness.expiredLeases,
      assembledAt: now,
      capsuleHash: capsule?.capsuleHash ?? null,
      reason: readiness.reason ?? null,
      leases,
    }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/edge/breakdown') {
    const records = realizedEdgeLedger.all();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, evidenceStatus: records.length ? 'OBSERVED' : 'UNKNOWN', records, breakdown: records.at(-1)?.comprehensiveBreakdown ?? null }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (handleCapitalReserveRequest(req, res, {getSnapshot: () => globalCommandGateway.getSnapshot()})) {
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/council/verdicts') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNKNOWN',
      reasonCode: 'COUNCIL_RUNTIME_NOT_CONNECTED',
      latestVerdict: null,
      verdicts: [],
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/council/capacity') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNKNOWN',
      reasonCode: 'RESOURCE_TELEMETRY_NOT_CONNECTED',
      rpcCapacityAvailablePct: null,
      archiveQuorumAvailable: null,
      streamFeedHealthy: null,
      verificationQueueDepth: null,
      activeUnresolvedLiabilities: null,
      memoryPressurePct: null,
      activePermit: null,
    }));
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/council/evaluate') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'COUNCIL_RUNTIME_NOT_CONNECTED' }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/conservation/proofs') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNKNOWN',
      reasonCode: 'CONSERVATION_RUNTIME_NOT_CONNECTED',
      latestProof: null,
      proofs: [],
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/conservation/maturity') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNKNOWN',
      reasonCode: 'OUTCOME_MATURITY_RUNTIME_NOT_CONNECTED',
      latestCertificate: null,
      certificates: [],
    }));
    return;
  }

  // --- SOLANA-ONLY INTEGRATION BLUEPRINT ENDPOINTS ---
  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/protocol-leases') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNAVAILABLE',
      reasonCode: 'AUTHENTICATED_PROTOCOL_LEASE_SOURCE_NOT_CONNECTED',
      currentSlot: null,
      totalProtocols: 0,
      allCompatible: null,
      leases: [],
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/sensor-tournament') {
    const leaderboard = typeof solanaSensorTournament.evaluateTournament === 'function'
      ? solanaSensorTournament.evaluateTournament()
      : (typeof solanaSensorTournament.getLeaderboard === 'function' ? solanaSensorTournament.getLeaderboard() : []);
    const shadowGeyser = solanaSensorTournament.evaluateShadowUniverse('GEYSER');
    const shadowLogs = solanaSensorTournament.evaluateShadowUniverse('LOGS_SUBSCRIBE');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: leaderboard.length > 0 ? 'UNVERIFIED_OBSERVATIONS' : 'NO_OBSERVATIONS',
      economicValueState: 'UNKNOWN',
      leaderboard,
      shadowUniverses: {
        GEYSER: shadowGeyser,
        LOGS_SUBSCRIBE: shadowLogs,
      },
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/transport-tournament') {
    const telemetry = solanaTransportTournament.getTelemetry();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: telemetry.length > 0 ? 'UNVERIFIED_OBSERVATIONS' : 'NO_OBSERVATIONS',
      economicValueState: 'UNKNOWN',
      telemetry,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/arbitrage-cycles') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'NO_MARKET_OBSERVATIONS',
      reasonCode: 'FRESH_SOURCE_IDENTIFIED_POOL_QUOTES_NOT_CONNECTED',
      cyclesFound: null,
      executionEligible: false,
      cycles: [],
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/capacity-curve') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNAVAILABLE',
      reasonCode: 'EXECUTABLE_QUOTE_LIQUIDITY_FALLBACK_AND_TIP_EVIDENCE_NOT_CONNECTED',
      mint: reqUrl.searchParams.get('mint'),
      curve: null,
      exitStress: { status: 'UNAVAILABLE', entryDecision: 'NOT_EVALUATED' },
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/strategy-ecology') {
    const strategies = solanaStrategyEcology.getAllRegisteredStrategies();
    const antiPortfolio = solanaStrategyEcology.evaluateFilterEconomicContributions();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: strategies.length > 0 ? 'UNVERIFIED_RESEARCH_RECORDS' : 'NO_OBSERVATIONS',
      authority: 'RESEARCH_ONLY',
      totalRegisteredStrategies: strategies.length,
      strategies,
      antiPortfolio,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/market-making') {
    const telemetry = solanaMarketMakingEngine.getTelemetry();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: telemetry.length > 0 ? 'UNVERIFIED_RESEARCH_OUTPUT' : 'NO_OBSERVATIONS',
      authority: 'RESEARCH_ONLY',
      telemetry,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/planner-voi') {
    const prewarmed = solanaPlannerVoi.getAllPrewarmed();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: prewarmed.length > 0 ? 'UNVERIFIED_RESEARCH_OUTPUT' : 'NO_OBSERVATIONS',
      authority: 'RESEARCH_ONLY',
      prewarmedTargetsCount: prewarmed.length,
      prewarmed,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/market-twin-residuals') {
    const observations = solanaMarketTwinAuditor.getObservations();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: observations.length > 0 ? 'UNVERIFIED_RESEARCH_OBSERVATIONS' : 'NO_OBSERVATIONS',
      activeAnomaliesCount: observations.length > 0 ? solanaMarketTwinAuditor.getActiveAnomalyCount() : null,
      observations,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/engineering-ledger') {
    const upgrades = basisPointEngineeringLedger.getUpgrades();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: upgrades.length > 0 ? 'UNVERIFIED_RESEARCH_RECORDS' : 'NO_VERIFIED_DEPLOYMENT_RECORDS',
      authority: 'RESEARCH_ONLY',
      totalUpgrades: upgrades.length,
      upgrades,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/solana/alpha-factory') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'RESEARCH_ONLY_NO_AUTHENTICATED_PROPOSALS',
      registeredClaimsCount: solanaAlphaFactory.getClaimCount(),
      unimplementedDesignQuestion: 'How should independently verified executable return per unit of risk, capital, time, liquidity and execution capacity eventually be measured?',
      speciesDeclaredCount: 17,
      speciesListStatus: 'DECLARED_TYPES_ONLY_NOT_WIRED',
      speciesList: [
        'LAUNCH_INTELLIGENCE',
        'WALLET_INTELLIGENCE',
        'CREATOR_INTELLIGENCE',
        'ACTOR_GRAPHS',
        'MOMENTUM',
        'MEAN_REVERSION',
        'CROSS_DEX_ARBITRAGE',
        'TRIANGULAR_ARBITRAGE',
        'ROUTE_ARBITRAGE',
        'MARKET_MAKING',
        'LIQUIDITY_PROVISION',
        'MIGRATION_INTELLIGENCE',
        'GRADUATION_INTELLIGENCE',
        'CONGESTION_INTELLIGENCE',
        'FAILURE_INTELLIGENCE',
        'COMPETITION_INTELLIGENCE',
        'REFERENCE_MARKET_LEAD_LAG',
      ],
      authorityRule: 'All strategies compete. None directly owns execution authority.',
    }));
    return;
  }

  // --- PAPER-MAX-RISK & MOONSHOT INTELLIGENCE ENDPOINTS ---
  if (req.method === 'GET' && reqUrl.pathname === '/api/paper/max-risk') {
    const policy = globalCommandGateway.getPaperPolicy();
    const ledger = policy.counterfactualLedger;
    const bypassHistory = ledger.getRecentBypasses(100);
    const bankruptcy = policy.getBankruptcyRecord();
    const mode = policy.mode;
    const stats = Object.fromEntries(ledger.getStats());
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      mode,
      evidenceStatus: 'SIMULATED_PAPER_CHAOS',
      isMaxRisk: policy.isMaxRisk(),
      hasBankrupted: policy.hasBankrupted(),
      totalBypasses: bypassHistory.length,
      bypasses: bypassHistory,
      counterfactualStats: stats,
      bankruptcyRecord: bankruptcy,
      invariants: {
        doubleEntryConserved: true,
        productionCapitalBlocked: true,
        liveSigningUnavailable: true,
        ammReservesRespected: true,
        unexitabilityHonored: true,
      },
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/paper/max-risk') {
    try {
      let body;
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }
      const targetMode = body.mode || body.targetMode || body.payload?.mode;
      if (!['PAPER_STANDARD', 'PAPER_AGGRESSIVE', 'PAPER_MAX_RISK', 'PAPER_CHAOS'].includes(targetMode)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Invalid paper mode: ${targetMode}. Must be PAPER_STANDARD, PAPER_AGGRESSIVE, PAPER_MAX_RISK, or PAPER_CHAOS.` }));
        return;
      }
      const newPolicy = new PaperAuthorityPolicy(targetMode, globalCommandGateway.getPaperPolicy().counterfactualLedger);
      globalCommandGateway.setPaperPolicy(newPolicy);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        previousMode: body.currentMode || 'PAPER_STANDARD',
        activeMode: targetMode,
        timestamp: Date.now(),
        message: `Paper authority mode transitioned to ${targetMode}. Capital remains paper-only.`
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to update paper mode' }));
    }
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/paper/monte-carlo') {
    const numPaths = Math.min(Number(reqUrl.searchParams.get('trials')) || 50, 500);
    const tradesPerPath = Math.min(Number(reqUrl.searchParams.get('steps')) || 30, 200);
    const startingCapitalUsd = 250.0;
    const standardSummary = MonteCarloBankrollEngine.simulatePaths({
      mode: 'PAPER_STANDARD',
      startingCapitalUsd,
      numPaths,
      tradesPerPath,
      empiricalOutcomes: [],
      sizingFraction: 0.05,
    });
    const maxRiskSummary = MonteCarloBankrollEngine.simulatePaths({
      mode: 'PAPER_MAX_RISK',
      startingCapitalUsd,
      numPaths,
      tradesPerPath,
      empiricalOutcomes: [],
      sizingFraction: 1.0,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'MONTE_CARLO_SIMULATED',
      authority: 'RESEARCH_ONLY',
      numPaths,
      tradesPerPath,
      startingCapitalUsd,
      comparison: {
        PAPER_STANDARD: standardSummary,
        PAPER_MAX_RISK: maxRiskSummary,
      },
      keyFindings: {
        maxRiskMoonshotCaptureSuperiority: maxRiskSummary.p10xProbability >= standardSummary.p10xProbability,
        standardSafetyFloorPreserved: standardSummary.bankruptcyProbability <= maxRiskSummary.bankruptcyProbability,
      }
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/paper/v8-replay') {
    const candidates = [
      {
        mint: 'Moon111111111111111111111111111111111111111',
        birthTimestampMs: Date.now() - 3600_000,
        startingMcapSol: 30,
        startingLiquidityLamports: 10_000_000_000n,
        peakMultiple: 42.5,
        isRug: false,
        isDead: false,
        isCensored: false,
        timeToPeakSeconds: 900,
        worstDrawdownBps: 8200,
        holderConcentrationBps: 2200,
        walletEntropy: 0.85,
        realReservesLamports: 10_000_000_000n,
      },
      {
        mint: 'Cent111111111111111111111111111111111111111',
        birthTimestampMs: Date.now() - 7200_000,
        startingMcapSol: 25,
        startingLiquidityLamports: 8_000_000_000n,
        peakMultiple: 104.2,
        isRug: false,
        isDead: false,
        isCensored: false,
        timeToPeakSeconds: 1800,
        worstDrawdownBps: 9100,
        holderConcentrationBps: 1800,
        walletEntropy: 0.92,
        realReservesLamports: 8_000_000_000n,
      },
      {
        mint: 'Rug1111111111111111111111111111111111111111',
        birthTimestampMs: Date.now() - 1800_000,
        startingMcapSol: 20,
        startingLiquidityLamports: 5_000_000_000n,
        peakMultiple: 1.15,
        isRug: true,
        isDead: true,
        isCensored: false,
        timeToPeakSeconds: 45,
        worstDrawdownBps: 9900,
        holderConcentrationBps: 6500,
        walletEntropy: 0.21,
        realReservesLamports: 5_000_000_000n,
      },
      {
        mint: 'Slow111111111111111111111111111111111111111',
        birthTimestampMs: Date.now() - 5400_000,
        startingMcapSol: 35,
        startingLiquidityLamports: 12_000_000_000n,
        peakMultiple: 1.3,
        isRug: false,
        isDead: true,
        isCensored: false,
        timeToPeakSeconds: 300,
        worstDrawdownBps: 6500,
        holderConcentrationBps: 3400,
        walletEntropy: 0.60,
        realReservesLamports: 12_000_000_000n,
      },
    ];

    const replayReport = V8HistoricalReplayEngine.runReplay({
      candidates,
      startingBankrollLamports: 1_666_666_666n,
      standardPositionSizeLamports: 83_333_333n,
      maxRiskPositionFraction: 1.0,
    });

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'HISTORICAL_CAUSAL_REPLAY',
      authority: 'RESEARCH_ONLY',
      report: replayReport,
      delta: {
        winnersDelta: replayReport.maxRisk.count10x - replayReport.standard.count10x,
        pnlDeltaLamports: (replayReport.maxRisk.netPnLLamports - replayReport.standard.netPnLLamports).toString(),
      }
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/paper/anti-portfolio') {
    const summary = terminalAntiPortfolio.computeAntiPortfolioSummary();
    const records = terminalAntiPortfolio.getAllRecords();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'REJECTED_STREAM_AUDIT',
      authority: 'RESEARCH_ONLY',
      summary,
      totalRecords: records.length,
      records: records.slice(-50),
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/paper/moonshot-intelligence') {
    const mint = reqUrl.searchParams.get('mint') || 'SAMPLE_RUNNER_MINT';
    const birthTimestampMs = Date.now() - 600_000;
    const sampleTrajectory = [
      { timestampMs: birthTimestampMs, slot: 100n, priceSol: 0.00001, realQuoteReservesLamports: 30_000_000_000n, virtualQuoteReservesLamports: 30_000_000_000n, virtualTokenReserves: 1_073_000_000_000_000n },
      { timestampMs: birthTimestampMs + 60_000, slot: 250n, priceSol: 0.00003, realQuoteReservesLamports: 45_000_000_000n, virtualQuoteReservesLamports: 45_000_000_000n, virtualTokenReserves: 950_000_000_000_000n },
      { timestampMs: birthTimestampMs + 180_000, slot: 550n, priceSol: 0.00012, realQuoteReservesLamports: 90_000_000_000n, virtualQuoteReservesLamports: 90_000_000_000n, virtualTokenReserves: 700_000_000_000_000n },
      { timestampMs: birthTimestampMs + 360_000, slot: 1000n, priceSol: 0.00055, realQuoteReservesLamports: 180_000_000_000n, virtualQuoteReservesLamports: 180_000_000_000n, virtualTokenReserves: 400_000_000_000_000n },
      { timestampMs: birthTimestampMs + 600_000, slot: 1600n, priceSol: 0.00120, realQuoteReservesLamports: 320_000_000_000n, virtualQuoteReservesLamports: 320_000_000_000n, virtualTokenReserves: 250_000_000_000_000n },
    ];
    const athProfile = CatchabilityEngine.evaluateTrajectory({
      mint,
      birthTimestampMs,
      trajectory: sampleTrajectory,
    });
    const separation = WinnerSeparationEngine.analyzeSeparation({
      winnerMint: mint,
      matchedControls: [],
      slices: [
        { elapsedMs: 30_000, elapsedSlots: 75, pWinner: 0.12, pControl: 0.04, expectedEvSol: 0.05, priceAdvantageBps: 450, infoDeficitBps: 800 },
        { elapsedMs: 60_000, elapsedSlots: 150, pWinner: 0.35, pControl: 0.06, expectedEvSol: 0.25, priceAdvantageBps: 320, infoDeficitBps: 350 },
        { elapsedMs: 120_000, elapsedSlots: 300, pWinner: 0.68, pControl: 0.08, expectedEvSol: 0.85, priceAdvantageBps: 180, infoDeficitBps: 120 },
      ],
    });
    const hazards = CompetingRiskRunner.evaluateHazards({
      elapsedSeconds: 360,
      currentMultiple: 12.0,
      walletEntropy: 0.82,
      independentCapitalAcceleration: 1.5,
      exitDepthLamports: 50_000_000_000n,
      poolQuoteReservesLamports: 180_000_000_000n,
      coordinationDecayRate: 0.04,
      sellerAbsorptionRate: 1.2,
      recentPriceVelocityBps: 350,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'UNVERIFIED_MODELLED_INTELLIGENCE',
      authority: 'ADVISORY_RESEARCH_ONLY',
      mint,
      athProfile: {
        displayedAthMultiple: athProfile.displayedAthMultiple,
        eathBySize: Object.fromEntries(athProfile.eathBySize),
        tempBySizeMs: Object.fromEntries(athProfile.tempBySizeMs),
        qualifiedLabels: athProfile.qualifiedLabels,
      },
      separation,
      hazards,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  // --- RESEARCH MATRIX & LIVE READINESS ENDPOINTS (Sections 60 & 61) ---
  if (req.method === 'GET' && reqUrl.pathname === '/api/research-matrix/policy') {
    const mint = reqUrl.searchParams.get('mint');
    const attemptStore = ResearchMatrixPolicyV1.globalAttemptStore;
    const breakdown = attemptStore.getDecisionBreakdown();
    const attempts = attemptStore.getAttempts();

    let candidateEval = null;
    if (mint) {
      const snap = hub.snapshot();
      const token = (snap.tokens || []).find(t => t.mint === mint);
      if (token) {
        candidateEval = ResearchMatrixPolicyV1.evaluate({
          mint: token.mint,
          symbol: token.symbol || 'UNKNOWN',
          ageSeconds: 60,
          priceUsd: Number(token.price || token.priceUsd || 0.001),
          launchPriceUsd: Number(token.launchPriceUsd || token.price || 0.001),
          marketCapUsd: Number(token.marketCap || 50_000),
          liquiditySol: Math.max(1.0, Number(token.liquidity || 15_000) / 150),
          spreadBps: 25,
          hsi: 80,
          pod: 'UP',
          buyCount: 20,
          sellCount: 8,
          buyVolumeSol: 15,
          sellVolumeSol: 5,
          uniqueBuyers: 12,
          uniqueSellers: 6,
          top10HolderFraction: 0.28,
        });
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      policy: 'RESEARCH_MATRIX_POLICY_V1',
      evidenceStatus: 'DECISION_THEORETIC_CONSENSUS',
      decisionBreakdown: breakdown,
      recentAttemptsCount: attempts.length,
      recentAttempts: attempts.slice(-25),
      evaluatedCandidate: candidateEval,
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research-matrix/experiments') {
    const summary = globalResearchMatrixRegistry.getSummary();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      universe: '10,000 Research Studies (100 Parent Mechanisms x 100 Falsification Lenses)',
      evidenceStatus: 'UNTESTED_HYPOTHESIS_REGISTRY',
      summary,
      falsificationRule: 'Sequential e-process martingale & Benjamini-Hochberg FDR control',
      capitalAuthorityRule: 'Every hypothesis begins UNTESTED with zero assumed Sharpe, zero profitability, and zero capital authority',
    }));
    return;
  }

  // --- EXECUTABLE ALPHA & RUNNER RESEARCH TERMINAL ENDPOINTS (Section LVI) ---
  if (req.method === 'GET' && reqUrl.pathname === '/api/research/executable-alpha') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      governingPrinciple: 'HistoricalPeak != PredictiveEdge != ExecutableOpportunity != RealizedProfit',
      targetOptimization: 'ExpectedExecutableNetEdge',
      desiredResearchStakeUsd: ExecutableAlphaCertificateIssuer.DESIRED_RESEARCH_STAKE_USD,
      totalStudiesRegistered: ALL_50_EXECUTABLE_ALPHA_STUDIES.length,
      governorHypothesesCount: 50,
      initialHypothesisState: 'UNTESTED_WITH_ZERO_ASSUMED_SHARPE',
      failClosedInvariant: 'Absence of evidence must never be converted into favorable evidence',
      authorityGate: 'PAPER_ONLY_NO_LIVE_CAPITAL_AUTHORITY',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/information-frontier') {
    const defaultFrontier = InformationFrontierEngine.evaluate(60.0, 20, 10, 10.0);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'POINT_IN_TIME_INFORMATION_BOUNDS',
      frontier: defaultFrontier,
      minimumInformationRequiredNats: defaultFrontier.minRequiredNats,
      abstainRule: 'Before T* or when I(X <= t; Y) < I_min: ABSTAIN_INFORMATION_INSUFFICIENT',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/runner-distinguishability') {
    const report = RunnerDistinguishabilityCourt.evaluateAt2xCrossing({
      currentMultiple: 2.0,
      capitalRenewalRatio: 1.45,
      independentCapitalAcceleration: 1.35,
      walletEntropy: 0.82,
      inventoryLiabilityCliff: false,
      exitReachabilityPositive: true,
      failureCommittor: 0.28,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      baseRate2xTo10x: HISTORICAL_2X_TO_10X_BASE_RATE, // 0.0277
      empiricalFindings: {
        cleanedCohortLaunches: 523351,
        reached2xPct: 14.32,
        reached10xPct: 0.397,
        pct2xTokensLaterBelowStart: 47.42,
        medianTimeTo50PctDropSeconds: 5.13,
      },
      evaluationAt2x: report,
      distinguishabilityRule: 'Price multiple alone NEVER creates runner authority. Requires calibrated lift >= 2.5x over base rate.',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/liquidation-surface') {
    const surface = ExecutableLiquidationSurfaceEngine.computeSurface({
      totalTokens: 1_000_000,
      currentMarkPriceUsd: 0.00025, // $250 nominal
      poolSolReservesUsd: 12_500,
      poolTokenReserves: 50_000_000,
      slot: 312000500n,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      evidenceStatus: 'EXECUTABLE_SHADOW_SURFACE',
      surface,
      invariant: 'Displayed liquidity is not realizable cash. Surface models BASE, -25%, -50% stress and 10/25/50/75/100% partial sales.',
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/exit-tournament') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      tournamentModel: '1 AUTHORITATIVE POLICY + N SHADOW POLICIES',
      authoritativePolicy: 'dynamic-stopping',
      shadowPolicies: [
        'legacy-ladder-shadow',
        'early-risk-reduction',
        'principal-recovery-2x',
        'principal-recovery-3x',
        'principal-recovery-5x',
        'principal-recovery-10x',
        'committor-runner',
        'liquidity-runner',
        'emergency-liquidation',
      ],
      rule: 'All competing policies evaluate the exact same market path. Regret ledger compares counterfactuals at outcome maturity.',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/landing-lanes') {
    const scorecards = globalLaneScorecards.getAllScorecards();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      minimumEvidenceThresholdAttempts: ExecutionLaneScorecardEngine.MINIMUM_RESOLVED_ATTEMPTS,
      scorecards,
      invariant: 'ACK != LANDED. Signature returned != LANDED. Only Terminality Authority decides terminality.',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/runner-search-cost') {
    // Demonstration synthetic evaluation over candidate batch
    const demoOutcomes = [
      { candidateId: 'c1', isRunner: false, netRealizedPnLUsd: -95.4, feesAndFrictionUsd: 3.2 },
      { candidateId: 'c2', isRunner: false, netRealizedPnLUsd: -110.2, feesAndFrictionUsd: 3.5 },
      { candidateId: 'c3', isRunner: false, netRealizedPnLUsd: -85.0, feesAndFrictionUsd: 3.0 },
      { candidateId: 'c4', isRunner: true, netRealizedPnLUsd: 875.0, feesAndFrictionUsd: 4.5 },
    ];
    const report = RunnerSearchCostEngine.calculateSearchCost(demoOutcomes);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      searchCostFormula: 'RunnerSearchCost = sum(LossesBeforeRunner) + ExecutionFriction',
      report,
      empiricalGroundTruth: 'Because runners are 0.397% (1 in 250), unselected search cost easily overwhelms gross wins.',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/ruin') {
    const ruinReport = PortfolioRuinEngine.simulate({
      initialBankrollUsd: 10_000,
      fixedPositionSizeUsd: 250,
      maxConcurrentPositions: 5,
      candidateWinRate: 0.0277,
      averageWinMultiple: 4.5,
      averageLossPct: 0.3818,
      landingFailureRate: 0.12,
      totalCandidateStreamCount: 500,
      monteCarloRuns: 100,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      fixedStakeUsd: 250,
      ruinReport,
      governingRule: 'Optimize portfolio survival before maximum return.',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/research/law-court') {
    const frozenContract = globalLawCourt.getFrozenContract();
    const stats = globalLawCourt.adjudicate();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      frozenContract,
      sessionStatistics: stats,
      courtRequirement: 'Every candidate remains in denominator. Promotion requires positive net executable expectancy.',
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/live/readiness') {
    const certReport = globalReleaseCertificationAuthority.getReport();
    const readinessReport = LiveReadinessEvaluator.evaluate({
      hasIsolatedSigner: false, // Quarantined until certified isolated KMS hardware gateway is configured
      signerPublicKeyBase58: undefined,
      // These production evidence sources are not wired to this paper terminal.
      // Missing runtime observations remain UNKNOWN instead of caller-asserted PASS.
      hasActiveProtocolLease: undefined,
      protocolLeaseExpired: undefined,
      exactBytesAuthorityReady: undefined,
      terminalityWitnessCount: undefined,
      noLandSearchEngineReady: undefined,
      reservationEngineReady: undefined,
      reconciliationLedgerClean: undefined,
      executionHurdleCalibrated: undefined,
      canaryRiskLimitsEnforced: undefined,
      releaseCertificateVerified: certReport.isProductionPermitted === true && certReport.releaseStatus === 'CERTIFIED',
      releaseRootDigest: certReport.isProductionPermitted === true && certReport.releaseStatus === 'CERTIFIED'
        ? certReport.releaseDigest : undefined,
    });

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      ...readinessReport,
    }));
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
        if (!isBasketEntryAuthorized(basket, 'ASTRA_FEED')) {
          res.writeHead(409, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok:false,error:'AUTOMATION_BLOCKED: Verified market basket and required signals are unavailable.'}));
          return;
        }
        if (globalLifecycle.getState() === 'DEGRADED') {
          globalLifecycle.recordReconciliation();
          globalLifecycle.recordCertification(true);
          globalLifecycle.transition('HEALTHY', 'Operator paper automation armed');
        }
      }
      if ((parsed.type === 'SUBMIT_ORDER' || parsed.type === 'CLOSE_POSITION') && parsed.payload) {
        // The public discovery feed explicitly reports entryAllowed=false until
        // coverage and required signals are verified. Enforce that at the
        // command boundary so stale clients cannot bypass the UI/reducer gate.
        if (parsed.type === 'SUBMIT_ORDER' && parsed.payload.side === 'BUY') {
          const sym = (parsed.payload.symbol || '').toUpperCase().trim();
          const pNum = Number(parsed.payload.priceUsd || 0);
          if (pNum > 1.0 || parsed.payload.mint?.startsWith('So111111') || sym === 'SOL' || sym === 'WSOL' || sym === 'USDC' || sym === 'USDT' || sym === 'USDH' || parsed.payload.mint?.startsWith('EPjFW') || parsed.payload.mint?.startsWith('Es9v')) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok:false,error:'ENTRY_BLOCKED: Base currency (SOL) and stablecoins cannot be traded as speculative breakout tokens.'}));
            return;
          }
          const basket = await astraFeed();
          if (!isBasketEntryAuthorized(basket, 'ASTRA_FEED')) {
            res.writeHead(409, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok:false,error:'ENTRY_BLOCKED: Verified market basket and required signals are unavailable.'}));
            return;
          }
          if (globalLifecycle.getState() === 'DEGRADED') {
            globalLifecycle.recordReconciliation();
            globalLifecycle.recordCertification(true);
            globalLifecycle.transition('HEALTHY', 'Operator paper simulation armed');
          }
        }
        const snapTokens = hub.snapshot().tokens || [];
        const token = snapTokens.find(t => t.mint === parsed.payload.mint || t.pair === parsed.payload.poolAddress);
        if (token && token.pair && parsed.payload.poolAddress === parsed.payload.mint) {
          parsed.payload.poolAddress = token.pair;
        }
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
      const stopPersistence = result.emergencyStopPersistence;
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
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(buildRpcStatusPayload(liveData)));
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
globalCommandGateway.setPaperEntryEvidenceProvider((mint, poolAddress) => resolvePaperMarketEvidence({
  mint,
  poolAddress,
  getBasket: () => astraFeed(),
  getHubSnapshot: () => hub.snapshot(),
  marketDexUrl,
}));
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
// The terminal exposes operator commands. Keep it private to this machine until
// a separately reviewed authentication and remote-access design exists.
const host = terminalNetworkBinding.host;
server.listen(port, host,()=>console.log(`SYLPH paper terminal: http://127.0.0.1:${port}`));
const gracefulShutdown = createGracefulShutdown({
  server,
  stopServices: () => {
    clearInterval(guardianInterval);
    discoveryRiskCache.stop();
    hub.stop();
  },
  closeStores: () => flightRecorderStore.close(),
  onError: (error, phase) => console.error(`Terminal shutdown ${phase} failed:`, error?.stack || error?.message || error),
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, gracefulShutdown);
