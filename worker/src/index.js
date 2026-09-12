/**
 * Avocado chat bridge — Cloudflare Worker + D1.
 *
 * Посетитель пишет в виджете на сайте → сообщение сохраняется в D1 и уходит
 * оператору в Telegram. Оператор отвечает боту (reply на сообщение посетителя,
 * либо «#id текст», либо просто текст — если за сутки писал ровно один посетитель)
 * → ответ сохраняется, виджет забирает его опросом. Раз в 15 минут cron
 * напоминает о чатах без ответа.
 *
 * Маршруты:
 *   GET  /api/health
 *   GET  /api/chat/:sid/messages?after=<id>
 *   POST /api/chat/:sid/messages            { text, name?, contact?, page? }
 *   POST /api/internal/chat/:sid/reply     { text } — X-Admin-Api-Key, server only
 *   POST /tg/webhook                         (Telegram, заголовок X-Telegram-Bot-Api-Secret-Token)
 *   GET  /tg/setup                           (заголовок X-Setup-Key: <WEBHOOK_SECRET>) — регистрирует webhook
 *
 * Секреты (wrangler secret put …): TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, WEBHOOK_SECRET, IP_SALT
 * Переменные (wrangler.toml [vars]): ALLOWED_ORIGINS, ADMIN_THREAD_ID (опц., тема в группе)
 * Новости: NEWS_CHANNEL_ID (пусто — выключены), NEWS_MEDIA (R2 binding).
 * Админка: ADMIN_API_SECRET — отдельный секрет, минимум 32 символа; только Pages server-side.
 */

import { importChannelPost, backfillNewsMedia } from './news.js';

const SID_RE = /^[a-z0-9]{16,64}$/i;
const MAX_TEXT = 2000;                      // сообщение посетителя
const MAX_ADMIN_TEXT = 4096;                // лимит самого Telegram — ответ оператора не режем
const LIMIT_PER_SID_MIN = 10;               // сообщений с одной сессии за минуту
const LIMIT_PER_IP_10MIN = 20;              // сообщений с одного IP за 10 минут
const LIMIT_NEW_SESSIONS_PER_IP_HOUR = 5;   // новых диалогов с одного IP в час
const HISTORY_LIMIT = 200;
const REMIND_AFTER_MS = 15 * 60_000;        // напоминать о чате без ответа спустя…
const LAST_ACTIVE_WINDOW_MS = 24 * 60 * 60_000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Server-to-server only. Never emit browser CORS headers for these routes.
    if (url.pathname.startsWith('/api/internal/')) {
      try { return await internalApi(request, url, env); }
      catch { console.error('internal chat API failed'); return json({ error: 'internal' }, 500); }
    }
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ── API для виджета ────────────────────────────────────────────
      if (url.pathname.startsWith('/api/')) {
        const origin = request.headers.get('Origin');
        if (origin && !cors['Access-Control-Allow-Origin']) {
          return json({ error: 'origin_not_allowed' }, 403);
        }
        if (url.pathname === '/api/health') {
          return json({
            ok: true,
            telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
            admin: Boolean(env.ADMIN_CHAT_ID),
            webhookSecret: Boolean(env.WEBHOOK_SECRET),
            db: Boolean(env.DB)
          }, 200, cors);
        }
        const m = /^\/api\/chat\/([^/]+)\/messages$/.exec(url.pathname);
        if (m) {
          const sid = m[1];
          if (!SID_RE.test(sid)) return json({ error: 'bad_session' }, 400, cors);
          await ensureSchema(env.DB);
          if (request.method === 'GET') {
            const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
            return getMessages(env, sid, after, cors);
          }
          if (request.method === 'POST') return postMessage(request, env, sid, cors);
          return json({ error: 'method_not_allowed' }, 405, cors);
        }
        return json({ error: 'not_found' }, 404, cors);
      }

      // ── Telegram ───────────────────────────────────────────────────
      if (url.pathname === '/tg/webhook' && request.method === 'POST') {
        const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
        const update = await request.json().catch(() => null);
        if (update && (update.channel_post || update.edited_channel_post)) {
          try { await importChannelPost(update.channel_post || update.edited_channel_post, env, tg); }
          catch {
            // News upserts are idempotent. Let Telegram retry D1/R2/network failures.
            // Never log download URLs: they contain the bot token.
            console.error('Telegram news import failed; awaiting retry');
            return new Response('retry', { status: 503 });
          }
          return ok();
        }
        try { await ensureSchema(env.DB); await telegramWebhook(update, env); }
        catch (e) { console.error('webhook failed', e && e.stack || e); }
        return ok(); // Telegram должен всегда получать 200: иначе он повторяет апдейт и держит очередь
      }
      if (url.pathname === '/tg/setup' && request.method === 'GET') {
        return telegramSetup(request, url, env);
      }

      if (url.pathname === '/') {
        return new Response('avocado chat api · ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('unhandled', err && err.stack ? err.stack : err);
      return json({ error: 'internal' }, 500, cors); // подробности — только в wrangler tail / Workers Logs
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(remindUnanswered(env));
    ctx.waitUntil(backfillNewsMedia(env, tg).catch(() => {
      console.error('Pending news photo backfill failed; will retry on a later cron');
    }));
  }
};

