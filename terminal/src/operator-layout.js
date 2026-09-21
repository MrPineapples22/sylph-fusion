/**
 * Operator layout and workspace persistence manager for Sylph Fusion.
 * Remembers panel visibility, selected session, time mode, and compact/full modes.
 */

export const LAYOUT_STORAGE_KEY = 'sylph-operator-layout-v1';

export const LAYOUT_MODES = {
  STANDARD: 'standard',
  COMPACT: 'compact',
  TELEMETRY: 'telemetry',
  EMERGENCY: 'emergency',
};

export const DEFAULT_LAYOUT = {
  layoutMode: LAYOUT_MODES.STANDARD,
  timeMode: 'local', // 'local' | 'utc'
  soakOpen: true,
  researchOpen: false,
  filter: 'all',
  selectedSession: null,
};

export function loadSavedLayout(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return { ...DEFAULT_LAYOUT };
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_LAYOUT,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(preferences, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try {
    const current = loadSavedLayout(storage);
    const updated = { ...current, ...preferences };
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

export function resetLayout(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return { ...DEFAULT_LAYOUT };
  try {
    storage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {}
  return { ...DEFAULT_LAYOUT };
}
