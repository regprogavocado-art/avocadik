# Мини-сайт Avocado

Astro 7.3.2 + `@astrojs/cloudflare` 14.3.1. HTML рендерится на Cloudflare,
шрифты, CSS и изображения отдаёт статика Pages. D1 `avocado-chat` общая с ботом:
существующие `sessions/messages` сохраняются, CMS добавляет собственные таблицы.
R2 `avocado-media` приватный; проверенные изображения доступны через `/media/...`.

## Страницы и CMS

Главная, `/hass`, `/ettinger`, `/rent`, `/catalog` и пять категорий,
`/countries`, `/payment`, `/news`, `/contacts`. Каталог поддерживает детальные
страницы услуг. Дополнительные страницы и новости получают собственные адреса.
Новости имеют пагинацию; скрытые и будущие публикации посетителям недоступны.

В `/admin` доступны страницы, услуги, страны, новости, чаты, счета и настройки.
Контент — простой текст с абзацами, HTML не исполняется. Цены, страны, наличие,
контакты, кошельки и согласованные условия редактируются через формы.
Реквизиты по умолчанию пустые, цены «по запросу», Bulletproof — «скоро».

Админка использует PBKDF2 и сессии D1 на 8 часов: HttpOnly/Secure/SameSite cookie,
CSRF, проверку Origin, ограничение попыток входа, журнал изменений и `no-store`.
Без настроенного пароля и базы вход закрыт. Встроенные Astro sessions отключены.
Ответ из админки идёт в существующую историю виджета или посетителю в Telegram.
Внутренний endpoint воркера требует отдельный `ADMIN_API_SECRET`.

## Локальный запуск (PowerShell)

Проверено на установленном на сервере Node 26 и npm. Из `site/`:

```powershell
npm ci
node scripts/local-setup.mjs
npm run build
```

Локальный пароль записывается в игнорируемый `site/output/local-access.json`.
Продакшен использует другие секреты. Для полного окружения запустите локальный
Telegram mock из `worker/` командой `npm run mock:tg`, затем в `site/`:

```powershell
npm run dev:stack
```

Сайт: `http://127.0.0.1:4322`, админка: `/admin`, тестовый чат: порт 4331.
Миграции применяются автоматически в отдельную D1. Оба приложения работают
в одном workerd, поэтому записи в общую локальную базу не конфликтуют.
Тестовые сообщения остаются в локальном mock, рабочий бот не вызывается.
После сборки перезапустите `dev:stack`. Windows: завершайте родительский Node
вместе с дочерними процессами; отдельное завершение workerd блокирует состояние.

`npm run dev` удобен для вёрстки. `npm run preview` запускает упакованный Pages
на 4321; для чата ему требуется отдельно настроенный локальный service binding.
Полные проверки выполняйте в `dev:stack`.

## Проверки

```powershell
npm run check
npm test
npm audit
npm run build
$env:UI_BASE_URL='http://127.0.0.1:4322'
npm run test:ui
$env:ADMIN_UI_BASE_URL='http://127.0.0.1:4322'
$env:ADMIN_UI_CHAT_URL='http://127.0.0.1:4331'
npm run test:admin
```

В `worker/` — `npm test`. Браузерные сценарии проверяют 1440/390, axe WCAG AA,
горизонтальный скролл, ошибки JS, меню/чат и реальные операции CMS с локальными
D1/R2. Подробности: [tests/admin-qa.md](tests/admin-qa.md).
Скриншоты: `output/playwright/`, Lighthouse: `output/lighthouse/`.
`node scripts/lighthouse.mjs` проверяет мобильные Performance/Accessibility;
параметры базового URL и повторов описаны в начале скрипта. Не запускайте
нагрузочные проверки параллельно с Lighthouse.

## Сборка для Cloudflare Pages

