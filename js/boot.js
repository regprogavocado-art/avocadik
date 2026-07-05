import { BOOT_LINES, BOOT_GRANTED, BOOT_OPEN, BOOT_ENTER, BOOT_SKIP_HINT } from './config.js';
import { bus } from './bus.js';
import { isOpen } from './countdown.js';

// Boot-прелоадер «взлом»: печать лога с реальным прогрессом загрузки черепа,
// финал ACCESS GRANTED → клик = user gesture для звука и старта сцены.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function initBoot({ instant = false } = {}) {
  const boot = document.getElementById('boot');
  const log = boot.querySelector('.boot-log');
  const fin = boot.querySelector('.boot-final');
  const granted = boot.querySelector('.boot-granted');
  const enterBtn = boot.querySelector('.boot-enter');
  const noSound = boot.querySelector('.boot-nosound');
  const hint = boot.querySelector('.boot-hint');

  granted.textContent = isOpen() ? BOOT_OPEN : BOOT_GRANTED;
  enterBtn.textContent = BOOT_ENTER;
  hint.textContent = BOOT_SKIP_HINT;

  let skullProgress = 0;
  let skullReady = false;
  let skipped = false;
  bus.on('skull:progress', (p) => { skullProgress = p; });
  bus.on('skull:ready', () => { skullReady = true; skullProgress = 1; });

  const lineText = (l, progress = 1) => {
    if (l.progress) {
      const filled = Math.round(progress * 10);
      const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
      return `${l.text}......... [${bar}] ${Math.round(progress * 100)}%`;
    }
    const dots = l.pad ? '.'.repeat(Math.max(2, l.pad - l.text.length)) : '';
    return `${l.text}${dots} ${l.ok}`;
  };

  async function typeLine(l) {
    const div = document.createElement('div');
    div.className = 'boot-line';
    log.appendChild(div);
    if (skipped) { div.textContent = lineText(l, 1); return div; }

    if (l.progress) {
      div.textContent = lineText(l, skullProgress);
      // живой прогресс — ждём загрузку черепа (не дольше 6с)
      const t0 = performance.now();
      while (!skullReady && performance.now() - t0 < 6000 && !skipped) {
        div.textContent = lineText(l, skullProgress);
        await wait(80);
      }
      div.textContent = lineText(l, 1);
      return div;
    }

    const full = lineText(l);
    for (let i = 0; i <= full.length; i += 3) {
      if (skipped) break;
      div.textContent = full.slice(0, i);
      bus.emit('boot:key');
      await wait(9);
    }
    div.textContent = full;
    await wait(120 + Math.random() * 150);
    return div;
  }

  async function run() {
    if (!instant) {
      const skip = () => { skipped = true; };
      addEventListener('keydown', skip, { once: true });
      boot.addEventListener('pointerdown', skip, { once: true });
      await wait(400);
      for (const l of BOOT_LINES) await typeLine(l);
    }
    // дождаться черепа в любом случае
    while (!skullReady) await wait(100);

    boot.classList.add('is-flash');
    await wait(180);
    fin.classList.add('is-on');
    boot.classList.remove('is-flash');

    const finish = (sound) => {
      bus.emit('boot:done', { sound });
      boot.classList.add('is-out');
      setTimeout(() => boot.remove(), 700);
    };
    enterBtn.addEventListener('click', (e) => { e.stopPropagation(); finish(true); }, { once: true });
    noSound.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); finish(false); }, { once: true });
  }

  run();
}
