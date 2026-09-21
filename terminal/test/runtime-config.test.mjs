import test from 'node:test';
import assert from 'node:assert/strict';
import { readRuntimeConfig } from '../soak-reader.mjs';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

test('readRuntimeConfig dynamically loads backend .env and engine overrides', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sylph-config-test-'));
  try {
    // Write custom .env with non-default values
    const envContent = [
      'MODE=paper',
      'BUY_LAMPORTS=25000000', // 0.025 SOL
      'STOP_BPS=1500',         // 15.0%
      'SLIPPAGE_BPS=450',      // 4.5%
      'MAX_POSITIONS=5',
      'MAX_PRIORITY_LAMPORTS=350000',
      'MIN_TIP_LAMPORTS=15000',
      'MIN_BUYERS=7',
    ].join('\n');
    await writeFile(join(tempDir, '.env'), envContent, 'utf8');

    // 1. Without live engine, reads .env on disk dynamically
    const cfg = await readRuntimeConfig(tempDir, null);
    assert.ok(cfg);
    assert.equal(cfg.source, 'project_env');
    assert.match(cfg.sourceDetail, /Backend Server/);
    assert.equal(cfg.isDynamic, true);
    assert.equal(cfg.BUY_LAMPORTS, 25_000_000);
    assert.equal(cfg.STOP_BPS, 1500);
    assert.equal(cfg.SLIPPAGE_BPS, 450);
    assert.equal(cfg.MAX_POSITIONS, 5);
    assert.equal(cfg.MAX_PRIORITY_LAMPORTS, 350_000);
    assert.equal(cfg.MIN_TIP_LAMPORTS, 15_000);
    assert.equal(cfg.MIN_BUYERS, 7);
    assert.deepEqual(cfg.EXIT_LADDER_STAGES, [12_000, 16_000, 25_000, 60_000, 160_000]);

    // 2. With live engine running, live engine limits take precedence
    const mockLiveEngine = {
      connected: true,
      mode: 'live',
      limits: {
        buy: '50000000',     // 0.05 SOL
        stop: 1800,           // 18.0%
        slippage: 500,
        positions: 4,
        priority: '400000',
        tip: '25000',
        exposure: '200000000',
      },
    };

    const liveCfg = await readRuntimeConfig(tempDir, mockLiveEngine);
    assert.equal(liveCfg.source, 'live_engine');
    assert.match(liveCfg.sourceDetail, /Live Engine Runtime/);
    assert.equal(liveCfg.BUY_LAMPORTS, 50_000_000);
    assert.equal(liveCfg.STOP_BPS, 1800);
    assert.equal(liveCfg.SLIPPAGE_BPS, 500);
    assert.equal(liveCfg.MAX_POSITIONS, 4);
    assert.equal(liveCfg.MAX_PRIORITY_LAMPORTS, 400_000);
    assert.equal(liveCfg.MODE, 'live');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('readRuntimeConfig handles missing .env gracefully with engine defaults', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sylph-empty-config-test-'));
  try {
    const cfg = await readRuntimeConfig(tempDir, null);
    assert.ok(cfg);
    assert.equal(cfg.source, 'engine_defaults');
    assert.equal(cfg.BUY_LAMPORTS, 10_000_000);
    assert.equal(cfg.STOP_BPS, 1200);
    assert.equal(cfg.SLIPPAGE_BPS, 300);
    assert.equal(cfg.MAX_POSITIONS, 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
