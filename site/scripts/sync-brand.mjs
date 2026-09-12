import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const source=await readFile(new URL('assets/img/avocado-mark.svg',root),'utf8');
const inner=source.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').trim();
const symbol='<symbol id="i-avocado" viewBox="0 0 64 64">'+inner+'</symbol>';
for(const name of ['index.html','site/src/components/Icons.astro']) {
 const path=new URL(name,root),html=await readFile(path,'utf8');
 if(!/<symbol id="i-avocado"[\s\S]*?<\/symbol>/.test(html))throw new Error('Brand symbol missing: '+name);
 await writeFile(path,html.replace(/<symbol id="i-avocado"[\s\S]*?<\/symbol>/,symbol));
}
await writeFile(new URL('favicon.svg',root),source.replace('<defs>','<rect width="64" height="64" rx="14" fill="#080a09"/><defs>'));
console.log('Brand source synchronized to legacy site, Astro sprite and favicon.');
