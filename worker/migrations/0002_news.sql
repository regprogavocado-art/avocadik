-- Shared with the Astro admin. All dates are Unix milliseconds; text is plain text.
CREATE TABLE IF NOT EXISTS news (
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
);
CREATE INDEX IF NOT EXISTS idx_news_public ON news (hidden, pinned DESC, published_at DESC, id DESC);
