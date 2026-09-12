import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ELEMENT_NODE, parse, renderSync, walkSync } from 'ultrahtml';
import { reservedPageSlugs } from '../src/lib/public-route-rules.mjs';

export const PUBLIC_ORIGIN = 'https://avocado.rest';
export const SOURCE_ORIGIN = 'https://avocado-rest.pages.dev';
export const CHAT_ORIGIN = 'https://avocado-chat.avocado-chat-worker.workers.dev';
const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = resolve(siteRoot, 'github-dist');
const PAGE_LIMIT = 1000;
const ASSET_LIMIT = 1500;
const TOTAL_LIMIT = 192 * 1024 * 1024;
const RESERVED = new Set(reservedPageSlugs);
const COMMON_PAGES = new Set(['/', '/software', '/hass', '/ettinger', '/rent', '/catalog', '/countries', '/payment', '/news', '/contacts']);
const CATEGORY = '(?:domains|vps|dedicated|bulletproof|proxies)';
const PUBLIC_PRIVATE_FIELDS = /\b(?:sourceName|sourceUrl|sourceCheckedAt|source_name|source_url|source_checked_at|CLOUDFLARE_API_TOKEN|ADMIN_PASSWORD_HASH|SESSION_SECRET)\b|price-source/i;
const EXTENSION_TYPES = {
  '.css': ['text/css'], '.js': ['text/javascript', 'application/javascript'], '.mjs': ['text/javascript', 'application/javascript'],
  '.svg': ['image/svg+xml'], '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.webp': ['image/webp'], '.avif': ['image/avif'],
  '.ico': ['image/x-icon', 'image/vnd.microsoft.icon'], '.woff': ['font/woff', 'application/font-woff'], '.woff2': ['font/woff2'],
};

function assertSafeURL(url) {
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Unsafe URL');
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { throw new Error('Malformed URL encoding'); }
  if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.includes('//') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) throw new Error('Unsafe URL path');
  if (/%(?:2f|5c)/i.test(url.pathname)) throw new Error('Encoded path separator is forbidden');
}

export function validateSource(value = SOURCE_ORIGIN) {
  const url = new URL(value);
  assertSafeURL(url);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Export source must be an origin');
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.origin !== SOURCE_ORIGIN && !local) throw new Error('Export source must be the approved Pages origin or an explicit local development server');
  return url.origin;
}

