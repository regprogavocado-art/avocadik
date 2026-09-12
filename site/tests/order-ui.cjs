const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:4322';
const output = path.resolve(process.env.ORDER_UI_OUTPUT || path.join(__dirname, '../output/playwright/orders'));
(async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, reducedMotion: 'reduce' });
      const sent = [], unexpectedWrites = [], errors = [];
      await context.route('**/*', route => {
        const request = route.request();
        if (/\/api\/chat\/[^/]+\/messages/.test(request.url())) {
          if (request.method() === 'POST') {
            sent.push(request.postDataJSON());
            return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { id: sent.length, ts: Date.now(), delivered: true } });
          }
          return route.fulfill({ headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }, json: { messages: [] } });
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { unexpectedWrites.push(request.url()); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const dialog = page.locator('#avocado-order');
      const chatDraft = page.locator('.ac-form textarea');
      async function snapshot(name) {
        const violations = (await new AxeBuilder({ page }).include('#avocado-order').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        assert.deepEqual(violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${name} ${width}: accessibility`);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'dialog fits viewport');
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`) });
      }
      await page.goto(`${base}/catalog/vps/`, { waitUntil: 'networkidle' });
      const orderButtons = page.locator('[data-order]');
      const items = await orderButtons.evaluateAll(buttons => buttons.map(button => JSON.parse(button.dataset.order)));
      const index = items.findIndex(item => item.countries.length === 1 && item.availability !== 'soon');
      assert.ok(index >= 0, 'a real published VPS tariff with one country exists');
      const product = items[index];
      const orderButton = orderButtons.nth(index);
      await orderButton.click();
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await page.locator('[data-order-price]').textContent(), product.priceLabel);
      assert.equal(await page.locator('#order-country').isVisible(), false, 'one country is read-only');
      assert.equal(await page.locator('[data-order-country-value]').textContent(), product.countries[0].name);
      await page.locator('#order-os').selectOption('Debian');
      await page.locator('#order-comment').fill('Нужен перенос проекта.');
      await snapshot('vps-order');
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await orderButton.evaluate(button => document.activeElement === button), true, 'Escape returns focus');
      await orderButton.click();
      assert.equal(await page.locator('#order-comment').inputValue(), 'Нужен перенос проекта.');
      await page.locator('[data-order-close]').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'native modal contains keyboard focus');
      await page.locator('[data-order-form] button[type="submit"]').click();
      await page.waitForFunction(() => document.activeElement === document.querySelector('.ac-form textarea'));
      assert.equal(await dialog.isVisible(), false);
      const message = await chatDraft.inputValue();
      assert.ok(message.includes(product.title) && message.includes(product.priceLabel) && message.includes(product.countries[0].name));
      assert.match(message, /Пожелание к ОС: Debian/);
      assert.match(message, /Нужен перенос проекта/);
      assert.equal(sent.length, 0, 'configuration and chat prefill never send a message');
      // The request is intercepted locally: no message reaches a real Worker or Telegram.
      await page.locator('.ac-send').click();
      await page.waitForFunction(() => document.querySelector('.ac-msg.user:not(.pending):not(.failed)'));
      assert.equal(sent.length, 1);
      assert.equal(sent[0].text, message, 'explicit send uses the existing chat API payload');
      await chatDraft.fill('x'.repeat(1995));
      await page.locator('.ac-close').click();
      await orderButton.click();
      await page.locator('[data-order-form] button[type="submit"]').click();
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await page.locator('#order-error').isVisible(), true);
      assert.equal(await chatDraft.inputValue(), 'x'.repeat(1995));
      await page.locator('[data-order-existing-chat]').click();
      await chatDraft.fill('Сохраните мой контекст.');
      await page.locator('.ac-close').click();
      await orderButton.click();
      await page.locator('[data-order-form] button[type="submit"]').click();
      assert.ok((await chatDraft.inputValue()).startsWith('Сохраните мой контекст.\n\n'));
      assert.equal(sent.length, 1, 'append never sends a second message');
      await page.locator('.ac-close').click();

      await page.goto(`${base}/catalog/proxies/`, { waitUntil: 'networkidle' });
      const proxyButtons = page.locator('[data-order]');
      const proxyItems = await proxyButtons.evaluateAll(buttons => buttons.map(button => JSON.parse(button.dataset.order)));
      const proxyIndex = proxyItems.findIndex(item => item.countries.length > 1);
      assert.ok(proxyIndex >= 0, 'a published proxy tariff has several known countries');
      const expectedCountries = proxyItems[proxyIndex].countries;
      const chosenCode = expectedCountries.at(-1).code;
      const countryFilter = page.locator(`[data-filter-country="${chosenCode}"]`);
      if (await countryFilter.count()) await countryFilter.click();
      await proxyButtons.nth(proxyIndex).click();
      assert.deepEqual(await page.locator('#order-country option').evaluateAll(options => options.map(option => option.value)), expectedCountries.map(item => item.code));
      if (await countryFilter.count()) assert.equal(await page.locator('#order-country').inputValue(), chosenCode, 'the tariff country filter carries over to the order');
      await page.locator('#order-country').selectOption(chosenCode);
      assert.equal(await page.locator('[data-order-os-row]').isVisible(), false, 'proxy orders do not imply a server OS');
      await snapshot('proxy-country-order');
      await page.keyboard.press('Escape');

      await page.goto(`${base}/catalog/domains/`, { waitUntil: 'networkidle' });
      const domainButtons = page.locator('[data-order]');
      const domainProducts = await domainButtons.evaluateAll(buttons => buttons.map(button => JSON.parse(button.dataset.order)));
      const comIndex = domainProducts.findIndex(item => item.title.includes('.com'));
      assert.ok(comIndex >= 0, 'a priced .com domain tariff exists');
      await domainButtons.nth(comIndex).click();
      assert.equal(await page.locator('#order-domain-input').isVisible(), true, 'a direct domain tariff asks for the desired name');
      await page.locator('#order-domain-input').fill('avocado-test.net');
      await page.locator('[data-order-form] button[type="submit"]').click();
      assert.match(await page.locator('#order-error').textContent(), /Этот тариф для зоны \.com/);
      assert.equal(sent.length, 1, 'a mismatched domain zone is never sent');
      await page.locator('#order-domain-input').fill('avocado-test');
      await snapshot('direct-domain-order');
      await page.locator('[data-order-form] button[type="submit"]').click();
      await page.waitForFunction(() => document.activeElement === document.querySelector('.ac-form textarea'));
      assert.match(await chatDraft.inputValue(), /avocado-test\.com/);
      assert.ok((await chatDraft.inputValue()).includes(domainProducts[comIndex].priceLabel));
      assert.equal(sent.length, 1);
      await page.locator('.ac-close').click();

      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.locator('.domain-search').first().screenshot({ path: path.join(output, `domain-search-${width}.png`) });
      const domainForm = page.locator('[data-domain-form]').first();
      const domainInput = domainForm.locator('input[name="domain"]');
      await domainInput.fill('https://wrong.example/path');
      await domainForm.locator('button[type="submit"]').click();
      assert.equal(await domainForm.locator('[data-domain-error]').isVisible(), true);
      assert.equal(await dialog.isVisible(), false);
      await domainInput.fill('пример.рф');
      await domainForm.locator('button[type="submit"]').click();
      assert.equal(await page.locator('[data-order-domain]').textContent(), 'xn--e1afmkfd.xn--p1ai');
      assert.equal(await page.locator('[data-order-os-row]').isVisible(), false);
      await snapshot('domain-order');
      assert.doesNotMatch(await dialog.textContent(), /домен (?:свободен|доступен)/i);
      await page.keyboard.press('Escape');
      await domainInput.fill('example.unknownzone');
      await domainForm.locator('button[type="submit"]').click();
      assert.equal(await page.locator('[data-order-price]').textContent(), 'По запросу');
      await page.locator('[data-order-form] button[type="submit"]').click();
      await page.waitForFunction(() => document.activeElement === document.querySelector('.ac-form textarea'));
      assert.match(await chatDraft.inputValue(), /example\.unknownzone/);
      assert.match(await chatDraft.inputValue(), /Проверьте доступность/);
      assert.equal(sent.length, 1, 'domain requests require the visitor to click Send too');
      assert.deepEqual(unexpectedWrites, []);
      assert.deepEqual(errors, []);
      results.push({ width, checks: 'VPS selection, price, country, OS, domain validation/IDN/unknown zone, keyboard focus, preserved draft/limit, WCAG AA', mockedPosts: sent.length, externalWrites: unexpectedWrites.length });
      await context.close();
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS: order and domain flow at 1440/390, WCAG AA, mock-only explicit sends, zero real POST.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
