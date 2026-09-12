// Run only after the release is ready:
// node scripts/production-smoke.mjs [--base https://avocado-rest.pages.dev] [--admin]
// Default: read-only. --admin additionally creates and deletes one login session;
// it never submits content forms, chat messages, invoices, or Telegram posts.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'site/output/production-smoke.json');
const workerBase = 'https://avocado-chat.avocado-chat-worker.workers.dev';
const routes = ['/', '/hass', '/ettinger', '/rent', '/catalog', '/catalog/domains', '/catalog/vps', '/catalog/dedicated', '/catalog/bulletproof', '/catalog/proxies', '/catalog/vps/vps', '/countries', '/payment', '/news', '/contacts'];
const secrets = new Set();
const report = { startedAt: new Date().toISOString(), base: null, readOnlyContent: true, checks: [], telegram: null, admin: { requested: false, loggedIn: false, loggedOut: false } };

function safe(text) {
  let result = String(text);
  for (const secret of secrets) if (secret) result = result.split(secret).join('[redacted]');
  return result.replace(/https?:\/\/[^\s<>"']+/gi, '[url]').replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]').replace(/[\r\n]+/g, ' ').slice(0, 500);
}
function check(name, pass, details = {}) {
  report.checks.push({ name, pass: Boolean(pass), ...details });
  if (!pass) throw new Error(name);
}
function trustedSite(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !(['avocado.rest', 'www.avocado.rest', 'avocado-rest.pages.dev'].includes(url.hostname) || url.hostname.endsWith('.avocado-rest.pages.dev'))) throw new Error('Smoke target must be an HTTPS Avocado deployment origin.');
  return url.origin;
}
function secureAdmin(headers) {
  return /no-store/i.test(headers['cache-control'] || '') && headers['x-content-type-options'] === 'nosniff' && headers['x-frame-options'] === 'DENY' && /frame-ancestors 'none'/.test(headers['content-security-policy'] || '') && /form-action 'self'/.test(headers['content-security-policy'] || '') && /script-src 'none'/.test(headers['content-security-policy'] || '');
}
async function get(url) {
  return fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(25_000) });
}
async function main() {
  const args = process.argv.slice(2);
  let configuredBase;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') configuredBase = args[++i];
    else if (args[i] === '--admin') report.admin.requested = true;
    else throw new Error('Usage: production-smoke.mjs [--base URL] [--admin]');
  }
  if (!configuredBase) configuredBase = JSON.parse(await readFile(resolve(root, 'site/output/release-state.json'), 'utf8')).url;
  const base = trustedSite(configuredBase);
  report.base = base;
  const owner = Object.fromEntries((await readFile(resolve(root, 'worker/.dev.vars.prod'), 'utf8')).split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) return [];
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (/TOKEN|SECRET|PASSWORD|SALT/.test(match[1])) secrets.add(value);
    return [[match[1], value]];
  }));
  let credentials;
  if (report.admin.requested) {
    credentials = JSON.parse(await readFile(resolve(root, 'site/output/production-access.json'), 'utf8'));
    if (typeof credentials.password !== 'string' || credentials.password.length < 16) throw new Error('Local production admin credentials are missing or invalid.');
    secrets.add(credentials.password);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  let browserErrors = 0, blockedWrites = 0, adminPhase = false, logoutCsrf = '';
  page.on('pageerror', () => browserErrors++);
  page.on('console', message => { if (message.type() === 'error') browserErrors++; });
  await context.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
    const auth = adminPhase && request.method() === 'POST' && target.origin === base && ['/api/admin/login', '/api/admin/logout'].includes(target.pathname);
    if (read || auth) return route.continue();
    blockedWrites++;
    return route.abort();
  });
  try {
    for (const path of routes) {
      browserErrors = 0;
      const response = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 35_000 });
      check(`${path}: HTTP 200`, response?.status() === 200, { status: response?.status() });
      check(`${path}: single H1`, await page.locator('h1').count() === 1);
      check(`${path}: no browser errors`, browserErrors === 0, { errors: browserErrors });
    }
    for (const path of ['/not-a-production-page', '/catalog/not-a-category', '/news/not-a-news-item']) {
      const response = await get(base + path);
      check(`${path}: HTTP 404`, response.status === 404, { status: response.status });
      await response.body?.cancel();
    }
    browserErrors = 0;
    const loginPage = await page.goto(base + '/admin/login', { waitUntil: 'networkidle' });
    check('Admin login: HTTP 200', loginPage?.status() === 200);
    check('Admin login: secure response headers', secureAdmin(await loginPage.allHeaders()));
    check('Admin login: no browser errors', browserErrors === 0);
    const challenge = (await context.cookies()).find(cookie => cookie.name === 'avocado_login');
    check('Admin login: secure challenge cookie', challenge?.httpOnly && challenge.secure && challenge.sameSite === 'Strict');
    for (const path of ['/admin', '/admin/pages', '/admin/chats', '/admin/settings']) {
      const response = await context.request.get(base + path, { maxRedirects: 0, timeout: 25_000 });
      const location = response.headers().location;
      check(`${path}: anonymous access protected`, [302, 303, 307, 308].includes(response.status()) && location && new URL(location, base).pathname === '/admin/login');
    }
    const healthResponse = await get(workerBase + '/api/health');
    check('Worker health: HTTP 200', healthResponse.status === 200);
    const health = await healthResponse.json();
    check('Worker health: D1 and Telegram configured', health.ok === true && health.db === true && health.telegram === true && health.admin === true && health.webhookSecret === true);
    const sid = 'smoke' + randomBytes(14).toString('hex');
    for (const [label, origin] of [['Pages chat proxy', base], ['Worker chat API', workerBase]]) {
      const response = await get(`${origin}/api/chat/${sid}/messages`);
      check(`${label}: read-only GET`, response.status === 200);
      const history = await response.json();
      check(`${label}: synthetic session is empty`, Array.isArray(history.messages) && history.messages.length === 0 && history.session === null);
    }
    check('Telegram read-only check: bot token configured', Boolean(owner.TELEGRAM_BOT_TOKEN));
    // This Bot API method is read-only. POST avoids stale cached GET metadata.
    const telegramResponse = await fetch(`https://api.telegram.org/bot${owner.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    check('Telegram getWebhookInfo: HTTP 200', telegramResponse.status === 200);
    const telegram = await telegramResponse.json();
    check('Telegram getWebhookInfo: successful', telegram.ok === true && Boolean(telegram.result));
    const info = telegram.result;
    const allowedUpdates = (Array.isArray(info.allowed_updates) ? info.allowed_updates : []).filter(value => typeof value === 'string' && /^[a-z_]{1,40}$/.test(value));
    report.telegram = { webhookMatches: info.url === workerBase + '/tg/webhook', allowedUpdates, pendingUpdates: Number(info.pending_update_count || 0), lastErrorAt: Number(info.last_error_date || 0), lastError: info.last_error_message ? safe(info.last_error_message) : null };
    check('Telegram webhook: expected endpoint', report.telegram.webhookMatches);
    check('Telegram webhook: chat and channel updates enabled', ['message', 'channel_post', 'edited_channel_post'].every(type => allowedUpdates.includes(type)));

    if (report.admin.requested) {
      adminPhase = true;
      const csrf = await page.locator('form[action="/api/admin/login"] input[name="csrf"]').inputValue();
      const response = await context.request.post(base + '/api/admin/login', { form: { csrf, password: credentials.password }, headers: { Origin: base }, maxRedirects: 0, timeout: 25_000 });
      // Record the cookie before assertions so the finally block can revoke a created session.
      const session = (await context.cookies()).find(cookie => cookie.name === 'avocado_admin');
      report.admin.loggedIn = Boolean(session);
      check('Admin authentication: accepted', response.status() === 303 && response.headers().location === '/admin' && report.admin.loggedIn);
      check('Admin authentication: secure session cookie', session.httpOnly && session.secure && session.sameSite === 'Strict');
      for (const path of ['/admin', '/admin/pages', '/admin/products', '/admin/countries', '/admin/news', '/admin/chats', '/admin/invoices', '/admin/settings']) {
        browserErrors = 0;
        const response = await page.goto(base + path, { waitUntil: 'networkidle' });
        check(`${path}: authenticated read`, response?.status() === 200 && new URL(page.url()).pathname === path);
        check(`${path}: secure headers`, secureAdmin(await response.allHeaders()));
        check(`${path}: no browser errors`, browserErrors === 0);
        logoutCsrf = await page.locator('form[action="/api/admin/logout"] input[name="csrf"]').inputValue();
      }
    }
    check('Browser guard: no content writes attempted', blockedWrites === 0, { blockedWrites });
  } finally {
    try {
      if (report.admin.loggedIn) {
        if (!logoutCsrf) {
          const dashboard = await context.request.get(base + '/admin', { timeout: 25_000 });
          const html = await dashboard.text();
          logoutCsrf = /<form[^>]+action="\/api\/admin\/logout"[^>]*>[\s\S]*?<input[^>]+value="([a-f0-9]{64})"/.exec(html)?.[1] || '';
        }
        const response = await context.request.post(base + '/api/admin/logout', { form: { csrf: logoutCsrf }, headers: { Origin: base }, maxRedirects: 0, timeout: 25_000 });
        const protectedAgain = await context.request.get(base + '/admin', { maxRedirects: 0, timeout: 25_000 });
        report.admin.loggedOut = response.status() === 303 && response.headers().location === '/admin/login' && [302, 303, 307, 308].includes(protectedAgain.status()) && new URL(protectedAgain.headers().location || '/', base).pathname === '/admin/login';
        check('Admin logout: temporary session revoked', report.admin.loggedOut);
      }
    } finally { await context.close(); await browser.close(); }
  }
}

try {
  await main();
  report.ok = true;
  console.log('Production smoke passed: 15 public routes, admin protection, read-only chat GET, Telegram webhook' + (report.admin.requested ? ', admin login/read/logout.' : '.'));
  console.log(JSON.stringify({ telegram: report.telegram, admin: report.admin }));
} catch (error) {
  report.ok = false;
  report.error = safe(error?.message || 'Production smoke failed.');
  console.error('Production smoke failed: ' + report.error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(resolve(root, 'site/output'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
