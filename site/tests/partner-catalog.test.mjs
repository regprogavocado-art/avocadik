import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {seedPages, mapProduct, publicProduct} from '../src/lib/content.ts';

const migration=readFileSync(new URL('../migrations/0005_partner_catalog.sql',import.meta.url),'utf8');
function initialDatabase(){
  const db=new DatabaseSync(':memory:');
  for(const file of ['0001_cms.sql','0002_seed.sql','0003_chat_baseline.sql','0004_product_pricing.sql'])
    db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  return db;
}
const products=db=>db.prepare("SELECT * FROM cms_products WHERE price<>'' ORDER BY slug").all();

test('Avocado catalog carries indicative prices without procurement identities in the public migration',()=>{
  const db=initialDatabase();try {
    db.exec(migration);
    const rows=products(db);
    assert.equal(rows.length,31);
    assert.deepEqual(Object.fromEntries(db.prepare("SELECT category,COUNT(*) AS n FROM cms_products WHERE price<>'' GROUP BY category ORDER BY category").all().map(r=>[r.category,r.n])),{dedicated:6,domains:8,proxies:5,vps:12});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cms_products').get().n,36);
    const knownCountries=new Set(db.prepare('SELECT code FROM cms_countries').all().map(r=>r.code));
    assert.equal(knownCountries.size,17);
    for(const row of rows){
      assert.match(row.price,/^(0|[1-9]\d*)\.\d{2}$/);
      assert.ok(Number(row.price)>0);
      assert.ok(['USD','EUR'].includes(row.price_currency));
      assert.equal(row.availability,'on_request');
      assert.equal(row.status,'published');
      assert.equal(row.source_name,'');
      assert.equal(row.source_url,'');
      assert.equal(row.source_checked_at,'');
      assert.match(row.price_note,/Ориентировочная цена/);
      assert.equal(row.price_period,row.category==='domains'?'year':row.category==='proxies'?'30_days':'month');
      for(const code of JSON.parse(row.country_codes)){assert.match(code,/^[A-Z]{2}$/);assert.ok(knownCountries.has(code),`${row.slug}: ${code}`);}
      const mapped=mapProduct(row);
      assert.equal(mapped.pricePeriod,row.price_period);
      assert.equal(mapped.sourceCheckedAt,row.source_checked_at);
      const publicCopy=publicProduct(mapped);
      assert.equal(publicCopy.sourceName,undefined);
      assert.equal(publicCopy.sourceUrl,undefined);
      assert.equal(publicCopy.sourceCheckedAt,undefined);
      assert.doesNotMatch(JSON.stringify(publicCopy),/sourceName|sourceUrl|sourceCheckedAt|партн[её]р|источник/i);
    }
    assert.equal(db.prepare("SELECT price FROM cms_products WHERE slug='fi-vps-1'").get().price,'5.00');
    assert.equal(db.prepare("SELECT price FROM cms_products WHERE slug='se-dedicated-32'").get().price,'100.00');
    assert.equal(db.prepare("SELECT price FROM cms_products WHERE slug='is-vps-1'").get().price,'8.72');
    assert.ok(rows.filter(r=>['vps-start-5','vps-highload-12','dedicated-i7-7700'].includes(r.slug)).every(r=>r.country_codes==='[]'));
    assert.equal(rows.find(r=>r.slug==='dedicated-performance-64').country_codes,'[]');
    assert.equal(rows.find(r=>r.slug==='nl-vps-4').country_codes,'["NL"]');
    for(const row of rows.filter(r=>r.slug.startsWith('ch-dedicated-'))){assert.match(row.price_note,/от 3 месяцев/);assert.match(row.body,/Минимальный срок — 3 месяца/);}
  } finally {db.close();}
});

test('domain examples and proxy per-IP prices cannot be mistaken for confirmed quotes or package totals',()=>{
  const db=initialDatabase();try {
    db.exec(migration);
    for(const row of products(db).filter(r=>r.category==='domains')){
      assert.equal(row.country_codes,'[]');
      assert.match(row.price_note,/Ориентировочная цена/);
      assert.match(row.price_note,/первый год/);
      assert.match(row.body,/предварительного расчёта/);
      assert.match(row.body,/Продление — по запросу/);
      assert.match(row.body,/точную сумму регистрации и продления/);
      assert.equal(row.source_name,'');
    }
    for(const row of products(db).filter(r=>r.category==='proxies')){
      assert.match(row.price_note,/за 1 IP/);
      assert.match(row.body,/на 30 дней/);
      assert.match(row.body,/Совместимость страны с типом прокси/);
    }
    const bulk=db.prepare("SELECT * FROM cms_products WHERE slug='ipv4-bulk'").get();
    assert.equal(bulk.price,'1.50');
    assert.match(bulk.price_note,/от 90 IP/);
    assert.match(bulk.body,/90 IP — 135.00 USD/);
  } finally {db.close();}
});

