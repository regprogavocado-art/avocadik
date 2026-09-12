# Avocado: знак, монумент и персонаж

Обновлено 12.09.2026 по референсу владельца. Avocado — разработчик собственного
и заказного ПО. Hass и Ettinger стоят перед дополнительными услугами.

## Три масштаба бренда

- `assets/img/avocado-mark.svg` — основной векторный знак. Светлая керамика,
  тонкая золотая грань и глубокая зелёная сердцевина. Читается в маленьком размере;
  не содержит мелких деталей персонажа. `site/scripts/sync-brand.mjs` переносит
  его в SVG-спрайты обоих сайтов и `favicon.svg`.
- `assets/img/hero-monument.webp` — большая фотореалистичная сцена: обсидиановый
  монумент у озера, золотая сердцевина, мокрые скалы и архитектура в тумане.
  1672×941, мобильная копия 960×540, JPEG для исходного лендинга. Широкий кадр
  размещается целиком в hero; текст находится в тёмной левой части.
- `assets/img/avocado-guardian.webp` — живой персонаж со щитом и орбитой узлов:
  защита, автоматизация и конфиденциальность. Настоящий прозрачный фон;
  копии 1024, 640 и 320 px. Один персонаж в блоке преимуществ главной,
  дополнительные акценты на страницах ПО и в OG. Он не заменяет малый знак.

Исходники PNG и отдельные промпты находятся в игнорируемой папке
`D:\AvocadoREST\assets\renders\`: `hero-monument.png`, `avocado-guardian.png`,
`hero-monument.prompt.txt`, `avocado-guardian.prompt.txt`.
Сгенерировано встроенным imagegen. Референс использован как направление материалов
и композиции, текст и псевдоинтерфейсы из него не перенесены в изображения.

## Hero: production prompt

```text
Cinematic ultra-wide luxury product photograph for the Avocado software brand.
A monumental single upright halved Hass avocado occupies the right third of the
frame, standing on layered wet obsidian rocks at a perfectly still mountain lake.
Sculptural black pebbled obsidian outer shell, smooth warm ivory ceramic inner
face, refined thin champagne-gold bevel around the silhouette, a deep inset
bronze-gold seed with a soft luminous golden edge. Expensive physically plausible
materials, deep carved volumes, sharp macro texture and realistic reflections.
Behind it, tall minimal black architectural monoliths fade into shadow; distant
alpine mountain ridges and soft mist, subdued warm light breaking through heavy
clouds. Nearly black left half and upper left provide clean empty space for live
website typography. Palette near-black #080a09, dark green #0f1a15, champagne gold
#e3b45c, only a subtle mint #8ff0a6 edge light. Photorealistic, restrained, dramatic
depth, premium editorial art direction. No words, letters, logos, watermarks,
hands, additional fruit, cartoon styling, neon cyberpunk, or interface elements.
Landscape 16:9 composition, monument fully inside the right third, generous dark
negative space on the left, no text baked into the image.
```

## Guardian: production prompt

```text
Create a premium living Avocado guardian character for a software development
brand, full body, isolated on a truly transparent background. One upright halved
Hass avocado with a glossy deep black obsidian pebbled outer shell, smooth warm
ivory ceramic face and a refined champagne-gold rim; a large inset bronze-gold
seed forms its central body. Expressive warm amber eyes, subtle confident brows
and a small reassuring smile. Elegant articulated dark metal arms and boots with
restrained gold trim. In one hand a translucent dark mint glass shield with a
simple luminous mint protective emblem; above the other hand three golden nodes
connected in a delicate orbit symbolize software automation. Character feels
alive, capable, kind and calm, a sophisticated cinematic 3D collectible, not a
military soldier. Physically based materials, deep volume, precise pebbled shell
texture, soft mint rim light on one side and warm gold on the other, beautiful
studio lighting with clear readable silhouette. Consistent with the obsidian,
ivory and gold monumental avocado in the supplied brand reference. All limbs,
shield and floating nodes fully visible inside the canvas with generous padding.
No background, no text, no letters, no logo, no watermark, no extra characters,
no guns, no harsh cyberpunk neon. Square image with real alpha transparency.
```

## Сборка и правила использования

`node site/scripts/build-og.cjs` собирает OG 1200×630 и PNG-иконки из готовых
WebP/SVG, используя локальные шрифты. `assets/og-minisite.png` и `assets/og.png`
показывают персонажа рядом с тезисом «Разрабатываем ПО. На вашей стороне».
Favicon ICO и apple-touch используют тот же векторный знак.

Hass/Ettinger сопровождают собственные SVG-схемы защиты и автоматизации.
Схемы не изображают якобы реальные показатели, SLA или клиентскую статистику.
Фон сайта сохраняет #080a09, основной акцент — мята, материалы иллюстраций — золото.
Анимация персонажа минимальна и отключается при `prefers-reduced-motion`.

«Без KYC» и оплата криптовалютой описывают процесс Avocado. Абсолютные гарантии
анонимности сетей, блокчейнов и третьих сторон не публикуются. Bulletproof остаётся
«скоро». Все услуги продаются от имени Avocado. Цены и география управляются
из CMS; клиент видит название Avocado, валюту, период и условия. Закупочные
источники, названия поставщиков и их ссылки доступны только администратору,
включая отсутствие этих данных в публичных URL и HTML. Программные подключения
к поставщикам — будущий этап.
