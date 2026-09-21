import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSavedLayout, saveLayout, resetLayout, DEFAULT_LAYOUT, LAYOUT_MODES } from '../src/operator-layout.js';

function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

test('operator layout loads default when storage is empty', () => {
  const mockStorage = createMockStorage();
  const layout = loadSavedLayout(mockStorage);
  assert.equal(layout.layoutMode, LAYOUT_MODES.STANDARD);
  assert.equal(layout.timeMode, 'local');
  assert.equal(layout.soakOpen, true);
});

test('operator layout persists updates and merges with defaults', () => {
  const mockStorage = createMockStorage();
  saveLayout({ layoutMode: LAYOUT_MODES.COMPACT, timeMode: 'utc' }, mockStorage);

  const reloaded = loadSavedLayout(mockStorage);
  assert.equal(reloaded.layoutMode, LAYOUT_MODES.COMPACT);
  assert.equal(reloaded.timeMode, 'utc');
  assert.equal(reloaded.soakOpen, true); // preserved default
});

test('operator layout resets to default', () => {
  const mockStorage = createMockStorage();
  saveLayout({ layoutMode: LAYOUT_MODES.TELEMETRY }, mockStorage);
  resetLayout(mockStorage);

  const reloaded = loadSavedLayout(mockStorage);
  assert.equal(reloaded.layoutMode, LAYOUT_MODES.STANDARD);
});
