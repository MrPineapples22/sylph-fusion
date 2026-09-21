/**
 * Command Palette search and action dispatch engine for Sylph Fusion.
 */

export const ACTION_CATEGORIES = {
  ACTIONS: 'Actions',
  TOKENS: 'Tokens & Assets',
  TELEMETRY: 'Telemetry & Sessions',
  LAYOUT: 'Layout & View',
};

/**
 * Builds the searchable catalog of operator commands.
 */
export function buildCommandCatalog({
  tokens = [],
  sessions = [],
  timeMode = 'local',
  layoutMode = 'standard',
  alertCount = 0,
}) {
  const items = [
    // Operator actions
    {
      id: 'action-alert-center',
      title: `Alert Center ${alertCount > 0 ? `(${alertCount} unacknowledged)` : ''}`,
      category: ACTION_CATEGORIES.ACTIONS,
      shortcut: 'A',
      keywords: ['alerts', 'notifications', 'rpc', 'errors', 'warnings'],
      actionType: 'TOGGLE_ALERTS',
    },
    {
      id: 'action-toggle-time',
      title: `Toggle Time Display (Currently: ${timeMode.toUpperCase()})`,
      category: ACTION_CATEGORIES.ACTIONS,
      shortcut: 'U',
      keywords: ['time', 'utc', 'local', 'clock', 'timezone'],
      actionType: 'TOGGLE_TIME_MODE',
    },
    {
      id: 'action-export-incident',
      title: 'Export Incident & Diagnostic Report (JSON)',
      category: ACTION_CATEGORIES.ACTIONS,
      keywords: ['incident', 'export', 'report', 'diagnostics', 'dump', 'debug'],
      actionType: 'EXPORT_INCIDENT_REPORT',
    },
    {
      id: 'action-export-audit',
      title: 'Export Execution Audit Tape (CSV)',
      category: ACTION_CATEGORIES.ACTIONS,
      keywords: ['audit', 'export', 'csv', 'trades', 'fills', 'rejections'],
      actionType: 'EXPORT_AUDIT_CSV',
    },
    {
      id: 'action-panic-close',
      title: 'Panic Close All Positions (Requires typed confirmation)',
      category: ACTION_CATEGORIES.ACTIONS,
      keywords: ['panic', 'close', 'liquidate', 'emergency', 'stop'],
      actionType: 'PANIC_CLOSE',
    },
    {
      id: 'action-reset-sim',
      title: 'Reset Paper Simulation (Requires typed confirmation)',
      category: ACTION_CATEGORIES.ACTIONS,
      keywords: ['reset', 'purge', 'restart', 'clear'],
      actionType: 'RESET_SIMULATION',
    },
    {
      id: 'action-inspect-provenance',
      title: 'Inspect Decision Provenance & Cryptographic Seal',
      category: ACTION_CATEGORIES.ACTIONS,
      shortcut: 'P',
      keywords: ['provenance', 'audit', 'gate', 'trace', 'seal', 'snapshot', 'forensics'],
      actionType: 'INSPECT_PROVENANCE',
    },
    {
      id: 'action-risk-waterfall',
      title: 'View Risk Budget Waterfall & Sizing Headroom',
      category: ACTION_CATEGORIES.ACTIONS,
      shortcut: 'W',
      keywords: ['waterfall', 'risk', 'budget', 'capital', 'headroom', 'capacity'],
      actionType: 'NAVIGATE_WATERFALL',
    },
    {
      id: 'action-paper-baseline',
      title: 'Compare Paper Simulation vs Deterministic Baseline',
      category: ACTION_CATEGORIES.ACTIONS,
      shortcut: 'B',
      keywords: ['compare', 'baseline', 'alpha', 'friction', 'drawdown', 'opportunity'],
      actionType: 'NAVIGATE_PAPER_BASELINE',
    },
    {
      id: 'action-counterfactual-methodology',
      title: 'View Counterfactual Methodology & Assumptions',
      category: ACTION_CATEGORIES.ACTIONS,
      shortcut: 'M',
      keywords: ['methodology', 'assumptions', 'counterfactual', 'alpha', 'formulas', 'friction', 'censoring'],
      actionType: 'VIEW_COUNTERFACTUAL_METHODOLOGY',
    },

    // Layout presets
    {
      id: 'layout-standard',
      title: 'Switch Layout: Standard Operator View',
      category: ACTION_CATEGORIES.LAYOUT,
      keywords: ['layout', 'standard', 'default', 'reset view'],
      actionType: 'SET_LAYOUT',
      payload: 'standard',
    },
    {
      id: 'layout-compact',
      title: 'Switch Layout: High-Density Compact View',
      category: ACTION_CATEGORIES.LAYOUT,
      keywords: ['layout', 'compact', 'dense', 'small'],
      actionType: 'SET_LAYOUT',
      payload: 'compact',
    },
    {
      id: 'layout-telemetry',
      title: 'Switch Layout: Telemetry Focus Mode',
      category: ACTION_CATEGORIES.LAYOUT,
      keywords: ['layout', 'telemetry', 'soak', 'focus'],
      actionType: 'SET_LAYOUT',
      payload: 'telemetry',
    },

    {
      id: 'layout-emergency',
      title: 'Switch Layout: Emergency Operator View (Distraction-Free)',
      category: ACTION_CATEGORIES.LAYOUT,
      shortcut: 'O',
      keywords: ['layout', 'emergency', 'operator', 'panic', 'clean', 'simple', 'positions'],
      actionType: 'SET_LAYOUT',
      payload: 'emergency',
    },

    // Telemetry & Sessions
    {
      id: 'telemetry-soak',
      title: 'View Soak Telemetry & RPC Health Gate',
      category: ACTION_CATEGORIES.TELEMETRY,
      shortcut: '3',
      keywords: ['soak', 'telemetry', 'gate', 'rpc', 'baseline'],
      actionType: 'NAVIGATE_SOAK',
    },
    {
      id: 'telemetry-model-shadow',
      title: 'View Model Shadow & Disagreement Analysis',
      category: ACTION_CATEGORIES.TELEMETRY,
      shortcut: 'D',
      keywords: ['shadow', 'model', 'ml', 'disagreement', 'confusion', 'matrix', 'latency'],
      actionType: 'NAVIGATE_MODEL_SHADOW',
    },
    {
      id: 'telemetry-artifact-manifest',
      title: 'View Artifact Manifest & Cryptographic Hashes',
      category: ACTION_CATEGORIES.TELEMETRY,
      shortcut: 'E',
      keywords: ['manifest', 'checksum', 'hash', 'policy', 'sha256', 'reproducibility'],
      actionType: 'NAVIGATE_ARTIFACT_MANIFEST',
    },
    {
      id: 'telemetry-compare',
      title: 'Compare Soak Sessions (A/B Side-by-Side)',
      category: ACTION_CATEGORIES.TELEMETRY,
      keywords: ['compare', 'soak', 'sessions', 'delta', 'funnel', 'attrition'],
      actionType: 'OPEN_SESSION_COMPARE',
    },
  ];

  // Add sessions if provided
  for (const s of sessions) {
    items.push({
      id: `session-${s.name || s.id}`,
      title: `Select Soak Session: ${s.name || s.id}`,
      category: ACTION_CATEGORIES.TELEMETRY,
      keywords: ['session', s.name || s.id],
      actionType: 'SELECT_SESSION',
      payload: s.name || s.id,
    });
  }

  // Add tokens / candidates
  for (const t of tokens) {
    items.push({
      id: `token-${t.id || t.mint || t.symbol}`,
      title: `Inspect Token: ${t.symbol || 'Unknown'} (${t.name || t.id || t.mint})`,
      category: ACTION_CATEGORIES.TOKENS,
      keywords: ['token', t.symbol, t.name, t.id, t.mint].filter(Boolean),
      actionType: 'SELECT_TOKEN',
      payload: t.id || t.mint,
    });
  }

  return items;
}

/**
 * Filter catalog items using query substring or keyword matching.
 */
export function filterCommands(catalog, query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return catalog;

  return catalog.filter(item => {
    if (item.title.toLowerCase().includes(q)) return true;
    if (item.category.toLowerCase().includes(q)) return true;
    if (item.keywords && item.keywords.some(k => k.toLowerCase().includes(q))) return true;
    if (item.shortcut && item.shortcut.toLowerCase() === q) return true;
    return false;
  });
}
