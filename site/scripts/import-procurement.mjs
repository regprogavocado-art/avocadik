// Optional internal procurement metadata. The input lives outside Git and public assets.
// Run after additive D1 migrations; existing administrator sources are preserved.
import {readFile} from 'node:fs/promises';
import {safeSourceUrl,validSourceDate} from '../src/lib/content.ts';
const root=new URL('../../',import.meta.url);
const records=JSON.parse(await readFile(new URL('output/procurement-sources.json',root),'utf8'));
if(!Array.isArray(records)||records.length>1000)throw new Error('Invalid private procurement input.');
const slugs=new Set();
for(const record of records){
 if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.slug)||slugs.has(record.slug)||typeof record.sourceName!=='string'||record.sourceName.length>100||!safeSourceUrl(record.sourceUrl)||!validSourceDate(record.sourceCheckedAt))throw new Error('Invalid private procurement record.');
 slugs.add(record.slug);
}
const variables=await readFile(new URL('worker/.dev.vars.prod',root),'utf8');
const line=variables.split(/\r?\n/).find(line=>line.startsWith('CLOUDFLARE_API_TOKEN='));
if(!line)throw new Error('Cloudflare credential is not configured.');
const token=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const config=JSON.parse(await readFile(new URL('site/output/release-state.json',root),'utf8'));
if(config.project!=='avocado-rest'||config.accountId!=='2b6c0762cbec2a24c370c18af84da66b')throw new Error('Unexpected release target.');
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/31b29b96-d036-45d1-9143-7233069154e2/query`;
let changed=0;
for(const record of records){
 const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:"UPDATE cms_products SET source_name=?,source_url=?,source_checked_at=? WHERE slug=? AND source_name='' AND source_url=''",params:[record.sourceName,record.sourceUrl,record.sourceCheckedAt,record.slug]}),signal:AbortSignal.timeout(25000)});
 const data=await response.json();
 if(!response.ok||!data.success)throw new Error('Private procurement import failed; existing entries were preserved. HTTP '+response.status);
 changed+=data.result?.[0]?.meta?.changes||0;
}
console.log(`Private procurement sources imported: ${changed}; input records: ${records.length}. Existing sources preserved.`);
