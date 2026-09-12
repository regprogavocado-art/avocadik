import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const server = resolve(siteRoot, 'dist/server');
const client = resolve(siteRoot, 'dist/client');
const output = resolve(siteRoot, 'pages-dist');
// Never remove a path outside the fixed build artifact directory.
if (relative(siteRoot, output) !== 'pages-dist') throw new Error('Unsafe Pages output path');
const built = JSON.parse(await readFile(resolve(server, 'wrangler.json'), 'utf8'));
if (built.main !== 'entry.mjs') throw new Error('Adapter output changed. Review Pages compatibility before deployment.');
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, '_worker.js'), { recursive: true });
await cp(client, output, { recursive: true });
for (const entry of await readdir(server, { withFileTypes: true })) {
  if (entry.name === 'wrangler.json' || entry.name.startsWith('.')) continue;
  await cp(resolve(server, entry.name), resolve(output, '_worker.js', entry.name), {
    recursive: true,
    filter: path => !basename(path).startsWith('.') && basename(path) !== 'wrangler.json',
  });
}
await writeFile(resolve(output, '_worker.js/index.js'), "export { default } from './entry.mjs';\n");
await writeFile(resolve(output, '_routes.json'), JSON.stringify({version:1,include:['/*'],exclude:['/_astro/*','/assets/*','/css/*','/js/*','/favicon.ico','/favicon.svg','/apple-touch-icon.png']}));
console.log('Prepared Cloudflare Pages advanced-mode artifact at site/pages-dist.');
