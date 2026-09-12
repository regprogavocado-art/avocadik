import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { flagCountryCodes } from '../src/lib/hosting.ts';
const root = new URL('../../', import.meta.url);
const target = new URL('../public/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['assets/fonts', 'assets/img']) {
  await cp(new URL(name, root), new URL(name, target), { recursive: true });
}
// Copy only catalog flags; each SVG carries its MIT notice in the exported asset.
await mkdir(new URL('assets/flags/', target), { recursive: true });
for (const code of flagCountryCodes) {
  const name = `assets/flags/${code.toLowerCase()}.svg`;
  await cp(new URL(name, root), new URL(name, target));
}
for (const name of ['css/fonts.css', 'css/chat.css', 'js/chat.js', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
  const destination = new URL(name, target);
  await mkdir(new URL('./', destination), { recursive: true });
  await cp(new URL(name, root), destination);
}
// Only the prepared social image is public; render sources and secrets never enter dist.
try { await cp(new URL('assets/og-minisite.png', root), new URL('assets/og.png', target)); }
catch { try { await cp(new URL('assets/og.png', root), new URL('assets/og.png', target)); } catch {} }
console.log('Synced approved public assets to ' + fileURLToPath(target));
