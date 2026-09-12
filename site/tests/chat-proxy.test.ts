import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardChat } from '../src/lib/chat-proxy.ts';
const sid = 'a'.repeat(32);
test('chat proxy preserves API payload and isolates credentials', async () => {
  let captured: Request | undefined;
  const request = new Request('https://preview.pages.dev/api/chat/' + sid + '/messages', { method: 'POST', headers: { Origin: 'https://preview.pages.dev', Cookie: 'admin=secret', Authorization: 'secret', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify({ text: 'Тест' }) });
  const result = await forwardChat(request, { CHAT_SERVICE: { async fetch(r: Request) { captured = r; return Response.json({ id: 3, ts: 123, delivered: true }); } } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { id: 3, ts: 123, delivered: true });
  assert.equal(captured?.headers.get('Cookie'), null);
  assert.equal(captured?.headers.get('Authorization'), null);
  assert.equal(captured?.redirect, 'manual');
  assert.equal(captured?.headers.get('CF-Connecting-IP'), '192.0.2.1');
  assert.deepEqual(await captured?.json(), { text: 'Тест' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});
test('chat proxy rejects another origin, invalid path, oversized body and unsupported method', async () => {
  const url = 'https://preview.pages.dev/api/chat/' + sid + '/messages';
  assert.equal((await forwardChat(new Request(url, { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' }), {})).status, 403);
  assert.equal((await forwardChat(new Request('https://preview.pages.dev/api/chat/invalid/messages'), {})).status, 404);
  assert.equal((await forwardChat(new Request(url, { method: 'DELETE' }), {})).status, 405);
  assert.equal((await forwardChat(new Request(url, { method: 'POST', body: 'x'.repeat(16385) }), {})).status, 413);
});
test('chat upstream failure returns retryable 503', async () => {
  const result = await forwardChat(new Request('https://preview.pages.dev/api/chat/' + sid + '/messages'), { CHAT_SERVICE: { async fetch() { throw new Error('offline'); } } });
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'chat_unavailable' });
});
test('chat proxy refuses upstream redirects', async () => {
  const result = await forwardChat(new Request('https://preview.pages.dev/api/chat/' + sid + '/messages'), { CHAT_SERVICE: { async fetch() { return new Response(null, { status: 302, headers: { Location: 'https://unexpected.test/' } }); } } });
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('Location'), null);
});
