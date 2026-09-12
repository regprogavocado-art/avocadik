import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {getSiteData,listNews,getNews} from '../src/lib/content.ts';
import {mutate,validAmount,sniffImage,renderAdmin} from '../src/lib/admin.ts';

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_cms.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_seed.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_chat_baseline.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}};
  return {sqlite,DB};
}
const request=new Request('https://example.test/api/admin/test',{method:'POST'});
const session={csrf:'csrf'};
const form=(values)=>{const f=new FormData();for(const [k,v] of Object.entries(values))f.set(k,String(v));return f};

test('public content excludes drafts; initial availability, countries and wallets are conservative',async()=>{
  const {DB,sqlite}=database();const data=await getSiteData({DB});
  assert.equal(data.pages.length,14);assert.equal(data.products.length,5);assert.deepEqual(data.countries,[]);assert.deepEqual(data.settings.wallets,[]);
  assert.equal(data.products.find(p=>p.category==='bulletproof').availability,'soon');
  assert.ok(data.products.filter(p=>p.category!=='bulletproof').every(p=>p.availability==='on_request'));
  sqlite.exec("UPDATE cms_pages SET status='draft' WHERE slug='hass'; UPDATE cms_products SET status='draft' WHERE category='vps'");
  const hidden=await getSiteData({DB});assert.ok(!hidden.pages.some(p=>p.slug==='hass'));assert.ok(!hidden.products.some(p=>p.category==='vps'));
});

test('all admin sections render against a freshly migrated empty chat database',async()=>{
  const {DB}=database();
  for(const section of ['','pages','products','countries','news','chats','invoices','settings']) {
    const page=await renderAdmin(section,{DB},session,new URL(`https://example.test/admin/${section}`));
    assert.ok(page.html.length>0);assert.notEqual(page.title,'Страница не найдена');
  }
});

test('news pagination includes pinned posts and excludes hidden/future publications',async()=>{
  const {DB,sqlite}=database();const now=Date.now();const ins=sqlite.prepare('INSERT INTO news(slug,title,published_at,created_at,updated_at,pinned,hidden) VALUES(?,?,?,?,?,?,?)');
  ins.run('older-pinned','Pinned',now-200,now,now,1,0);ins.run('recent','Recent',now-100,now,now,0,0);ins.run('hidden','Hidden',now-50,now,now,0,1);ins.run('future','Future',now+60000,now,now,0,0);
  const first=await listNews({DB},1,1),second=await listNews({DB},2,1);assert.equal(first.total,2);assert.equal(first.items[0].slug,'older-pinned');assert.equal(second.items[0].slug,'recent');
  assert.equal(await getNews({DB},'hidden'),null);assert.equal(await getNews({DB},'future'),null);assert.equal((await getNews({DB},'recent')).title,'Recent');
});

test('invoice snapshots preserve exact decimals and wallet details after settings change',async()=>{
  const {DB,sqlite}=database(),env={DB};
  const wallet={id:'w1',label:'Main',currency:'USDT',network:'TRC-20',address:'T123456789abcdef',enabled:true};
  sqlite.prepare("UPDATE cms_settings SET value=? WHERE key='wallets'").run(JSON.stringify([wallet]));
  const result=await mutate('invoices',request,env,form({walletId:'w1',amount:'12345678901234567890.000000000000000001',description:'VPS'}),session);
  assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/admin/invoices?saved=1');
  const invoice=sqlite.prepare('SELECT * FROM invoices').get();assert.equal(invoice.amount,'12345678901234567890.000000000000000001');assert.equal(invoice.address,wallet.address);
  sqlite.prepare("UPDATE cms_settings SET value=? WHERE key='wallets'").run(JSON.stringify([{...wallet,address:'NEWADDRESS12345',network:'ERC-20'}]));
  assert.equal(sqlite.prepare('SELECT address FROM invoices').get().address,wallet.address);
  const invalid=await mutate('invoice-status',request,env,form({id:invoice.id,status:'fulfilled'}),session);assert.match(invalid.headers.get('location'),/error=/);assert.equal(sqlite.prepare('SELECT status FROM invoices').get().status,'pending');
  await mutate('invoice-status',request,env,form({id:invoice.id,status:'paid',transactionId:'tx-12345'}),session);assert.equal(sqlite.prepare('SELECT status FROM invoices').get().status,'paid');
  await mutate('invoice-status',request,env,form({id:invoice.id,status:'fulfilled'}),session);assert.equal(sqlite.prepare('SELECT status FROM invoices').get().status,'fulfilled');
});

