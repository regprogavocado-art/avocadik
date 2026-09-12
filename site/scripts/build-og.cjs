const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
(async () => {
 const root = path.resolve(__dirname, '../..');
 const data = async (file, mime) => 'data:' + mime + ';base64,' + (await readFile(path.join(root,file))).toString('base64');
 const [fruit, font, latin] = await Promise.all([data('assets/img/avocado-cutout.webp','image/webp'),data('assets/fonts/manrope-cyrillic.woff2','font/woff2'),data('assets/fonts/manrope-latin.woff2','font/woff2')]);
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage({ viewport:{width:1200,height:630}, deviceScaleFactor:1 });
  await page.setContent('<!doctype html><html lang="ru"><meta charset="utf-8"><style>@font-face{font-family:Manrope;src:url('+font+');font-weight:500 800;unicode-range:U+0400-045F,U+2116}@font-face{font-family:Manrope;src:url('+latin+');font-weight:500 800}*{box-sizing:border-box}body{margin:0;background:#080a09;color:#eef2ee;font-family:Manrope,sans-serif;overflow:hidden}.frame{width:1200px;height:630px;position:relative;padding:60px 72px;background:radial-gradient(ellipse at 80% 72%,#18261b 0,transparent 48%)}.brand{font-size:30px;font-weight:800;letter-spacing:-1px}.brand small{color:#98a39b;font-size:17px;margin-left:16px;font-weight:500;letter-spacing:0}h1{font-size:59px;line-height:1.13;letter-spacing:-2.3px;font-weight:800;margin:80px 0 24px;max-width:700px}h1 span{color:#8ff0a6}.line{color:#afb9b2;font-size:21px;line-height:1.5;max-width:610px}img{position:absolute;right:32px;top:89px;width:445px;height:445px;object-fit:contain}.left{position:relative;z-index:2}.rule{height:1px;background:linear-gradient(90deg,#e3b45c88,transparent);width:420px;margin-top:54px}</style><div class="frame"><img alt="" src="'+fruit+'"><div class="left"><div class="brand">Avocado <small>avocado.rest</small></div><h1>Инфраструктура.<br><span>Больше возможностей.</span></h1><div class="line">Защита, серверы и автоматизация<br>для вашего проекта.</div><div class="rule"></div></div></div></html>');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('img').evaluate(img => img.decode());
  await page.screenshot({ path:path.join(root,'assets/og-minisite.png') });
  console.log('Created assets/og-minisite.png (1200x630) using avocado-cutout.webp.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
