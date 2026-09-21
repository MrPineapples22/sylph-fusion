import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatFreshness, getFreshnessBadge } from '../src/time-format.js';

test('formatTime formats UTC and local strings predictably', () => {
  const ts = Date.UTC(2026, 8, 16, 23, 15, 30); // 2026-09-16 23:15:30 UTC
  const utcFormatted = formatTime(ts, 'utc');
  assert.equal(utcFormatted, '23:15:30 UTC');

  const utcWithDate = formatTime(ts, 'utc', true);
  assert.equal(utcWithDate, '2026-09-16 23:15:30 UTC');

  const localFormatted = formatTime(ts, 'local');
  assert.match(localFormatted, /^\d{2}:\d{2}:\d{2}$/);
});

test('formatFreshness formats milliseconds, seconds, and minutes accurately', () => {
  assert.equal(formatFreshness(350), '350ms');
  assert.equal(formatFreshness(2400), '2.4s');
  assert.equal(formatFreshness(65000), '1m 5s');
  assert.equal(formatFreshness(null), '—');
});

test('getFreshnessBadge assigns live, stale, and disconnected statuses', () => {
  const live = getFreshnessBadge(400, false);
  assert.equal(live.status, 'live');
  assert.equal(live.tone, 'positive');

  const stale = getFreshnessBadge(6500, false);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.tone, 'warning');

  const disconnected = getFreshnessBadge(10000, true);
  assert.equal(disconnected.status, 'disconnected');
  assert.equal(disconnected.tone, 'negative');
});
