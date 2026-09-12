import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

test('ordering appends to an edited chat draft without POST, duplication, truncation or later replacement', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const writes = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { messages: [], session: null } });
    });
    await page.setContent('<main><button id="order">Заказать</button></main><div id="chat-root"></div>');
    await page.evaluate(() => { window.AVOCADO_CONFIG = { chatApiBase: 'https://chat.invalid', telegramUrl: 'https://t.me/example' }; });
    await page.addScriptTag({ path: fileURLToPath(new URL('../../js/chat.js', import.meta.url)) });
    const draft = page.locator('.ac-form textarea');
    await page.evaluate(() => window.AvocadoChat.open({ text: 'Первая подстановка' }));
    await draft.fill('Мой важный черновик');
    const applyOrder = () => page.evaluate(() => window.AvocadoChat.open({ text: 'Заказ: VPS NL4', opener: document.querySelector('#order'), appendDraft: true }));
    assert.equal(await applyOrder(), true);
    assert.equal(await draft.inputValue(), 'Мой важный черновик\n\nЗаказ: VPS NL4');
    assert.equal(await applyOrder(), true);
    assert.equal(await draft.inputValue(), 'Мой важный черновик\n\nЗаказ: VPS NL4', 'reopening the same order does not append it twice');
    await page.evaluate(() => window.AvocadoChat.open({ text: 'Другая обычная CTA' }));
    assert.equal(await draft.inputValue(), 'Мой важный черновик\n\nЗаказ: VPS NL4', 'ordinary CTA still preserves the edited draft');
    await draft.fill('x'.repeat(1995));
    await page.evaluate(() => window.AvocadoChat.close());
    assert.equal(await applyOrder(), false);
    assert.equal(await draft.inputValue(), 'x'.repeat(1995), 'an overfull draft remains byte-for-byte unchanged');
    assert.equal(await page.locator('#acPanel').getAttribute('aria-hidden'), 'true', 'failed prefill does not open a second dialog');
    await page.evaluate(() => window.AvocadoChat.open({ text: '' }));
    await draft.fill('');
    await page.evaluate(() => window.AvocadoChat.open({ text: 'Неизменённая CTA' }));
    assert.equal(await applyOrder(), true);
    assert.equal(await draft.inputValue(), 'Заказ: VPS NL4', 'an untouched earlier CTA is replaceable');
    assert.deepEqual(writes, [], 'opening an order never sends a customer message');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
