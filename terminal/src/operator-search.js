import { WORKSPACES } from './operator-navigation.js';

export const WORKSPACE_DETAILS = {
  Command: 'Your operating picture, evidence and next steps',
  'Aether Flux': 'Discover, filter and compare observed tokens',
  'Token Intelligence': 'Investigate signals, sources and missing evidence',
  Execution: 'Inspect action capabilities and operating constraints',
  Positions: 'Review reported positions and capital',
  Incidents: 'Inspect blockers and recent state changes',
  System: 'Inspect provider health and automation responsibility',
  Info: 'Understand evidence, authority and the simulator',
};

/** Navigation only. Search results never grant execution authority. */
export function searchOperations(query = '', tokens = []) {
  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = value => terms.every(term => value.toLowerCase().includes(term));
  const workspaces = WORKSPACES.filter(name => matches(`${name} ${WORKSPACE_DETAILS[name]}`))
    .map(name => ({ id: `workspace:${name}`, kind: 'workspace', label: name, detail: WORKSPACE_DETAILS[name], workspace: name }));
  if (!terms.length) return workspaces;
  const seen = new Set();
  const results = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!token || typeof token.mint !== 'string' || !token.mint || seen.has(token.mint)) continue;
    seen.add(token.mint);
    if (matches(`${token.symbol || ''} ${token.mint}`)) results.push({ id: `token:${token.mint}`, kind: 'token', label: token.symbol || 'Unknown token', detail: token.mint, token });
    if (results.length === 12) break;
  }
  return [...workspaces, ...results];
}

export function moveSearchSelection(index, delta, count) {
  return count > 0 ? ((index + delta) % count + count) % count : 0;
}

export function selectedSearchIndex(results, selectedId) {
  return Math.max(0, results.findIndex(result => result.id === selectedId));
}
