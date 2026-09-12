-- Existing chat tables, unchanged. Makes a fresh CMS database usable before the
-- first chat request; CREATE IF NOT EXISTS preserves production chat history.
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY,
 name TEXT DEFAULT '', contact TEXT DEFAULT '', page TEXT DEFAULT '', ua TEXT DEFAULT '', ip_hash TEXT DEFAULT '',
 created_at INTEGER NOT NULL, last_user_at INTEGER, last_admin_at INTEGER, reminded_at INTEGER,
 tg_user_chat_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
 sender TEXT NOT NULL CHECK(sender IN ('user','admin')), text TEXT NOT NULL, created_at INTEGER NOT NULL,
 ip_hash TEXT DEFAULT '', tg_message_id INTEGER, tg_chat_id TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id,id);
CREATE INDEX IF NOT EXISTS idx_messages_tg ON messages(tg_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages(ip_hash,created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_user_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions(ip_hash,created_at);
