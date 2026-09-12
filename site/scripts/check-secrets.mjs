import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root=fileURLToPath(new URL('../../',import.meta.url));
const secrets=[];
for(const file of ['worker/.dev.vars.prod','site/.dev.vars','site/.dev.vars.prod']) {
 try {for(const line of (await readFile(resolve(root,file),'utf8')).split(/\r?\n/)){const match=/^([A-Z_]+)=(.*)$/.exec(line);if(match&&/TOKEN|PASSWORD|SECRET|SALT/.test(match[1])){const value=match[2].trim().replace(/^["']|["']$/g,'');if(value.length>=12)secrets.push(value);}}}catch{}
}
for(const file of ['site/output/local-access.json','site/output/production-access.json']) {
 try { const value=JSON.parse(await readFile(resolve(root,file),'utf8')).password;if(typeof value==='string'&&value.length>=12)secrets.push(value); } catch {}
}
async function walk(dir){const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}
if(process.argv.includes('--git')) {
 const run=promisify(execFile);
 const {stdout}=await run('git',['ls-files','--cached','-z'],{cwd:root,maxBuffer:16*1024*1024});
 const paths=stdout.split('\0').filter(Boolean);
 for(const file of paths){const {stdout:bytes}=await run('git',['show',':'+file],{cwd:root,encoding:'buffer',maxBuffer:64*1024*1024});if(secrets.some(secret=>bytes.includes(Buffer.from(secret))))throw new Error('Known credential found in Git index: '+file);}
 console.log('Git index secret scan passed: '+paths.length+' files checked.');
 process.exit(0);
}
const files=await walk(resolve(root,'site/pages-dist'));
for(const file of files){const bytes=await readFile(file);if(secrets.some(secret=>bytes.includes(Buffer.from(secret))))throw new Error('Credential found in build artifact: '+relative(root,file));if(/(?:^|[\\/])(?:\.dev\.vars|\.env|secrets\.json)/.test(file))throw new Error('Private file in build');}
console.log('Build secret scan passed: '+files.length+' files checked, no known credentials.');
