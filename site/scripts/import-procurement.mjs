// Optional internal procurement metadata. The input lives outside Git and public assets.
// Run after additive D1 migrations; existing administrator sources are preserved.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeSourceUrl,validSourceDate} from '../src/lib/content.ts';
const root=new URL('../../',import.meta.url);
export const procurementSql="UPDATE cms_products SET source_name=?,source_url=?,source_checked_at=? WHERE slug=? AND source_name='' AND source_url='' AND source_checked_at=''";

export function validateProcurement(records){
 if(!Array.isArray(records)||records.length>1000)throw new Error('Invalid private procurement input.');
 const slugs=new Set();
 for(const record of records){
  if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.slug!=='string'||record.slug.length>80||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug)||slugs.has(record.slug)||typeof record.sourceName!=='string'||!record.sourceName.trim()||record.sourceName.length>100||typeof record.sourceUrl!=='string'||record.sourceUrl.length>1000||!safeSourceUrl(record.sourceUrl)||typeof record.sourceCheckedAt!=='string'||!validSourceDate(record.sourceCheckedAt))throw new Error('Invalid private procurement record.');
  slugs.add(record.slug);
 }
 return records;
}

export async function importProcurement({read=readFile,request=fetch,validateOnly=false}={}){
 let input;
 try{input=JSON.parse(await read(new URL('output/procurement-sources.json',root),'utf8'));}catch{throw new Error('Private procurement input is unavailable or malformed.');}
 const records=validateProcurement(input);
 if(validateOnly)return {validated:records.length,changed:0};
 const variables=await read(new URL('worker/.dev.vars.prod',root),'utf8');
 const line=variables.split(/\r?\n/).find(line=>line.startsWith('CLOUDFLARE_API_TOKEN='));
 if(!line)throw new Error('Cloudflare credential is not configured.');
 const token=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
 if(!token)throw new Error('Cloudflare credential is not configured.');
 const config=JSON.parse(await read(new URL('site/output/release-state.json',root),'utf8'));
 if(config.project!=='avocado-rest'||config.accountId!=='2b6c0762cbec2a24c370c18af84da66b')throw new Error('Unexpected release target.');
 const endpoint=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/31b29b96-d036-45d1-9143-7233069154e2/query`;
 let changed=0;
 for(const record of records){
  const response=await request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:procurementSql,params:[record.sourceName,record.sourceUrl,record.sourceCheckedAt,record.slug]}),signal:AbortSignal.timeout(25000)});
  const data=await response.json();
  if(!response.ok||!data.success||data.result?.[0]?.success===false)throw new Error('Private procurement import failed. It can be retried without replacing existing sources. HTTP '+response.status);
  changed+=data.result?.[0]?.meta?.changes||0;
 }
 return {validated:records.length,changed};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await importProcurement({validateOnly:process.argv.includes('--validate-only')});
 console.log(`Private procurement records validated: ${result.validated}; imported: ${result.changed}. Existing sources preserved.`);
}
