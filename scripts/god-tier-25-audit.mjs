import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * A deliberately conservative source-evidence audit.  It establishes only
 * that the named architectural controls are represented in this checkout.
 * It cannot certify a live signer, provider, settlement process, or strategy.
 */
// A control must have both a source anchor and a deliberately narrow, reviewable
// contract marker. This is still not a replacement for behavioral, integration,
// or release evidence; it simply prevents an empty file from satisfying the audit.
const controls = [
  ['runtime context isolation', 'src/runtime-context.ts', ['RuntimeMode', 'Object.freeze', 'LIVE_BLOCKED']],
  ['runtime composition root', 'src/runtime-composition.ts', ['composePaperRuntime', 'Object.freeze']],
  ['command gateway boundary', 'src/command-gateway.ts', ['class CommandGateway', 'Emergency Stop']],
  ['operator read model', 'src/operator-read-model.ts', ['PROJECTION_STALE_FENCE_MS', 'validUntil']],
  ['projection service', 'src/projection-service.ts', ['class ProjectionService', 'EXECUTION_EVIDENCE_UNAVAILABLE']],
  ['discovery freshness fence', 'src/discovery.ts', ['DISCOVERY_FRESH_MS', 'discoverySnapshot']],
  ['provider health model', 'src/platform/ingestion/provider-health.ts', ['class ProviderHealthTracker', 'RATE_LIMITED']],
  ['capability fabric', 'src/platform/ingestion/capability-fabric.ts', ['CapabilityAuthority', 'independenceGroup']],
  ['stream integrity', 'src/platform/ingestion/stream-integrity.ts', ['streamIntegrity', 'GAP_DETECTED']],
  ['gap reconciliation', 'src/platform/ingestion/gap-reconciler.ts', ['class IngestionGapReconciler', 'BackfillHandler']],
  ['cross-provider validation', 'src/platform/ingestion/cross-validator.ts', ['class MultiSourceCrossValidator', 'CrossValidationStatus']],
  ['event ledger', 'src/platform/ledger/event-ledger.ts', ['class EventLedger', 'GENESIS_HASH']],
  ['double-entry accounting', 'src/platform/ledger/double-entry.ts', ['class DoubleEntryJournal', 'balance']],
  ['execution authority readiness', 'src/platform/execution/execution-authority-readiness.ts', ['executionCapabilityMatrix', 'BLOCKED']],
  ['transaction compatibility policy', 'src/platform/execution/transaction-compatibility.ts', ['SupportedTransactionVersion', 'UNSUPPORTED_CHAIN_TRANSACTION_VERSION']],
  ['transaction lifetime policy', 'src/platform/execution/transaction-lifetime.ts', ['TransactionLifetimeState', 'NEAR_EXPIRY']],
  ['hard veto kernel', 'src/platform/security/hard-veto-kernel.ts', ['HardVeto', 'VETO MEANS PROVEN VETO']],
  ['token semantic inspection', 'src/platform/security/token-semantics.ts', ['ExecutionPolicyVerdict', 'TRANSFER_SEMANTICS_UNVERIFIED']],
  ['signing firewall', 'src/platform/signing/signing-firewall.ts', ['class SigningFirewall', 'UNKNOWN_PROGRAM_DENIED']],
  ['durable live signer boundary', 'src/platform/signing/durable-live-signer.ts', ['class DurableLiveSigner', 'grantId']],
  ['settlement firewall', 'src/platform/signing/settlement-firewall.ts', ['class SettlementFirewall', 'rejectionReason']],
  ['release certification authority', 'src/platform/certification/release-certification.ts', ['PRODUCTION_CERTIFIED', 'UNVERIFIED_CANDIDATE']],
  ['temporal feature store', 'src/intelligence/truth/feature-store.ts', ['class PointInTimeFeatureStore', 'immutableJson']],
  ['JEV advisory shadow lane', 'src/intelligence/astra/jev-shadow-lane.ts', ['ADVISORY_ONLY', 'executionAuthorized: false']],
  ['operator evidence UI', 'terminal/src/OperatorProvider.jsx', ['OperatorProvider', 'STALE_PROJECTION']],
];

const root = resolve(import.meta.dirname, '..');
const missing = [];
for (const [name, relativePath, requiredMarkers] of controls) {
  const fullPath = resolve(root, relativePath);
  try {
    await access(fullPath);
    const source = await readFile(fullPath, 'utf8');
    const absentMarkers = requiredMarkers.filter((marker) => !source.includes(marker));
    if (absentMarkers.length) {
      missing.push({ name, relativePath, absentMarkers });
      console.log(`INCOMPLETE  ${name} — ${relativePath} (missing: ${absentMarkers.join(', ')})`);
      continue;
    }
    console.log(`PASS  ${name} — ${relativePath} (contract markers verified)`);
  } catch {
    missing.push({ name, relativePath });
    console.log(`MISSING  ${name} — ${relativePath}`);
  }
}

const certification = await readFile(resolve(root, 'FINAL_PRODUCTION_CERTIFICATION.md'), 'utf8');
const liveIsBlocked = /PRODUCTION_EXECUTION_CERTIFIED\s*=\s*FALSE/.test(certification);
console.log(`${liveIsBlocked ? 'PASS' : 'FAIL'}  production execution remains explicitly uncertified`);

if (missing.length || !liveIsBlocked) {
  console.error(`\nGod-tier source audit failed: ${missing.length} control(s) missing; live-certification guard=${liveIsBlocked}.`);
  process.exitCode = 1;
} else {
  console.log(`\nGod-tier source audit passed: ${controls.length}/25 controls are represented. This is not a production-release certificate.`);
}
