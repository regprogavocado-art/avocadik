import { CONFIG, CONSOLE_ART, COPY_TAIL } from './config.js';
import { bus } from './bus.js';

// Пасхалки: «6 7», консольный арт, реакция на копирование, тапы по лого.

export function initEggs({ skull, speech }) {
  let lastEgg = -Infinity;
  let last6 = 0;
  let tapCount = 0;
  let lastTap = 0;
  let copyReacted = false;

  const overlay = document.getElementById('egg67');
  const digit = overlay ? overlay.querySelector('.egg67-digit') : null;

  function trigger67() {
    const now = performance.now();
    if (now - lastEgg < CONFIG.egg67CooldownMs) {
      if (skull) skull.reproach(); // «серьёзно?»
      return;
    }
    lastEgg = now;
    bus.emit('egg:67');

    if (overlay) overlay.classList.add('is-on');
    if (skull) {
      const tl = skull.playEgg67();
      tl.eventCallback('onComplete', () => {
        if (overlay) overlay.classList.remove('is-on');
        if (speech) speech.react('egg67');
      });
    } else {
      setTimeout(() => {
        if (overlay) overlay.classList.remove('is-on');
        if (speech) speech.react('egg67');
      }, 2400);
    }
  }

  // такт качания → перещёлкиваем гигантскую цифру 6/7
  bus.on('egg:beat', ({ i }) => {
    if (!digit) return;
    digit.textContent = i % 2 === 0 ? '6' : '7';
    digit.classList.remove('is-glitch');
    void digit.offsetWidth;
    digit.classList.add('is-glitch');
  });

  // клавиатура: 6 → 7 с интервалом < 1.5с
  addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    if (e.key === '6') { last6 = performance.now(); return; }
    if (e.key === '7' && performance.now() - last6 < 1500) trigger67();
  });

  // мобила: 7 быстрых тапов по лого, на 6-м — глитч-подсказка
  const logo = document.getElementById('logo');
  if (logo) {
    logo.addEventListener('pointerdown', () => {
      const now = performance.now();
      tapCount = now - lastTap < 700 ? tapCount + 1 : 1;
      lastTap = now;
      if (tapCount === 6) {
        logo.classList.remove('is-hint');
        void logo.offsetWidth;
        logo.classList.add('is-hint');
      }
      if (tapCount >= 7) { tapCount = 0; trigger67(); }
    });
  }

  // DevTools-консоль
  console.log(
    '%c' + CONSOLE_ART,
    'font-family: "JetBrains Mono", Consolas, monospace; color:#eaeaea; background:#050505; font-size:12px; line-height:1.35;'
  );
  console.log('%cCONSOLE', 'color:#ff2a2a; font-weight:700; font-size:14px; font-family:monospace;');

  // копирование: хвост + реплика (только субтитрами, 1 раз за сессию)
  document.addEventListener('copy', (e) => {
    const sel = String(document.getSelection() || '');
    if (!sel.trim()) return;
    try {
      e.clipboardData.setData('text/plain', sel + COPY_TAIL);
      e.preventDefault();
    } catch { /* пусть копируется как есть */ }
    if (!copyReacted && speech) {
      copyReacted = true;
      speech.react('copy', { silent: true });
    }
  });

  // ховер по финальному CTA — реплика черепа
  const finalBtn = document.getElementById('finalBtn');
  if (finalBtn && speech) {
    finalBtn.addEventListener('mouseenter', () => {
      speech.react('ctaHover');
      if (skull) skull.lookAt(0, 0);
    });
  }
}
