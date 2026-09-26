/**
 * OperatorProvider — Central React context for the Operator Experience Runtime (OXR).
 *
 * Manages:
 * - Unified projection polling (replaces separate /api/system/strip and /live/api/system/trust calls)
 * - Workspace FSM state (via workspaceReducer)
 * - Stale fence timer (auto-transitions to STALE_PROJECTION when validUntil expires)
 * - Capability cache for efficient child lookups
 * - Attention arbitration (force-navigates to emergency on critical incidents)
 *
 * All children consume projection data through useOperator() — no direct fetch calls.
 */
import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  initialWorkspace,
  workspaceReducer,
  isProjectionCurrent,
  stableTokenOrder,
  startOperatorConnection,
} from './operator-runtime.js';

const OperatorContext = createContext(null);

const POLL_ACTIVE_MS = 2000;
const POLL_BACKGROUND_MS = 10000;
const STALE_CHECK_MS = 1000;

export function OperatorProvider({ children, apiBase = '' }) {
  const [workspace, dispatchWorkspace] = useReducer(workspaceReducer, undefined, initialWorkspace);
  const [projection, setProjection] = React.useState(null);
  const [connectionState, setConnectionState] = React.useState('BOOT');
  const staleTimerRef = useRef(null);
  const tokenOrderRef = useRef([]);
  const latestProjectionRef = useRef(null);
  const latestConnectionRef = useRef('BOOT');

  // Stale fence: periodically check if the last accepted projection has expired
  useEffect(() => {
    const check = () => {
      if (latestProjectionRef.current && !isProjectionCurrent(latestProjectionRef.current, latestConnectionRef.current)) {
        dispatchWorkspace({ type: 'STALE_PROJECTION' });
        setConnectionState('STALE');
      }
    };
    staleTimerRef.current = setInterval(check, STALE_CHECK_MS);
    return () => clearInterval(staleTimerRef.current);
  }, []);

  // Projection polling via operator connection
  useEffect(() => {
    const request = async (signal) => {
      const res = await fetch(`${apiBase}/api/operator`, { signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Projection fetch failed: ${res.status}`);
      return res.json();
    };

    const stop = startOperatorConnection({
      request,
      onSnapshot: (data) => {
        latestProjectionRef.current = data;
        setProjection(data);
        // Maintain stable token order
        tokenOrderRef.current = stableTokenOrder(
          tokenOrderRef.current,
          // The discovery authority publishes candidate observations as
          // `rows`; accepting the legacy `tokens` alias keeps older replay
          // fixtures compatible without emptying a valid live projection.
          data.rows || data.tokens || []
        );
        // Attention arbitration: critical incidents force navigation
        if (data.incidents?.some(i => i.priority === 'A1' || i.priority === 'A2')) {
          dispatchWorkspace({ type: 'ATTENTION_OVERRIDE', target: 'Incidents' });
        }
        if (data.system?.state === 'HALTED') {
          dispatchWorkspace({ type: 'ATTENTION_OVERRIDE', target: 'System' });
        }
      },
      onState: (state) => {
        latestConnectionRef.current = state;
        setConnectionState(state);
        dispatchWorkspace({ type: state === 'CONNECTED' ? 'CONNECTED' : 'REVALIDATE' });
      },
      intervalMs: POLL_ACTIVE_MS,
    });
    return stop;
  }, [apiBase]);

  // Adjust polling based on visibility
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Will be handled by startOperatorConnection's built-in visibility listener
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const navigate = useCallback((target) => {
    dispatchWorkspace({ type: 'NAVIGATE', workspace: target });
  }, []);

  const investigate = useCallback((mint) => {
    dispatchWorkspace({ type: 'INVESTIGATE', mint });
  }, []);

  const prepareExecution = useCallback((review) => {
    dispatchWorkspace({ type: 'PREPARE', review });
  }, []);

  const abandonExecution = useCallback(() => {
    dispatchWorkspace({ type: 'ABANDON' });
  }, []);

  const clearAttention = useCallback(() => {
    dispatchWorkspace({ type: 'CLEAR_ATTENTION' });
  }, []);

  const toggleComparison = useCallback((mint) => {
    dispatchWorkspace({ type: 'COMPARE', mint });
  }, []);

  // Capability lookup: returns {state, reasonCodes, blockerChain} for an action
  const getCapability = useCallback((action) => {
    if (!isProjectionCurrent(projection, connectionState) || !projection?.capabilities?.[action]) {
      return { state: 'UNKNOWN', reasonCodes: ['PROJECTION_UNAVAILABLE'], blockerChain: ['PROJECTION_UNAVAILABLE'] };
    }
    return {
      ...projection.capabilities[action],
      blockerChain: projection.capabilityBlockers?.[action] || projection.capabilities[action].reasonCodes,
    };
  }, [projection, connectionState]);

  // Is any action currently allowed?
  const isActionPermitted = useCallback((action) => {
    if (workspace.staleProjection || !isProjectionCurrent(projection, connectionState)) return false;
    const cap = getCapability(action);
    return cap.state === 'READY';
  }, [workspace.staleProjection, projection, connectionState, getCapability]);

  const value = useMemo(() => ({
    // Projection data
    projection,
    connectionState,
    isStale: workspace.staleProjection,
    stableTokenOrder: tokenOrderRef.current,

    // Workspace state
    workspace,
    navigate,
    investigate,
    prepareExecution,
    abandonExecution,
    clearAttention,
    toggleComparison,

    // Capability queries
    getCapability,
    isActionPermitted,

    // Raw dispatch for advanced use
    dispatchWorkspace,
  }), [projection, connectionState, workspace, navigate, investigate, prepareExecution, abandonExecution, clearAttention, toggleComparison, getCapability, isActionPermitted]);

  return React.createElement(OperatorContext.Provider, { value }, children);
}

/**
 * Hook to consume operator context. Must be used within OperatorProvider.
 * @returns {Object} Operator context with projection, workspace, and capability helpers
 */
export function useOperator() {
  const ctx = useContext(OperatorContext);
  if (!ctx) throw new Error('useOperator must be used within an OperatorProvider');
  return ctx;
}