test('migration preserves existing editor content, draft decisions, generic URLs and private settings',()=>{
  const db=initialDatabase();try {
    db.prepare("UPDATE cms_pages SET title='Редакторский заголовок',body='Текст владельца' WHERE slug='home'").run();
    db.prepare("UPDATE cms_pages SET status='draft' WHERE slug='hass'").run();
    db.prepare("UPDATE cms_settings SET value='private-owner-value' WHERE key='wallets'").run();
    db.exec("INSERT INTO cms_countries(code,name,status,created_at,updated_at) VALUES('FI','Название владельца','draft',1,1)");
    db.exec("INSERT INTO cms_products(slug,title,category,price,status,availability,created_at,updated_at) VALUES('fi-vps-1','Товар владельца','vps','99.00','draft','soon',1,1)");
    db.exec("INSERT INTO cms_pages(slug,title,body,status,created_at,updated_at) VALUES('software','Раздел владельца','Свой текст','draft',1,1)");
    const generic=db.prepare("SELECT * FROM cms_products WHERE slug IN ('domains','vps','dedicated','bulletproof','proxies') ORDER BY slug").all();
    db.exec(migration);
    assert.equal(db.prepare("SELECT title FROM cms_pages WHERE slug='home'").get().title,'Редакторский заголовок');
    assert.equal(db.prepare("SELECT status FROM cms_pages WHERE slug='hass'").get().status,'draft');
    assert.equal(db.prepare("SELECT title FROM cms_pages WHERE slug='software'").get().title,'Раздел владельца');
    assert.equal(db.prepare("SELECT name FROM cms_countries WHERE code='FI'").get().name,'Название владельца');
    assert.equal(db.prepare("SELECT status FROM cms_countries WHERE code='FI'").get().status,'draft');
    assert.equal(db.prepare("SELECT price FROM cms_products WHERE slug='fi-vps-1'").get().price,'99.00');
    assert.equal(db.prepare("SELECT status FROM cms_products WHERE slug='fi-vps-1'").get().status,'draft');
    assert.equal(db.prepare("SELECT value FROM cms_settings WHERE key='wallets'").get().value,'private-owner-value');
    assert.deepEqual(db.prepare("SELECT * FROM cms_products WHERE slug IN ('domains','vps','dedicated','bulletproof','proxies') ORDER BY slug").all(),generic);
    const before=db.prepare('SELECT * FROM cms_products ORDER BY id').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM cms_products ORDER BY id').all(),before);
  } finally {db.close();}
});

test('untouched public pages migrate to the same software-first copy as the no-DB fallback',()=>{
  const db=initialDatabase();try {
    db.exec(migration);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cms_pages').get().n,15);
    for(const page of seedPages){
      const saved=db.prepare('SELECT title,summary,body,status FROM cms_pages WHERE slug=?').get(page.slug);
      assert.ok(saved,page.slug);
      for(const key of ['title','summary','body','status'])assert.equal(saved[key].replaceAll('\r',''),page[key].replaceAll('\r',''),`${page.slug}.${key}`);
      assert.doesNotMatch(JSON.stringify(saved),/sourceName|sourceUrl|sourceCheckedAt|партн[её]р|источник/i);
    }
    const home=db.prepare("SELECT * FROM cms_pages WHERE slug='home'").get();
    assert.equal(home.title,'Разрабатываем ПО. Защищаем ваши возможности.');
    const ettinger=db.prepare("SELECT * FROM cms_pages WHERE slug='ettinger'").get();
    assert.match(ettinger.body,/наш программный продукт/);
    assert.match(ettinger.body,/дополнительные услуги Avocado/);
  } finally {db.close();}
});

test('private procurement data remains available to admin mapping and absent from public output',()=>{
  const db=initialDatabase();try {
    db.exec(migration);
    const row=products(db)[0];
    const admin=mapProduct({...row,source_name:'Internal supplier',source_url:'https://example.test/procurement',source_checked_at:'2026-09-12'});
    assert.equal(admin.sourceName,'Internal supplier');
    assert.equal(admin.sourceUrl,'https://example.test/procurement');
    assert.equal(admin.sourceCheckedAt,'2026-09-12');
    const publicCopy=publicProduct(admin);
    assert.doesNotMatch(JSON.stringify(publicCopy),/Internal supplier|example\.test|sourceName|sourceUrl|sourceCheckedAt/);
    const ignored=readFileSync(new URL('../../.gitignore',import.meta.url),'utf8');
    assert.match(ignored,/(?:^|\n)output\/\r?(?:\n|$)/);
    assert.doesNotMatch(migration,/https?:\/\//);
  } finally {db.close();}
});
