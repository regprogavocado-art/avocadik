/** Full, local-only CMS/browser acceptance test. Never run against a deployed site. */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const base = process.env.ADMIN_UI_BASE_URL || process.env.UI_BASE_URL || 'http://127.0.0.1:4321';
const mock = 'http://127.0.0.1:8099';
const chat = process.env.ADMIN_UI_CHAT_URL || process.env.LOCAL_CHAT_URL || 'http://127.0.0.1:8789';
const loopback = value => { const url = new URL(value); return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); };
assert.ok(loopback(base), 'Admin browser tests accept a loopback HTTP URL only.');
assert.ok(loopback(chat), 'Chat tests accept a loopback HTTP URL only.');
const output = path.resolve(__dirname, '../output/playwright/admin');
const run = Date.now().toString(36);
const findings = [];
let password = '';
const fixtures = { pageSlug: `qa-page-${run}`, productSlug: `qa-vps-${run}`, newsSlug: `qa-news-${run}`, walletId: '', pageId: '', productId: '', countryId: '', newsId: '', invoiceId: '' };
const sections = ['', 'pages', 'products', 'countries', 'news', 'chats', 'invoices', 'settings'];
const prefix = `Локальный тест ${run}`;
let browser, context, admin, visitorContext, visitor;
let cleanupFailed = false;
const errors = new WeakMap();

async function ready(url) {
  assert.ok(loopback(url));
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local test endpoint is not ready: ${new URL(url).origin}`);
}

async function observe(page) {
  errors.set(page, []);
  page.on('console', event => { if (event.type() === 'error') errors.get(page).push(event.text()); });
  page.on('pageerror', error => errors.get(page).push(error.message));
}
async function safeContext(viewport) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', extraHTTPHeaders: { 'CF-Connecting-IP': `192.0.2.${Math.floor(Math.random() * 200) + 20}` } });
  await ctx.route('**/*', async route => {
    if (!loopback(route.request().url())) return route.abort('blockedbyclient');
    return route.continue();
  });
  return ctx;
}
async function go(page, url, expected = 200) {
  errors.get(page).length = 0;
  const response = await page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
  assert.equal(response.status(), expected, `${url}: HTTP status`);
  return response;
}
async function capture(page, label, width, check = true) {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${label}-${width}.png`), fullPage: true });
  if (label === 'product-edit') await page.locator('input[name="price"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, `${label}-${width}-viewport.png`), fullPage: false });
  if (!check) return;
  const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(overflow.scroll <= overflow.client + 1, `${label} ${width}: document overflow ${JSON.stringify(overflow)}`);
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = a11y.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
  findings.push({ label, width, errors: [...errors.get(page)], violations });
  await writeFile(path.join(output, 'results.json'), JSON.stringify(findings, null, 2));
  assert.deepEqual(errors.get(page), [], `${label} ${width}: console/page errors`);
  assert.deepEqual(violations, [], `${label} ${width}: WCAG AA violations`);
}
async function submit(form, button = 'Сохранить') {
  const page = form.page();
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), form.getByRole('button', { name: button, exact: true }).click()]);
  const url = new URL(page.url());
  assert.ok(!url.searchParams.has('error'), `Form rejected: ${url.searchParams.get('error')}`);
  assert.ok(url.searchParams.has('saved') || url.searchParams.has('uploaded'), `Form save was not confirmed: ${url.pathname}`);
}
function mainForm(action) { return admin.locator(`form[action="/api/admin/${action}"]`).first(); }
async function openRow(section, title) {
  const row = admin.getByRole('row').filter({ has: admin.getByRole('cell', { name: title, exact: true }) });
  await row.getByRole('link', { name: 'Открыть', exact: true }).click();
  await admin.waitForLoadState('networkidle');
  assert.ok(new URL(admin.url()).pathname.startsWith(`/admin/${section}`));
  return new URL(admin.url()).searchParams.get('edit');
}
async function fillPage(title, body, status) {
  const form = mainForm('pages');
  await form.getByLabel('Название', { exact: true }).fill(title);
  await form.getByLabel('Адрес страницы', { exact: true }).fill(fixtures.pageSlug);
  await form.getByLabel('Краткое описание', { exact: true }).fill('Проверка публикации из админки.');
  await form.getByLabel('Текст страницы', { exact: true }).fill(body);
  await form.getByLabel('Публикация', { exact: true }).selectOption(status);
  await submit(form);
}
async function cleanup() {
  if (!admin || !context) return;
  // Cleanup uses authenticated forms and only the local records created by this run.
  const cleanups = [
    ['pages', fixtures.pageId, 'status', 'draft'], ['products', fixtures.productId, 'status', 'draft'],
    ['countries', fixtures.countryId, 'status', 'draft']
  ];
  for (const [section, id, field, value] of cleanups) {
    if (!id) continue;
    try { await go(admin, `/admin/${section}?edit=${id}`); const form = mainForm(section); await form.locator(`[name="${field}"]`).selectOption(value); await submit(form); }
    catch { cleanupFailed = true; console.error(`Cleanup needs review: ${section} fixture.`); }
  }
  if (fixtures.newsId) {
    try { await go(admin, `/admin/news?edit=${fixtures.newsId}`); const form = mainForm('news'); await form.getByLabel('Скрыть с сайта', { exact: true }).check(); await submit(form); }
    catch { cleanupFailed = true; console.error('Cleanup needs review: news fixture.'); }
  }
  if (fixtures.walletId) {
    try { await go(admin, '/admin/settings'); const form = admin.locator('form[action="/api/admin/wallet"]').filter({ has: admin.locator(`input[name="id"][value="${fixtures.walletId}"]`) }); const details = form.locator('..'); await details.locator('summary').click(); await form.getByLabel('Разрешить выставление счетов', { exact: true }).uncheck(); await submit(form); }
    catch { cleanupFailed = true; console.error('Cleanup needs review: wallet fixture.'); }
  }
}

