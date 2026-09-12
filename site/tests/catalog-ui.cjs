const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:4322';
const output = path.resolve(__dirname, '../output/playwright/catalog-interactions');

(async () => {
  await mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true});
  const reports = [];
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:width === 1440 ? 1000 : 844},reducedMotion:'reduce'});
      let writes = 0;
      await context.route('**/*',route => {
        if (['GET','HEAD','OPTIONS'].includes(route.request().method())) return route.continue();
        writes++;
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror',error => errors.push(error.message));
      const open = async route => {const response=await page.goto(base+route,{waitUntil:'networkidle'});assert.equal(response.status(),200,route);};
      await open('/catalog/vps/#country=CH');
      let grid = page.locator('[data-tariff-grid]');
      assert.equal(await grid.locator('[data-tariff]:visible').count(),2,'country hash restores actual Swiss VPS');
      await grid.locator('[data-filter-ram]').selectOption('4');
      assert.equal(await grid.locator('[data-tariff]:visible').count(),1,'RAM filter excludes Swiss 1 GB');
      await grid.locator('[data-filter-currency]').selectOption('USD');
      assert.equal(await grid.locator('[data-tariff]:visible').count(),0,'currencies remain separate');
      assert.equal(await grid.locator('[data-filter-empty]').isVisible(),true);
      assert.equal(new URL(page.url()).search,'','filter state never creates SSR query routes');
      assert.equal(new URL(page.url()).hash,'#country=CH&ram=4&currency=USD');
      await page.screenshot({path:path.join(output,`empty-${width}.png`),fullPage:false});
      await grid.locator('[data-filter-reset]').click();
      assert.equal(await grid.locator('[data-tariff]:visible').count(),12);
      assert.equal(await grid.locator('[data-filter-country="DE"]').count(),0,'Germany is not a VPS location');
      assert.equal(await grid.locator('[data-filter-country="US"]').count(),1);
      await grid.locator('[data-filter-country="IS"]').click();
      assert.equal(await grid.locator('[data-tariff]:visible').count(),3);
      assert.match(await grid.locator('[data-tariff]:visible').first().innerText(),/Уточним/,'unknown Icelandic port is explicit');
      await page.screenshot({path:path.join(output,`vps-is-${width}.png`),fullPage:false});
      await open('/');
      grid = page.locator('[data-tariff-grid]').first();
      assert.equal(await grid.locator('[data-tariff]:visible').count(),4,'home starts with four featured VPS');
      await grid.locator('[data-filter-country="CH"]').click();
      assert.equal(await grid.locator('[data-tariff]:visible').count(),2,'home filtering considers all twelve tariffs');
      await grid.locator('[data-filter-reset]').click();
      assert.equal(await grid.locator('[data-tariff]:visible').count(),4);
      await open('/countries/');
      const germany=page.locator('.hosting-country-card').filter({has:page.getByRole('heading',{name:'Германия',exact:true})});
      assert.equal(await germany.locator('a[href="/catalog/proxies/#country=DE"]').count(),1);
      assert.equal(await germany.locator('a[href*="/catalog/vps/"]').count(),0);
      assert.equal(await page.locator('.hosting-country-card .country-flag').count(),17);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth+1);
      assert.equal(overflow,false,`${width}: countries page must not overflow horizontally`);
      assert.deepEqual(errors,[]);
      assert.equal(writes,0,'catalog browsing never sends messages');
      reports.push({width,filters:true,homeFeatured:true,countryGeography:true,blockedWrites:writes,errors});
      await context.close();
    }
    await writeFile(path.join(output,'results.json'),JSON.stringify(reports,null,2));
    console.log('Catalog interactions passed at 1440 and 390; no messages sent.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack || error.message);process.exitCode=1;});
