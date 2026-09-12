import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
export const prerender = false;
const send: APIRoute = async ({ params, request }) => {
  const key = params.key || '';
  if (!/^(news|uploads)\/[a-zA-Z0-9_./-]+$/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) return new Response('Not found', { status: 404 });
  const bucket = env.NEWS_MEDIA;
  if (!bucket) return new Response('Not found', { status: 404 });
  const object = await bucket.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", ETag: object.httpEtag });
  if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
};
export const GET = send;
export const HEAD = send;
