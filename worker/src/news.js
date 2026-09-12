// Telegram news importer. Text stays plain; the site must render it escaped.
export const NEWS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'telegram')),
    source_chat_id TEXT,
    source_message_id INTEGER,
    source_updated_at INTEGER,
    source_url TEXT NOT NULL DEFAULT '',
    media_key TEXT NOT NULL DEFAULT '',
    media_file_id TEXT NOT NULL DEFAULT '',
    published_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
    UNIQUE(source_chat_id, source_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_news_public ON news (hidden, pinned DESC, published_at DESC, id DESC)`
];

const ready = new WeakMap();
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const USERNAME_RE = /^[a-z][a-z0-9_]{4,31}$/i;
class InvalidPhoto extends Error {}

export async function ensureNewsSchema(db) {
  if (!db) throw new Error('D1 binding DB is missing');
  if (!ready.has(db)) {
    ready.set(db, db.batch(NEWS_SCHEMA.map((sql) => db.prepare(sql))).catch((error) => {
      ready.delete(db);
      throw error;
    }));
  }
  await ready.get(db);
}

function plain(value, max) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
    : '';
}

export function allowedNewsChannel(chat, configured) {
  if (!chat || chat.type !== 'channel' || !Number.isSafeInteger(chat.id) || chat.id >= 0) return false;
  const channel = String(configured || '').trim();
  if (/^-\d+$/.test(channel)) return channel === String(chat.id);
  const username = channel.replace(/^@/, '');
  return USERNAME_RE.test(username) && username.toLowerCase() === String(chat.username || '').toLowerCase();
}

export async function importChannelPost(msg, env, telegramApi) {
  if (!allowedNewsChannel(msg?.chat, env.NEWS_CHANNEL_ID)) return { ignored: true };
  if (!Number.isSafeInteger(msg.message_id) || msg.message_id <= 0 || !Number.isSafeInteger(msg.date) || msg.date <= 0) return { ignored: true };
  const body = plain(msg.text || msg.caption, 4096);
  const photos = Array.isArray(msg.photo) ? msg.photo.filter((p) => typeof p.file_id === 'string' && p.file_id.length <= 1024) : [];
  const photo = photos.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
  // Ignore service updates and unsupported media without a caption.
  if (!body && !photo) return { ignored: true };
  await ensureNewsSchema(env.DB);
  const chatId = String(msg.chat.id);
  const sourceUpdated = (Number.isSafeInteger(msg.edit_date) && msg.edit_date > 0 ? msg.edit_date : msg.date) * 1000;
  const previous = await env.DB.prepare('SELECT * FROM news WHERE source_chat_id = ? AND source_message_id = ?')
    .bind(chatId, msg.message_id).first();
  if (previous && sourceUpdated < previous.source_updated_at) return { ignored: true };
  const title = body.split(/\r?\n/).find((line) => line.trim())?.slice(0, 160) || 'Новость Avocado';
  const excerpt = body.replace(/\s+/g, ' ').slice(0, 240);
  const username = String(msg.chat.username || '');
  const sourceUrl = USERNAME_RE.test(username) ? `https://t.me/${username}/${msg.message_id}` : '';
  let mediaKey = previous?.media_key || '';
  let mediaFileId = previous?.media_file_id || '';

  if (!previous?.manual_override) {
    if (!photo) { mediaKey = ''; mediaFileId = ''; }
    else if (!env.NEWS_MEDIA) {
      // Keep Telegram's durable file identifier while R2 is not enabled yet.
      // A changed photo must not continue showing the previous image.
      if (mediaFileId !== photo.file_id) mediaKey = '';
      mediaFileId = photo.file_id;
    }
    else if (env.NEWS_MEDIA && (mediaFileId !== photo.file_id || !mediaKey)) {
      try {
        mediaKey = await importPhoto(photo, chatId, msg.message_id, env, telegramApi);
        mediaFileId = photo.file_id;
      } catch (error) {
        if (!(error instanceof InvalidPhoto)) throw error; // transient failures return 503; Telegram retries
        console.warn('News photo skipped: unsupported image or size');
        mediaKey = ''; mediaFileId = '';
      }
    }
  }

  const now = Date.now();
  await env.DB.prepare(`INSERT INTO news (
      slug, title, body, excerpt, source, source_chat_id, source_message_id, source_updated_at,
      source_url, media_key, media_file_id, published_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'telegram', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_chat_id, source_message_id) DO UPDATE SET
      title = CASE WHEN news.manual_override = 0 THEN excluded.title ELSE news.title END,
      body = CASE WHEN news.manual_override = 0 THEN excluded.body ELSE news.body END,
      excerpt = CASE WHEN news.manual_override = 0 THEN excluded.excerpt ELSE news.excerpt END,
      media_key = CASE WHEN news.manual_override = 0 THEN excluded.media_key ELSE news.media_key END,
      media_file_id = CASE WHEN news.manual_override = 0 THEN excluded.media_file_id ELSE news.media_file_id END,
      source_updated_at = excluded.source_updated_at,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at
    WHERE news.source_updated_at <= excluded.source_updated_at`)
    .bind(`telegram-${chatId.replace('-', '')}-${msg.message_id}`, title, body, excerpt,
      chatId, msg.message_id, sourceUpdated, sourceUrl, mediaKey, mediaFileId,
      msg.date * 1000, now, now).run();
  return { imported: true };
}

