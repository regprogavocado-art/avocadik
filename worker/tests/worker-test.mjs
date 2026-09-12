import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { allowedNewsChannel, ensureNewsSchema, NEWS_SCHEMA } from '../src/news.js';
import { memoryD1 } from './helpers/d1.mjs';

const HOOK_SECRET = 'test-webhook-secret-0123456789';
const ADMIN_SECRET = 'test-admin-api-secret-at-least-32-characters';
const CHANNEL = -1001234567890;
const fakeJpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217]);

function fixture(t) {
  const env = {
    DB: memoryD1(), ALLOWED_ORIGINS: 'https://avocado.rest,http://localhost:8000',
    TELEGRAM_BOT_TOKEN: 'fake-test-token', ADMIN_CHAT_ID: '777', WEBHOOK_SECRET: HOOK_SECRET,
    ADMIN_API_SECRET: ADMIN_SECRET, NEWS_CHANNEL_ID: String(CHANNEL), IP_SALT: 'fake-test-salt',
    TELEGRAM_API_BASE: 'http://127.0.0.1:8099'
  };
  const outgoing = [], media = new Map();
  let nextId = 100;
  env.NEWS_MEDIA = {
    async put(key, value, options) { media.set(key, { bytes: new Uint8Array(value), options }); return { key }; }
  };
  const originalFetch = globalThis.fetch;
  const state = { filePath: 'photos/test.jpg', photo: fakeJpeg, getFileFailure: false, sendFailure: false };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://127.0.0.1:8099', 'test must never contact a real Telegram API');
    if (url.pathname.startsWith('/file/')) {
      assert.equal(init.redirect, 'manual');
      if (state.photoRedirect) return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/image.jpg' } });
      return new Response(state.photo, { headers: { 'content-type': 'image/jpeg' } });
    }
    const method = url.pathname.split('/').at(-1), payload = JSON.parse(init.body);
    let result = true;
    if (method === 'getFile') {
      if (state.getFileFailure) return Response.json({ ok: false, error_code: state.getFileErrorCode || 503, description: 'mock unavailable' }, { status: state.getFileErrorCode || 503 });
      result = { file_path: state.filePath, file_size: state.fileSize ?? state.photo.length };
    }
    if (method === 'sendMessage') {
      if (state.sendFailure) return Response.json({ ok: false, description: 'mock blocked' }, { status: 403 });
      result = { message_id: nextId++, chat: { id: payload.chat_id }, text: payload.text };
    }
    if (method === 'getMe') result = { username: 'mock_bot' };
    outgoing.push({ method, payload, result });
    return Response.json({ ok: true, result });
  };
  t.after(() => { globalThis.fetch = originalFetch; env.DB.sqlite.close(); });
  const fetchWorker = (path, options = {}) => worker.fetch(new Request(`https://worker.example${path}`, options), env, { waitUntil() {} });
  const webhook = (update, secret = HOOK_SECRET) => fetchWorker('/tg/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update)
  });
  const channelPost = (overrides = {}) => ({ message_id: 14, date: 1789000000, chat: { id: CHANNEL, username: 'avocado_news', type: 'channel' }, text: 'Новый VPS\nДоступен по запросу.', ...overrides });
  const adminReply = (sid, text, key = ADMIN_SECRET) => fetchWorker(`/api/internal/chat/${sid}/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Api-Key': key, Origin: 'https://avocado.rest' }, body: JSON.stringify({ text })
  });
  const cron = async () => {
    const pending = [];
    await worker.scheduled({}, env, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);
  };
  return { env, state, media, outgoing, fetchWorker, webhook, channelPost, adminReply, cron };
}

test('channel allowlist is opt-in, strict, and accepts a configured public username', () => {
  const chat = { id: CHANNEL, type: 'channel', username: 'avocado_news' };
  assert.equal(allowedNewsChannel(chat, ''), false);
  assert.equal(allowedNewsChannel(chat, '@AVOCADO_NEWS'), true);
  assert.equal(allowedNewsChannel(chat, 'avocado_news'), true);
  assert.equal(allowedNewsChannel(chat, String(CHANNEL)), true);
  assert.equal(allowedNewsChannel(chat, 'https://t.me/avocado_news'), false);
  assert.equal(allowedNewsChannel({ ...chat, type: 'private' }, '@avocado_news'), false);
  assert.equal(allowedNewsChannel({ ...chat, id: 77 }, '@avocado_news'), false);
});

test('webhook rejects a wrong secret; disabled and foreign channels never touch D1 or Telegram', async (t) => {
  const f = fixture(t);
  assert.equal((await f.webhook({ channel_post: f.channelPost() }, 'wrong')).status, 403);
  f.env.NEWS_CHANNEL_ID = '';
  assert.equal((await f.webhook({ channel_post: f.channelPost() })).status, 200);
  f.env.NEWS_CHANNEL_ID = '-1009999999999';
  await f.webhook({ channel_post: f.channelPost() });
  assert.equal(f.env.DB.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='news'").get().n, 0);
  assert.equal(f.outgoing.length, 0);
});

test('channel news is plain text, deduplicated, editable, and preserves moderation', async (t) => {
  const f = fixture(t), post = f.channelPost({ text: '<script>alert(1)</script>\nНовая услуга' });
  for (let i = 0; i < 2; i++) assert.equal((await f.webhook({ channel_post: post })).status, 200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) AS n FROM news').get().n, 1);
  let row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(row.body, post.text);
  assert.equal(row.source_url, 'https://t.me/avocado_news/14');
  assert.equal(row.published_at, post.date * 1000);
  f.env.DB.sqlite.prepare('UPDATE news SET hidden=1,pinned=1').run();
  const edited = { ...post, text: 'Изменённый пост', edit_date: post.date + 10 };
  await f.webhook({ edited_channel_post: edited });
  row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(row.body, edited.text);
  assert.equal(row.hidden, 1); assert.equal(row.pinned, 1);
  await f.webhook({ channel_post: post });
  assert.equal(f.env.DB.sqlite.prepare('SELECT body FROM news').get().body, edited.text, 'an older retry cannot undo an edit');
  f.env.DB.sqlite.prepare("UPDATE news SET manual_override=1,title='Редакция',body='Правка владельца'").run();
  await f.webhook({ edited_channel_post: { ...edited, text: 'Ещё правка из Telegram', edit_date: post.date + 20 } });
  row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(row.body, 'Правка владельца'); assert.equal(row.title, 'Редакция');
  assert.equal(row.source_updated_at, (post.date + 20) * 1000);
  assert.equal(f.outgoing.length, 0, 'channel import must not send chat messages');
});

test('photo goes into private R2 with a token-free content key; a duplicate avoids download', async (t) => {
  const f = fixture(t), post = f.channelPost({ photo: [{ file_id: 'small', width: 20, height: 20 }, { file_id: 'large', width: 100, height: 100 }] });
  assert.equal((await f.webhook({ channel_post: post })).status, 200);
  const row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.match(row.media_key, /^news\/telegram\/1001234567890\/14\/[0-9a-f]{24}\.jpg$/);
  assert.equal(row.media_file_id, 'large'); assert.equal(f.media.size, 1);
  assert.equal(f.media.get(row.media_key).options.httpMetadata.contentType, 'image/jpeg');
  await f.webhook({ channel_post: post });
  assert.equal(f.outgoing.filter((entry) => entry.method === 'getFile').length, 1);
  f.env.DB.sqlite.prepare('UPDATE news SET manual_override=1').run();
  await f.webhook({ edited_channel_post: { ...post, photo: [{ file_id: 'replacement', width: 200, height: 200 }], edit_date: post.date + 10 } });
  assert.equal(f.outgoing.filter((entry) => entry.method === 'getFile').length, 1, 'manual media override is preserved');
});

test('Telegram photo redirects are rejected without following them or storing media', async (t) => {
  const f = fixture(t);
  f.state.photoRedirect = true;
  const response = await f.webhook({ channel_post: f.channelPost({ photo: [{ file_id: 'redirected' }] }) });
  assert.equal(response.status, 200);
  const row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(row.media_key, ''); assert.equal(row.media_file_id, '');
  assert.equal(f.media.size, 0);
});

test('without R2 the original file id is preserved and the enabled cron restores it without another post', async (t) => {
  const f = fixture(t), bucket = f.env.NEWS_MEDIA;
  delete f.env.NEWS_MEDIA;
  const post = f.channelPost({ photo: [{ file_id: 'pending-original', width: 100, height: 100 }] });
  assert.equal((await f.webhook({ channel_post: post })).status, 200);
  const before = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(before.media_key, ''); assert.equal(before.media_file_id, 'pending-original');
  await f.cron();
  assert.equal(f.outgoing.length, 0, 'disabled R2 does not call Telegram');
  f.env.NEWS_MEDIA = bucket;
  await f.cron();
  const after = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.match(after.media_key, /\.jpg$/);
  assert.deepEqual({ ...after, media_key: '' }, { ...before }, 'backfill changes only the media key');
  assert.equal(f.media.size, 1);
  assert.equal(f.outgoing.filter((entry) => entry.method !== 'getFile').length, 0, 'news backfill never sends messages');
  await f.cron();
  assert.equal(f.outgoing.length, 1, 'already restored images are not downloaded again');
});

test('a replacement while R2 is absent queues the latest photo instead of showing the old one', async (t) => {
  const f = fixture(t), bucket = f.env.NEWS_MEDIA;
  const post = f.channelPost({ photo: [{ file_id: 'original' }] });
  await f.webhook({ channel_post: post });
  delete f.env.NEWS_MEDIA;
  await f.webhook({ edited_channel_post: { ...post, edit_date: post.date + 10, photo: [{ file_id: 'replacement' }] } });
  let row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(row.media_key, ''); assert.equal(row.media_file_id, 'replacement');
  f.env.NEWS_MEDIA = bucket;
  await f.cron();
  row = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.match(row.media_key, /\.jpg$/);
  assert.equal(f.outgoing.at(-1).payload.file_id, 'replacement');
});

test('backfill retries transient failures but removes permanently invalid photos from the queue', async (t) => {
  const f = fixture(t), bucket = f.env.NEWS_MEDIA;
  delete f.env.NEWS_MEDIA;
  await f.webhook({ channel_post: f.channelPost({ photo: [{ file_id: 'pending' }] }) });
  f.env.NEWS_MEDIA = bucket;
  f.state.getFileFailure = true;
  await f.cron();
  assert.equal(f.env.DB.sqlite.prepare('SELECT media_file_id FROM news').get().media_file_id, 'pending');
  f.state.getFileFailure = false;
  const put = bucket.put;
  bucket.put = async () => { throw new Error('mock R2 outage'); };
  await f.cron();
  assert.equal(f.env.DB.sqlite.prepare('SELECT media_file_id FROM news').get().media_file_id, 'pending');
  bucket.put = put;
  f.state.getFileFailure = true; f.state.getFileErrorCode = 400;
  await f.cron();
  assert.equal(f.env.DB.sqlite.prepare('SELECT media_file_id FROM news').get().media_file_id, '');
  const count = f.outgoing.length;
  await f.cron();
  assert.equal(f.outgoing.length, count, 'invalid file no longer triggers retries');
});

test('backfill preserves manual overrides including edits made while a photo is downloading', async (t) => {
  const f = fixture(t), bucket = f.env.NEWS_MEDIA;
  delete f.env.NEWS_MEDIA;
  await f.webhook({ channel_post: f.channelPost({ photo: [{ file_id: 'manual' }] }) });
  f.env.DB.sqlite.prepare("UPDATE news SET manual_override=1,body='Редакция',hidden=1,pinned=1").run();
  const before = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  f.env.NEWS_MEDIA = bucket;
  await f.cron();
  assert.deepEqual(f.env.DB.sqlite.prepare('SELECT * FROM news').get(), before);
  assert.equal(f.outgoing.length, 0);
  f.env.DB.sqlite.prepare('UPDATE news SET manual_override=0').run();
  const put = bucket.put;
  bucket.put = async (...args) => {
    f.env.DB.sqlite.prepare("UPDATE news SET manual_override=1,body='Новая ручная правка',media_key='manual/image.webp'").run();
    return put(...args);
  };
  await f.cron();
  const after = f.env.DB.sqlite.prepare('SELECT * FROM news').get();
  assert.equal(after.body, 'Новая ручная правка'); assert.equal(after.media_key, 'manual/image.webp');
  assert.equal(after.hidden, 1); assert.equal(after.pinned, 1);
});

test('backfill processes at most ten pending photos per cron', async (t) => {
  const f = fixture(t), bucket = f.env.NEWS_MEDIA;
  delete f.env.NEWS_MEDIA;
  for (let i = 1; i <= 14; i++) await f.webhook({ channel_post: f.channelPost({ message_id: i, photo: [{ file_id: `pending-${i}` }] }) });
  f.env.NEWS_MEDIA = bucket;
  await f.cron();
  assert.equal(f.env.DB.sqlite.prepare("SELECT count(*) AS n FROM news WHERE media_key <> ''").get().n, 10);
  await f.cron();
  assert.equal(f.env.DB.sqlite.prepare("SELECT count(*) AS n FROM news WHERE media_key <> ''").get().n, 14);
});

test('transient Telegram or R2 errors return 503 for retry, then recover without duplicate news', async (t) => {
  const f = fixture(t), post = f.channelPost({ photo: [{ file_id: 'photo', width: 100, height: 100 }] });
  f.state.getFileFailure = true;
  assert.equal((await f.webhook({ channel_post: post })).status, 503);
  f.state.getFileFailure = false;
  const put = f.env.NEWS_MEDIA.put;
  f.env.NEWS_MEDIA.put = async () => { throw new Error('mock R2 outage'); };
  assert.equal((await f.webhook({ channel_post: post })).status, 503);
  f.env.NEWS_MEDIA.put = put;
  assert.equal((await f.webhook({ channel_post: post })).status, 200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) AS n FROM news').get().n, 1);
});

test('D1 schema outage returns 503 and the next Telegram retry can recover', async (t) => {
  const f = fixture(t), batch = f.env.DB.batch;
  f.env.DB.batch = async () => { throw new Error('mock D1 outage'); };
  assert.equal((await f.webhook({ channel_post: f.channelPost() })).status, 503);
  f.env.DB.batch = batch;
  assert.equal((await f.webhook({ channel_post: f.channelPost() })).status, 200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) AS n FROM news').get().n, 1);
});

test('unsafe file paths, SVG, and oversized images never reach R2', async (t) => {
  const f = fixture(t);
  const variants = [
    { filePath: '../secret.jpg', photo: fakeJpeg },
    { filePath: 'https://evil.example/picture.jpg', photo: fakeJpeg },
    { filePath: 'photos/file.jpg', photo: new TextEncoder().encode('<svg onload="alert(1)"></svg>') },
    { filePath: 'photos/file.jpg', photo: new Uint8Array(8 * 1024 * 1024 + 1) },
    { filePath: 'photos/file.jpg', photo: new Uint8Array(8 * 1024 * 1024 + 1), fileSize: 100 }
  ];
  for (let i = 0; i < variants.length; i++) {
    Object.assign(f.state, variants[i]);
    assert.equal((await f.webhook({ channel_post: f.channelPost({ message_id: i + 1, photo: [{ file_id: `photo${i}` }] }) })).status, 200);
  }
  assert.equal(f.media.size, 0);
  assert.equal(f.env.DB.sqlite.prepare('SELECT count(*) AS n FROM news').get().n, variants.length, 'plain text survives permanent photo rejection');
});

test('webhook setup requests new and edited channel posts without dropping the pending queue', async (t) => {
  const f = fixture(t);
  const response = await f.fetchWorker('/tg/setup', { headers: { 'X-Setup-Key': HOOK_SECRET } });
  assert.equal(response.status, 200);
  const payload = f.outgoing.find((entry) => entry.method === 'setWebhook').payload;
  assert.deepEqual(payload.allowed_updates, ['message', 'channel_post', 'edited_channel_post']);
  assert.equal(payload.drop_pending_updates, false);
});

test('legacy web chat keeps its message, Telegram reply, prefix, polling and CORS contract', async (t) => {
  const f = fixture(t), sid = 'abcdefghijklmnopqrstuvwx';
  const response = await f.fetchWorker(`/api/chat/${sid}/messages`, {
    method: 'POST', headers: { Origin: 'https://avocado.rest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Хочу VPS', name: 'Посетитель', contact: '@visitor', page: '/catalog/vps' })
  });
  const sent = await response.json();
  assert.equal(response.status, 200); assert.equal(sent.delivered, true);
  const messageId = f.outgoing.find((entry) => entry.method === 'sendMessage').result.message_id;
  const reply = { message_id: 900, chat: { id: 777, type: 'private' }, text: 'Ответ оператора', reply_to_message: { message_id: messageId } };
  await f.webhook({ message: reply }); await f.webhook({ message: reply });
  await f.webhook({ message: { message_id: 901, chat: { id: 777 }, text: `#${sid.slice(0, 8)} Ответ по префиксу` } });
  const history = await (await f.fetchWorker(`/api/chat/${sid}/messages?after=${sent.id}`)).json();
  assert.equal(history.messages.length, 2); assert.equal(history.messages[0].from, 'admin');
  assert.equal(history.messages[1].text, 'Ответ по префиксу');
  assert.deepEqual(Object.keys(history.messages[0]), ['id', 'from', 'text', 'ts']);
  assert.equal((await f.fetchWorker(`/api/chat/${sid}/messages`, { headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('internal admin reply is authenticated, has no CORS, and appears in website polling', async (t) => {
  const f = fixture(t), sid = 'abcdefghijklmnopqrstuvwx';
  let response = await f.adminReply(sid, 'Ответ', 'wrong');
  assert.equal(response.status, 403); assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  assert.equal((await f.fetchWorker(`/api/internal/chat/${sid}/reply`, { method: 'OPTIONS', headers: { Origin: 'https://avocado.rest' } })).status, 403);
  assert.equal((await f.adminReply(sid, 'Ответ')).status, 404);
  await f.fetchWorker(`/api/chat/${sid}/messages`, { method: 'POST', body: JSON.stringify({ text: 'Заявка' }) });
  assert.equal((await f.adminReply(sid, '')).status, 400);
  assert.equal((await f.adminReply(sid, 'x'.repeat(4097))).status, 400);
  response = await f.adminReply(sid, 'Ответ из админки');
  const result = await response.json();
  assert.equal(result.delivered, true); assert.equal(result.channel, 'website');
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  const history = await (await f.fetchWorker(`/api/chat/${sid}/messages`)).json();
  assert.equal(history.messages.at(-1).text, 'Ответ из админки');
  assert.equal(history.messages.at(-1).id, result.id);
});

test('admin reply to a Telegram visitor uses the bot and reports delivery failure truthfully', async (t) => {
  const f = fixture(t);
  await f.webhook({ message: { message_id: 500, chat: { id: 555, type: 'private' }, from: { first_name: 'Пётр', username: 'petr' }, text: 'Нужна панель' } });
  const sid = f.env.DB.sqlite.prepare("SELECT id FROM sessions WHERE tg_user_chat_id='555'").get().id;
  let result = await (await f.adminReply(sid, 'Пётр, присылаю условия')).json();
  assert.equal(result.delivered, true); assert.equal(result.channel, 'telegram');
  assert.equal(f.outgoing.filter((entry) => entry.method === 'sendMessage' && String(entry.payload.chat_id) === '555').at(-1).payload.text, 'Пётр, присылаю условия');
  f.state.sendFailure = true;
  result = await (await f.adminReply(sid, 'Сохранено при недоступном Telegram')).json();
  assert.equal(result.delivered, false);
  assert.equal(f.env.DB.sqlite.prepare("SELECT text FROM messages WHERE id=?").get(result.id).text, 'Сохранено при недоступном Telegram');
});

test('news runtime schema is reusable across D1 bindings and matches the SQL migration', async (t) => {
  const { readFile } = await import('node:fs/promises');
  const migration = await readFile(new URL('../migrations/0002_news.sql', import.meta.url), 'utf8');
  const db = memoryD1(); t.after(() => db.sqlite.close());
  db.sqlite.exec(migration);
  await ensureNewsSchema(db);
  for (const sql of NEWS_SCHEMA) db.sqlite.exec(sql);
  const columns = db.sqlite.prepare('PRAGMA table_info(news)').all().map((column) => column.name);
  assert.deepEqual(columns, ['id', 'slug', 'title', 'body', 'excerpt', 'source', 'source_chat_id', 'source_message_id', 'source_updated_at', 'source_url', 'media_key', 'media_file_id', 'published_at', 'created_at', 'updated_at', 'hidden', 'pinned', 'manual_override']);
});