Новый адаптер Astro ориентирован на Workers. `scripts/package-pages.mjs`
упаковывает его серверные ES-модули в Pages advanced mode (`_worker.js/index.js`)
и переносит клиентскую статику с `_routes.json`. Это собственный слой совместимости,
проверяемый сборкой и тестами в workerd; при обновлении адаптера проверяйте его заново.
Конфигурация сборки — `wrangler.build.jsonc`, Pages — `../pages/wrangler.toml`.
Pages-конфиг вынесен наружу, чтобы Wrangler не подменял его конфигурацией Workers
из автоматически созданного `.wrangler/deploy/config.json`.

Основание упаковки: [Cloudflare Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/).
Ограничения и изменения адаптера: [Astro Cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/).

Скрытые файлы, `.dev.vars` и серверный `wrangler.json` не входят в пакет.
Каждая сборка сканируется на известные секреты. Публикуется **только `pages-dist/`**,
а не `dist/`, в котором адаптер может создать копию локальных переменных.

## Выкладка

В игнорируемом `worker/.dev.vars.prod` должен быть `CLOUDFLARE_API_TOKEN`
с доступом к Workers, Pages, D1 и R2. Для DNS — отдельное разрешение Zone/DNS Edit.
OAuth с этого сервера не используется. Не вставляйте значения в команды или Git.

Из `site/`, после успешных локальных проверок:

```powershell
node scripts/cloudflare-release.mjs prepare
node scripts/cloudflare-release.mjs migrate
node scripts/cloudflare-release.mjs worker
node scripts/cloudflare-release.mjs webhook
node scripts/cloudflare-release.mjs site
```

`prepare` создаёт проект `avocado-rest`, bindings и случайные секреты; пароль
сохраняет в `site/output/production-access.json` (открывайте локально).
`migrate` сначала экспортирует удалённую D1 в `site/output/backups/`, затем
добавляет таблицы и исходный контент. `worker` сохраняет старые секреты и включает
`@avocadodev`; `webhook` добавляет channel_post/edited_channel_post без сброса очереди.
`site` ещё раз проверяет пакет и выкладывает его на `avocado-rest.pages.dev`.
После выкладки: `node scripts/production-smoke.mjs --admin` проверяет страницы,
защиту и вход с локальным паролем, читает историю чата и настройки webhook.
Контент, сообщения, счета и канал этот smoke-тест не изменяет.

Если R2 ещё не включён в аккаунте, первый preview работает без загрузки файлов.
Текст новостей сохраняется, фото ожидают включения R2. После активации повторите
`prepare`, `worker`, `site`; cron догрузит фотографии. Перед сменой домена проверьте
SSR, вход, контент и здоровье чата на Pages. DNS-план и ограничения — в MIGRATION.md.

## Криптовалютные счета

В настройках добавьте подтверждённый адрес и сеть. При создании счёта фиксируются
точная десятичная сумма и снимок реквизитов; последующие изменения кошелька их
не меняют. Оператор передаёт реквизиты посетителю, проверяет перевод вручную,
вводит идентификатор транзакции и отмечает оплату, затем выдачу. Только ожидающий
счёт можно отменить. Никакие процессоры или блокчейн-запросы не подключены.

Условия оплаты и возврата публикуйте после утверждения владельцем. BTCPay Server —
следующий этап: отдельный VPS, домен и резервные копии; выбор ресурсов и расходы
требуют данных владельца. Текущая система не выдаёт ручную проверку за автоматическую.

## Изображения

Пять промптов категорий — в `../design-system/avocado/render-brief.md` и
игнорируемой папке `../assets/renders/`. Оригиналы готовит владелец во внешнем ИИ.
`python scripts/convert-renders.py` создаёт WebP и мобильные варианты, когда
исходники появятся; `npm run assets` переносит одобренные файлы в public.
`scripts/build-og.cjs` создаёт OG с прозрачным авокадо; исходный PNG остаётся
в `assets/og-minisite.png`. Публичный сайт использует локальные шрифты и WebP srcset.
