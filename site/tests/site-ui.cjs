const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:4321';
const output = path.resolve(__dirname, '../output/playwright/public');
const routes = process.env.UI_ROUTES ? process.env.UI_ROUTES.split(',').filter(Boolean) : [ '/', '/hass', '/ettinger', '/rent', '/catalog', '/catalog/domains', '/catalog/vps', '/catalog/dedicated', '/catalog/bulletproof', '/catalog/proxies', '/catalog/vps/vps', '/countries', '/payment', '/news', '/contacts' ];
if (process.env.UI_NEWS_SLUG) routes.push(`/news/${encodeURIComponent(process.env.UI_NEWS_SLUG)}`);
const findings = [];

(async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
      for (const route of routes) {
        pageErrors.length = 0;
        const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200, `${route}: HTTP status`);
        await page.evaluate(() => document.fonts.ready);
        // Eagerly reveal lazy media without changing the delivered page or image markup.
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(resolve => requestAnimationFrame(resolve)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(160);
        assert.equal(await page.locator('h1').count(), 1, `${route}: exactly one H1`);
        const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(overflow.scroll <= overflow.width + 1, `${route} ${width}: horizontal overflow ${JSON.stringify(overflow)}`);
        const brokenImages = await page.locator('img').evaluateAll(images => images.filter(image => image.complete && image.naturalWidth === 0).map(image => image.getAttribute('src')));
        assert.deepEqual(brokenImages, [], `${route}: broken images`);
        const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const violations = a11y.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
        const name = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
        await page.screenshot({ path: path.join(output, `${name}-${width}-viewport.png`), fullPage: false });
        findings.push({ route, width, status: response.status(), errors: [...pageErrors], violations });
        await writeFile(path.join(output, 'results.json'), JSON.stringify(findings, null, 2));
        assert.deepEqual(pageErrors, [], `${route} ${width}: browser errors`);
        assert.deepEqual(violations, [], `${route} ${width}: accessibility violations`);
      }
      await page.goto(base, { waitUntil: 'networkidle' });
      if (width === 390) {
        const toggle = page.getByRole('button', { name: 'Открыть меню', exact: true });
        await toggle.click();
        await assert.doesNotReject(() => page.getByRole('navigation', { name: 'Мобильная навигация', exact: true }).waitFor({ state: 'visible' }));
        await page.keyboard.press('Escape');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape closes mobile menu');
        assert.ok(await toggle.evaluate(element => element === document.activeElement), 'Escape restores menu toggle focus');
        await toggle.click();
        await page.getByRole('navigation', { name: 'Мобильная навигация', exact: true }).getByRole('link', { name: 'Оплата', exact: true }).click();
        assert.equal(new URL(page.url()).pathname, '/payment');
      }
      if (!process.env.UI_SKIP_CHAT) {
        const cta = page.locator('[data-chat]').filter({ hasText: width === 1440 ? 'Обсудить проект' : 'Обсудить оплату' }).first();
        const historyResponse = page.waitForResponse(response => /\/api\/chat\/[^/]+\/messages/.test(response.url()) && response.request().method() === 'GET');
        await cta.click();
        assert.equal((await historyResponse).status(), 200, 'Chat history API returns200');
        await page.locator('.ac-panel[aria-hidden="false"]').waitFor();
        assert.ok((await page.locator('.ac-form textarea').inputValue()).length > 0, 'CTA pre-fills the chat without sending');
        const chatA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        assert.deepEqual(chatA11y.violations.map(item => item.id), [], `${width}: opened chat accessibility`);
        assert.deepEqual(pageErrors, [], `${width}: no errors when opening the chat`);
        await page.screenshot({ path: path.join(output, `chat-${width}.png`), fullPage: false });
        await page.getByRole('button', { name: 'Свернуть чат', exact: true }).click();
        assert.ok(await cta.evaluate(element => element === document.activeElement), 'Chat restores opener focus');
      }
      await context.close();
    }
    const page = await browser.newPage();
    for (const route of ['/this-page-does-not-exist', '/catalog/not-a-category', '/catalog/vps/not-a-product', '/news/not-a-news-item']) {
      const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 404, `${route}: unknown or unpublished pages must return404`);
    }
    console.log(`PASS: ${routes.length} public routes × 2 viewports, WCAG AA, navigation, ${process.env.UI_SKIP_CHAT ? 'chat deferred, ' : 'chat focus/prefill, '}404 paths.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
