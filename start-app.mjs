import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TERMINAL_PORT || 8793);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid TERMINAL_PORT.');
const url = `http://127.0.0.1:${port}/`;
async function ready() {
  try {
    const health = await fetch(`${url}health`, { signal: AbortSignal.timeout(1500) });
    if (health.ok) {
      if ((await health.json()).service !== 'sylph-paper-terminal') return false;
    } else if (health.status === 404) {
      // Older running instances predate /health; verify their actual market API.
      const market = await fetch(`${url}live/api/market`, { signal: AbortSignal.timeout(1500) });
      if (!market.ok) return false;
      const data = await market.json();
      if (!Array.isArray(data.tokens) || !data.sources) return false;
    } else return false;
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const page = await response.text();
    return response.ok && page.includes('name="sylph-terminal"') && /sylph/i.test(page);
  } catch { return false; }
}

try {
  if (!await ready()) {
    if (!existsSync(join(root, 'terminal/dist/index.html'))) throw new Error('App build is missing. Restore or build the project first.');
    if (!existsSync(join(root, 'dist/market-hub.js'))) throw new Error('Market server build is missing. Run npm run build in the project folder.');
    console.log('Starting SYLPH and its market feeds. Please wait...');
    mkdirSync(join(root, 'data'), { recursive: true });
    const out = openSync(join(root, 'data/app.log'), 'a');
    const err = openSync(join(root, 'data/app-error.log'), 'a');
    const child = spawn(process.execPath, ['terminal/server.mjs'], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err],
    });
    let launchError;
    child.on('error', error => { launchError = error; });
    child.unref();
    closeSync(out); closeSync(err);
    let started = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (launchError) throw launchError;
      if (await ready()) { started = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!started) throw new Error(`App could not start. Check data/app-error.log. Port ${port} may already be occupied.`);
  }
  if (!process.argv.includes('--check')) {
    const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
      .filter(Boolean).map(base => join(base, 'Microsoft/Edge/Application/msedge.exe')).find(existsSync);
    const browser = edge
      ? spawn(edge, [`--app=${url}`], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.on('error', error => { console.error(`Could not open the browser: ${error.message}\nOpen ${url}`); process.exitCode = 1; });
    browser.unref();
  }
  console.log(`SYLPH is ready: ${url}\nYou can close this launcher. The app continues running in the background.\nDouble-click Open SYLPH.cmd next time to reopen it.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