function internalURL(value, sourceOrigin, basePath = '/', allowRelativeParents = false) {
  // Reject traversal before URL normalisation can erase it.
  if ((!allowRelativeParents && /(?:^|\/)(?:\.|%2e){1,2}(?:\/|%2f|[?#]|$)/i.test(value)) || /\\/.test(value)) throw new Error('Unsafe relative URL');
  const url = new URL(value, sourceOrigin + basePath);
  if (![sourceOrigin, PUBLIC_ORIGIN].includes(url.origin)) return null;
  assertSafeURL(url);
  return url;
}

export function pageTarget(value, { sourceOrigin = SOURCE_ORIGIN, basePath = '/', customPaths = new Set() } = {}) {
  if (!value || value.startsWith('#')) return null;
  const url = internalURL(value, sourceOrigin, basePath);
  if (!url) return null;
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const first = pathname.split('/')[1];
  if (RESERVED.has(first) || first?.startsWith('_')) return null;
  const known = COMMON_PAGES.has(pathname) || new RegExp(`^/catalog/${CATEGORY}(?:/[a-z0-9][a-z0-9-]*)?$`).test(pathname) || /^\/news\/[a-z0-9][a-z0-9-]*$/.test(pathname) || customPaths.has(pathname);
  if (!known) return null;
  let page = 1;
  if (url.search) {
    const entries = [...url.searchParams];
    if (pathname !== '/news' || entries.length !== 1 || entries[0][0] !== 'page' || !/^[1-9]\d{0,4}$/.test(entries[0][1])) throw new Error('Unsupported public page query');
    page = Number(entries[0][1]);
  }
  const fetchPath = page > 1 ? `/news?page=${page}` : pathname;
  const publicPath = page > 1 ? `/news/page/${page}/` : pathname === '/' ? '/' : pathname + '/';
  return { fetchPath, publicPath, file: publicPath.slice(1) + 'index.html', hash: url.hash };
}

export function parseManifest(value, sourceOrigin = SOURCE_ORIGIN) {
  if (!value || !Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > PAGE_LIMIT) throw new Error('Invalid public export manifest');
  const customPaths = new Set();
  for (const path of value.paths) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('#')) throw new Error('Invalid manifest route');
    if (/^\/[a-z0-9][a-z0-9-]*$/.test(path) && !RESERVED.has(path.slice(1)) && path !== '/404') customPaths.add(path);
  }
  const pages = value.paths.map(path => {
    const target = pageTarget(path, { sourceOrigin, customPaths });
    if (!target) throw new Error('Manifest contains a non-public route');
    return target;
  });
  if (!pages.some(page => page.fetchPath === '/')) throw new Error('Manifest must contain the home page');
  return { customPaths, pages };
}

export function assetTarget(value, { sourceOrigin = SOURCE_ORIGIN, basePath = '/' } = {}) {
  if (!value || /^(?:data:|#)/i.test(value)) return null;
  const url = internalURL(value, sourceOrigin, basePath, true);
  if (!url) throw new Error('External assets are not allowed in the static export');
  if (url.search) throw new Error('Asset query parameters are not supported');
  const permitted = /^\/(?:assets|_astro|css|js)\/[a-zA-Z0-9_./-]+$/.test(url.pathname) || /^\/media\/(?:news|uploads)\/[a-zA-Z0-9_./-]+$/.test(url.pathname) || /^\/(?:favicon\.(?:svg|ico)|apple-touch-icon\.png)$/.test(url.pathname);
  const extension = extname(url.pathname).toLowerCase();
  if (!permitted || !EXTENSION_TYPES[extension]) throw new Error('Unapproved public asset path');
  return { fetchPath: url.pathname, publicPath: url.pathname, file: url.pathname.slice(1), hash: url.hash, types: EXTENSION_TYPES[extension] };
}

function cssURLs(css, options, assets) {
  // Compiled Astro CSS and our local font CSS use URL tokens; imports are collected too.
  const replace = (full, _quote, raw) => {
    const value = raw.trim();
    if (!value || /^(?:data:|#)/i.test(value)) return full;
    const asset = assetTarget(value, options);
    if (asset) assets.set(asset.fetchPath, asset);
    return `url("${asset.publicPath}${asset.hash}")`;
  };
  let transformed = css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, replace);
  transformed = transformed.replace(/@import\s+(['"])([^'"]+)\1/gi, (_full, _quote, value) => {
    const asset = assetTarget(value, options);
    assets.set(asset.fetchPath, asset);
    return `@import "${asset.publicPath}"`;
  });
  return transformed;
}

export function assertPublicContent(html, privatePatterns = []) {
  if (PUBLIC_PRIVATE_FIELDS.test(html)) throw new Error('Private procurement or credential fields found in public HTML');
  for (const pattern of privatePatterns) if (pattern.test(html)) throw new Error('Private procurement information found in public HTML');
}

export function transformHTML(html, { sourceOrigin = SOURCE_ORIGIN, fetchPath = '/', publicPath = '/', customPaths = new Set(), publishedPaths = null, privatePatterns = [] } = {}) {
  assertPublicContent(html, privatePatterns);
  const ast = parse(html);
  const pages = new Map();
  const assets = new Map();
  const removedNavigation = [];
  const options = { sourceOrigin, basePath: fetchPath, customPaths };
  let configFound = false;
  let configScriptFound = false;
  const useAsset = value => {
    const asset = assetTarget(value, options);
    if (!asset) return value;
    assets.set(asset.fetchPath, asset);
    return asset.publicPath + asset.hash;
  };
  walkSync(ast, node => {
    if (node.type !== ELEMENT_NODE) return;
    const tag = node.name.toLowerCase();
    const attrs = node.attributes;
    if (tag === 'base' || tag === 'iframe' || tag === 'form') throw new Error('Unexpected active element in public export');
    if (tag === 'a' && attrs.href) {
      const local = internalURL(attrs.href, sourceOrigin, fetchPath);
      if (local && /^\/admin(?:\/|$)/.test(local.pathname)) attrs.href = SOURCE_ORIGIN + local.pathname + local.search + local.hash;
      else if (local && !attrs.href.startsWith('#')) {
        const target = pageTarget(attrs.href, options);
        if (!target) throw new Error('A public page links to an unsupported internal route');
        if (publishedPaths && !publishedPaths.has(target.fetchPath)) {
          let navigation = false;
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (parent.name === 'nav' || parent.attributes?.class?.split(/\s+/).includes('footer-links')) navigation = true;
          }
          if (navigation) removedNavigation.push(node);
          else { node.name = 'span'; node.attributes = {}; }
        } else {
          pages.set(target.fetchPath, target);
          attrs.href = target.publicPath + target.hash;
        }
      }
    }
    if (tag === 'link') {
      const rel = (attrs.rel || '').toLowerCase();
      if (rel === 'canonical') attrs.href = PUBLIC_ORIGIN + publicPath;
      else if (attrs.href && /(?:stylesheet|icon|preload|modulepreload)/.test(rel)) attrs.href = useAsset(attrs.href);
      else if (attrs.href && rel !== 'preconnect') throw new Error('Unsupported link metadata');
    }
    if (tag === 'meta') {
      if (attrs.property === 'og:url') attrs.content = PUBLIC_ORIGIN + publicPath;
      if (attrs.property === 'og:image' || attrs.name === 'twitter:image') attrs.content = PUBLIC_ORIGIN + useAsset(attrs.content);
      if ((attrs['http-equiv'] || '').toLowerCase() === 'refresh') throw new Error('Unexpected public page redirect');
    }
    if (attrs.src) attrs.src = useAsset(attrs.src);
    if (attrs.poster) attrs.poster = useAsset(attrs.poster);
    if ((tag === 'use' || tag === 'image') && attrs.href && !attrs.href.startsWith('#')) attrs.href = useAsset(attrs.href);
    for (const attr of ['srcset', 'imagesrcset']) {
      if (attrs[attr]) attrs[attr] = attrs[attr].split(',').map(entry => {
        const candidate = entry.trim().split(/\s+/);
        if (!candidate[0] || candidate.length > 2 || (candidate[1] && !/^\d+(?:\.\d+)?[wx]$/.test(candidate[1]))) throw new Error('Unsupported image source set');
        return [useAsset(candidate[0]), candidate[1]].filter(Boolean).join(' ');
      }).join(', ');
    }
    if (attrs.style) attrs.style = cssURLs(attrs.style, options, assets);
    if (tag === 'style') for (const child of node.children) if (typeof child.value === 'string') child.value = cssURLs(child.value, options, assets);
    if (tag === 'script' && attrs.id === 'avocado-config') {
      const config = JSON.parse(node.children.map(child => child.value || '').join(''));
      config.chatApiBase = CHAT_ORIGIN;
      node.children[0].value = JSON.stringify(config).replaceAll('<', '\\u003c');
      configFound = true;
    }
    if (tag === 'script' && !attrs.src && attrs.id !== 'avocado-config') {
      for (const child of node.children) {
        if (typeof child.value !== 'string') continue;
        const before = child.value;
        child.value = before.replace(/window\.AVOCADO_CONFIG\.chatApiBase\s*=\s*window\.location\.origin\s*;?/g, `window.AVOCADO_CONFIG.chatApiBase = ${JSON.stringify(CHAT_ORIGIN)};`);
        if (child.value !== before) configScriptFound = true;
      }
    }
  });
  // Mutate child lists after traversal so adjacent navigation links are never skipped.
  for (const node of removedNavigation) node.parent.children = node.parent.children.filter(child => child !== node);
  if (!configFound || !configScriptFound) throw new Error('Expected chat configuration was not found; review the export integration');
  const transformed = renderSync(ast);
  assertPublicContent(transformed, privatePatterns);
  return { html: transformed, pages: [...pages.values()], assets: [...assets.values()] };
}

/** Fetch only the manifest snapshot. Stale navigation must never resurrect a draft page. */
export async function* crawlPublicPages({ manifest, sourceOrigin = SOURCE_ORIGIN, fetchImpl = fetch, privatePatterns = [] }) {
  const targets = new Map(manifest.pages.map(page => [page.fetchPath, page]));
  if (targets.size > PAGE_LIMIT) throw new Error('Public page count exceeds the export limit');
  const publishedPaths = new Set(targets.keys());
  for (const [path, page] of targets) {
    const result = await fetchBounded(sourceOrigin + path, { sourceOrigin, fetchImpl, allowedTypes: ['text/html'], redirectAllowed: next => {
      const mapped = pageTarget(next.href, { sourceOrigin, customPaths: manifest.customPaths });
      return mapped?.fetchPath === path;
    } });
    const transformed = transformHTML(result.bytes.toString('utf8'), { sourceOrigin, fetchPath: path, publicPath: page.publicPath, customPaths: manifest.customPaths, publishedPaths, privatePatterns });
    yield { page, transformed };
  }
}

export async function fetchBounded(url, { fetchImpl = fetch, sourceOrigin = SOURCE_ORIGIN, allowedTypes = [], status = 200, limit = 2 * 1024 * 1024, redirectAllowed = () => false } = {}) {
  let target = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    assertSafeURL(target);
    if (target.origin !== sourceOrigin) throw new Error('Refusing to fetch an untrusted origin');
    const response = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: allowedTypes.join(', '), 'User-Agent': 'Avocado-Public-Export/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      const next = location ? new URL(location, target) : null;
      if (!next || next.origin !== sourceOrigin || !redirectAllowed(next)) throw new Error('Refusing an unexpected export redirect');
      target = next;
      continue;
    }
    if (response.status !== status) throw new Error(`Unexpected HTTP ${response.status} at ${target.pathname}`);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!allowedTypes.includes(contentType)) throw new Error(`Unexpected content type at ${target.pathname}`);
    if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('Export response exceeds its size limit');
    const chunks = [];
    let size = 0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error('Export response exceeds its size limit');
      chunks.push(Buffer.from(chunk));
    }
    if (!size) throw new Error('Empty public export response');
    return { bytes: Buffer.concat(chunks), contentType };
  }
  throw new Error('Too many export redirects');
}

async function privatePatterns() {
  try {
    const records = JSON.parse(await readFile(resolve(siteRoot, '../output/procurement-sources.json'), 'utf8'));
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [];
    for (const record of records) {
      if (record.sourceUrl) patterns.push(new RegExp(escape(new URL(record.sourceUrl).hostname.replace(/^www\./, '')), 'i'));
      if (record.sourceName) patterns.push(new RegExp(`(?<![a-z0-9_-])${escape(record.sourceName.trim())}(?![a-z0-9_-])`, 'i'));
    }
    return patterns;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function safeOutput(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.startsWith('/') || file.split('/').some(part => part === '.' || part === '..' || !part)) throw new Error('Unsafe output filename');
  const target = resolve(outputRoot, file);
  const inside = relative(outputRoot, target);
  if (inside.startsWith('..') || resolve(outputRoot, inside) !== target) throw new Error('Output escapes the artifact directory');
  return target;
}

export async function exportSite({ sourceOrigin = SOURCE_ORIGIN, fetchImpl = fetch } = {}) {
  sourceOrigin = validateSource(sourceOrigin);
  if (relative(siteRoot, outputRoot) !== 'github-dist') throw new Error('Unsafe fixed export directory');
  const manifestResponse = await fetchBounded(sourceOrigin + '/api/public/manifest', { sourceOrigin, fetchImpl, allowedTypes: ['application/json'] });
  const manifest = parseManifest(JSON.parse(manifestResponse.bytes.toString('utf8')), sourceOrigin);
  const supplierPatterns = await privatePatterns();
  // This directory contains only disposable generated output, never source or credentials.
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const pendingAssets = new Map();
  const visitedPages = new Set();
  const visitedAssets = new Set();
  const sitemap = new Set();
  let totalBytes = 0;
  const save = async (file, bytes) => {
    totalBytes += Buffer.byteLength(bytes);
    if (totalBytes > TOTAL_LIMIT) throw new Error('Static export exceeds the total size limit');
    const target = safeOutput(file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  };
  const collect = transformed => {
    for (const asset of transformed.assets) if (!visitedAssets.has(asset.fetchPath)) pendingAssets.set(asset.fetchPath, asset);
  };
  for await (const { page, transformed } of crawlPublicPages({ manifest, sourceOrigin, fetchImpl, privatePatterns: supplierPatterns })) {
    visitedPages.add(page.fetchPath);
    collect(transformed);
    await save(page.file, transformed.html);
    sitemap.add(PUBLIC_ORIGIN + page.publicPath);
  }
  const notFound = await fetchBounded(sourceOrigin + '/404', { sourceOrigin, fetchImpl, allowedTypes: ['text/html'], status: 404 });
  const transformed404 = transformHTML(notFound.bytes.toString('utf8'), { sourceOrigin, fetchPath: '/404', publicPath: '/404.html', customPaths: manifest.customPaths, publishedPaths: new Set(visitedPages), privatePatterns: supplierPatterns });
  for (const asset of transformed404.assets) pendingAssets.set(asset.fetchPath, asset);
  await save('404.html', transformed404.html);
  for (const path of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']) {
    const asset = assetTarget(path, { sourceOrigin });
    pendingAssets.set(path, asset);
  }
  while (pendingAssets.size) {
    if (visitedAssets.size + pendingAssets.size > ASSET_LIMIT) throw new Error('Public asset count exceeds the export limit');
    const [path, asset] = pendingAssets.entries().next().value;
    pendingAssets.delete(path);
    if (visitedAssets.has(path)) continue;
    visitedAssets.add(path);
    const result = await fetchBounded(sourceOrigin + path, { sourceOrigin, fetchImpl, allowedTypes: asset.types, limit: 20 * 1024 * 1024 });
    let bytes = result.bytes;
    if (result.contentType === 'text/css') {
      const discovered = new Map();
      bytes = Buffer.from(cssURLs(bytes.toString('utf8'), { sourceOrigin, basePath: path }, discovered));
      for (const child of discovered.values()) if (!visitedAssets.has(child.fetchPath)) pendingAssets.set(child.fetchPath, child);
    }
    if (['text/javascript', 'application/javascript'].includes(result.contentType)) {
      const code = bytes.toString('utf8');
      // Astro currently emits one self-contained client module. Collect relative chunk imports if that changes.
      for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"\n]+)\1/g)) {
        if (!match[2].startsWith('.') && !match[2].startsWith('/')) throw new Error('Unexpected external client module import');
        const child = assetTarget(match[2], { sourceOrigin, basePath: path });
        if (!visitedAssets.has(child.fetchPath)) pendingAssets.set(child.fetchPath, child);
      }
    }
    await save(asset.file, bytes);
  }
  await save('admin/index.html', '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0;url=https://avocado-rest.pages.dev/admin"><title>Вход для команды — Avocado</title></head><body><p><a href="https://avocado-rest.pages.dev/admin">Открыть защищённую админку Avocado</a></p></body></html>');
  await save('.nojekyll', '');
  await save('CNAME', 'avocado.rest\n');
  await save('robots.txt', 'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://avocado.rest/sitemap.xml\n');
  await save('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + [...sitemap].sort().map(url => `  <url><loc>${url}</loc></url>`).join('\n') + '\n</urlset>\n');
  // Final recursive inventory rejects accidental server bundles or hidden files.
  const audit = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (entry.name.startsWith('.') && entry.name !== '.nojekyll') || /^(?:_worker\.js|_headers|_routes\.json|wrangler.*|.*\.map|package.*\.json)$/i.test(entry.name)) throw new Error('Private or server artifact found in static export');
      if (entry.isDirectory()) await audit(resolve(dir, entry.name));
    }
  };
  await audit(outputRoot);
  const result = { pages: visitedPages.size, assets: visitedAssets.size, bytes: totalBytes };
  console.log(`GitHub Pages export ready: ${result.pages} public pages, ${result.assets} assets, ${(result.bytes / 1024 / 1024).toFixed(1)} MiB.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportSite({ sourceOrigin: process.env.GITHUB_EXPORT_SOURCE || SOURCE_ORIGIN }).catch(error => {
    console.error('Static export failed: ' + error.message);
    process.exitCode = 1;
  });
}
