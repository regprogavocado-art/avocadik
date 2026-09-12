// Local preview of the exact GitHub Pages artifact. No build or backend proxy.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const artifact = fileURLToPath(new URL('../github-dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

export async function startPreview({ port = 8000, host = '127.0.0.1' } = {}) {
  const root = await realpath(artifact);
  await stat(resolve(root, 'index.html'));
  const insideRoot = path => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
  const send = async (request, response, path, status = 200) => {
    const file = await realpath(path);
    if (!insideRoot(file)) throw new Error('Artifact path escaped preview root');
    const bytes = await readFile(file);
    response.writeHead(status, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  };
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
      const rawPath = (request.url || '/').split('?')[0];
      const decoded = decodeURIComponent(rawPath);
      if (!decoded.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(decoded) || /%(?:2f|5c)/i.test(rawPath) || decoded.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(400); response.end('Invalid path'); return;
      }
      const target = resolve(root, '.' + decoded);
      if (!insideRoot(target)) { response.writeHead(400); response.end('Invalid path'); return; }
      const entry = await stat(target).catch(error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; });
      if (entry?.isFile()) { await send(request, response, target); return; }
      if (entry?.isDirectory()) {
        const index = resolve(target, 'index.html');
        const exists = await stat(index).then(value => value.isFile()).catch(() => false);
        if (exists) {
          if (!rawPath.endsWith('/')) {
            response.writeHead(301, { Location: rawPath + '/' + (request.url.includes('?') ? '?' + request.url.split('?').slice(1).join('?') : '') }); response.end(); return;
          }
          await send(request, response, index); return;
        }
      }
      await send(request, response, resolve(root, '404.html'), 404);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 500);
      response.end(error instanceof URIError ? 'Invalid path' : 'Preview could not serve this request');
    }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startPreview();
  console.log(`GitHub artifact preview: http://127.0.0.1:8000 (PID ${process.pid})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
