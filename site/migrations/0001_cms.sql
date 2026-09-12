CREATE TABLE IF NOT EXISTS cms_pages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('published','draft')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('domains','vps','dedicated','bulletproof','proxies')),
 summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', price TEXT NOT NULL DEFAULT '', price_currency TEXT NOT NULL DEFAULT 'USD',
 availability TEXT NOT NULL DEFAULT 'on_request' CHECK(availability IN ('available','on_request','soon')),
 country_codes TEXT NOT NULL DEFAULT '[]', image TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('published','draft')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_countries (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('published','draft')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS news (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','telegram')), source_chat_id TEXT, source_message_id INTEGER,
 source_updated_at INTEGER, source_url TEXT NOT NULL DEFAULT '', media_key TEXT NOT NULL DEFAULT '', media_file_id TEXT NOT NULL DEFAULT '',
 published_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)), manual_override INTEGER NOT NULL DEFAULT 0 CHECK(manual_override IN (0,1)),
 UNIQUE(source_chat_id,source_message_id)
);
CREATE INDEX IF NOT EXISTS idx_news_public ON news(hidden,pinned DESC,published_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS admin_login_attempts (ip_hash TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ip_hash,window_start));
CREATE TABLE IF NOT EXISTS invoices (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, amount TEXT NOT NULL,
 currency TEXT NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL, wallet_id TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','fulfilled','cancelled')),
 transaction_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, paid_at INTEGER, fulfilled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invoices_session ON invoices(session_id,created_at);
CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, created_at INTEGER NOT NULL);
