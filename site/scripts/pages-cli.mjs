import { spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const cwd = fileURLToPath(new URL('../../pages/', import.meta.url));
if (args[0] === 'dev') {
  try { await cp(new URL('../.dev.vars', import.meta.url), new URL('../../pages/.dev.vars', import.meta.url)); } catch {}
  if (!args.some(arg => arg.startsWith('--service'))) args.push('--service', 'CHAT_SERVICE=avocado-chat-localqa');
}
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'pages', ...args], { cwd, stdio:'inherit', env:process.env });
child.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
