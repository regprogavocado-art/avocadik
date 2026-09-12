const { chromium } = require('playwright');
const OUT = process.env.OUT;
const SITE = 'http://localhost:8000/';
const SECRET = 'localsecret-0123456789abcdef';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const patchConfig = async (route) => {
    const res = await route.fetch(); let body = await res.text();
    body = body.replace("chatApiBase: ''", "chatApiBase: 'http://127.0.0.1:8787'");
    await route.fulfill({ status: 200, body, headers: { 'content-type': 'application/javascript' } });
  };
  await page.route('**/js/config.js', patchConfig);
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/desktop-full.png', fullPage: true });
  await page.screenshot({ path: OUT + '/desktop-hero.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // чат: сообщение → мок Telegram → ответ через webhook → виджет
  await page.click('.ac-launcher');
  await page.waitForSelector('body.ac-open');
  await page.fill('input[name=name]', 'Тест');
  await page.fill('input[name=contact]', '@test');
  await page.fill('.ac-form textarea', 'Привет из Playwright');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ac-msg.user:not(.pending)', { timeout: 10000 });
  const log = await (await fetch('http://127.0.0.1:8099/__log')).json();
  const last = [...log].reverse().find((e) => e.method === 'sendMessage' && /Playwright/.test(e.payload.text || ''));
  await fetch('http://127.0.0.1:8787/tg/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    body: JSON.stringify({ update_id: 99, message: { message_id: 9000 + Math.floor(Math.random() * 1e6), chat: { id: 777 }, text: 'Ответ оператора из Telegram ✅', reply_to_message: { message_id: last.result.message_id } } })
  });
  await page.waitForSelector('.ac-msg.admin', { timeout: 15000 });
  await page.screenshot({ path: OUT + '/desktop-chat.png' });
  await page.click('.ac-close');
  await page.click('.plan-featured button');
  await page.waitForTimeout(200);
  const prefill = await page.inputValue('.ac-form textarea');
  // черновик посетителя не затирается следующей CTA
  await page.fill('.ac-form textarea', 'черновик');
  await page.click('.cta-actions [data-chat*="внедрить"]');
  await page.waitForTimeout(200);
  const draftKept = (await page.inputValue('.ac-form textarea')) === 'черновик';
  await page.fill('.ac-form textarea', '');
  await page.click('.ac-close');

  // перезагрузка: история должна подтянуться из localStorage/сервера
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('.ac-launcher');
  await page.waitForSelector('.ac-msg.admin', { timeout: 10000 });
  const restored = await page.$$eval('.ac-msg', (els) => els.map((e) => e.className));

  // мобильный
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.route('**/js/config.js', patchConfig);
  await mp.goto(SITE, { waitUntil: 'networkidle' });
  await mp.evaluate(() => document.fonts.ready);
  await mp.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); });
  await mp.waitForTimeout(600);
  const moverflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await mp.screenshot({ path: OUT + '/mobile-full.png', fullPage: true });
  await mp.click('#navToggle'); await mp.waitForTimeout(300);
  await mp.screenshot({ path: OUT + '/mobile-menu.png' });
  await mp.click('#navToggle');
  await mp.click('.ac-launcher'); await mp.waitForTimeout(400);
  await mp.screenshot({ path: OUT + '/mobile-chat.png' });

  const hiddenSvgs = await page.evaluate(() => document.querySelectorAll('svg:not([aria-hidden])').length);
  console.log(JSON.stringify({ errors, overflow, moverflow, prefill, draftKept, restored, hiddenSvgs, tgMsgId: last && last.result.message_id }, null, 2));
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
