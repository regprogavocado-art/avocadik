# Локальные тесты чата

Поднять окружение (три терминала, из `worker/`):

```bash
node scripts/mock-telegram.mjs                      # мок Telegram, :8099
npx wrangler dev --port 8787 --ip 127.0.0.1         # воркер с локальной D1 (читает .dev.vars)
python -m http.server 8000 --bind 127.0.0.1         # из корня репозитория — сайт
```

В `.dev.vars` для тестов: `TELEGRAM_API_BASE=http://127.0.0.1:8099`, `ADMIN_CHAT_ID=777`,
`WEBHOOK_SECRET=localsecret-0123456789abcdef` (значение зашито в `api-test.sh`).
Перед прогоном удалить `.wrangler/state`, иначе сработают лимиты (5 новых диалогов в час с IP).

```bash
bash tests/api-test.sh                              # 12 проверок API и маршрутизации Telegram
npm i playwright && npx playwright install chromium # один раз
OUT=/tmp/shots node tests/ui-test.cjs               # скриншоты 1440/390 + сквозной чат; ждёт errors: [] и overflow 0
```

`ui-test.cjs` подменяет `chatApiBase` на локальный воркер только если в `js/config.js` он пустой;
при рабочем значении тест пойдёт в продовый воркер — на время теста поставьте `chatApiBase: ''`.
