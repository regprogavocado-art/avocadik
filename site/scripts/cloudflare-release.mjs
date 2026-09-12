import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const action=process.argv[2];
if(!['prepare','migrate','worker','site','webhook'].includes(action))throw new Error('Usage: node scripts/cloudflare-release.mjs prepare|migrate|worker|site|webhook');
const parse=text=>Object.fromEntries(text.split(/\r?\n/).filter(line=>/^\w+=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^["']|["']$/g,'')];}));
const owner=parse(await readFile(resolve(root,'worker/.dev.vars.prod'),'utf8'));
if(!owner.CLOUDFLARE_API_TOKEN)throw new Error('Cloudflare API credential is not configured.');
const secretValues=new Set();
function trackSecrets(values){for(const [key,value] of Object.entries(values))if(/TOKEN|SECRET|PASSWORD|SALT/i.test(key)&&typeof value==='string'&&value.length>=6)secretValues.add(value);}
trackSecrets(owner);
function sanitized(text){let output=String(text).replace(/https?:\/\/[^\s<>"']+/gi,url=>/X-Amz-/i.test(url)?'[redacted signed URL]':url);for(const secret of secretValues)output=output.split(secret).join('[redacted]');return output.replace(/X-Amz-[A-Za-z0-9-]+=[^\s&]+/gi,'[redacted signed parameter]');}
async function api(path,method='GET',body){const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+owner.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok||!data.success){const error=new Error(sanitized((data.errors||[]).map(item=>item.message).join('; ')||'Cloudflare request failed'));error.code=data.errors?.[0]?.code;throw error;}return data.result;}
const accounts=await api('/accounts');
if(accounts.length!==1)throw new Error('Select the intended Cloudflare account explicitly before release.');
const accountId=accounts[0].id;
const account='/accounts/'+accountId;
const childEnv={...process.env,CLOUDFLARE_API_TOKEN:owner.CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID:accountId};
async function run(args,cwd=resolve(root,'site')){
 try{trackSecrets(parse(await readFile(resolve(root,'site/.dev.vars.prod'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
 await new Promise((done,reject)=>{
  const processChild=spawn(process.execPath,args,{cwd,env:childEnv,stdio:['inherit','pipe','pipe']});
  for(const [stream,destination] of [[processChild.stdout,process.stdout],[processChild.stderr,process.stderr]]){
   let pending='';stream.setEncoding('utf8');stream.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines)destination.write(sanitized(line)+'\n');});stream.on('end',()=>{if(pending)destination.write(sanitized(pending));});
  }
  processChild.on('error',()=>reject(new Error('Release command could not be started.')));
  processChild.on('close',code=>code===0?done():reject(new Error('Release command failed ('+code+').')));
 });
}
const wrangler=resolve(root,'site/node_modules/wrangler/bin/wrangler.js');
const output=resolve(root,'site/output');
await mkdir(output,{recursive:true});
function validateSecrets(values){if(!/^pbkdf2-sha256\$100000\$[a-f0-9]{32,128}\$[a-f0-9]{64}$/i.test(values.ADMIN_PASSWORD_HASH||'')||typeof values.SESSION_SECRET!=='string'||values.SESSION_SECRET.length<32||typeof values.ADMIN_API_SECRET!=='string'||values.ADMIN_API_SECRET.length<32)throw new Error('Existing production admin secrets are incomplete or invalid; they were not changed.');trackSecrets(values);return Object.fromEntries(['ADMIN_PASSWORD_HASH','SESSION_SECRET','ADMIN_API_SECRET'].map(key=>[key,values[key]]));}
async function productionSecrets(){const file=resolve(root,'site/.dev.vars.prod');try{return validateSecrets(parse(await readFile(file,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
 const password=randomBytes(24).toString('base64url'),salt=randomBytes(32);
 const values={ADMIN_PASSWORD_HASH:'pbkdf2-sha256$100000$'+salt.toString('hex')+'$'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex'),ADMIN_API_SECRET:randomBytes(32).toString('hex')};
 await writeFile(file,Object.entries(values).map(([key,value])=>key+'="'+value+'"').join('\n')+'\n',{mode:0o600});
 await writeFile(resolve(output,'production-access.json'),JSON.stringify({url:'https://avocado-rest.pages.dev/admin',password},null,2),{mode:0o600});
 return values;
}
async function mediaAvailable(){try{const list=await api(account+'/r2/buckets');return Array.isArray(list.buckets)?list.buckets:list;}catch(error){if(error.code===10042)return null;throw error;}}
async function releaseState(){const state=JSON.parse(await readFile(resolve(output,'release-state.json'),'utf8'));if(state.accountId!==accountId||state.project!=='avocado-rest'||typeof state.mediaReady!=='boolean')throw new Error('Release state does not match this account/project. Run prepare for the intended account first.');return state;}
if(action==='prepare'){
 const secrets=await productionSecrets();
 const buckets=await mediaAvailable();let mediaReady=buckets!==null;
 if(mediaReady&&!buckets.some(bucket=>bucket.name==='avocado-media'))await api(account+'/r2/buckets','POST',{name:'avocado-media'});
 const env_vars={PUBLIC_SITE_URL:{type:'plain_text',value:'https://avocado.rest'},CHAT_WORKER_URL:{type:'plain_text',value:'https://avocado-chat.avocado-chat-worker.workers.dev'},...Object.fromEntries(Object.entries(secrets).map(([key,value])=>[key,{type:'secret_text',value}]))};
 const config={compatibility_date:'2026-09-12',compatibility_flags:['nodejs_compat'],env_vars,d1_databases:{DB:{id:'31b29b96-d036-45d1-9143-7233069154e2'}},services:{CHAT_SERVICE:{service:'avocado-chat',environment:'production'}},r2_buckets:mediaReady?{NEWS_MEDIA:{name:'avocado-media'}}:{}};
 const projects=await api(account+'/pages/projects');let project=projects.find(item=>item.name==='avocado-rest');
 if(!project)project=await api(account+'/pages/projects','POST',{name:'avocado-rest',production_branch:'main',deployment_configs:{production:config,preview:config}});
 else project=await api(account+'/pages/projects/avocado-rest','PATCH',{deployment_configs:{production:config,preview:config}});
 await writeFile(resolve(output,'release-state.json'),JSON.stringify({accountId,project:project.name,url:'https://'+project.subdomain,mediaReady,preparedAt:new Date().toISOString()},null,2));
 let credentialsFile=null;try{const credentials=JSON.parse(await readFile(resolve(output,'production-access.json'),'utf8'));credentials.url='https://'+project.subdomain+'/admin';await writeFile(resolve(output,'production-access.json'),JSON.stringify(credentials,null,2),{mode:0o600});credentialsFile='site/output/production-access.json';}catch(error){if(error.code!=='ENOENT')throw error;}
 console.log(JSON.stringify({project:project.name,url:'https://'+project.subdomain,mediaReady,credentialsFile}));
}else if(action==='migrate'){
 await mkdir(resolve(output,'backups'),{recursive:true});
 const file=resolve(output,'backups','avocado-chat-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql');
 await run([wrangler,'d1','export','avocado-chat','--remote','--config','wrangler.build.jsonc','--output',file]);
 if((await stat(file)).size===0)throw new Error('D1 backup is empty; migrations were not started.');
 await run([wrangler,'d1','migrations','apply','avocado-chat','--remote','--config','wrangler.build.jsonc']);
 console.log('Remote additive CMS migrations applied; backup saved outside Git.');
}else if(action==='worker'){
 const state=await releaseState(),secrets=await productionSecrets();
 await api(account+'/workers/scripts/avocado-chat/secrets','PUT',{name:'ADMIN_API_SECRET',type:'secret_text',text:secrets.ADMIN_API_SECRET});
 const envPath=resolve(root,'worker/.dev.vars.prod');let text=await readFile(envPath,'utf8');text=text.replace(/^ADMIN_API_SECRET=.*\r?\n?/gm,'').trimEnd()+'\nADMIN_API_SECRET='+secrets.ADMIN_API_SECRET+'\n';await writeFile(envPath,text,{mode:0o600});
 const dir=resolve(root,'worker/.wrangler/cms-release');await mkdir(dir,{recursive:true});
 let config=await readFile(resolve(root,'worker/wrangler.toml'),'utf8');
 if(!/^main\s*=\s*["']src\/index\.js["']\s*$/m.test(config)||!/^\[vars\]\s*$/m.test(config))throw new Error('Worker config layout changed; release config was not generated.');
 config=config.replace(/^main\s*=.*$/m,'main = "../../src/index.js"').replace(/^compatibility_date\s*=.*$/m,'compatibility_date = "2026-09-12"');
 const sections=config.split(/(?=^\[)/m).filter(section=>!/^\[\[r2_buckets\]\]/.test(section)||!/^binding\s*=\s*["']NEWS_MEDIA["']\s*$/m.test(section));
 config=sections.map(section=>section.startsWith('[vars]')?'[vars]\nNEWS_CHANNEL_ID = "-1004361494715"\n'+section.slice('[vars]'.length).replace(/^NEWS_CHANNEL_ID\s*=.*\r?\n?/gm,'').trimStart():section).join('');
 if(state.mediaReady)config+='\n[[r2_buckets]]\nbinding = "NEWS_MEDIA"\nbucket_name = "avocado-media"\n';
 const path=resolve(dir,'wrangler.toml');await writeFile(path,config);
 await run([wrangler,'deploy','--config',path,'--keep-vars'],resolve(root,'worker'));
 console.log('Chat worker released with channel allowlist and internal admin reply key.');
}else if(action==='site'){
 const state=await releaseState();
 await run([resolve(root,'site/scripts/check-secrets.mjs')]);
 const dir=resolve(root,'output/pages-release');await mkdir(dir,{recursive:true});
 let config=await readFile(resolve(root,'pages/wrangler.toml'),'utf8');config=config.replace('../site/pages-dist','../../site/pages-dist').replace('../site/migrations','../../site/migrations');
 if(!state.mediaReady)config=config.split(/(?=^\[)/m).filter(section=>!/^\[\[r2_buckets\]\]/.test(section)||!/^binding\s*=\s*["']NEWS_MEDIA["']\s*$/m.test(section)).join('');
 await writeFile(resolve(dir,'wrangler.toml'),config);
 await run([wrangler,'pages','deploy',resolve(root,'site/pages-dist'),'--project-name',state.project,'--branch','main','--commit-dirty=true'],dir);
 console.log('Pages release uploaded: '+state.url);
}else if(action==='webhook'){
 if(!/^[A-Za-z0-9_-]{16,256}$/.test(owner.WEBHOOK_SECRET||''))throw new Error('Webhook secret is missing or invalid; registration was not attempted.');
 if(!owner.TELEGRAM_BOT_TOKEN)throw new Error('Bot token is missing; webhook registration cannot be verified.');
 const response=await fetch('https://avocado-chat.avocado-chat-worker.workers.dev/tg/setup?fresh='+Date.now(),{headers:{'X-Setup-Key':owner.WEBHOOK_SECRET,'Cache-Control':'no-cache',Pragma:'no-cache'},redirect:'manual',signal:AbortSignal.timeout(25000)});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error('Webhook registration failed.');
 const verification=await fetch('https://api.telegram.org/bot'+owner.TELEGRAM_BOT_TOKEN+'/getWebhookInfo',{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(25000)});
 const info=await verification.json(),expectedUpdates=['message','channel_post','edited_channel_post'];
 if(!verification.ok||!info.ok||info.result?.url!=='https://avocado-chat.avocado-chat-worker.workers.dev/tg/webhook'||!expectedUpdates.every(type=>info.result?.allowed_updates?.includes(type)))throw new Error('Webhook readback did not confirm the expected endpoint and channel subscription; repeat setup after deployment propagation.');
 console.log(JSON.stringify({webhookConfigured:true,bot:result.bot,allowedUpdates:expectedUpdates,pendingUpdates:Number(info.result.pending_update_count||0),hasLastError:Boolean(info.result.last_error_message)}));
}else throw new Error('Usage: node scripts/cloudflare-release.mjs prepare|migrate|worker|site|webhook');
