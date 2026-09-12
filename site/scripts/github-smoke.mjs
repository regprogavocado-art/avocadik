// Read-only checks against the static artifact preview or the published GitHub site.
// node scripts/github-smoke.mjs [--base https://avocado.rest]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ELEMENT_NODE, parse, walkSync } from 'ultrahtml';

const publicOrigin = 'https://avocado.rest';
const adminURL = 'https://avocado-rest.pages.dev/admin';
const chatOrigin = 'https://avocado-chat.avocado-chat-worker.workers.dev';
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--base'), 'Usage: github-smoke.mjs [--base URL]');
const base = new URL(args[1] || 'http://127.0.0.1:8000');
assert.ok([publicOrigin, 'http://127.0.0.1:8000', 'http://localhost:8000'].includes(base.origin) && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password, 'Use the public GitHub site or the approved local static preview');
const assets = new Set();
const links = new Set();
const report = { base: base.origin, startedAt: new Date().toISOString(), routes: [], assets: 0, checks: [], ok: false };
const privateFields = /\b(?:sourceName|sourceUrl|sourceCheckedAt|source_name|source_url|source_checked_at|CLOUDFLARE_API_TOKEN|ADMIN_PASSWORD_HASH|SESSION_SECRET)\b|price-source/i;

async function get(path, status = 200, redirect = 'follow') {
  const response = await fetch(new URL(path, base), { method: 'GET', redirect, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, status, `${path}: expected HTTP ${status}`);
  return response;
}
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); }
function localURL(value, path) {
  if (!value || /^(?:data:|#)/i.test(value)) return null;
  const url = new URL(value, new URL(path, base));
  if (![base.origin, publicOrigin].includes(url.origin)) return null;
  return url;
}
function asset(value, path) {
  if (!value || /^(?:data:|#)/i.test(value)) return;
  const url = localURL(value, path);
  assert.ok(url, `${path}: public asset must be hosted with the site`);
  assert.equal(url.search, '', `${path}: asset queries must be resolved before export`);
  assets.add(url.pathname);
}
function cssAssets(css, path) {
  for (const match of css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) asset(match[2], path);
  for (const match of css.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) asset(match[2], path);
}

try {
  const sitemap = await (await get('/sitemap.xml')).text();
  const routes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => {
    const url = new URL(match[1]);
    assert.equal(url.origin, publicOrigin, 'Sitemap retains avocado.rest');
    assert.ok(url.pathname.endsWith('/') && !url.search && !url.hash, 'Sitemap uses static directory paths');
    return url.pathname;
  });
  check('Sitemap includes home, software, catalog, payment and news', ['/', '/software/', '/catalog/', '/payment/', '/news/'].every(path => routes.includes(path)));
  check('Sitemap routes are unique and public', new Set(routes).size === routes.length && !routes.some(path => /^\/(?:admin|api|worker|site)(?:\/|$)/.test(path)));
  const routeSet = new Set(routes);
  for (const path of routes) {
    const response = await get(path);
    assert.match(response.headers.get('content-type') || '', /text\/html/, `${path}: HTML response`);
    const html = await response.text();
    assert.doesNotMatch(html, privateFields, `${path}: no private procurement fields or credentials`);
    const document = parse(html);
    const canonical = [], h1 = [], configs = [], scripts = [];
    walkSync(document, node => {
      if (node.type !== ELEMENT_NODE) return;
      const name = node.name.toLowerCase(), attrs = node.attributes;
      if (name === 'h1') h1.push(node);
      if (name === 'link' && attrs.rel === 'canonical') canonical.push(attrs.href);
      if (name === 'a' && attrs.href) {
        const url = localURL(attrs.href, path);
        if (url) { assert.equal(url.search, '', `${path}: public links cannot depend on SSR queries`); links.add(url.pathname); }
      }
      if (name === 'script' && attrs.id === 'avocado-config') configs.push(JSON.parse(node.children.map(child => child.value || '').join('')));
      if (name === 'script' && !attrs.src && attrs.id !== 'avocado-config') scripts.push(node.children.map(child => child.value || '').join(''));
      if (attrs.src) asset(attrs.src, path);
      if (attrs.poster) asset(attrs.poster, path);
      if (name === 'link' && /(?:stylesheet|icon|preload|modulepreload)/.test(attrs.rel || '')) asset(attrs.href, path);
      if (['use', 'image'].includes(name)) asset(attrs.href || attrs['xlink:href'], path);
      for (const attribute of ['srcset', 'imagesrcset']) if (attrs[attribute]) for (const candidate of attrs[attribute].split(',')) asset(candidate.trim().split(/\s+/)[0], path);
      if (attrs.style) cssAssets(attrs.style, path);
      if (name === 'style') cssAssets(node.children.map(child => child.value || '').join(''), path);
      if (name === 'meta' && ['og:image', 'twitter:image'].includes(attrs.property || attrs.name)) asset(attrs.content, path);
    });
    assert.equal(h1.length, 1, `${path}: exactly one H1`);
    assert.deepEqual(canonical, [publicOrigin + path], `${path}: canonical stays on GitHub domain`);
    assert.equal(configs.length, 1, `${path}: one chat configuration`);
    assert.equal(configs[0].chatApiBase, chatOrigin, `${path}: static chat calls its existing Worker`);
    assert.ok(scripts.some(code => code.includes(chatOrigin)), `${path}: runtime chat configuration uses the Worker`);
    assert.ok(!scripts.some(code => /chatApiBase\s*=\s*window\.location\.origin/.test(code)), `${path}: no same-origin API assumption`);
    report.routes.push(path);
  }
  check('Every internal content link resolves to a published route', [...links].every(path => routeSet.has(path) || path === '/admin/'));
  for (const path of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']) assets.add(path);
  for (const path of assets) {
    const response = await get(path);
    const type = response.headers.get('content-type') || '';
    assert.ok(!/text\/html/.test(type), `${path}: asset must not resolve to the fallback page`);
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 0, `${path}: asset is non-empty`);
    if (/text\/css/.test(type)) cssAssets(new TextDecoder().decode(bytes), path);
    if (/(?:application|text)\/javascript/.test(type)) {
      for (const match of new TextDecoder().decode(bytes).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"\n]+)\1/g)) asset(match[2], path);
    }
  }
  report.assets = assets.size;
  const shortRoute = await get('/software', 301, 'manual');
  check('GitHub directory redirect preserves nested route', new URL(shortRoute.headers.get('location'), base).pathname === '/software/');
  const admin = await (await get('/admin/')).text();
  check('Admin route opens the protected Cloudflare CMS', admin.includes(`url=${adminURL}`) && admin.includes(`href="${adminURL}"`) && /noindex/.test(admin) && !/<form\b/i.test(admin));
  const robots = await (await get('/robots.txt')).text();
  check('Robots advertises public sitemap and excludes admin', robots.includes('Sitemap: https://avocado.rest/sitemap.xml') && robots.includes('Disallow: /admin'));
  for (const path of ['/not-a-static-page', '/catalog/not-a-category/', '/catalog/vps/not-a-product/', '/news/not-a-news-item/', '/api/public/manifest', '/api/admin/settings', '/worker/src/index.js', '/site/src/lib/data.ts', '/README.md', '/wrangler.json', '/output/production-access.json']) {
    const response = await get(path, 404);
    const html = await response.text();
    assert.match(response.headers.get('content-type') || '', /text\/html/, `${path}: uses the custom 404`);
    assert.doesNotMatch(html, privateFields, `${path}: fallback leaks no credentials or procurement fields`);
  }
  check('Private/server files and unknown routes return 404', true);
  report.ok = true;
  console.log(`Static smoke passed: ${report.routes.length} sitemap routes, ${report.assets} assets, links, canonical URLs, chat configuration, admin redirect and private paths.`);
} catch (error) {
  report.error = error.message;
  console.error('Static smoke failed: ' + error.message);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const folder = fileURLToPath(new URL('../output/', import.meta.url));
  await mkdir(folder, { recursive: true });
  await writeFile(new URL(`../output/github-smoke-${base.protocol === 'https:' ? 'live' : 'local'}.json`, import.meta.url), JSON.stringify(report, null, 2));
}
