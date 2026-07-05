import { CONFIG } from './config.js';
import { bus } from './bus.js';

// Таймер до открытия: DD:HH:MM:SS, глитч-перещёлкивание цифр,
// режим «ШЛЮЗЫ ОТКРЫТЫ» после нуля.

export const isOpen = () => Date.now() >= CONFIG.launchDateUTC;

const UNITS = [
  { key: 'dd', label: 'ДН' },
  { key: 'hh', label: 'ЧС' },
  { key: 'mm', label: 'МН' },
  { key: 'ss', label: 'СК' },
];

function buildMarkup(el) {
  el.innerHTML = UNITS.map((u, i) =>
    `${i ? '<span class="cd-sep">:</span>' : ''}` +
    `<span class="cd-unit"><span class="cd-digits" data-u="${u.key}">` +
    `<span class="cd-d">0</span><span class="cd-d">0</span>` +
    `</span><span class="cd-label">${u.label}</span></span>`
  ).join('');
}

export function initCountdown() {
  const els = [...document.querySelectorAll('[data-countdown]')];
  els.forEach(buildMarkup);
  let opened = false;

  const render = () => {
    let left = Math.max(0, CONFIG.launchDateUTC - Date.now());
    const dd = Math.floor(left / 86400000);
    const hh = Math.floor(left / 3600000) % 24;
    const mm = Math.floor(left / 60000) % 60;
    const ss = Math.floor(left / 1000) % 60;
    const vals = { dd, hh, mm, ss };

    for (const el of els) {
      for (const u of UNITS) {
        const digits = el.querySelectorAll(`[data-u="${u.key}"] .cd-d`);
        const str = String(Math.min(99, vals[u.key])).padStart(2, '0');
        digits.forEach((d, i) => {
          if (d.textContent !== str[i]) {
            d.textContent = str[i];
            d.classList.remove('is-glitch');
            void d.offsetWidth; // перезапуск CSS-анимации
            d.classList.add('is-glitch');
          }
        });
      }
    }

    if (left <= 0 && !opened) {
      opened = true;
      openGates(els);
    }
  };

  const openGates = (list) => {
    document.body.classList.add('is-open');
    setTimeout(() => {
      list.forEach((el) => { el.innerHTML = '<span class="cd-open">ШЛЮЗЫ ОТКРЫТЫ</span>'; });
      document.querySelectorAll('[data-cta]').forEach((a) => {
        a.textContent = 'ВОЙТИ →';
        a.href = CONFIG.forumUrl;
      });
      bus.emit('launch:open');
    }, 900);
  };

  if (isOpen()) {
    // поздний визит — сразу режим OPEN, без мёртвых нулей
    els.forEach((el) => { el.innerHTML = '<span class="cd-open">ШЛЮЗЫ ОТКРЫТЫ</span>'; });
    document.body.classList.add('is-open');
    document.querySelectorAll('[data-cta]').forEach((a) => {
      a.textContent = 'ВОЙТИ →';
      a.href = CONFIG.forumUrl;
    });
    opened = true;
    return;
  }

  render();
  setInterval(render, 250);
}