/* ─── Схема D1 (создаётся лениво при первом запросе) ────────────────── */
const schemasReady = new WeakMap();
function ensureSchema(db) {
  if (!db) throw new Error('D1 binding "DB" is missing — check wrangler.toml');
  if (!schemasReady.has(db)) {
    const schemaReady = (async () => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          name TEXT DEFAULT '',
          contact TEXT DEFAULT '',
          page TEXT DEFAULT '',
          ua TEXT DEFAULT '',
          ip_hash TEXT DEFAULT '',
          created_at INTEGER NOT NULL,
          last_user_at INTEGER,
          last_admin_at INTEGER,
          reminded_at INTEGER,
          tg_user_chat_id TEXT DEFAULT ''
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          sender TEXT NOT NULL CHECK (sender IN ('user','admin')),
          text TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          ip_hash TEXT DEFAULT '',
          tg_message_id INTEGER,
          tg_chat_id TEXT DEFAULT ''
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, id)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_tg ON messages (tg_message_id)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages (ip_hash, created_at)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions (last_user_at)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions (ip_hash, created_at)`)
      ]);
      // миграции для баз, созданных ранней версией (колонка уже есть — ошибка игнорируется)
      for (const sql of [
        `ALTER TABLE sessions ADD COLUMN reminded_at INTEGER`,
        `ALTER TABLE sessions ADD COLUMN tg_user_chat_id TEXT DEFAULT ''`,
        `ALTER TABLE messages ADD COLUMN tg_chat_id TEXT DEFAULT ''`
      ]) {
        try { await db.prepare(sql).run(); } catch (e) { /* duplicate column */ }
      }
    })().catch((e) => { schemasReady.delete(db); throw e; });
    schemasReady.set(db, schemaReady);
  }
  return schemasReady.get(db);
}

/* ─── Admin: ответ через серверный service binding ─────────────────── */
async function internalApi(request, url, env) {
  const provided = request.headers.get('X-Admin-Api-Key') || '';
  if (!await secretEqual(provided, env.ADMIN_API_SECRET)) return json({ error: 'forbidden' }, 403);
  const match = /^\/api\/internal\/chat\/([^/]+)\/reply$/.exec(url.pathname);
  if (!match) return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const sid = match[1];
  if (!SID_RE.test(sid)) return json({ error: 'bad_session' }, 400);
  const payload = await request.json().catch(() => null);
  if (typeof payload?.text !== 'string' || payload.text.length > MAX_ADMIN_TEXT) return json({ error: 'bad_request' }, 400);
  const text = clean(payload.text, MAX_ADMIN_TEXT);
  if (!text) return json({ error: 'empty' }, 400);
  await ensureSchema(env.DB);
  const session = await env.DB.prepare('SELECT id, tg_user_chat_id FROM sessions WHERE id = ?').bind(sid).first();
  if (!session) return json({ error: 'session_not_found' }, 404);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (session_id, sender, text, created_at) VALUES (?, 'admin', ?, ?) RETURNING id")
      .bind(sid, text, now),
    env.DB.prepare('UPDATE sessions SET last_admin_at = ? WHERE id = ?').bind(now, sid)
  ]);
  let delivered = true;
  if (session.tg_user_chat_id) {
    try {
      const sent = await tg(env, 'sendMessage', { chat_id: session.tg_user_chat_id, text });
      delivered = Boolean(sent);
    } catch { delivered = false; console.error('Admin reply saved but Telegram delivery failed'); }
  }
  return json({ id: results[0].results[0].id, ts: now, delivered, channel: session.tg_user_chat_id ? 'telegram' : 'website' });
}

async function secretEqual(provided, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || provided.length > 512) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/* ─── Виджет: история ───────────────────────────────────────────────── */
async function getMessages(env, sid, after, cors) {
  const rows = await env.DB.prepare(
    `SELECT id, sender, text, created_at FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?`
  ).bind(sid, after, HISTORY_LIMIT).all();
  const messages = (rows.results || []).map((r) => ({ id: r.id, from: r.sender, text: r.text, ts: r.created_at }));
  let session = null;
  if (after === 0) {
    const s = await env.DB.prepare(`SELECT name, contact FROM sessions WHERE id = ?`).bind(sid).first();
    if (s) session = { name: s.name || '', contact: s.contact || '' };
  }
  return json({ messages, session }, 200, cors);
}

/* ─── Виджет: новое сообщение ───────────────────────────────────────── */
async function postMessage(request, env, sid, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== 'string') return json({ error: 'bad_request' }, 400, cors);
  const text = clean(body.text, MAX_TEXT);
  if (!text) return json({ error: 'empty' }, 400, cors);
  const name = clean(body.name, 80);
  const contact = clean(body.contact, 120);
  const page = clean(body.page, 200);
  const ua = clean(request.headers.get('User-Agent'), 200);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  const ipHash = await sha256(ip + '|' + (env.IP_SALT || env.TELEGRAM_BOT_TOKEN || 'dev-salt'));
  const now = Date.now();
  const db = env.DB;

  // лимиты
  const existing = await db.prepare(`SELECT id, name, contact FROM sessions WHERE id = ?`).bind(sid).first();
  const [bySid, byIp, newByIp] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND sender = 'user' AND created_at > ?`).bind(sid, now - 60_000),
    db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ip_hash = ? AND sender = 'user' AND created_at > ?`).bind(ipHash, now - 600_000),
    db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE ip_hash = ? AND created_at > ?`).bind(ipHash, now - 3_600_000)
  ]);
  const n = (r) => (r.results && r.results[0] && r.results[0].n) || 0;
  if (n(bySid) >= LIMIT_PER_SID_MIN || n(byIp) >= LIMIT_PER_IP_10MIN || (!existing && n(newByIp) >= LIMIT_NEW_SESSIONS_PER_IP_HOUR)) {
    return json({ error: 'rate_limited' }, 429, cors);
  }

  const isNew = !existing;
  await db.prepare(`INSERT INTO sessions (id, name, contact, page, ua, ip_hash, created_at, last_user_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE sessions.name END,
        contact = CASE WHEN excluded.contact <> '' THEN excluded.contact ELSE sessions.contact END,
        page = excluded.page,
        last_user_at = excluded.last_user_at`)
    .bind(sid, name, contact, page, ua, ipHash, now, now).run();

  const ins = await db.prepare(`INSERT INTO messages (session_id, sender, text, created_at, ip_hash) VALUES (?, 'user', ?, ?, ?) RETURNING id`)
    .bind(sid, text, now, ipHash).first();
  const id = ins.id;

  // уведомление оператору
  const sess = { name: name || (existing && existing.name) || '', contact: contact || (existing && existing.contact) || '' };
  const short = shortId(sid);
  const who = [sess.name, sess.contact].filter(Boolean).map(esc).join(' · ') || 'Посетитель без имени';
  let tgText = (isNew ? `🥑 <b>Новый чат</b> <code>#${short}</code>` : `💬 <code>#${short}</code>`) + `\n👤 ${who}`;
  if (isNew && page && page !== '/' && page !== '/index.html') tgText += `\n📄 ${esc(page)}`;
  tgText += `\n\n${esc(text)}`;

  let delivered = false;
  try {
    const sent = await tg(env, 'sendMessage', {
      chat_id: env.ADMIN_CHAT_ID, text: tgText, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(env.ADMIN_THREAD_ID ? { message_thread_id: Number(env.ADMIN_THREAD_ID) } : {})
    });
    if (sent) {
      delivered = true;
      await db.prepare(`UPDATE messages SET tg_message_id = ?, tg_chat_id = ? WHERE id = ?`)
        .bind(sent.message_id, String(env.ADMIN_CHAT_ID || ''), id).run();
    }
  } catch (e) {
    console.error('telegram sendMessage failed:', e.message);
  }
  return json({ id, ts: now, delivered }, 200, cors);
}

