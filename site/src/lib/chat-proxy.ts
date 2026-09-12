export async function forwardChat(request: Request, env: Record<string, any>): Promise<Response> {
  const url = new URL(request.url);
  if (!/^\/api\/chat\/[a-z0-9]{16,64}\/messages$/i.test(url.pathname)) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 16384) return Response.json({ error: 'too_large' }, { status: 413 });
  let body: string | undefined;
  if (request.method === 'POST') {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 16384) return Response.json({ error: 'too_large' }, { status: 413 });
  }
  const target = new URL(env.CHAT_WORKER_URL || 'https://avocado-chat.avocado-chat-worker.workers.dev');
  target.pathname = url.pathname;
  target.search = url.search;
  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
  // The existing Worker allows the canonical site origin. Cookies and browser authorization never cross this boundary.
  headers.set('Origin', 'https://avocado.rest');
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('CF-Connecting-IP', ip);
  try {
    const upstream = new Request(target, { method: request.method, headers, body, redirect: 'manual' });
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
    const result = env.CHAT_SERVICE && !local ? await env.CHAT_SERVICE.fetch(upstream) : await fetch(upstream);
    if (result.status >= 300 && result.status < 400) throw new Error('Unexpected chat redirect');
    return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    console.error('Chat upstream unavailable:', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'chat_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
