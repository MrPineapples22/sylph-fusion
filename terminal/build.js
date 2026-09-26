import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Resolve through Vite so npm and pnpm's isolated dependency layouts both work.
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const esbuildCli = viteRequire.resolve('esbuild/bin/esbuild');
process.chdir(dirname(fileURLToPath(import.meta.url)));
mkdirSync('dist/assets', { recursive: true });

function bundle(args) {
  // Inherited streams also work on hosts that disallow esbuild's service pipes.
  // On Windows esbuild's CLI is JavaScript; Unix installations may replace it
  // with the native executable during installation.
  const command = process.platform === 'win32' ? process.execPath : esbuildCli;
  const commandArgs = process.platform === 'win32' ? [esbuildCli, ...args] : args;
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`esbuild failed (${result.signal || result.status})`);
  }
}

console.log('Building production app bundle...');
bundle([
  'src/main.jsx', '--bundle', '--minify', '--format=esm',
  '--platform=browser', '--target=es2022', '--outfile=dist/assets/app.js',
  '--sourcemap', '--loader:.js=jsx', '--loader:.jsx=jsx', '--loader:.ts=ts',
  '--loader:.css=empty', '--define:process.env.NODE_ENV="production"'
]);

console.log('Building execution engine...');
bundle([
  '../src/execution-engine.ts', '--bundle', '--format=esm',
  '--platform=node', '--target=node24', '--outfile=dist/execution-engine.js'
]);

console.log('Building styles and assets...');
await import('./build-assets.mjs');
console.log('Build completed successfully!');
