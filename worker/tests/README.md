# Локальные тесты чата

Быстрые проверки без запуска серверов и без реального Telegram (Node 22.13+ с `node:sqlite`):

```bash
cd worker
npm test
```

Прогон использует настоящую SQLite в памяти и перехватывает все запросы `fetch`.
Покрывает прежний контракт чата, ответ из админки, закрытый внутренний API,
разрешённый канал, повторы и правки новостей, ручную модерацию, загрузку фото,
отказ D1/R2/Telegram и запрет опасных файлов. Продовые переменные не читаются.

Ниже — дополнительный существующий smoke-тест с реальным локальным Workers runtime.

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

Для новой админки и новостей см. [NEWS.md](../NEWS.md). Для локальных прогонов
используйте отдельный `--persist-to` и тестовые значения секретов. Завершайте
родительский процесс Node у Wrangler, чтобы `workerd` освободил SQLite.
