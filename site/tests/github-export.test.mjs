import test from 'node:test';
import assert from 'node:assert/strict';
import { assetTarget, assertPublicContent, CHAT_ORIGIN, crawlPublicPages, fetchBounded, pageTarget, parseManifest, PUBLIC_ORIGIN, SOURCE_ORIGIN, transformHTML, validateSource } from '../scripts/export-github-pages.mjs';
import { reservedPageSlugs } from '../src/lib/public-route-rules.mjs';

const fixture = `<!doctype html><html lang="ru"><head><link rel="canonical" href="${SOURCE_ORIGIN}/news"><meta property="og:url" content="${SOURCE_ORIGIN}/news"><meta property="og:image" content="${SOURCE_ORIGIN}/assets/og.png"><link rel="preload" as="image" href="/assets/img/hero.webp" imagesrcset="/assets/img/hero-small.webp 960w, /assets/img/hero.webp 1672w"><style>@font-face{src:url('/assets/fonts/manrope.woff2')} .mark{mask:url(#local)}</style></head><body><a href="/news?page=2">Далее</a><a href="/catalog/vps/compute-1">VPS</a><a href="/admin">Команда</a><a href="https://t.me/avocadodev/15">Telegram</a><svg><use href="#i-avocado"/></svg><script type="application/json" id="avocado-config">{"telegramUrl":"https://t.me/avogurubot"}</script><script>window.AVOCADO_CONFIG = JSON.parse(document.getElementById('avocado-config').textContent); window.AVOCADO_CONFIG.chatApiBase = window.location.origin;</script><script src="/js/chat.js" defer></script><script type="module" src="/_astro/site.123.js"></script></body></html>`;

test('public routes become directory indexes; news query pages have distinct URLs', () => {
  assert.deepEqual(pageTarget('/news?page=2#list'), { fetchPath: '/news?page=2', publicPath: '/news/page/2/', file: 'news/page/2/index.html', hash: '#list' });
  assert.equal(pageTarget('/catalog/vps/compute-1').file, 'catalog/vps/compute-1/index.html');
  assert.equal(pageTarget('/').file, 'index.html');
  assert.equal(pageTarget('/news?page=1').publicPath, '/news/');
  assert.throws(() => pageTarget('/news?page=2&token=private'), /query/);
  assert.throws(() => pageTarget('/catalog?v=2'), /query/);
  assert.throws(() => pageTarget('/news?page=-1'), /query/);
});

test('manifest accepts published custom pages and rejects private or cross-origin paths', () => {
  const manifest = parseManifest({ paths: ['/', '/software', '/about-team', '/news?page=2', '/catalog/vps/compute-1'] });
  assert.ok(manifest.customPaths.has('/about-team'));
  assert.equal(pageTarget('/about-team', manifest).file, 'about-team/index.html');
  for (const path of ['/admin', '/admin/invoices', '/api/chat', '/worker', '//evil.test/', '/assets/secret', '/404']) {
    assert.throws(() => parseManifest({ paths: ['/', path] }));
  }
  for (const slug of reservedPageSlugs) assert.throws(() => parseManifest({ paths: ['/', '/' + slug] }));
  assert.equal(pageTarget('/admin'), null);
  assert.equal(pageTarget('/api/public/manifest'), null);
  assert.equal(pageTarget('https://evil.test/news'), null);
  assert.throws(() => pageTarget('/catalog/../admin'), /Unsafe/);
  for (const path of ['/catalog/%2e%2e/admin', '/catalog\\..\\admin', '/catalog/vps/%2fadmin', 'https://user:password@avocado-rest.pages.dev/software']) assert.throws(() => pageTarget(path));
});

test('a page changed to draft is removed from stale navigation and is never fetched', async () => {
  const manifest = parseManifest({ paths: ['/', '/software'] });
  const html = fixture.replace('<body>', '<body><nav><a href="/hass">Hidden Hass</a><a href="/ettinger">Hidden Ettinger</a><a href="/software">Published software</a></nav><div class="footer-links"><a href="/hass">Hidden footer link</a></div><p><a class="button" href="/hass" tabindex="0" role="link">Neutral description</a></p>');
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url.pathname);
    if (!['/', '/software'].includes(url.pathname)) return new Response('404', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  };
  const exported = [];
  for await (const item of crawlPublicPages({ manifest, fetchImpl })) exported.push(item);
  assert.deepEqual(calls, ['/', '/software'], 'stale links must not fetch hidden routes or a 404');
  for (const { transformed } of exported) {
    assert.doesNotMatch(transformed.html, /Hidden Hass|Hidden Ettinger|Hidden footer link|href="\/hass/);
    assert.match(transformed.html, /<span>Neutral description<\/span>/);
    assert.match(transformed.html, /href="\/software\/"/);
    assert.deepEqual(transformed.pages.map(page => page.fetchPath), ['/software']);
  }
  assert.throws(() => transformHTML(html.replace('/hass', '/unknown-arbitrary-path'), { publishedPaths: new Set(['/']) }), /unsupported internal route/);
});

