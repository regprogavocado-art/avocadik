import * as THREE from 'three';

// Атлас глифов: 8×8 ячеек по 64px = текстура 512×512, генерируется в рантайме.
// Ноль байт ассетов, шрифт всегда совпадает с моношрифтом сайта.
const CHARS =
  '01<>{}[]/\\|;:#$%@&*+=?!~^_.…0123456789ABCDEFXNEGRАЫЪЖДЛФЦ§«»01#$';

export const GLYPH_COUNT = 64;

export async function buildGlyphAtlas() {
  try {
    await document.fonts.load('700 44px "JetBrains Mono"');
  } catch { /* нет Font Loading API — рисуем системным моно */ }

  const size = 512;
  const cell = size / 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.font = '700 44px "JetBrains Mono", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < GLYPH_COUNT; i++) {
    const ch = CHARS[i % CHARS.length];
    const x = (i % 8) * cell + cell / 2;
    const y = Math.floor(i / 8) * cell + cell / 2;
    ctx.fillText(ch, x, y + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}