test('unconfigured wallets and malformed amounts cannot create payable invoices',async()=>{
  const {DB,sqlite}=database();for(const value of ['0','0.0000','-1','1e10','1,00',' 1','01','1.1234567890123456789','Infinity','NaN'])assert.equal(validAmount(value),false,value);
  for(const value of ['1','0.000000000000000001','25.00'])assert.equal(validAmount(value),true,value);
  const result=await mutate('invoices',request,{DB},form({walletId:'missing',amount:'10',description:'Hosting'}),session);assert.match(result.headers.get('location'),/error=/);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,0);
});

test('admin forms escape stored HTML; content accepts plain text and reserves system routes',async()=>{
  const {DB,sqlite}=database();
  await mutate('pages',request,{DB},form({title:'<script>alert(1)</script>',slug:'custom',summary:'" onfocus="evil',body:'<img src=x onerror=alert(1)>',status:'published'}),session);
  const record=sqlite.prepare("SELECT * FROM cms_pages WHERE slug='custom'").get();assert.ok(record);
  const rendered=await renderAdmin('pages',{DB},session,new URL(`https://example.test/admin/pages?edit=${record.id}`));assert.ok(!rendered.html.includes('<script>'));assert.match(rendered.html,/&lt;script&gt;/);assert.match(rendered.html,/&lt;img/);
  const bad=await mutate('pages',request,{DB},form({title:'Admin',slug:'admin',body:'',status:'published'}),session);assert.match(bad.headers.get('location'),/error=/);
});

test('image uploads reject SVG or misleading extensions; magic bytes determine MIME',()=>{
  assert.equal(sniffImage(new TextEncoder().encode('<svg><script>alert(1)</script></svg>')),null);
  assert.equal(sniffImage(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])).type,'image/png');
  assert.equal(sniffImage(new TextEncoder().encode('RIFFxxxxWEBPVP8x')).extension,'webp');
});

test('Telegram editorial changes preserve source identity and pin/hide flags',async()=>{
  const {DB,sqlite}=database();const now=Date.now();sqlite.prepare("INSERT INTO news(slug,title,body,source,source_chat_id,source_message_id,published_at,created_at,updated_at) VALUES('tg-post','Original','Original body','telegram','-100',7,?,?,?)").run(now,now,now);
  const id=sqlite.prepare('SELECT id FROM news').get().id;
  await mutate('news',request,{DB},form({id,slug:'tg-post',title:'Edited',body:'Editorial body',publishedAt:new Date(now).toISOString(),hidden:'on',pinned:'on',manualOverride:'on'}),session);
  const news=sqlite.prepare('SELECT * FROM news').get();assert.equal(news.source,'telegram');assert.equal(news.source_message_id,7);assert.equal(news.hidden,1);assert.equal(news.pinned,1);assert.equal(news.manual_override,1);assert.equal(news.title,'Edited');
});

test('site response does not resend a saved reply after Telegram delivery warning',async()=>{
  const {DB}=database();let calls=0;
  const env={DB,ADMIN_API_SECRET:'a'.repeat(32),CHAT_SERVICE:{async fetch(url,options){calls++;assert.ok(url.includes('/api/internal/chat/test/reply'));assert.equal(options.headers['X-Admin-Api-Key'],'a'.repeat(32));return Response.json({id:1,delivered:false,channel:'telegram'})}}};
  const response=await mutate('reply',request,env,form({sessionId:'test',text:'Ответ'}),session);assert.equal(calls,1);assert.match(response.headers.get('location'),/warning=delivery/);
});

test('explicit localhost chat URL takes priority over an existing remote service binding',async()=>{
  const {DB}=database();const original=globalThis.fetch;let called='';
  globalThis.fetch=async input=>{called=String(input);return Response.json({id:1,delivered:true,channel:'website'})};
  try {
    const response=await mutate('reply',request,{DB,ADMIN_API_SECRET:'a'.repeat(32),CHAT_WORKER_URL:'http://127.0.0.1:8789',CHAT_SERVICE:{fetch(){throw new Error('Remote binding must not be used in local QA')}}},form({sessionId:'localtest',text:'Local reply'}),session);
    assert.equal(called,'http://127.0.0.1:8789/api/internal/chat/localtest/reply');assert.equal(response.status,303);assert.match(response.headers.get('location'),/saved=1/);
  } finally {globalThis.fetch=original}
});
