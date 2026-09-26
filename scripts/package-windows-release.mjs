import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import {fileURLToPath, pathToFileURL} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.env.example',
  'terminal/server.mjs', 'terminal/astra-feed.mjs', 'terminal/soak-reader.mjs',
  'terminal/evidence-view.mjs', 'terminal/local-request.mjs'];
const trees = ['dist', 'terminal/dist', 'ui'];
const allowed = new Set(['.js', '.mjs', '.map', '.json', '.html', '.css', '.svg', '.png', '.ico', '.woff', '.woff2']);

// Parse syntax instead of searching text: comments and string contents are not imports.
export function runtimeModuleClosure(root, entry = 'terminal/server.mjs') {
  root = fs.realpathSync(root);
  const visited = new Set();
  function visit(relative) {
    relative = path.normalize(relative);
    const portable = relative.replaceAll('\\', '/');
    if (!/^(?:terminal\/[^/]+\.mjs|dist\/.+\.(?:mjs|js|json))$/.test(portable)) {
      throw new Error('Disallowed runtime dependency: ' + portable);
    }
    let full = root;
    for (const part of relative.split(path.sep)) {
      full = path.join(full, part);
      if (fs.lstatSync(full).isSymbolicLink()) throw new Error('Package input may not be a link: ' + relative);
    }
    if (!fs.statSync(full).isFile()) throw new Error('Runtime dependency is not a file: ' + relative);
    if (visited.has(relative)) return;
    visited.add(relative);
    if (path.extname(relative) === '.json') return;
    const source = ts.createSourceFile(relative, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports = [];
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) imports.push(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0])) throw new Error('Computed runtime import cannot be packaged: ' + relative);
        imports.push(node.arguments[0]);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const specifier of imports) {
      const value = specifier.text;
      if (value.startsWith('.')) visit(path.relative(root, fileURLToPath(new URL(value, pathToFileURL(full)))));
      else if (value.startsWith('/') || value.startsWith('file:')) throw new Error('Absolute runtime import cannot be packaged: ' + relative);
    }
  }
  visit(entry);
  return [...visited].sort();
}

export function packageCandidate(root, destination) {
  root = fs.realpathSync(root);
  destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error('Destination already exists; previous artifacts are never overwritten.');
  if (destination === root || root.startsWith(destination + path.sep)) throw new Error('Invalid package destination.');
  const inputs = [];
  function collect(relative, filtered = false) {
    const full = path.join(root, relative), stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Package input may not be a link: ' + relative);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) collect(path.join(relative, name), true);
    } else if (stat.isFile()) {
      if (filtered && !allowed.has(path.extname(relative))) throw new Error('Unexpected runtime artifact: ' + relative);
      inputs.push(relative);
    }
  }
  for (const file of new Set([...files, ...runtimeModuleClosure(root), ...trees])) collect(file);
  // The closure overlaps dist, which is also copied as a complete runtime tree.
  inputs.splice(0, inputs.length, ...new Set(inputs));
  for (const required of ['dist/fusion.js', 'dist/execution-engine.js', 'terminal/dist/index.html', 'ui/index.html', 'ui/app.js', 'ui/style.css']) {
    if (!inputs.includes(required.replaceAll('/', path.sep))) throw new Error('Missing runtime artifact: ' + required);
  }
  fs.mkdirSync(destination, {recursive: true});
  for (const relative of inputs) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(root, relative), target);
  }
  function write(name, text) {fs.writeFileSync(path.join(destination, name), text.replace(/\r?\n/g, '\r\n'));}
  write('install-dependencies.bat', '@echo off\ncd /d "%~dp0"\ncall pnpm install --frozen-lockfile --prod\nexit /b %errorlevel%\n');
  write('start-dashboard.bat', '@echo off\ncd /d "%~dp0"\necho SYLPH candidate - release certification pending\nset TERMINAL_PORT=8793\necho Dashboard: http://127.0.0.1:8793\nnode --env-file-if-exists=.env terminal/server.mjs\nexit /b %errorlevel%\n');
  write('start-engine.bat', '@echo off\ncd /d "%~dp0"\nif not exist .env (\n echo Configure .env from .env.example before starting the engine.\n exit /b 1\n)\nnode --env-file=.env dist/fusion.js --check\nif errorlevel 1 exit /b 1\nnode --env-file=.env dist/fusion.js\nexit /b %errorlevel%\n');
  write('INSTALL.txt', 'SYLPH WINDOWS CANDIDATE PACKAGE\nStatus: NOT CERTIFIED. Packaging does not prove release gates.\nRequires Node.js 24+ and pnpm 11.19.0.\nRun install-dependencies.bat to install the locked runtime dependencies.\nNo node_modules or user data is included. An internet connection or populated package cache is required.\nThe terminal runs at http://127.0.0.1:8793 and is simulation/observation only.\nCopy .env.example to .env and configure it before explicitly starting the separate engine.\nNo credential file, wallet, database, log, or session is copied from the development machine.\nUI source freshness, a clean install, startup, shutdown, and release gates still require verification.\n');
  const entries = [];
  function hash(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) hash(full);
      else {const bytes = fs.readFileSync(full); entries.push({path: path.relative(destination, full).replaceAll('\\', '/'), sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')});}
    }
  }
  hash(destination);
  const manifest = {application: 'sylph-fusion', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    releaseStatus: 'UNVERIFIED_CANDIDATE', packagedAtUtc: new Date().toISOString(),
    dependenciesIncluded: false, totalFiles: entries.length, files: entries};
  fs.writeFileSync(path.join(destination, 'RELEASE_MANIFEST.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function isDirectInvocation(argvEntry, moduleUrl) {
  if (!argvEntry) return false;
  if (pathToFileURL(path.resolve(argvEntry)).href === moduleUrl) return true;
  // Windows launchers can preserve a relative argv entry while the module URL
  // has a normalized drive path. Match the script identity as a safe fallback.
  const normalized = argvEntry.replaceAll('\\', '/');
  return normalized === 'scripts/package-windows-release.mjs' ||
    normalized.endsWith('/scripts/package-windows-release.mjs');
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  const target = path.join(projectRoot, 'release', 'candidate-' + new Date().toISOString().replaceAll(/[:.]/g, '-'));
  try {const manifest = packageCandidate(projectRoot, target); console.log(JSON.stringify({destination: target, files: manifest.totalFiles, status: manifest.releaseStatus}));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
