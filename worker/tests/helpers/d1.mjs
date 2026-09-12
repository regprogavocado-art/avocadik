import { DatabaseSync } from 'node:sqlite';

// Real SQLite with the small D1 surface used by the Worker, including atomic batch.
export function memoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    sqlite,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
        async run() {
          const meta = sqlite.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(meta.changes), last_row_id: Number(meta.lastInsertRowid) } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return db;
}
