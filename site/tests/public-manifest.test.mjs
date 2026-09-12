import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {buildPublicManifest,getPublicManifest,publicManifestResponse} from '../src/lib/public-manifest.ts';

const now=Date.parse('2026-09-12T12:00:00Z');
function database(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of ['0001_cms.sql','0002_seed.sql','0003_chat_baseline.sql','0004_product_pricing.sql'])sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  const queries=[];
  const DB={prepare(sql){queries.push(sql);const statement=sqlite.prepare(sql);let values=[];return {bind(...args){values=args;return this},async all(){return {results:statement.all(...values)}}}}};
  return {sqlite,DB,queries};
}

test('manifest reads only published routing fields and excludes private records and drafts',async()=>{
  const {sqlite,DB,queries}=database();
  try {
    sqlite.exec("UPDATE cms_pages SET status='draft' WHERE slug='hass'; UPDATE cms_products SET status='draft' WHERE category='vps'; UPDATE cms_settings SET value='private-wallet-sentinel' WHERE key='wallets'; UPDATE cms_products SET source_name='private-supplier-sentinel',source_url='https://supplier.invalid/internal',body='private-product-body-sentinel'; INSERT INTO cms_pages(slug,title,status,created_at,updated_at) VALUES('software','Software','published',1,1),('custom-page','Private title sentinel','published',1,1),('draft-page','Draft','draft',1,1)");
    const result=await getPublicManifest({DB},now);
    assert.deepEqual(Object.keys(result),['generatedAt','paths']);
    assert.equal(result.generatedAt,'2026-09-12T12:00:00.000Z');
    for(const path of ['/','/software','/ettinger','/rent','/catalog','/catalog/vps','/catalog/proxies/proxies','/custom-page'])assert.ok(result.paths.includes(path),path);
    for(const path of ['/hass','/draft-page','/catalog/vps/vps','/home','/category-vps'])assert.ok(!result.paths.includes(path),path);
    assert.deepEqual(result.paths,[...new Set(result.paths)].sort());
    assert.doesNotMatch(JSON.stringify(result),/sentinel|supplier|wallet|source|body|title|admin|invoice|csrf|session/i);
    assert.equal(queries.length,3);
    for(const sql of queries)assert.doesNotMatch(sql,/SELECT\s+\*|cms_settings|source_|body|title|wallet|admin|invoice|sessions/i);
  } finally {sqlite.close();}
});

test('news inventory includes all currently visible stories and exact nine-item pagination',async()=>{
  const {sqlite,DB}=database();
  try {
    const insert=sqlite.prepare('INSERT INTO news(slug,title,body,hidden,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    for(let i=1;i<=19;i++)insert.run(`story-${i}`,'Private news title','Private body',0,now-i,now,now);
    insert.run('hidden-story','Hidden','Hidden',1,now-1,now,now);
    insert.run('future-story','Future','Future',0,now+1,now,now);
    let result=await getPublicManifest({DB},now);
    assert.equal(result.paths.filter(path=>path.startsWith('/news/')).length,19);
    assert.deepEqual(result.paths.filter(path=>path.includes('?')),['/news?page=2','/news?page=3']);
    assert.ok(!result.paths.includes('/news/hidden-story'));
    assert.ok(!result.paths.includes('/news/future-story'));
    assert.doesNotMatch(JSON.stringify(result),/Private|Hidden|Future|published_at/);
    result=await getPublicManifest({DB},now+1);
    assert.ok(result.paths.includes('/news/future-story'),'story appears when its publication time arrives');
    sqlite.exec("UPDATE cms_pages SET status='draft' WHERE slug='news'");
    result=await getPublicManifest({DB},now);
    assert.ok(!result.paths.includes('/news'));
    assert.ok(!result.paths.some(path=>path.includes('?')));
    assert.ok(result.paths.includes('/news/story-1'),'published detail remains independently available in SSR');
  } finally {sqlite.close();}
});

test('published slugs cannot turn the export into private endpoint or arbitrary-path fetching',()=>{
  const pageSlugs=['admin','api','media','index','assets','css','js','fonts','404','robots','sitemap','../admin','news?admin=1','/admin','https://evil.invalid','a%2fadmin','a\\admin','a'.repeat(81),'UPPER','_astro','category-unknown','category-vps','home','custom-page'];
  const result=buildPublicManifest(pageSlugs.map(slug=>({slug,status:'published'})),[
    {slug:'safe-product',category:'vps',status:'published'},
    {slug:'../secret',category:'vps',status:'published'},
    {slug:'private',category:'../admin',status:'published'},
    {slug:'draft',category:'vps',status:'draft'},
  ],[
    {slug:'safe-story',published_at:now},
    {slug:'../api',published_at:now},
    {slug:'hidden',published_at:now,hidden:true},
    {slug:'future',published_at:now+1},
  ],now);
  assert.deepEqual(result.paths,['/','/catalog/vps','/catalog/vps/safe-product','/custom-page','/news/safe-story']);
});

test('manifest is uncached, excluded from indexing and fails closed without exposing database errors',async()=>{
  let response=await publicManifestResponse({},now);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.match(response.headers.get('content-type'),/^application\/json/);
  assert.ok((await response.json()).paths.includes('/software'));
  response=await publicManifestResponse({DB:{prepare(){throw new Error('secret database connection details')}}},now);
  assert.equal(response.status,503);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'Public content is temporarily unavailable.'});
});