// A bounded cron task: 10 photos means at most 20 Telegram fetches + 10 R2 writes.
// telegramApi is the same helper used by the webhook; this function never sends messages.
export async function backfillNewsMedia(env, telegramApi, limit = 10) {
  const result = { attempted: 0, restored: 0, rejected: 0, failed: 0 };
  if (!env.NEWS_MEDIA || !env.TELEGRAM_BOT_TOKEN || !env.DB) return result;
  const batchSize = Math.min(10, Math.max(1, Math.trunc(Number(limit)) || 10));
  await ensureNewsSchema(env.DB);
  const rows = await env.DB.prepare(`SELECT id, source_chat_id, source_message_id, media_file_id FROM news
      WHERE source = 'telegram' AND media_file_id <> '' AND media_key = '' AND manual_override = 0
      ORDER BY RANDOM() LIMIT ?`).bind(batchSize).all();
  for (const row of rows.results || []) {
    result.attempted++;
    try {
      if (!/^-\d{1,20}$/.test(String(row.source_chat_id)) || !Number.isSafeInteger(row.source_message_id) || row.source_message_id <= 0 || typeof row.media_file_id !== 'string' || row.media_file_id.length > 1024) throw new InvalidPhoto();
      const key = await importPhoto({ file_id: row.media_file_id }, row.source_chat_id, row.source_message_id, env, telegramApi);
      // An edit or manual override during the download wins. Do not alter editorial metadata.
      const update = await env.DB.prepare(`UPDATE news SET media_key = ?
          WHERE id = ? AND media_file_id = ? AND media_key = '' AND manual_override = 0`)
        .bind(key, row.id, row.media_file_id).run();
      result.restored += Number(update.meta?.changes || 0);
    } catch (error) {
      if (error instanceof InvalidPhoto) {
        // Permanent failures leave the queue rather than being fetched every 15 minutes.
        const update = await env.DB.prepare(`UPDATE news SET media_file_id = ''
            WHERE id = ? AND media_file_id = ? AND media_key = '' AND manual_override = 0`)
          .bind(row.id, row.media_file_id).run();
        result.rejected += Number(update.meta?.changes || 0);
      } else {
        result.failed++;
        console.warn('Pending news photo download failed; will retry on a later cron');
      }
    }
  }
  return result;
}

async function importPhoto(photo, chatId, messageId, env, telegramApi) {
  if (Number(photo.file_size) > MAX_PHOTO_BYTES) throw new InvalidPhoto();
  let file;
  try { file = await telegramApi(env, 'getFile', { file_id: photo.file_id }); }
  catch (error) {
    if (error?.status === 400) throw new InvalidPhoto(); // Telegram rejects an invalid file_id permanently
    throw error;
  }
  if (!file) throw new Error('Telegram file unavailable');
  const path = file.file_path;
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_./-]{1,512}$/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new InvalidPhoto();
  if (Number(file.file_size) > MAX_PHOTO_BYTES) throw new InvalidPhoto();
  // A trusted deployment variable can point at the local Telegram mock. No post-provided URL is fetched.
  const base = String(env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  const url = new URL(`${base}/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (url.origin !== new URL(base).origin) throw new InvalidPhoto();
  // workerd supports only "follow" and "manual". Never follow a Telegram file redirect.
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new InvalidPhoto();
  }
  if (!response.ok) throw new Error('Telegram photo download failed');
  if (Number(response.headers.get('content-length')) > MAX_PHOTO_BYTES) {
    await response.body?.cancel();
    throw new InvalidPhoto();
  }
  const bytes = await readLimited(response.body);
  const format = imageFormat(bytes);
  if (!format) throw new InvalidPhoto();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
  const key = `news/telegram/${chatId.replace('-', '')}/${messageId}/${hash}.${format.extension}`;
  await env.NEWS_MEDIA.put(key, bytes, {
    httpMetadata: { contentType: format.type, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { source: 'telegram', channel: chatId, message: String(messageId) }
  });
  return key;
}

async function readLimited(stream) {
  if (!stream) throw new InvalidPhoto();
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PHOTO_BYTES) { await reader.cancel(); throw new InvalidPhoto(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function imageFormat(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', type: 'image/jpeg' };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return { extension: 'png', type: 'image/png' };
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { extension: 'webp', type: 'image/webp' };
  return null;
}
