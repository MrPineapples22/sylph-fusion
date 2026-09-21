import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist/assets', { recursive: true });

console.log('Building app bundle...');
await esbuild.build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'dist/assets/app.js',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' }
});

console.log('Building execution engine...');
await esbuild.build({
  entryPoints: ['../src/execution-engine.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'dist/execution-engine.js'
});

console.log('Building styles and assets...');
await import('./build-assets.mjs');
console.log('Build completed successfully!');
