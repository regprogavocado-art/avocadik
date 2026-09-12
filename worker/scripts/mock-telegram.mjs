// Мок Telegram Bot API для локальной разработки без реального бота.
// Запуск: npm run mock:tg   (порт 8099), в .dev.vars: TELEGRAM_API_BASE=http://127.0.0.1:8099
// Печатает в консоль всё, что воркер «отправляет в Telegram», и отвечает как настоящий API.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8099);
let nextMessageId = 1000;
const log = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const m = /^\/bot[^/]+\/(\w+)/.exec(req.url || '');
    const method = m ? m[1] : null;
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }

    if (req.url === '/__log') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(log));
    }
    if (!method) { res.writeHead(404); return res.end('not found'); }

    let result = true;
    if (method === 'sendMessage') {
      result = { message_id: nextMessageId++, chat: { id: payload.chat_id }, text: payload.text, date: Math.floor(Date.now() / 1000) };
      console.log(`\n[sendMessage → ${payload.chat_id}] message_id=${result.message_id}\n${payload.text}\n`);
    } else if (method === 'getMe') {
      result = { id: 1, is_bot: true, first_name: 'Mock', username: 'avocado_mock_bot' };
    } else if (method === 'setWebhook') {
      console.log(`[setWebhook] ${payload.url}`);
    } else if (method === 'setMessageReaction') {
      console.log(`[reaction] message_id=${payload.message_id}`);
    } else {
      console.log(`[${method}]`, payload);
    }
    log.push({ method, payload, result, at: Date.now() });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Mock Telegram API: http://127.0.0.1:${PORT}  (лог: /__log)`));
