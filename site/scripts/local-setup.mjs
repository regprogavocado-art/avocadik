import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
const envPath = new URL('../.dev.vars', import.meta.url);
try { await access(envPath); console.log('Existing site/.dev.vars preserved.'); process.exit(0); } catch {}
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(32);
const hash = 'pbkdf2-sha256$100000$' + salt.toString('hex') + '$' + pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
const internalSecret = randomBytes(32).toString('hex');
await writeFile(envPath, [
 'ADMIN_PASSWORD_HASH="'+hash+'"',
 'SESSION_SECRET="'+sessionSecret+'"',
 'ADMIN_API_SECRET="'+internalSecret+'"',
 'CHAT_WORKER_URL="https://local-chat.invalid"',
 'PUBLIC_SITE_URL="http://127.0.0.1:4321"'
].join('\n')+'\n', { mode: 0o600 });
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/local-access.json', import.meta.url), JSON.stringify({ url: 'http://127.0.0.1:4321/admin', password }, null, 2), { mode: 0o600 });
console.log('Local CMS credentials created in gitignored site/output/local-access.json. Production secrets are separate.');
