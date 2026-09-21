import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_MODES, loadSavedLayout, saveLayout, resetLayout, DEFAULT_LAYOUT } from '../src/operator-layout.js';

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}

test('operator-layout supports LAYOUT_MODES.EMERGENCY and persists emergency mode', () => {
  assert.strictEqual(LAYOUT_MODES.EMERGENCY, 'emergency');

  const storage = new MockStorage();
  const initial = loadSavedLayout(storage);
  assert.strictEqual(initial.layoutMode, LAYOUT_MODES.STANDARD);

  // Switch to emergency mode
  const saved = saveLayout({ layoutMode: LAYOUT_MODES.EMERGENCY }, storage);
  assert.strictEqual(saved.layoutMode, 'emergency');

  // Verify reload
  const reloaded = loadSavedLayout(storage);
  assert.strictEqual(reloaded.layoutMode, 'emergency');

  // Reset restores default standard
  const reset = resetLayout(storage);
  assert.strictEqual(reset.layoutMode, 'standard');
});
