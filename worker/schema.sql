-- Справочно: схема D1. Воркер создаёт таблицы сам при первом запросе (ensureSchema)
-- и добавляет недостающие колонки в старые базы. Файл нужен только для ручного просмотра:
--   npx wrangler d1 execute avocado-chat --remote --file=schema.sql
-- Таблица news для Telegram/CMS: migrations/0002_news.sql (см. NEWS.md).

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,              -- id сессии посетителя (генерируется в браузере)
  name TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  page TEXT DEFAULT '',             -- с какой страницы/секции написали
  ua TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '',          -- SHA-256 (усечённый) от IP + соль
  created_at INTEGER NOT NULL,      -- unix ms
  last_user_at INTEGER,
  last_admin_at INTEGER,
  reminded_at INTEGER,              -- когда последний раз напоминали о чате без ответа
  tg_user_chat_id TEXT DEFAULT ''   -- если посетитель пишет боту напрямую: его chat_id в Telegram
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('user','admin')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash TEXT DEFAULT '',
  tg_message_id INTEGER,            -- message_id в Telegram (для маршрутизации reply)
  tg_chat_id TEXT DEFAULT ''        -- chat_id, в котором живёт это message_id
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_tg ON messages (tg_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions (last_user_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions (ip_hash, created_at);
