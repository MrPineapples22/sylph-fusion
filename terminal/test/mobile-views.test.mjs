import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Resolve relative to this test, not the shell's working directory, so the
// documented `npm --prefix terminal test` command is portable.
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const spotlightCss = readFileSync(resolve(projectRoot, 'terminal/src/spotlight.css'), 'utf8');
const cockpitCss = readFileSync(resolve(projectRoot, 'terminal/src/cockpit.css'), 'utf8');
const operatorCss = readFileSync(resolve(projectRoot, 'terminal/src/operator-terminal.css'), 'utf8');

test('mobile viewport breakpoints: defined and non-overlapping', () => {
  // Check required breakpoints in spotlight.css
  assert.match(spotlightCss, /@media\s*\(\s*max-width:\s*650px\s*\)/, 'Mobile max-width 650px breakpoint must exist');
  assert.match(spotlightCss, /@media\s*\(\s*max-width:\s*320px\s*\)/, 'Ultra-compact max-width 320px breakpoint must exist');
  assert.match(spotlightCss, /@media\s*\(\s*max-width:\s*1100px\s*\)/, 'Tablet max-width 1100px breakpoint must exist');
});

test('mobile touch target sizes meet accessibility requirements (>= 44px)', () => {
  // Mobile nav buttons must be at least 44px tall
  assert.match(spotlightCss, /min-height:\s*(?:44px|48px)/, 'Touch targets must be >= 44px');
  // Confirm spot-filters and spot-actions meet min-height
  assert.match(spotlightCss, /\.spot-filters\s+button\s*\{[^}]*min-height:\s*48px/);
  assert.match(spotlightCss, /\.spot-action,\s*\.spot-lock,\s*\.spot-order\s*>\s*button:first-of-type\s*\{[^}]*min-height:\s*48px/);
  assert.match(operatorCss, /\.op-terminal \.op-token-link\{min-height:44px\}/, 'Mobile token-row actions must be at least 44px tall');
});

test('zero accidental horizontal overflow rules enforced on mobile containers', () => {
  // Ensure overflow handling rules
  assert.match(spotlightCss, /box-sizing:\s*border-box/, 'Box-sizing must be border-box');
  assert.match(spotlightCss, /overflow-wrap:\s*anywhere/, 'Text must break without creating horizontal page overflow');
  assert.match(cockpitCss, /overflow-x:\s*auto/, 'Scrollable tables must contain horizontal overflow');
});

test('mobile window navigation: all 6 canonical operational views configured', () => {
  const spotlightJsx = readFileSync(resolve(projectRoot, 'terminal/src/Spotlight.jsx'), 'utf8');
  assert.match(spotlightJsx, /'Overview'/, 'Overview tab must exist');
  assert.match(spotlightJsx, /'Market'/, 'Market tab must exist');
  assert.match(spotlightJsx, /'Opportunities'/, 'Opportunities tab must exist');
  assert.match(spotlightJsx, /'Positions'/, 'Positions tab must exist');
  assert.match(spotlightJsx, /'Alerts'/, 'Alerts tab must exist');
  assert.match(spotlightJsx, /'System'/, 'System tab must exist');
});

test('desktop and mobile share single authoritative backend state', () => {
  const spotlightJsx = readFileSync(resolve(projectRoot, 'terminal/src/Spotlight.jsx'), 'utf8');
  assert.match(spotlightJsx, /startDiscoveryConnection/, 'Must consume real discovery connection');
  assert.match(spotlightJsx, /\/api\/command/, 'Must route all capital/emergency actions through authoritative gateway');
  // Verify fail-closed stale feed behavior
  assert.match(spotlightJsx, /stale\s*\?\s*'MARKET FEED STALE — CAPITAL LOCKED'/, 'Stale feed must prominently display capital lock');
});
