import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandCatalog, filterCommands, ACTION_CATEGORIES } from '../src/command-palette.js';

test('buildCommandCatalog populates default actions, tokens, and sessions', () => {
  const catalog = buildCommandCatalog({
    tokens: [{ id: 'SOL', symbol: 'SOL', name: 'Solana' }, { id: 'BONK', symbol: 'BONK', name: 'Bonk' }],
    sessions: [{ name: 'soak-session-1' }],
    timeMode: 'local',
    alertCount: 3,
  });

  assert.ok(catalog.length >= 8, 'Should contain actions and tokens');
  assert.ok(catalog.some(c => c.actionType === 'TOGGLE_ALERTS'));
  assert.ok(catalog.some(c => c.actionType === 'TOGGLE_TIME_MODE'));
  assert.ok(catalog.some(c => c.actionType === 'EXPORT_INCIDENT_REPORT'));
  assert.ok(catalog.some(c => c.actionType === 'SELECT_TOKEN' && c.payload === 'BONK'));
  assert.ok(catalog.some(c => c.actionType === 'SELECT_SESSION' && c.payload === 'soak-session-1'));
});

test('filterCommands filters by title substring, category, or keywords', () => {
  const catalog = buildCommandCatalog({
    tokens: [{ id: 'SYLPH', symbol: 'SYLPH', name: 'Sylph Fusion' }],
  });

  const alertResults = filterCommands(catalog, 'alert');
  assert.ok(alertResults.length > 0);
  assert.equal(alertResults[0].actionType, 'TOGGLE_ALERTS');

  const tokenResults = filterCommands(catalog, 'sylph');
  assert.ok(tokenResults.length > 0);
  assert.equal(tokenResults[0].payload, 'SYLPH');

  const emptyResults = filterCommands(catalog, 'nonexistent_query_xyz');
  assert.equal(emptyResults.length, 0);
});

test('filterCommands matches shortcut exact match', () => {
  const catalog = buildCommandCatalog({});
  const res = filterCommands(catalog, 'u');
  assert.ok(res.some(c => c.actionType === 'TOGGLE_TIME_MODE'));
});
