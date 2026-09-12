import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://avocado.rest',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough', configPath: './wrangler.build.jsonc' }),
  session: false,
  server: { host: '127.0.0.1', port: 4321 },
  security: { checkOrigin: true },
  vite: { build: { sourcemap: false } },
});
