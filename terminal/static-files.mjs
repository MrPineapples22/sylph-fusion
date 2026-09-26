import {readFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';

const DOCUMENT_ROUTES = new Set(['/', '/mobile', '/simulator']);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function containedPath(base, requestPath) {
  const file = resolve(base, '.' + requestPath);
  return file.startsWith(resolve(base) + sep) ? file : null;
}

export async function serveStaticRequest({req, res, root, read = readFile}) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).pathname);
  } catch {
    res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(req.method === 'HEAD' ? undefined : 'Invalid request path');
    return;
  }

  const documentRequest = DOCUMENT_ROUTES.has(pathname);
  const relativePath = documentRequest ? '/index.html' : pathname;
  // Production must serve one identifiable artifact. Falling back to the
  // legacy UI can mask a missing or corrupt terminal build with HTTP 200.
  const candidates = [containedPath(root, relativePath)].filter(Boolean);

  for (const file of candidates) {
    try {
      const data = await read(file);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] || 'application/octet-stream');
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : data);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
        res.writeHead(503, {'Content-Type': 'text/plain; charset=utf-8'});
        res.end(req.method === 'HEAD' ? undefined : 'Terminal asset unavailable');
        return;
      }
    }
  }

  const status = documentRequest ? 503 : 404;
  res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
  res.end(req.method === 'HEAD' ? undefined : documentRequest ? 'Terminal UI unavailable' : 'Asset not found');
}
