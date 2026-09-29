export function isLocalRequest(req, port) {
  const remoteIp = req.socket?.remoteAddress;
  const loopbackIps = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  if (remoteIp && !loopbackIps.has(remoteIp)) return false;
  const authorities = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = req.headers.host || '';
  if (!authorities.has(host) || req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin) {
    const originMatch = /^https?:\/\/([^/]+)/.exec(origin);
    const originHost = originMatch ? originMatch[1] : origin;
    if (!authorities.has(originHost)) return false;
  }
  return true;
}

export async function readCommand(req, limit = 16_384) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('JSON content type required'), {status: 415});
  }
  const chunks = [];
  let size = 0;
  const stream = typeof req.iterator === 'function' ? req.iterator({destroyOnReturn: false}) : req;
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    if (size > limit) {
      req.resume?.();
      throw Object.assign(new Error('Command body too large'), {status: 413});
    }
    chunks.push(Buffer.from(chunk));
  }
  let command;
  try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON command'), {status: 400}); }
  const types = ['SUBMIT_ORDER', 'CLOSE_POSITION', 'CHANGE_MODE', 'SET_AUTOMATION', 'EMERGENCY_STOP', 'CLEAR_EMERGENCY_STOP', 'PANIC_CLOSE_ALL', 'SET_PAPER_CAPITAL'];
  if (!command || typeof command !== 'object' || !types.includes(command.type) ||
      typeof command.commandId !== 'string' || !command.commandId || command.commandId.length > 128 ||
      typeof command.initiator !== 'string' || !command.initiator || command.initiator.length > 128 ||
      !Number.isFinite(command.timestamp) || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
    throw Object.assign(new Error('Invalid command envelope'), {status: 400});
  }
    // Base58 validation for mints
  if (command.payload && command.payload.mint) {
    const mintStr = String(command.payload.mint);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintStr)) {
      throw Object.assign(new Error('Invalid token mint address format (base58 required)'), {status: 400});
    }
  }
  return command;
}
