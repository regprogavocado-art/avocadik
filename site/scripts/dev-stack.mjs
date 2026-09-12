/** One local workerd owns both Workers and their shared D1/R2 bindings.
 * Uses only local secrets and a fake Telegram API; never uses provider credentials.
 * Run npm run build first, keep the Telegram mock listening on 127.0.0.1:8099.
 */
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {readFile,readdir,mkdir,writeFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'../output/qa-stack');
const localSecrets={};let runtime;
async function modulesIn(directory,entry) {
  const modules=[];
  async function visit(folder) {for(const item of await readdir(folder,{withFileTypes:true})) {const filename=resolve(folder,item.name);if(item.isDirectory())await visit(filename);else if(/\.(?:mjs|js)$/.test(item.name))modules.push({type:'ESModule',path:filename,contents:await readFile(filename,'utf8')});}}
  await visit(directory);return modules.sort((a,b)=>a.path===resolve(directory,entry)?-1:b.path===resolve(directory,entry)?1:0);
}
try {
  const source=await readFile(resolve(root,'.dev.vars'),'utf8');
  for(const line of source.split(/\r?\n/)) {const match=/^([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/.exec(line.trim());if(match)localSecrets[match[1]]=match[2]??match[3]??match[4];}
  for(const key of ['ADMIN_PASSWORD_HASH','SESSION_SECRET','ADMIN_API_SECRET'])if(!localSecrets[key])throw new Error(`Missing local ${key}; run the local-setup helper first.`);
  const siteName='avocado-site-qa',chatName='avocado-chat-qa';
  const shared={modules:true,compatibilityDate:'2026-09-12',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'avocado-qa-shared'},r2Buckets:{NEWS_MEDIA:'avocado-qa-media'}};
  const appRoot=resolve(root,'pages-dist/_worker.js'),chatRoot=resolve(root,'../worker/src');
  const appModules=await modulesIn(appRoot,'entry.mjs'),chatModules=await modulesIn(chatRoot,'index.js');
  await mkdir(output,{recursive:true});
  // Asset watchers must not hold dist/client open while Astro rebuilds on Windows.
  const assetSnapshot=resolve(output,'assets');
  await cp(resolve(root,'dist/client'),assetSnapshot,{recursive:true,force:true});
  const options=convertV4MiniflareOptions({
    host:'127.0.0.1',port:4322,log:new Log(LogLevel.ERROR),
    workers:[
      {...shared,name:siteName,modules:appModules,modulesRoot:appRoot,
        assets:{directory:assetSnapshot,binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
        serviceBindings:{CHAT_SERVICE:chatName},
        bindings:{ADMIN_PASSWORD_HASH:localSecrets.ADMIN_PASSWORD_HASH,SESSION_SECRET:localSecrets.SESSION_SECRET,ADMIN_API_SECRET:localSecrets.ADMIN_API_SECRET,CHAT_WORKER_URL:'https://local-chat.invalid',PUBLIC_SITE_URL:'http://127.0.0.1:4322',PUBLIC_PUBLISH_MODE:'github'}},
      {...shared,name:chatName,modules:chatModules,modulesRoot:chatRoot,unsafeDirectSockets:[{host:'127.0.0.1',port:4331}],
        bindings:{ALLOWED_ORIGINS:'https://avocado.rest,http://127.0.0.1:4322',TELEGRAM_API_BASE:'http://127.0.0.1:8099',TELEGRAM_BOT_TOKEN:'fake-test-token',ADMIN_CHAT_ID:'777',WEBHOOK_SECRET:'localsecret-0123456789abcdef',ADMIN_API_SECRET:localSecrets.ADMIN_API_SECRET,IP_SALT:'local-test-ip-salt',NEWS_CHANNEL_ID:'-1001234567890'}}
    ]
  });
  options.resourcePersistencePath=resolve(output,'state');
  runtime=new Miniflare(options);
  await runtime.ready;
  const db=await runtime.getD1Database('DB',siteName);
  await db.prepare('CREATE TABLE IF NOT EXISTS qa_migrations(name TEXT PRIMARY KEY)').run();
  for(const name of (await readdir(resolve(root,'migrations'))).filter(name=>name.endsWith('.sql')).sort()) {
    if(await db.prepare('SELECT name FROM qa_migrations WHERE name=?').bind(name).first())continue;
    const sql=await readFile(resolve(root,'migrations',name),'utf8');
    const statements=sql.split(/;\s*(?:\r?\n|$)/).map(statement=>statement.trim()).filter(Boolean);
    await db.batch(statements.map(statement=>db.prepare(statement)));
    await db.prepare('INSERT INTO qa_migrations(name) VALUES(?)').bind(name).run();
  }
  const config={site:'http://127.0.0.1:4322',chat:'http://127.0.0.1:4331',mock:'http://127.0.0.1:8099',state:resolve(output,'state')};
  await writeFile(resolve(output,'endpoints.json'),JSON.stringify(config,null,2));
  console.log(`Local stack ready: site ${config.site}, fake chat ${config.chat}. One shared D1/R2 runtime.`);
  const close=async()=>{await runtime?.dispose();process.exit(0)};
  process.on('SIGINT',close);process.on('SIGTERM',close);
} catch(error) {
  try {await runtime?.dispose()}catch{}
  let safe=String(error?.stack||error);
  for(const value of Object.values(localSecrets))if(value?.length>=8)safe=safe.replaceAll(value,'[REDACTED]');
  console.error(safe);process.exitCode=1;
}