/* ─── Telegram: входящие апдейты ────────────────────────────────────── */
async function telegramWebhook(update, env) {
  const msg = update && update.message;
  if (!msg || !msg.chat) return;
  const chatId = String(msg.chat.id);
  const text = String(msg.text || msg.caption || '').trim();
  const db = env.DB;

  // Оператор ещё не настроен: подсказываем chat_id и ничего больше не делаем
  if (!env.ADMIN_CHAT_ID) {
    if (/^\/start/.test(text)) {
      await reply(env, msg, `Ваш chat_id: <code>${esc(chatId)}</code>\nУкажите его в секрете <b>ADMIN_CHAT_ID</b> воркера, чтобы получать сообщения с сайта.`);
    }
    return;
  }
  // Не оператор: это посетитель, который пишет боту напрямую в Telegram
  if (chatId !== String(env.ADMIN_CHAT_ID)) {
    if (msg.chat.type && msg.chat.type !== 'private') return; // группы, куда бота добавили случайно, игнорируем
    await visitorFromTelegram(env, msg, text);
    return;
  }

  if (!text) {
    if (msg.photo || msg.document || msg.sticker || msg.voice || msg.video || msg.audio || msg.animation || msg.video_note) {
      await reply(env, msg, 'В чат на сайте доставляется только текст (или подпись к медиа). Отправьте ответ текстом.');
    }
    return; // сервисные сообщения (закреп, новые участники…) молча игнорируем
  }

  if (/^\/(start|help)\b/.test(text)) { await reply(env, msg, helpText(chatId)); return; }

  if (/^\/chats\b/.test(text)) {
    const rows = await db.prepare(
      `SELECT s.id, s.name, s.contact, s.last_user_at, s.last_admin_at, s.tg_user_chat_id,
              (SELECT text FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_text
         FROM sessions s ORDER BY COALESCE(s.last_user_at, s.created_at) DESC LIMIT 10`
    ).all();
    const list = (rows.results || []).map((s) => {
      const who = [s.name, s.contact].filter(Boolean).map(esc).join(' · ') || 'без имени';
      const waiting = (s.last_user_at || 0) > (s.last_admin_at || 0) ? ' ⏳' : '';
      const via = s.tg_user_chat_id ? ' ✈️' : '';
      return `<code>#${shortId(s.id)}</code> ${who}${via}${waiting}\n<i>${esc(String(s.last_text || '').slice(0, 80))}</i>`;
    });
    await reply(env, msg, list.length ? `Последние диалоги (⏳ — ждут ответа):\n\n${list.join('\n\n')}` : 'Диалогов пока нет.');
    return;
  }

  if (text.startsWith('/')) { await reply(env, msg, 'Неизвестная команда. Доступны: /chats, /help'); return; }

  // Повторная доставка апдейта (Telegram повторяет при сбоях) — не дублируем ответ
  const dup = await db.prepare(`SELECT 1 AS x FROM messages WHERE sender = 'admin' AND tg_message_id = ? AND tg_chat_id = ? LIMIT 1`)
    .bind(msg.message_id, chatId).first();
  if (dup) return;

  // ── маршрутизация ответа ──
  let sid = null;
  let body = text;
  let routedBy = '';

  const rt = msg.reply_to_message;
  if (rt) {
    const row = await db.prepare(`SELECT session_id FROM messages WHERE tg_message_id = ? AND tg_chat_id = ? LIMIT 1`)
      .bind(rt.message_id, chatId).first();
    if (row) { sid = row.session_id; routedBy = 'reply'; }
    else {
      const ids = [...String(rt.text || rt.caption || '').matchAll(/#([a-z0-9]{6,})/gi)].map((x) => x[1]);
      if (ids.length > 1) {
        await reply(env, msg, 'В этом сообщении несколько чатов — сделайте reply на сообщение конкретного посетителя или начните текст с <code>#id</code>.');
        return;
      }
      if (ids.length === 1) { sid = await findByPrefix(db, ids[0]); if (sid) routedBy = 'reply'; }
    }
  }
  if (!sid) {
    const m = /^#([a-z0-9]{6,})\s+([\s\S]+)$/i.exec(text);
    if (m) {
      sid = await findByPrefix(db, m[1]);
      if (!sid) { await reply(env, msg, `Чат <code>#${esc(m[1])}</code> не найден — сообщение не отправлено. Список: /chats`); return; }
      body = m[2].trim(); routedBy = 'prefix';
    }
  }
  if (!sid) {
    // «последний активный» — только в личном чате с ботом и только если за сутки писал ровно один посетитель
    const isPrivate = !msg.chat.type || msg.chat.type === 'private';
    const recent = await db.prepare(`SELECT id FROM sessions WHERE last_user_at > ? ORDER BY last_user_at DESC LIMIT 2`)
      .bind(Date.now() - LAST_ACTIVE_WINDOW_MS).all();
    const rows = recent.results || [];
    if (isPrivate && rows.length === 1) { sid = rows[0].id; routedBy = 'last'; }
    else {
      await reply(env, msg, rows.length
        ? 'Активных чатов несколько — ответьте через reply на сообщение посетителя или начните текст с <code>#id</code>. Список: /chats'
        : 'Нет активных чатов — некуда отправить.');
      return;
    }
  }
  if (!body) return;

  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO messages (session_id, sender, text, created_at, tg_message_id, tg_chat_id) VALUES (?, 'admin', ?, ?, ?, ?)`)
      .bind(sid, clean(body, MAX_ADMIN_TEXT), now, msg.message_id, chatId),
    db.prepare(`UPDATE sessions SET last_admin_at = ? WHERE id = ?`).bind(now, sid)
  ]);

  // посетитель пишет через Telegram — дублируем ответ ему в личку через бота
  const sess = await db.prepare(`SELECT tg_user_chat_id FROM sessions WHERE id = ?`).bind(sid).first();
  if (sess && sess.tg_user_chat_id) {
    try {
      await tg(env, 'sendMessage', { chat_id: sess.tg_user_chat_id, text: clean(body, MAX_ADMIN_TEXT) });
    } catch (e) {
      await reply(env, msg, `Не удалось доставить ответ посетителю в Telegram (возможно, он заблокировал бота): ${esc(e.message)}`);
    }
  }

  const captionOnly = !msg.text && Boolean(msg.caption);
  if (routedBy === 'last') {
    await reply(env, msg, `→ доставлено в единственный активный чат <code>#${shortId(sid)}</code>.${captionOnly ? ' Вложение не передано, только подпись.' : ''}`);
  } else if (captionOnly) {
    await reply(env, msg, 'Доставлена только подпись — вложения в чат на сайте не передаются.');
  } else {
    try {
      await tg(env, 'setMessageReaction', { chat_id: chatId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👌' }] });
    } catch (e) { /* реакции могут быть недоступны — не критично */ }
  }
}

/* ─── Telegram: посетитель пишет боту напрямую ──────────────────────── */
async function visitorFromTelegram(env, msg, text) {
  const db = env.DB;
  const chatId = String(msg.chat.id);
  const from = msg.from || {};
  const sid = 'tg' + (await sha256('tg-user:' + chatId)).slice(0, 30);
  const name = clean([from.first_name, from.last_name].filter(Boolean).join(' '), 80);
  const contact = from.username ? '@' + clean(from.username, 60) : '';

  if (/^\/start/.test(text)) {
    await reply(env, msg, 'Здравствуйте! Это чат Avocado. Напишите ваш вопрос одним сообщением — ответим здесь.');
    return;
  }
  if (!text) {
    await reply(env, msg, 'Пришлите, пожалуйста, текстом — вложения пока не принимаем.');
    return;
  }
  const now = Date.now();
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND sender = 'user' AND created_at > ?`)
    .bind(sid, now - 60_000).first();
  if ((recent && recent.n) >= LIMIT_PER_SID_MIN) return;

  const existing = await db.prepare(`SELECT id FROM sessions WHERE id = ?`).bind(sid).first();
  await db.prepare(`INSERT INTO sessions (id, name, contact, page, ua, ip_hash, created_at, last_user_at, tg_user_chat_id)
      VALUES (?, ?, ?, 'telegram', '', '', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE sessions.name END,
        contact = CASE WHEN excluded.contact <> '' THEN excluded.contact ELSE sessions.contact END,
        last_user_at = excluded.last_user_at, tg_user_chat_id = excluded.tg_user_chat_id`)
    .bind(sid, name, contact, now, now, chatId).run();
  const ins = await db.prepare(`INSERT INTO messages (session_id, sender, text, created_at) VALUES (?, 'user', ?, ?) RETURNING id`)
    .bind(sid, clean(text, MAX_ADMIN_TEXT), now).first();

  const who = [name, contact].filter(Boolean).map(esc).join(' · ') || 'Без имени';
  const tgText = (existing ? `✈️ <code>#${shortId(sid)}</code>` : `✈️ <b>Новый чат из Telegram</b> <code>#${shortId(sid)}</code>`) + `\n👤 ${who}\n\n${esc(text)}`;
  try {
    const sent = await tg(env, 'sendMessage', {
      chat_id: env.ADMIN_CHAT_ID, text: tgText, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(env.ADMIN_THREAD_ID ? { message_thread_id: Number(env.ADMIN_THREAD_ID) } : {})
    });
    if (sent) {
      await db.prepare(`UPDATE messages SET tg_message_id = ?, tg_chat_id = ? WHERE id = ?`)
        .bind(sent.message_id, String(env.ADMIN_CHAT_ID), ins.id).run();
    }
  } catch (e) { console.error('forward to admin failed:', e.message); }
  if (!existing) await reply(env, msg, 'Спасибо! Сообщение получили, ответим здесь.');
}

function helpText(chatId) {
  return [
    `🥑 <b>Avocado · чат с сайта</b>`,
    ``,
    `Сюда приходят сообщения посетителей avocado.rest. Как ответить:`,
    `• <b>Reply</b> (ответить) на сообщение посетителя — самый надёжный способ;`,
    `• или начать текст с идентификатора: <code>#a1b2c3d4 ваш ответ</code>;`,
    `• или, если за сутки писал только один посетитель, просто написать — уйдёт ему.`,
    `Сообщения с пометкой ✈️ пришли от посетителей прямо в Telegram — ответ reply уйдёт им в личку через бота.`,
    `Каждые 15 минут бот напоминает о чатах без ответа.`,
    ``,
    `/chats — последние диалоги`,
    `chat_id этого чата: <code>${esc(chatId)}</code>`
  ].join('\n');
}

/* ─── Telegram: напоминания о чатах без ответа (cron) ───────────────── */
async function remindUnanswered(env) {
  if (!env.ADMIN_CHAT_ID || !env.TELEGRAM_BOT_TOKEN) return;
  await ensureSchema(env.DB);
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT s.id, s.name, s.contact, s.last_user_at,
            (SELECT text FROM messages m WHERE m.session_id = s.id AND m.sender = 'user' ORDER BY m.id DESC LIMIT 1) AS last_text
       FROM sessions s
      WHERE s.last_user_at > COALESCE(s.last_admin_at, 0)
        AND s.last_user_at < ?
        AND COALESCE(s.reminded_at, 0) < s.last_user_at
      ORDER BY s.last_user_at ASC LIMIT 10`
  ).bind(now - REMIND_AFTER_MS).all();
  for (const s of rows.results || []) {
    const who = [s.name, s.contact].filter(Boolean).map(esc).join(' · ') || 'Посетитель без имени';
    const mins = Math.round((now - s.last_user_at) / 60_000);
    try {
      // reply на напоминание маршрутизируется по единственному #id в его тексте
      await tg(env, 'sendMessage', {
        chat_id: env.ADMIN_CHAT_ID, parse_mode: 'HTML', disable_web_page_preview: true,
        ...(env.ADMIN_THREAD_ID ? { message_thread_id: Number(env.ADMIN_THREAD_ID) } : {}),
        text: `⏳ <b>Без ответа ${mins} мин</b> <code>#${shortId(s.id)}</code>\n👤 ${who}\n\n${esc(String(s.last_text || '').slice(0, 500))}\n\n<i>Reply на это сообщение — ответ уйдёт в этот чат.</i>`
      });
      await env.DB.prepare(`UPDATE sessions SET reminded_at = ? WHERE id = ?`).bind(now, s.id).run();
    } catch (e) { console.error('remind failed', e.message); }
  }
}

