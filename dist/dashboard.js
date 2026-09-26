import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
export async function startDashboard(source, port) {
    const token = randomBytes(32).toString('hex');
    let origin = '';
    let expectedHost = '';
    const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
    const script = await readFile(new URL('../ui/app.js', import.meta.url));
    const css = await readFile(new URL('../ui/style.css', import.meta.url));
    const reply = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const server = createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
            reply(res, 403, { error: 'Local dashboard access only' });
            return;
        }
        try {
            if (req.method === 'GET' && req.url === '/') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(html.replace('SESSION_TOKEN', token));
                return;
            }
            if (req.method === 'GET' && (req.url === '/app.js' || req.url === '/style.css')) {
                res.writeHead(200, { 'content-type': req.url === '/app.js' ? 'text/javascript' : 'text/css' });
                res.end(req.url === '/app.js' ? script : css);
                return;
            }
            const supplied = req.headers['x-dashboard-token'];
            if (typeof supplied !== 'string' || !/^[0-9a-f]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
                reply(res, 403, { error: 'Reload the dashboard to reconnect' });
                return;
            }
            if (req.method === 'GET' && req.url === '/api/state') {
                reply(res, 200, source.snapshot());
                return;
            }
            if (req.method === 'GET' && req.url === '/api/market' && source.marketSnapshot) {
                reply(res, 200, source.marketSnapshot());
                return;
            }
            if (req.method === 'GET' && req.url?.startsWith('/api/search?') && source.search) {
                reply(res, 200, await source.search(new URL(req.url, origin).searchParams.get('q') ?? ''));
                return;
            }
            if (req.method === 'GET' && req.url?.startsWith('/api/risk?') && source.risk) {
                reply(res, 200, await source.risk(new URL(req.url, origin).searchParams.get('mint') ?? ''));
                return;
            }
            if (req.method === 'POST' && (req.url === '/api/entries' || req.url === '/api/watch' || req.url === '/api/paper' || req.url === '/api/paper-auto')) {
                if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
                    reply(res, 403, { error: 'Invalid request origin or content type' });
                    return;
                }
                let body = '';
                for await (const chunk of req) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 512) {
                        reply(res, 413, { error: 'Request too large' });
                        return;
                    }
                }
                let value;
                try {
                    value = JSON.parse(body);
                }
                catch {
                    reply(res, 400, { error: 'Invalid JSON' });
                    return;
                }
                if (req.url === '/api/watch') {
                    const v = value;
                    if (!source.watch || !v || typeof v.mint !== 'string' || typeof v.enabled !== 'boolean' || Object.keys(v).length !== 2) {
                        reply(res, 400, { error: 'Expected mint and enabled' });
                        return;
                    }
                    await source.watch(v.mint, v.enabled);
                    reply(res, 200, source.marketSnapshot?.());
                    return;
                }
                if (req.url === '/api/paper') {
                    const v = value;
                    if (!source.paper || !v || !['buy', 'sell', 'test-buy'].includes(v.action) || typeof v.mint !== 'string' || (v.fraction !== undefined && (!Number.isInteger(v.fraction) || v.fraction < 1 || v.fraction > 10000)) || Object.keys(v).some(k => !['action', 'mint', 'fraction'].includes(k))) {
                        reply(res, 400, { error: 'Expected paper action, mint, and optional fraction' });
                        return;
                    }
                    reply(res, 200, await source.paper(v.action, v.mint, v.fraction));
                    return;
                }
                if (req.url === '/api/paper-auto') {
                    const v = value;
                    if (!source.setPaperAuto || !v || typeof v.enabled !== 'boolean' || Object.keys(v).length !== 1) {
                        reply(res, 400, { error: 'Expected enabled boolean' });
                        return;
                    }
                    await source.setPaperAuto(v.enabled);
                    reply(res, 200, source.snapshot());
                    return;
                }
                if (!value || typeof value !== 'object' || !('paused' in value) || typeof value.paused !== 'boolean' || Object.keys(value).length !== 1) {
                    reply(res, 400, { error: 'Expected paused boolean' });
                    return;
                }
                await source.setPaused(value.paused);
                reply(res, 200, source.snapshot());
                return;
            }
            reply(res, 404, { error: 'Not found' });
        }
        catch {
            reply(res, 503, { error: 'Dashboard action unavailable; check the bot terminal' });
        }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Dashboard did not bind to a TCP port');
    expectedHost = `127.0.0.1:${address.port}`;
    origin = `http://${expectedHost}`;
    return { url: origin, close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
//# sourceMappingURL=dashboard.js.map