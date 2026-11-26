// A loopback static file server (for built Storybooks) and a readiness wait (for page servers).
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
};

export function serveStatic(root) {
  const base = normalize(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); statSync(file); }
    catch { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    }));
  });
}

export async function waitForUrl(url, timeoutSeconds, isAlive = () => true) {
  const end = Date.now() + timeoutSeconds * 1000;
  let last = '';
  while (Date.now() < end) {
    if (!isAlive()) throw new Error('server process exited before it was ready');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.status < 500) return;
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.cause?.code ?? e.message; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} was not ready after ${timeoutSeconds}s (${last})`);
}

export async function startCommandServer({ command, url, timeoutSeconds }, cwd) {
  const child = spawn(command, { shell: true, cwd, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  let alive = true;
  child.on('exit', () => { alive = false; });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
  try { await waitForUrl(url, timeoutSeconds, () => alive); }
  catch (e) { stop(); throw e; }
  return { url: url.replace(/\/$/, ''), close: async () => stop() };
}