/* ─── Telegram: регистрация webhook ─────────────────────────────────── */
async function telegramSetup(request, url, env) {
  const key = request.headers.get('X-Setup-Key') || url.searchParams.get('key');
  if (!env.WEBHOOK_SECRET || key !== env.WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403);
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(env.WEBHOOK_SECRET)) {
    return json({ error: 'WEBHOOK_SECRET: Telegram допускает только A-Z a-z 0-9 _ - (16–256 символов). Сгенерируйте новый: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"' }, 400);
  }
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, 500);
  const hook = `${url.origin}/tg/webhook`;
  const result = await tg(env, 'setWebhook', {
    url: hook, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'channel_post', 'edited_channel_post'], drop_pending_updates: false
  });
  const me = await tg(env, 'getMe', {});
  return json({ ok: true, webhook: hook, bot: me && me.username ? '@' + me.username : null, admin: Boolean(env.ADMIN_CHAT_ID), result });
}

/* ─── Хелперы ───────────────────────────────────────────────────────── */
async function tg(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) { console.warn(`telegram ${method}: TELEGRAM_BOT_TOKEN not set, skipped`); return null; }
  const base = String(env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const error = new Error(`Telegram ${method}: ${data.description || ('HTTP ' + res.status)}`);
    error.status = Number(data.error_code || res.status);
    throw error;
  }
  return data.result;
}

// ответ оператору в тот же чат (и в ту же тему, если это группа с темами)
function reply(env, msg, html) {
  return tg(env, 'sendMessage', {
    chat_id: msg.chat.id, parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: msg.message_id,
    ...(msg.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
    text: html
  });
}

async function findByPrefix(db, prefix) {
  const row = await db.prepare(`SELECT id FROM sessions WHERE id LIKE ? ORDER BY COALESCE(last_user_at, created_at) DESC LIMIT 1`)
    .bind(prefix.toLowerCase() + '%').first();
  return row ? row.id : null;
}

function shortId(sid) { return String(sid).slice(0, 8); }
function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const okOrigin = origin && (allowed.includes('*') || allowed.includes(origin));
  if (!okOrigin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra)
  });
}
function ok() { return new Response('ok'); }
