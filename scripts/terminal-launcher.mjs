/** Local launch checks must prove both service identity and usable UI assets. */
export function terminalPort(value) {
  const port = Number(value || 8795);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid TERMINAL_PORT.');
  return port;
}

export async function probeTerminal(url, request = fetch) {
  try {
    const read = path => request(new URL(path, url), {signal: AbortSignal.timeout(1500), redirect: 'error'});
    const health = await read('/health');
    if (!health.ok || (await health.json()).service !== 'sylph-paper-terminal') return false;
    const response = await read('/');
    if (!response.ok) return false;
    const page = await response.text();
    if (!page.includes('name="sylph-terminal"')) return false;
    const assets = [...page.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => match[1]);
    if (!assets.some(path => /\.js(?:\?|$)/.test(path)) || !assets.some(path => /\.css(?:\?|$)/.test(path))) return false;
    const checks = await Promise.all(assets.map(async path => {
      const asset = await read(path);
      const type = asset.headers.get('content-type') || '';
      return asset.ok && (/\.js(?:\?|$)/.test(path) ? /(?:java|ecma)script/i.test(type) : /text\/css/i.test(type)) && (await asset.text()).trim().length > 0;
    }));
    return checks.every(Boolean);
  } catch { return false; }
}

export async function waitForTerminal({probe, child, attempts = 30, delayMs = 500, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  let failure;
  let started = false;
  const onError = () => { failure = new Error('Terminal process could not start. Check the Node.js installation.'); };
  const onExit = code => { failure = new Error(`Terminal process exited before startup (code ${code ?? 'unknown'}). Check data/app-error.log.`); };
  child.on('error', onError);
  child.on('exit', onExit);
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (failure) throw failure;
      if (child.exitCode != null || child.signalCode != null) throw new Error('Terminal process stopped before startup. Check data/app-error.log.');
      const ready = await probe();
      if (failure) throw failure;
      if (ready) { started = true; return true; }
      if (attempt + 1 < attempts) await pause(delayMs);
    }
    return false;
  } finally {
    // This child belongs to this launch attempt, never an existing service.
    // Do not leave a detached listener behind after reporting startup failure.
    if (!started && child.exitCode == null && child.signalCode == null) {
      try { child.kill(); } catch { /* A failed spawn has no process to terminate. */ }
    }
    child.removeListener('error', onError);
    child.removeListener('exit', onExit);
  }
}
