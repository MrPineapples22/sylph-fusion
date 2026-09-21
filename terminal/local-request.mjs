export function isLocalRequest(req, port) {
  const authorities = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!authorities.has(req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin && ![...authorities].some(host => origin === `http://${host}`)) return false;
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
  const types = ['SUBMIT_ORDER', 'CLOSE_POSITION', 'CHANGE_MODE', 'SET_AUTOMATION', 'EMERGENCY_STOP'];
  if (!command || typeof command !== 'object' || !types.includes(command.type) ||
      typeof command.commandId !== 'string' || !command.commandId || command.commandId.length > 128 ||
      typeof command.initiator !== 'string' || !command.initiator || command.initiator.length > 128 ||
      !Number.isFinite(command.timestamp) || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
    throw Object.assign(new Error('Invalid command envelope'), {status: 400});
  }
  return command;
}
