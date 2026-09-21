#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  parseSplTokenVaultAmount,
  parseRaydiumV4PoolState,
  normalizeRaydiumReserves,
  parsePumpBondingCurve
} from './adapters/reserve-adapters.mjs';

const vault = Buffer.alloc(72);
vault.writeBigUInt64LE(42_500_000_000n, 64);
assert.equal(parseSplTokenVaultAmount(vault), 42_500_000_000n);
assert.throws(() => parseSplTokenVaultAmount(Buffer.alloc(71)), /Buffer underrun/);

const pool = Buffer.alloc(752);
const coinKey = Buffer.alloc(32, 0x11);
const pcKey = Buffer.alloc(32, 0x22);
coinKey.copy(pool, 32);
pcKey.copy(pool, 64);
const keys = parseRaydiumV4PoolState(pool);
assert.deepEqual(keys.coinVaultPubkey, coinKey);
assert.deepEqual(keys.pcVaultPubkey, pcKey);

const coin = Buffer.alloc(72);
const pc = Buffer.alloc(72);
coin.writeBigUInt64LE(10_000_000_000n, 64);
pc.writeBigUInt64LE(500_000_000_000n, 64);
const normalized = normalizeRaydiumReserves({ coinVaultBuffer: coin, pcVaultBuffer: pc, isSolBase: true, slot: 284910300 });
assert.equal(normalized.sol, 10_000_000_000n);
assert.equal(normalized.token, 500_000_000_000n);
assert.equal(normalized.protocol, 'RAYDIUM_V4');

const curve = Buffer.alloc(49);
curve.writeBigUInt64LE(1_073_000_191_000_000n, 8);
curve.writeBigUInt64LE(30_000_000_000n, 16);
curve.writeBigUInt64LE(793_100_000_000_000n, 24);
curve.writeBigUInt64LE(2_150_000_000n, 32);
curve.writeUInt8(0, 48);
const parsed = parsePumpBondingCurve(curve, 284910305);
assert.equal(parsed.token, 1_073_000_191_000_000n);
assert.equal(parsed.sol, 30_000_000_000n);
assert.equal(parsed.realToken, 793_100_000_000_000n);
assert.equal(parsed.realSol, 2_150_000_000n);
assert.equal(parsed.complete, false);
assert.equal(parsed.protocol, 'PUMP_FUN');

console.log('3/3 reserve adapter checks passed');
