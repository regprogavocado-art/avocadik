# avocado.rest — лендинг Avocado + чат с оператором через Telegram

Статический сайт (GitHub Pages, ветка `main`, корень репозитория) и небольшой
бэкенд чата на Cloudflare Worker + D1, который связывает виджет на сайте с
Telegram-ботом: посетители пишут на сайте, оператор отвечает в Telegram.

```
index.html          лендинг
404.html            страница «не найдено» для GitHub Pages
css/                styles.css (сайт), chat.css (виджет), fonts.css (шрифты локально)
js/config.js        ← все контакты и адрес API чата
js/main.js          меню, reveal-анимации, CTA → чат
js/chat.js          виджет чата
assets/             шрифты, иконки, og.png
design-system/      токены дизайна (MASTER.md)
worker/             Cloudflare Worker: API чата + Telegram-бот
_config.yml         GitHub Pages не публикует worker/, design-system/ и README
```

## Локальный запуск сайта

Нужен любой статический сервер (через `file://` шрифты и конфиг не подгрузятся):

```bash
python -m http.server 8000
# → http://localhost:8000
```

## Чат: как это работает

1. Посетитель нажимает «Написать нам» или любую CTA-кнопку (они открывают чат с заготовленным текстом).
2. Пока `chatApiBase` в `js/config.js` пуст, чат работает в режиме «напишите в Telegram»: кнопка ведёт на `telegramUrl`, текст CTA подставляется в поле ввода Telegram.
3. Когда воркер подключён: сообщение уходит в `POST /api/chat/:sid/messages`, сохраняется в D1 и пересылается ботом в ваш Telegram.
4. Вы отвечаете боту **reply** на сообщение посетителя (или `#id текст`; или просто текстом, если за сутки писал ровно один посетитель — иначе бот попросит уточнить).
5. Ответ сохраняется, виджет забирает его опросом (каждые 3 с при открытом окне, 15 с в фоне) и показывает посетителю. История хранится по `sid` в браузере посетителя: закрыл вкладку — вернулся — ответ на месте, на кнопке чата — счётчик непрочитанных.
6. Раз в 15 минут бот напоминает о чатах без ответа (reply на напоминание тоже уходит посетителю).

Команды боту: `/start` — подсказка и ваш chat_id, `/chats` — последние 10 диалогов (⏳ — ждут ответа).
Вложения (фото, файлы) в чат на сайте не передаются — бот об этом предупредит.

**Второй канал — сам бот.** Посетитель может написать боту напрямую в Telegram (ссылка `telegramUrl` в `js/config.js`,
кнопка «Открыть Telegram» в виджете, иконка в подвале). Такие сообщения приходят вам с пометкой ✈️, ваш reply
уходит посетителю в личку через бота. Пока воркер не задеплоен, сообщения боту копятся у Telegram до 24 часов
и будут доставлены после регистрации webhook.

## Текущая конфигурация (12.09.2026)

- Воркер: `https://avocado-chat.avocado-chat-worker.workers.dev` (аккаунт Cloudflare redacted@example.invalid, база D1 `avocado-chat`).
- Бот: @avogurubot, webhook зарегистрирован, оператор — chat_id из секрета `ADMIN_CHAT_ID`.
- Секреты воркера продублированы локально в `worker/.dev.vars.prod` (в git не попадает). Логи: `cd worker && npx wrangler tail`.
- Переразвернуть после правок воркера: `cd worker && CLOUDFLARE_API_TOKEN=<токен> npx wrangler deploy`.

## Чат: настройка с нуля (один раз, ~10 минут)

Нужны: аккаунт Cloudflare (бесплатного тарифа достаточно), Node.js 18+.

```bash
cd worker
npm install
npx wrangler login                 # откроется браузер

# 1. База D1
npm run d1:create                  # скопировать database_id из вывода в wrangler.toml

# 2. Бот: создать у @BotFather (/newbot), получить токен
npx wrangler secret put TELEGRAM_BOT_TOKEN
# секрет вебхука: только буквы, цифры, _ и - (требование Telegram). Сгенерировать:
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put IP_SALT    # любая случайная строка; менять не нужно

# 3. Деплой
npm run deploy                     # в выводе будет URL вида https://avocado-chat.<account>.workers.dev

# 4. Зарегистрировать webhook (секрет — в заголовке, а не в адресной строке):
curl -H "X-Setup-Key: <WEBHOOK_SECRET>" https://avocado-chat.<account>.workers.dev/tg/setup
#    ответ {"ok":true,"bot":"@...","admin":false}

# 5. Написать боту /start — он ответит вашим chat_id; сохранить его:
npx wrangler secret put ADMIN_CHAT_ID
#    повторный /start теперь показывает инструкцию, а /api/health → "admin":true
```

Затем в `js/config.js`:

```js
chatApiBase: 'https://avocado-chat.<account>.workers.dev',
telegramUrl: 'https://t.me/<ваш_аккаунт>',   // необязательно; пусто — иконка в подвале и ссылка в заглушке скрыты
```

и выложить сайт (push в `main`). Проверка: `GET <worker>/api/health` → `{"ok":true,"telegram":true,"admin":true,...}`.

Если сайт открывается не только с avocado.rest — добавьте домен в `ALLOWED_ORIGINS` в `worker/wrangler.toml`.

### Бот в группе

Бота можно добавить в группу: chat_id будет отрицательным (`-100…`). В @BotFather выполните
`/setprivacy → Disable` (или сделайте бота администратором), иначе в группе он видит только команды
и reply на свои сообщения. Каналы не поддерживаются. Для группы с темами задайте `ADMIN_THREAD_ID`
в `worker/wrangler.toml` — уведомления будут приходить в эту тему.

### Локальная отладка чата без реального бота

```bash
cd worker
cp .dev.vars.example .dev.vars     # TELEGRAM_API_BASE=http://127.0.0.1:8099
npm run mock:tg                    # терминал 1: мок Telegram, печатает исходящие сообщения
npm run dev                        # терминал 2: воркер на http://localhost:8787 с локальной D1
```

В `js/config.js` временно `chatApiBase: 'http://localhost:8787'`. Ответ «оператора» можно сымитировать запросом
к вебхуку (заголовок `X-Telegram-Bot-Api-Secret-Token` = `WEBHOOK_SECRET` из `.dev.vars`).

## Лимиты и защита

- Сообщение ≤ 2000 символов; не более 10 сообщений в минуту с одной сессии, 20 за 10 минут и 5 новых диалогов в час с одного IP.
- IP хранится только как усечённый SHA-256 с солью (`IP_SALT`).
- API отвечает только доменам из `ALLOWED_ORIGINS`; webhook принимает запросы только с секретом; ошибки наружу не раскрываются.
- Повторные доставки апдейтов Telegram не дублируют ответы.
- Бесплатного тарифа Cloudflare (100 000 запросов/день) хватает примерно на 500 открытых чатов в день.

## Деплой сайта

GitHub Pages настроен на ветку `main` (корень), домен `avocado.rest` в файле `CNAME`. Достаточно `git push`.
`_config.yml` исключает из публикации `worker/`, `design-system/` и `README.md`.

Рекомендуется также добавить у регистратора запись `CNAME www → regprogavocado-art.github.io.`, тогда
`www.avocado.rest` будет перенаправляться на основной домен.