(async () => {
  await mkdir(output, { recursive: true });
  const access = JSON.parse(await readFile(path.resolve(__dirname, '../output/local-access.json'), 'utf8'));
  password = access.password;
  assert.ok(typeof password === 'string' && password.length >= 16, 'Missing local-only test credentials.');
  assert.ok(loopback(access.url), 'The credentials file must refer to localhost.');
  await ready(`${base}/admin/login`);
  await ready(`${chat}/api/health`);
  // The mock endpoint must be reachable before any message submission.
  assert.equal((await fetch(`${mock}/__log`)).status, 200, 'Local Telegram mock must be available.');
  // Write to the explicitly local Worker, then read through Pages. This proves
  // the Pages proxy uses that same local DB before the browser can send a message.
  const probeId = randomBytes(16).toString('hex'), probeText = `${prefix}: проверка локального маршрута.`;
  const probe = await fetch(`${chat}/api/chat/${probeId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'CF-Connecting-IP': '192.0.2.219' }, body: JSON.stringify({ text: probeText, name: 'Локальная проверка маршрута' }) });
  assert.equal(probe.status, 200, 'The explicitly local Worker accepts its local probe.');
  const proxyProbe = await fetch(`${base}/api/chat/${probeId}/messages`);
  assert.equal(proxyProbe.status, 200, 'The Pages chat proxy must be available.');
  const probeHistory = await proxyProbe.json();
  assert.ok(probeHistory.messages.some(message => message.text === probeText), 'The Pages proxy must read the same local Worker/DB before browser sends.');
  browser = await chromium.launch({ headless: true });
  context = await safeContext({ width: 1440, height: 1000 });
  admin = await context.newPage(); await observe(admin);
  visitorContext = await safeContext({ width: 1440, height: 1000 });
  visitor = await visitorContext.newPage(); await observe(visitor);
  try {
    await go(admin, '/admin');
    assert.equal(new URL(admin.url()).pathname, '/admin/login', 'Anonymous admin access redirects to login.');
    for (const width of [1440, 390]) await capture(admin, 'login', width);
    await admin.getByLabel('Пароль', { exact: true }).fill(password);
    await Promise.all([admin.waitForNavigation({ waitUntil: 'networkidle' }), admin.getByRole('button', { name: 'Войти', exact: true }).click()]);
    assert.equal(new URL(admin.url()).pathname, '/admin', 'Valid password starts an admin session.');
    const cookie = (await context.cookies()).find(cookie => cookie.name === 'avocado_admin');
    assert.ok(cookie?.httpOnly && cookie.sameSite === 'Strict', 'Session cookie is HttpOnly and SameSite Strict.');
    for (const width of [1440, 390]) for (const section of sections) { await go(admin, `/admin${section ? '/' + section : ''}`); await capture(admin, section || 'overview', width); }
    console.log('PASS: login + 8 admin sections at 1440/390, no overflow, console errors or WCAG AA violations.');

    // Page lifecycle is verified through the anonymous public browser.
    await go(admin, '/admin/pages');
    await fillPage(`${prefix} — страница`, 'Исходный текст страницы.', 'draft');
    fixtures.pageId = await openRow('pages', `${prefix} — страница`);
    await go(visitor, `/${fixtures.pageSlug}`, 404);
    await fillPage(`${prefix} — страница`, 'Обновлённый текст из защищённой админки.', 'published');
    await go(visitor, `/${fixtures.pageSlug}`);
    assert.ok(await visitor.getByText('Обновлённый текст из защищённой админки.', { exact: true }).isVisible());
    await go(admin, `/admin/pages?edit=${fixtures.pageId}`); for (const width of [1440, 390]) await capture(admin, 'page-edit', width);

    // Country and product have explicit local fixture names and no commercial stock.
    await go(admin, '/admin/countries');
    const existingCountry = admin.getByRole('row').filter({ has: admin.getByRole('cell', { name: 'Локальная тестовая страна', exact: true }) });
    if (await existingCountry.count()) { await existingCountry.getByRole('link', { name: 'Открыть', exact: true }).click(); fixtures.countryId = new URL(admin.url()).searchParams.get('edit'); }
    let form = mainForm('countries');
    await form.getByLabel('Название страны', { exact: true }).fill('Локальная тестовая страна');
    await form.getByLabel('Код из двух букв', { exact: true }).fill('QZ');
    await form.getByLabel('Публикация', { exact: true }).selectOption('published'); await submit(form);
    fixtures.countryId = await openRow('countries', 'Локальная тестовая страна');
    await go(admin, '/admin/products'); form = mainForm('products');
    await form.getByLabel('Название', { exact: true }).fill(`${prefix} — VPS`); await form.getByLabel('Адрес', { exact: true }).fill(fixtures.productSlug);
    await form.getByLabel('Категория', { exact: true }).selectOption('vps'); await form.getByLabel('Краткое описание', { exact: true }).fill('Тестовая услуга, только локальная база.');
    await form.getByLabel('Описание', { exact: true }).fill('Не предназначено для продажи.'); await form.getByLabel('Цена', { exact: true }).fill('12.34');
    await form.getByLabel('Период цены', { exact: true }).selectOption('month');
    await form.getByLabel('Примечание к цене', { exact: true }).fill('Предварительный ориентир · локальная проверка');
    await form.getByLabel('Название источника', { exact: true }).fill('Проверочный источник');
    await form.getByLabel('Ссылка на источник', { exact: true }).fill('https://example.com/prices');
    await form.getByLabel('Дата проверки источника', { exact: true }).fill('2026-09-12');
    await form.getByLabel('Наличие', { exact: true }).selectOption('on_request'); await form.getByLabel('Локальная тестовая страна', { exact: true }).check();
    await form.getByLabel('Публикация', { exact: true }).selectOption('published'); await submit(form);
    fixtures.productId = await openRow('products', `${prefix} — VPS`);
    assert.equal(await mainForm('products').getByLabel('Период цены', { exact:true }).inputValue(),'month');
    assert.equal(await mainForm('products').getByLabel('Название источника', { exact:true }).inputValue(),'Проверочный источник');
    assert.equal(await mainForm('products').getByLabel('Ссылка на источник', { exact:true }).inputValue(),'https://example.com/prices');
    assert.equal(await mainForm('products').getByLabel('Дата проверки источника', { exact:true }).inputValue(),'2026-09-12');
    await mainForm('products').getByLabel('Наличие', { exact: true }).selectOption('available'); await submit(mainForm('products'));
    await go(visitor, `/catalog/vps/${fixtures.productSlug}`); assert.ok(await visitor.getByText('В наличии', { exact: true }).first().isVisible());
    assert.ok(await visitor.getByRole('heading', { name:'12,34 USD / мес.', exact:true }).isVisible());
    assert.ok(await visitor.getByText('Предварительный ориентир · локальная проверка', { exact:true }).isVisible());
    assert.equal(await visitor.getByRole('link', { name:'Проверочный источник', exact:true }).count(),0);
    assert.ok(!(await visitor.content()).includes('https://example.com/prices'));
    assert.equal(await visitor.locator('.price-source').count(),0);
    await go(admin, `/admin/products?edit=${fixtures.productId}`); for (const width of [1440, 390]) await capture(admin, 'product-edit', width);

    // Wallet addresses are intentionally invalid as real addresses; no chain/processors are contacted.
    await go(admin, '/admin/settings'); form = admin.locator('form[action="/api/admin/wallet"]').last();
    await form.getByLabel('Название для оператора', { exact: true }).fill(`${prefix} — тестовый кошелёк`);
    await form.getByLabel('Криптовалюта', { exact: true }).fill('USDT'); await form.getByLabel('Сеть', { exact: true }).fill('TRC-20');
    await form.getByLabel('Адрес кошелька', { exact: true }).fill('TLOCALTESTNOTREAL0123456789'); await form.getByLabel('Разрешить выставление счетов', { exact: true }).check(); await submit(form);
    const details = admin.locator('details').filter({ has: admin.locator('summary').filter({ hasText: `${prefix} — тестовый кошелёк` }) }); await details.locator('summary').click();
    fixtures.walletId = await details.locator('input[name="id"]').inputValue();
    await go(admin, '/admin/invoices'); form = mainForm('invoices');
    await form.getByLabel('Услуга или назначение платежа', { exact: true }).fill(`${prefix} — счёт`); await form.getByLabel('Криптовалюта и сеть', { exact: true }).selectOption(fixtures.walletId);
    await form.getByLabel('Точная сумма', { exact: true }).fill('12345678901234567890.000000000000000001'); await form.getByLabel('Примечание для оператора', { exact: true }).fill('Локальная проверка точности. Не является платёжным счётом.'); await submit(form, 'Создать счёт');
    fixtures.invoiceId = await openRow('invoices', `${prefix} — счёт`);
    assert.ok(await admin.getByText('12345678901234567890.000000000000000001 USDT', { exact: true }).last().isVisible(), 'The full decimal amount is preserved.');
    await go(admin, '/admin/settings'); const wallet = admin.locator('details').filter({ has: admin.locator('summary').filter({ hasText: `${prefix} — тестовый кошелёк` }) }); await wallet.locator('summary').click();
    await wallet.getByLabel('Адрес кошелька', { exact: true }).fill('TLOCALCHANGEDNOTREAL9876543210'); await submit(wallet.locator('form'));
    await go(admin, `/admin/invoices?edit=${fixtures.invoiceId}`); assert.ok(await admin.getByText('TLOCALTESTNOTREAL0123456789', { exact: true }).isVisible(), 'An existing invoice keeps the original address.');
    assert.equal(await admin.getByText('TLOCALCHANGEDNOTREAL9876543210', { exact: true }).count(), 0);
    for (const width of [1440, 390]) await capture(admin, 'invoice-pending', width);
    form = admin.locator('form[action="/api/admin/invoice-status"]').filter({ has: admin.locator('input[name="status"][value="paid"]') });
    await form.getByLabel('Идентификатор проверенной транзакции', { exact: true }).fill(`LOCAL-TEST-NO-CHAIN-${run}`); await submit(form, 'Подтверждаю поступление');
    await go(admin, `/admin/invoices?edit=${fixtures.invoiceId}`); assert.ok(await admin.getByText('Оплачен', { exact: true }).last().isVisible());
    await submit(admin.locator('form[action="/api/admin/invoice-status"]'), 'Подтверждаю выдачу');
    await go(admin, `/admin/invoices?edit=${fixtures.invoiceId}`); assert.ok(await admin.getByText('Выдан', { exact: true }).last().isVisible());
    for (const width of [1440, 390]) await capture(admin, 'invoice-fulfilled', width);
    console.log('PASS: public draft/publish, country/product stock, exact invoice amount, immutable wallet snapshot, paid → fulfilled.');

    // Real R2 upload through a file input, followed by a public GET without a session.
    await go(admin, '/admin/news'); form = mainForm('upload'); await form.locator('input[type="file"]').setInputFiles(path.resolve(__dirname, '../../assets/og-minisite.png')); await submit(form, 'Загрузить');
    const uploaded = new URL(admin.url()).searchParams.get('uploaded'); assert.ok(uploaded.startsWith('/media/uploads/'));
    const imageResponse = await visitorContext.request.get(`${base}${uploaded}`); assert.equal(imageResponse.status(), 200); assert.equal(imageResponse.headers()['content-type'], 'image/png'); assert.ok((await imageResponse.body()).length > 1000);
    form = mainForm('news'); await form.getByLabel('Заголовок', { exact: true }).fill(`${prefix} — новость`); await form.getByLabel('Адрес новости', { exact: true }).fill(fixtures.newsSlug);
    await form.getByLabel('Краткое описание', { exact: true }).fill('Проверка редактора новостей.'); await form.getByLabel('Текст новости', { exact: true }).fill('Исходная новость локального теста.');
    await form.getByLabel('Закрепить в начале списка', { exact: true }).check(); await form.getByLabel('Скрыть с сайта', { exact: true }).check(); await submit(form);
    fixtures.newsId = await openRow('news', `${prefix} — новость`); await go(visitor, `/news/${fixtures.newsSlug}`, 404);
    await mainForm('news').getByLabel('Скрыть с сайта', { exact: true }).uncheck(); await mainForm('news').getByLabel('Текст новости', { exact: true }).fill('Отредактированная новость локального теста.'); await submit(mainForm('news'));
    await go(visitor, `/news/${fixtures.newsSlug}`); assert.ok(await visitor.getByText('Отредактированная новость локального теста.', { exact: true }).isVisible());
    await go(visitor, '/news'); assert.ok(await visitor.locator(`a[href="/news/${fixtures.newsSlug}"]`).first().isVisible());
    await go(admin, `/admin/news?edit=${fixtures.newsId}`); for (const width of [1440, 390]) await capture(admin, 'news-edit', width);

    // Chat runs against the local Pages proxy and local mock only.
    await go(visitor, '/'); const cfg = await visitor.evaluate(() => window.AVOCADO_CONFIG);
    assert.ok(loopback(cfg.chatApiBase), 'The browser chat endpoint must remain local.');
    await visitor.locator('[data-chat]').first().click(); await visitor.locator('.ac-panel[aria-hidden="false"]').waitFor();
    await visitor.locator('.ac-intro input[name="name"]').fill(`${prefix} — посетитель`); await visitor.locator('.ac-intro input[name="contact"]').fill('local-test@example.invalid');
    const message = `${prefix}: проверка чата без реальной отправки.`, reply = `${prefix}: ответ из админки получен.`;
    await visitor.locator('.ac-form textarea').fill(message); const sent = visitor.waitForResponse(response => response.request().method() === 'POST' && /\/api\/chat\/[^/]+\/messages/.test(response.url()));
    await visitor.getByRole('button', { name: 'Отправить', exact: true }).click(); assert.equal((await sent).status(), 200);
    const log = await (await fetch(`${mock}/__log`)).json(); assert.ok(log.some(entry => entry.method === 'sendMessage' && String(entry.payload.text).includes(message)), 'The visitor message reached the local Telegram mock.');
    const sid = await visitor.evaluate(() => JSON.parse(localStorage.getItem('avocado.chat.sid')));
    await go(admin, `/admin/chats/${sid}`); assert.ok(await admin.getByText(message, { exact: true }).isVisible());
    const csrf = await mainForm('reply').locator('[name="csrf"]').inputValue();
    const denied = await context.request.post(`${base}/api/admin/reply`, { headers: { Origin: 'https://example.invalid' }, form: { csrf, sessionId: sid, text: 'Rejected cross-origin test' } }); assert.equal(denied.status(), 403);
    await mainForm('reply').getByLabel('Сообщение', { exact: true }).fill(reply); await submit(mainForm('reply'), 'Отправить ответ');
    await visitor.bringToFront();
    const replyBubble = visitor.locator('.ac-msg.admin').filter({ hasText: reply });
    await replyBubble.waitFor({ timeout: 15000 });
    assert.equal(await replyBubble.evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()), reply);
    for (const width of [1440, 390]) { await capture(admin, 'chat-history', width); await capture(visitor, 'visitor-chat', width); }
    console.log('PASS: media upload/public GET, hidden/pinned/edited news, local Telegram notification, admin reply in visitor widget, CSRF rejection.');
    await writeFile(path.join(output, 'fixtures.json'), JSON.stringify({ ...fixtures, sid }, null, 2));
  } finally {
    await cleanup();
    if (admin && context) {
      try { await go(admin, '/admin'); await Promise.all([admin.waitForNavigation({ waitUntil: 'networkidle' }), admin.getByRole('button', { name: 'Выйти', exact: true }).click()]); assert.equal(new URL(admin.url()).pathname, '/admin/login'); const response = await context.request.get(`${base}/admin/pages`); assert.ok(response.url().endsWith('/admin/login')); }
      catch { cleanupFailed = true; console.error('Logout verification needs review.'); }
    }
    await browser?.close();
  }
  assert.equal(cleanupFailed, false, 'Fixture cleanup and logout must complete.');
  console.log(`PASS: ${findings.length} screenshot/accessibility states. Fixtures archived/hidden; dummy wallet disabled; logout revokes session.`);
})().catch(error => { console.error(String(error?.stack || error).replaceAll(password || 'NO_PASSWORD_SET', '[REDACTED]')); process.exitCode = 1; });
