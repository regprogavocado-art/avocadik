# Рендеры категорий Avocado

Создать пять отдельных изображений. Положить исходные PNG в `D:\\AvocadoREST\\assets\\renders\\`. Предпочтительно 4:3, 2048×1536 или выше; можно квадрат. Каждый кадр должен допускать кадрирование 4:3 и 1:1, объект — в правой нижней области. Слева и сверху оставить очень тёмное свободное место. Без текста, букв, цифр, логотипов и водяных знаков.

Общая палитра: #080a09, тени #0f1a15, золото #e3b45c, сдержанная мята #8ff0a6. Реалистичные материалы, мягкий туман, контроль бликов; без киберпанка, неоновой синевы и интерфейсов.

## category-domains.png

```text
Use case: ads-marketing
Asset type: premium web catalogue category photograph for Domain names. Single image, landscape 4:3, ideally 2048x1536 pixels or higher.
Primary request: Cinematic photorealistic product landscape at night: a single polished dark obsidian sphere set within delicate concentric rings on a wet black stone plinth at the edge of a still mountain lake, very subtle warm golden light tracing several fine orbital arcs; a physical premium product photograph suggesting a connected namespace.
Composition: Subject in the lower right half, with generous very dark empty negative space on the left and upper third. All essential elements fit inside a central square-safe crop. Keep edges near-black so they blend into a website.
Lighting and palette: Near-black #080a09 background, forest-green #0f1a15 shadows, soft warm golden #e3b45c accents, extremely restrained mint-green #8ff0a6 rim light. Very dark, realistic, refined and quiet. Natural wet stone and subtle mist, high-end photographic detail.
Avoid: text, letters, numbers, logos, watermarks, people, bright sky, daylight, cyberpunk, neon blue, cartoon, flat illustration, HUD, dashboard, plastic-looking materials, excessive bloom, busy composition.
```

## category-vps.png

```text
Use case: ads-marketing
Asset type: premium web catalogue category photograph for Virtual private servers. Single image, landscape 4:3, ideally 2048x1536 pixels or higher.
Primary request: Cinematic photorealistic product landscape at night: a small group of three precise upright dark brushed-metal server monoliths standing on separate wet black stone ledges, restrained warm golden seams and subtle mint-green edge light, distant dark mountain lake and thin mist; clear physical material and restrained premium engineering.
Composition: Subject in the lower right half, with generous very dark empty negative space on the left and upper third. All essential elements fit inside a central square-safe crop. Keep edges near-black so they blend into a website.
Lighting and palette: Near-black #080a09 background, forest-green #0f1a15 shadows, soft warm golden #e3b45c accents, extremely restrained mint-green #8ff0a6 rim light. Very dark, realistic, refined and quiet. Natural wet stone and subtle mist, high-end photographic detail.
Avoid: text, letters, numbers, logos, watermarks, people, bright sky, daylight, cyberpunk, neon blue, cartoon, flat illustration, HUD, dashboard, plastic-looking materials, excessive bloom, busy composition.
```

## category-dedicated.png

```text
Use case: ads-marketing
Asset type: premium web catalogue category photograph for Dedicated servers. Single image, landscape 4:3, ideally 2048x1536 pixels or higher.
Primary request: Cinematic photorealistic product landscape at night: one substantial sculptural black anodized-metal server tower on dark wet mountain stone, subtle finely machined vents and one warm golden vertical light slit, tiny restrained mint-green rim light, distant mountain ridges and thin mist, no readable labels.
Composition: Subject in the lower right half, with generous very dark empty negative space on the left and upper third. All essential elements fit inside a central square-safe crop. Keep edges near-black so they blend into a website.
Lighting and palette: Near-black #080a09 background, forest-green #0f1a15 shadows, soft warm golden #e3b45c accents, extremely restrained mint-green #8ff0a6 rim light. Very dark, realistic, refined and quiet. Natural wet stone and subtle mist, high-end photographic detail.
Avoid: text, letters, numbers, logos, watermarks, people, bright sky, daylight, cyberpunk, neon blue, cartoon, flat illustration, HUD, dashboard, plastic-looking materials, excessive bloom, busy composition.
```

## category-bulletproof.png

```text
Use case: ads-marketing
Asset type: premium web catalogue category photograph for Bulletproof hosting (coming soon). Single image, landscape 4:3, ideally 2048x1536 pixels or higher.
Primary request: Cinematic photorealistic product landscape at night: a sealed dark obsidian architectural vault embedded into a distant mountain rock face, fine golden seam around a closed rectangular entrance, restrained mint rim reflection on wet stone, thin low mist, quiet premium sense of resilience and a product not yet opened, no weapons or military imagery.
Composition: Subject in the lower right half, with generous very dark empty negative space on the left and upper third. All essential elements fit inside a central square-safe crop. Keep edges near-black so they blend into a website.
Lighting and palette: Near-black #080a09 background, forest-green #0f1a15 shadows, soft warm golden #e3b45c accents, extremely restrained mint-green #8ff0a6 rim light. Very dark, realistic, refined and quiet. Natural wet stone and subtle mist, high-end photographic detail.
Avoid: text, letters, numbers, logos, watermarks, people, bright sky, daylight, cyberpunk, neon blue, cartoon, flat illustration, HUD, dashboard, plastic-looking materials, excessive bloom, busy composition.
```

## category-proxies.png

```text
Use case: ads-marketing
Asset type: premium web catalogue category photograph for Proxies. Single image, landscape 4:3, ideally 2048x1536 pixels or higher.
Primary request: Cinematic photorealistic product landscape at night: a series of slender luminous warm-gold paths weaving between five small smooth obsidian stone markers across a dark wet mountain plateau beside a perfectly still lake, layered dark green ridges fading into mist, subtle mint rim reflections, physical photoreal materials.
Composition: Subject in the lower right half, with generous very dark empty negative space on the left and upper third. All essential elements fit inside a central square-safe crop. Keep edges near-black so they blend into a website.
Lighting and palette: Near-black #080a09 background, forest-green #0f1a15 shadows, soft warm golden #e3b45c accents, extremely restrained mint-green #8ff0a6 rim light. Very dark, realistic, refined and quiet. Natural wet stone and subtle mist, high-end photographic detail.
Avoid: text, letters, numbers, logos, watermarks, people, bright sky, daylight, cyberpunk, neon blue, cartoon, flat illustration, HUD, dashboard, plastic-looking materials, excessive bloom, busy composition.
```

## Конвертация

После получения файлов выполнить `python site/scripts/convert-renders.py`, затем `cd site && npm run assets`. Конвертер сохраняет `assets/img/category-*.webp` и мобильные `category-*-640.webp` и не увеличивает исходники. PNG остаются вне git. Исходные кадры осмотреть до подключения.

