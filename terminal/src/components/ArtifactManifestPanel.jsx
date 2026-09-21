import React, { useState } from 'react';
import {
  FileCode,
  Download,
  Copy,
  Check,
  ShieldCheck,
  Database,
  Clock,
  Layers,
  Sliders,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { generateArtifactManifest } from '../artifact-manifest-eval.js';

export function ArtifactManifestPanel({
  session = null,
  config = null,
  rules = null,
  fills = [],
  candidates = [],
}) {
  const [copiedKey, setCopiedKey] = useState(null);

  const manifest = generateArtifactManifest({
    session,
    config,
    rules,
    fills,
    candidates,
  });

  const {
    sessionId,
    generatedAtUtc,
    schemas,
    cryptographicHashes,
    sessionBoundaries,
    policyContext,
    runtimeConfiguration,
    integrityVerification,
    itemCounts,
  } = manifest;

  const handleCopy = (text, key) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const handleDownloadManifest = () => {
    const jsonStr = JSON.stringify(manifest, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sylph-manifest-${sessionId}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <article className="soak-card manifest-card" id="artifact-manifest-panel">
      {/* Header */}
      <header className="soak-card-header">
        <div>
          <span className="eyebrow flex items-center gap-1">
            <FileCode size={12} className="text-accent" />
            REPRODUCIBILITY &amp; CHECKSUM AUDIT TRAIL
          </span>
          <h3>Artifact Manifest &amp; Checksums (SHA-256)</h3>
        </div>
        <div className="manifest-actions flex items-center gap-2">
          <span className="pill pill-session font-mono text-xs flex items-center gap-1" title="Computed from supplied JSON records; no saved reference was compared">
            <FileCode size={11} /> CHECKSUMS COMPUTED
          </span>
          <button
            type="button"
            className="btn btn-mini btn-primary flex items-center gap-1 font-mono text-xs"
            onClick={handleDownloadManifest}
            title="Download manifest.json with SHA-256 checksums (Unsigned)"
          >
            <Download size={12} /> Export manifest.json (Checksums)
          </button>
        </div>
      </header>

      <div className="manifest-body font-mono text-xs">
        {/* Session Metadata Strip */}
        <div className="manifest-meta-strip mb-3">
          <div>
            <span className="text-muted">SESSION ID:</span>
            <b>{sessionId}</b>
          </div>
          <div>
            <span className="text-muted">SLOTS:</span>
            <b>{sessionBoundaries.startSlot ?? '—'} &rarr; {sessionBoundaries.endSlot ?? '—'} ({sessionBoundaries.totalSlots ?? '—'} slots)</b>
          </div>
          <div>
            <span className="text-muted">DURATION:</span>
            <b>{sessionBoundaries.durationSeconds === null ? 'Unavailable' : `${sessionBoundaries.durationSeconds}s`}</b>
          </div>
          <div>
            <span className="text-muted">EVALUATED:</span>
            <b>{itemCounts.candidatesEvaluated} Candidates &bull; {itemCounts.fillsExecuted} Fills</b>
          </div>
        </div>

        {/* Schema Version Badges */}
        <div className="schema-versions-row mb-4 flex items-center gap-2">
          <span className="text-muted">SCHEMA VERSIONS:</span>
          <span className="pill pill-session">Snapshot: {schemas.snapshotSchemaVersion}</span>
          <span className="pill pill-session">Outcome: {schemas.outcomeSchemaVersion}</span>
          <span className="pill pill-session">Policy: {schemas.policySchemaVersion}</span>
        </div>

        {/* Cryptographic Hashes Grid */}
        <div className="hash-cards-grid mb-4">
          {/* Policy Hash */}
          <div className="hash-card">
            <div className="hash-card-header">
              <span>POLICY SHA-256 HASH</span>
              <button
                type="button"
                className="icon-copy"
                onClick={() => handleCopy(cryptographicHashes.policyHash, 'policy')}
                title="Copy Policy Hash"
              >
                {copiedKey === 'policy' ? <Check size={12} className="text-good" /> : <Copy size={12} />}
              </button>
            </div>
            <code className="hash-value">{cryptographicHashes.policyHash}</code>
            <small className="text-muted">
              Hashes entry criteria (drift cap 200 bps, buyer min 5), ladder tiers ({policyContext.tp1Pct}%, {policyContext.tp2Pct}%, {policyContext.tp3Pct}%), and stop loss ({policyContext.stopLossPct}%).
            </small>
          </div>

          {/* Configuration Hash */}
          <div className="hash-card">
            <div className="hash-card-header">
              <span>CONFIG SHA-256 HASH</span>
              <button
                type="button"
                className="icon-copy"
                onClick={() => handleCopy(cryptographicHashes.configHash, 'config')}
                title="Copy Config Hash"
              >
                {copiedKey === 'config' ? <Check size={12} className="text-good" /> : <Copy size={12} />}
              </button>
            </div>
            <code className="hash-value">{cryptographicHashes.configHash}</code>
            <small className="text-muted">
              Hashes runtime execution parameters (priority fees, Jito tip, 10ms timeout cap, sanitized RPC rate limits).
            </small>
          </div>

          {/* Candidate Checksum */}
          <div className="hash-card">
            <div className="hash-card-header">
              <span>CANDIDATE SNAPSHOTS CHECKSUM</span>
              <button
                type="button"
                className="icon-copy"
                onClick={() => handleCopy(cryptographicHashes.candidatesChecksum, 'candidates')}
                title="Copy Candidates Checksum"
              >
                {copiedKey === 'candidates' ? <Check size={12} className="text-good" /> : <Copy size={12} />}
              </button>
            </div>
            <code className="hash-value">{cryptographicHashes.candidatesChecksum}</code>
            <small className="text-muted">
              Verifies integrity of all sealed candidate feature snapshots and decision timestamps.
            </small>
          </div>

          {/* Fills Checksum */}
          <div className="hash-card">
            <div className="hash-card-header">
              <span>FILLS JOURNAL CHECKSUM</span>
              <button
                type="button"
                className="icon-copy"
                onClick={() => handleCopy(cryptographicHashes.fillsChecksum, 'fills')}
                title="Copy Fills Checksum"
              >
                {copiedKey === 'fills' ? <Check size={12} className="text-good" /> : <Copy size={12} />}
              </button>
            </div>
            <code className="hash-value">{cryptographicHashes.fillsChecksum}</code>
            <small className="text-muted">
              Verifies execution order ledger, net amounts, and cost basis consistency.
            </small>
          </div>
        </div>

        {/* Runtime Parameter Table */}
        <div className="manifest-params-section">
          <h4 className="text-muted mb-2">VERIFIED POLICY &amp; RUNTIME PARAMETERS</h4>
          <div className="param-grid">
            <div><span>Target Order Size:</span> <b>{policyContext.targetSizeSol} SOL</b></div>
            <div><span>Max Slippage:</span> <b>{policyContext.maxSlippageBps} BPS</b></div>
            <div><span>Take-Profit Ladder:</span> <b>+{policyContext.tp1Pct}% / +{policyContext.tp2Pct}% / +{policyContext.tp3Pct}%</b></div>
            <div><span>Stop-Loss &amp; Trailing:</span> <b>-{policyContext.stopLossPct}% / -{policyContext.trailingStopPct}%</b></div>
            <div><span>Max Positions:</span> <b>{policyContext.maxPositions}</b></div>
            <div><span>Reserve Drift Cap:</span> <b>&plusmn;{policyContext.reserveDriftCapBps} BPS</b></div>
            <div><span>Priority Fee:</span> <b>{runtimeConfiguration.priorityFeeMicrolamports} &micro;L</b></div>
            <div><span>Jito MEV Tip:</span> <b>{runtimeConfiguration.jitoTipSol} SOL</b></div>
            <div><span>RPC Drop Rate Cap:</span> <b>{runtimeConfiguration.rpcRateLimitCap}%</b></div>
            <div><span>Model Timeout Cap:</span> <b>{runtimeConfiguration.modelTimeoutMs}ms (Fail-Closed)</b></div>
          </div>
        </div>
      </div>

      <footer className="soak-card-footer">
        <small>
          Computed from the JSON records supplied to this panel, which may be a partial sample. No trusted reference or full artifact file was verified. These fingerprints are unsigned.
        </small>
      </footer>
    </article>
  );
}

export default ArtifactManifestPanel;
