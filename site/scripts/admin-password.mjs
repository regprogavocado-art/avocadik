import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = process.env.AVOCADO_ADMIN_PASSWORD;
if (!password || password.length < 16 || password.length > 256) {
  console.error('Set AVOCADO_ADMIN_PASSWORD locally to a unique password of 16–256 characters. Never paste it into chat.');
  process.exitCode = 1;
} else {
  const salt = randomBytes(32);
  const value = 'pbkdf2-sha256$100000$' + salt.toString('hex') + '$' + pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  const output = new URL('../.admin-password-hash', import.meta.url);
  await writeFile(output, value + '\n', { mode: 0o600 });
  console.log('Hash written to site/.admin-password-hash (gitignored). Set ADMIN_PASSWORD_HASH as a Cloudflare Pages secret.');
}
