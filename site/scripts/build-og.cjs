const { chromium } = require('playwright');
const { readFile,copyFile,mkdir } = require('node:fs/promises');
const path = require('node:path');
(async () => {
 const root=path.resolve(__dirname,'../..');
 const data=async(file,mime)=>'data:'+mime+';base64,'+(await readFile(path.join(root,file))).toString('base64');
 const [character,font,latin,mark]=await Promise.all([data('assets/img/avocado-guardian.webp','image/webp'),data('assets/fonts/manrope-cyrillic.woff2','font/woff2'),data('assets/fonts/manrope-latin.woff2','font/woff2'),readFile(path.join(root,'assets/img/avocado-mark.svg'),'utf8')]);
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
@font-face{font-family:Manrope;src:url(${font});font-weight:400 800;unicode-range:U+0400-045F,U+2116}@font-face{font-family:Manrope;src:url(${latin});font-weight:400 800}*{box-sizing:border-box}body{margin:0;background:#080a09;color:#eef2ee;font-family:Manrope,sans-serif;overflow:hidden}.frame{width:1200px;height:630px;position:relative;padding:48px 62px;background:radial-gradient(ellipse at 85% 60%,#26322580,transparent 48%)}.brand{display:flex;align-items:center;gap:12px;font-size:30px;font-weight:800;letter-spacing:-1px}.brand svg{width:48px;height:52px}.brand small{color:#a2ada5;font-size:12px;display:block;margin-top:4px;font-weight:500;letter-spacing:.03em}h1{font-size:60px;line-height:1.12;letter-spacing:-2.1px;font-weight:800;margin:70px 0 25px;max-width:690px}h1 span{color:#e3b45c}.line{color:#bbc5bc;font-size:19px;line-height:1.7;max-width:600px}.mascot{position:absolute;right:0;top:55px;width:520px;height:540px;object-fit:contain}.left{position:relative;z-index:2;pointer-events:none}.rule{height:1px;background:linear-gradient(90deg,#e3b45c77,transparent);width:525px;margin-top:35px}.privacy{margin-top:22px;font-size:13px;color:#8ff0a6;letter-spacing:.02em}
</style><div class="frame"><img class="mascot" alt="" src="${character}"><div class="left"><div class="brand">${mark}<div>Avocado<small>Анонимный хостинг</small></div></div><h1>Анонимный хостинг.<br><span>На вашей стороне.</span></h1><div class="line">VPS · Серверы · Домены · Прокси<br>Свои решения для защиты и автоматизации</div><div class="rule"></div><div class="privacy">Без KYC и проверки документов · Оплата криптовалютой</div></div></div></html>`);
  await page.evaluate(()=>document.fonts.ready);await page.locator('img').evaluate(img=>img.decode());
  await page.screenshot({path:path.join(root,'assets/og-minisite.png')});
  await copyFile(path.join(root,'assets/og-minisite.png'),path.join(root,'assets/og.png'));
  await page.setViewportSize({width:256,height:256});
  await page.setContent(`<html><style>body{margin:0;background:#080a09;display:grid;place-items:center;width:256px;height:256px}svg{width:210px;height:210px}</style>${mark}</html>`);
  await mkdir(path.join(root,'output/brand'),{recursive:true});
  await page.screenshot({path:path.join(root,'output/brand/favicon-256.png')});
  for (const size of [192,512]) {
   await page.setViewportSize({width:size,height:size});
   await page.setContent(`<html><style>body{margin:0;background:#080a09;display:grid;place-items:center;width:${size}px;height:${size}px}svg{width:82%;height:82%}</style>${mark}</html>`);
   await page.screenshot({path:path.join(root,`assets/icons/icon-${size}.png`)});
  }
  console.log('Created social artwork and favicon master with the Avocado guardian and new vector mark.');
 } finally {await browser.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
