/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type CloudflareRuntime = import('@astrojs/cloudflare').Runtime;
declare namespace App {
  interface Locals extends CloudflareRuntime {}
}
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    NEWS_MEDIA: R2Bucket;
    CHAT_SERVICE: Fetcher;
    CHAT_WORKER_URL: string;
    ADMIN_PASSWORD_HASH: string;
    SESSION_SECRET: string;
    ADMIN_API_SECRET: string;
    PUBLIC_SITE_URL: string;
  }
}
