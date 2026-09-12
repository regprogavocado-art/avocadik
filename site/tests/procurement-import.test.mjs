import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {importProcurement,validateProcurement} from '../scripts/import-procurement.mjs';

const record={slug:'test-item',sourceName:'Internal fixture',sourceUrl:'https://example.test/prices',sourceCheckedAt:'2026-09-12'};
const target={project:'avocado-rest',accountId:'2b6c0762cbec2a24c370c18af84da66b'};
function privateFiles(records,config=target){return async url=>{
 if(url.pathname.endsWith('/output/procurement-sources.json'))return JSON.stringify(records);
 if(url.pathname.endsWith('/worker/.dev.vars.prod'))return 'CLOUDFLARE_API_TOKEN="fake-local-test-credential"';
 if(url.pathname.endsWith('/site/output/release-state.json'))return JSON.stringify(config);
 throw new Error('Unexpected private input path');
};}

test('private importer validates schema before reading credentials or issuing requests',async()=>{
 for(const records of [null,[null],[[]],[record,record],[{...record,slug:'bad-'}],[{...record,sourceName:' '}],[{...record,sourceUrl:'javascript:alert(1)'}],[{...record,sourceUrl:'https://name:password@example.test/'}],[{...record,sourceUrl:'https://example.test/'+ 'a'.repeat(1000)}],[{...record,sourceCheckedAt:'2026-02-30'}]])assert.throws(()=>validateProcurement(records),/Invalid private procurement/);
 let reads=0;
 const result=await importProcurement({validateOnly:true,read:async url=>{reads++;assert.ok(url.pathname.endsWith('/output/procurement-sources.json'));return JSON.stringify([record]);},request:()=>{throw new Error('Dry validation must never access network');}});
 assert.equal(reads,1);assert.deepEqual(result,{validated:1,changed:0});
});

test('private importer targets only empty metadata and preserves operator fields, including a date-only edit',async()=>{
 const db=new DatabaseSync(':memory:');
 try {
  for(const file of ['0001_cms.sql','0004_product_pricing.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const states=[['test-empty','','',''],['test-name','Owner','',''],['test-url','','https://example.test/owner',''],['test-date','','','2026-09-01']];
  for(const [slug,name,url,date] of states)db.prepare("INSERT INTO cms_products(slug,title,category,price,source_name,source_url,source_checked_at,created_at,updated_at) VALUES(?,'Owner title','vps','25.00',?,?,?,1,1)").run(slug,name,url,date);
  const before=db.prepare('SELECT slug,title,price,created_at,updated_at FROM cms_products ORDER BY slug').all();
  const sourceBefore=db.prepare("SELECT * FROM cms_products WHERE slug<>'test-empty' ORDER BY slug").all();
  const records=states.map(([slug])=>({...record,slug}));let requests=0;
  const request=async(url,options)=>{
   requests++;assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/31b29b96-d036-45d1-9143-7233069154e2/query`);
   assert.equal(options.method,'POST');const {sql,params}=JSON.parse(options.body);
   const result=db.prepare(sql).run(...params);return Response.json({success:true,result:[{success:true,meta:{changes:Number(result.changes)}}]});
  };
  assert.deepEqual(await importProcurement({read:privateFiles(records),request}),{validated:4,changed:1});
  assert.deepEqual(db.prepare('SELECT slug,title,price,created_at,updated_at FROM cms_products ORDER BY slug').all(),before);
  assert.deepEqual(db.prepare("SELECT * FROM cms_products WHERE slug<>'test-empty' ORDER BY slug").all(),sourceBefore);
  assert.deepEqual(await importProcurement({read:privateFiles(records),request}),{validated:4,changed:0});
  assert.equal(requests,8);
 } finally {db.close();}
});

test('private importer rejects an unexpected deployment target without any request',async()=>{
 let requests=0;
 await assert.rejects(importProcurement({read:privateFiles([record],{...target,accountId:'different'}),request:()=>{requests++;throw new Error('No request allowed');}}),/Unexpected release target/);
 assert.equal(requests,0);
});