test('only trusted sources and approved public asset types are accepted', () => {
  assert.equal(validateSource(), SOURCE_ORIGIN);
  assert.equal(validateSource('http://127.0.0.1:4322'), 'http://127.0.0.1:4322');
  for (const source of ['https://evil.test', 'https://avocado-rest.pages.dev.evil.test', 'https://user:password@avocado-rest.pages.dev', SOURCE_ORIGIN + '/admin']) assert.throws(() => validateSource(source));
  assert.equal(assetTarget('../assets/fonts/local.woff2', { basePath: '/css/fonts.css' }).file, 'assets/fonts/local.woff2');
  assert.equal(assetTarget('/media/news/channel-123.jpg').file, 'media/news/channel-123.jpg');
  assert.equal(assetTarget('#inline'), null);
  for (const value of ['/worker/.dev.vars', '/assets/secret.json', '/_astro/bundle.js.map', 'https://evil.test/image.webp', '/assets/%2fsecret.webp']) assert.throws(() => assetTarget(value));
  for (const value of ['/assets/.dev.vars.js', '/assets/../../worker/secret.js', '/assets/%2e%2e/worker/secret.js', '/js/chat.js?token=private']) assert.throws(() => assetTarget(value));
});

test('HTML keeps design, rewrites chat and metadata, and exposes no local admin form', () => {
  const result = transformHTML(fixture, { fetchPath: '/news?page=2', publicPath: '/news/page/2/' });
  assert.match(result.html, /href="\/news\/page\/2\/"/);
  assert.match(result.html, /href="\/catalog\/vps\/compute-1\/"/);
  assert.match(result.html, /href="https:\/\/avocado-rest\.pages\.dev\/admin"/);
  assert.match(result.html, /href="https:\/\/t\.me\/avocadodev\/15"/);
  assert.ok(result.html.includes(`content="${PUBLIC_ORIGIN}/news/page/2/"`));
  assert.ok(result.html.includes(`content="${PUBLIC_ORIGIN}/assets/og.png"`));
  assert.ok(result.html.includes(CHAT_ORIGIN));
  assert.doesNotMatch(result.html, /chatApiBase = window.location.origin/);
  assert.ok(result.assets.some(asset => asset.fetchPath === '/assets/fonts/manrope.woff2'));
  assert.ok(result.assets.some(asset => asset.fetchPath === '/assets/img/hero-small.webp'));
  assert.ok(result.assets.some(asset => asset.fetchPath === '/_astro/site.123.js'));
  assert.equal(result.pages.some(page => page.fetchPath.startsWith('/admin')), false);
  assert.match(result.html, /mask:url\(#local\)/);
});

test('CSS references, responsive images and source-origin assets are rewritten without losing SVG', () => {
  const input = fixture.replace('<style>', `<style>@import '/css/theme.css'; .image{background:url("${SOURCE_ORIGIN}/assets/img/background.webp")} `).replace('<body>', '<body><img src="/media/news/post-3.jpg" srcset="/media/news/post-3.jpg 1x, /media/news/post-3-large.jpg 2x">');
  const result = transformHTML(input);
  for (const path of ['/css/theme.css', '/assets/img/background.webp', '/media/news/post-3.jpg', '/media/news/post-3-large.jpg']) assert.ok(result.assets.some(asset => asset.fetchPath === path), path);
  assert.match(result.html, /<use href="#i-avocado"/);
  assert.doesNotMatch(result.html, /https:\/\/avocado-rest\.pages\.dev\/assets/);
  assert.throws(() => transformHTML(input.replace('/css/theme.css', 'https://unexpected.test/theme.css')), /External assets/);
});

test('schema changes and private procurement fields fail closed', () => {
  assert.throws(() => transformHTML(fixture.replace('window.location.origin', 'location.origin')), /chat configuration/);
  assert.throws(() => transformHTML(fixture.replace('<body>', '<body><form action="/api/private">')), /active element/);
  assert.throws(() => transformHTML(fixture.replace('<body>', '<body><a href="/api/private">API</a>')), /unsupported internal route/);
  assert.throws(() => assertPublicContent('<p data-source_name="hidden">Price</p>'), /Private/);
  assert.throws(() => assertPublicContent('<p>confidential supplier</p>', [/confidential supplier/]), /Private/);
});

test('fetch guards reject foreign redirects, bad content types, size overflow and error responses', async () => {
  const options = { allowedTypes: ['text/html'], limit: 10, sourceOrigin: SOURCE_ORIGIN };
  await assert.rejects(fetchBounded(SOURCE_ORIGIN, { ...options, fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://evil.test/' } }), redirectAllowed: () => true }), /redirect/);
  await assert.rejects(fetchBounded(SOURCE_ORIGIN, { ...options, fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }), /content type/);
  await assert.rejects(fetchBounded(SOURCE_ORIGIN, { ...options, fetchImpl: async () => new Response('01234567890', { headers: { 'content-type': 'text/html' } }) }), /size limit/);
  await assert.rejects(fetchBounded(SOURCE_ORIGIN, { ...options, fetchImpl: async () => new Response('error', { status: 500, headers: { 'content-type': 'text/html' } }) }), /HTTP 500/);
  let calls = 0;
  await assert.rejects(fetchBounded('https://evil.test/', { ...options, fetchImpl: async () => { calls++; } }), /untrusted origin/);
  assert.equal(calls, 0);
  const ok = await fetchBounded(SOURCE_ORIGIN, { ...options, fetchImpl: async () => new Response('<p>ok</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) });
  assert.equal(ok.bytes.toString(), '<p>ok</p>');
});
