import { readFile, writeFile, mkdir } from 'node:fs/promises';
const vars = Object.fromEntries((await readFile(new URL('../../worker/.dev.vars.prod', import.meta.url),'utf8')).split(/\r?\n/).filter(line=>/^\w+=/.test(line)).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1).trim().replace(/^["']|["']$/g,'')];}));
async function cf(path) { const response = await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+vars.CLOUDFLARE_API_TOKEN}}); const data=await response.json();return {status:response.status,success:data.success,result:data.result,errors:data.errors}; }
async function tg(method,body) {const response=await fetch('https://api.telegram.org/bot'+vars.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json();}
const accounts = await cf('/accounts');
console.log(JSON.stringify({accounts:accounts.success?accounts.result.map(a=>({id:a.id,name:a.name})):accounts.errors}));
const account=accounts.success?accounts.result[0]:null;
if(account){
 const paths=['/accounts/'+account.id+'/pages/projects','/accounts/'+account.id+'/d1/database','/accounts/'+account.id+'/r2/buckets','/zones?name=avocado.rest'];
 const result=await Promise.all(paths.map(cf));
 result.forEach((r,i)=>console.log(JSON.stringify({resource:['pages','d1','r2','zones'][i],status:r.status,result:r.success?(i===2?r.result:r.result.map(x=>({id:x.id,name:x.name,subdomain:x.subdomain,status:x.status}))):r.errors})));
 await mkdir(new URL('../output/',import.meta.url),{recursive:true});
 await writeFile(new URL('../output/provider-resources.json',import.meta.url),JSON.stringify({accountId:account.id,resources:result.map(r=>r.success?r.result:null)},null,2));
}
const [bot,channel]=await Promise.all([tg('getMe',{}),tg('getChat',{chat_id:'@avocadodev'})]);
console.log(JSON.stringify({bot:bot.ok?{id:bot.result.id,username:bot.result.username}:bot.description,channel:channel.ok?{id:channel.result.id,title:channel.result.title,type:channel.result.type,username:channel.result.username}:channel.description}));
if(bot.ok&&channel.ok){const member=await tg('getChatMember',{chat_id:channel.result.id,user_id:bot.result.id});console.log(JSON.stringify({botChannelStatus:member.ok?member.result.status:member.description}));await writeFile(new URL('../output/telegram-channel.json',import.meta.url),JSON.stringify({id:channel.result.id,username:channel.result.username,botStatus:member.ok?member.result.status:'unknown'}));}
