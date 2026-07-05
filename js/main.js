import { CONFIG } from './config.js';
import { bus } from './bus.js';
import { isMobile, prefersReducedMotion, hasWebGL, debugMode } from './utils.js';
import { initCountdown } from './countdown.js';
import { initBoot } from './boot.js';
import { initAudio, audio } from './audio.js';
import { initPointer } from './pointer.js';
import { initSpeech } from './speech.js';
import { initEggs } from './eggs.js';
import { initScroll } from './scroll.js';

async function start() {
  history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  const mobile = isMobile();
  const reduced = prefersReducedMotion();
  const has3d = hasWebGL() && !reduced;
  document.body.classList.toggle('no3d', !has3d);
  document.body.classList.toggle('is-mobile', mobile);

  // ссылки из конфига
  document.querySelectorAll('[data-cta]').forEach((a) => { a.href = CONFIG.registerUrl; });
  document.querySelectorAll('[data-tg]').forEach((a) => { a.href = CONFIG.telegramUrl; });
  document.querySelectorAll('[data-mail]').forEach((a) => { a.href = CONFIG.mailUrl; });

  initCountdown();
  initAudio();

  // boot подписывается на skull:progress/skull:ready — стартуем ДО создания черепа
  let bootDone = false;
  bus.on('boot:done', async ({ sound }) => {
    bootDone = true;
    document.body.style.overflow = '';
    scrollTo(0, 0); // scroll anchoring может дёрнуть страницу при снятии overflow
    if (window.ScrollTrigger) ScrollTrigger.refresh();
    // speech может ещё инициализироваться (выбор голоса до 2с) — дожидаемся
    while (!refs.speech) await new Promise((r) => setTimeout(r, 100));
    refs.setSound(sound);
    if (refs.skull) refs.skull.playAssembly();
    setTimeout(() => refs.speech.startMonologue(), refs.skull ? 1900 : 400);
  });
  document.body.style.overflow = 'hidden';
  initBoot({ instant: reduced });
  const refs = { skull: null, speech: null, setSound: null };

  // ── 3D-сцена (three.js грузится только когда реально нужен) ──
  let skull = null;
  let getFps = () => 0;
  if (has3d) {
    try {
      const sceneMod = await import('./scene.js');
      const { createSkull } = await import('./skull.js');
      const { scene, camera } = sceneMod.initScene(document.getElementById('gl'));
      getFps = sceneMod.getFps;
      skull = await createSkull(scene, camera);
      dispatchEvent(new Event('resize')); // череп подписался на scene:resize после первого эмита
    } catch (err) {
      console.error('[NEGRA] 3D недоступен:', err);
      if (location.protocol === 'file:') {
        console.warn('[NEGRA] Открой через локальный сервер: python -m http.server 8000');
      }
      document.body.classList.add('no3d');
      bus.emit('skull:ready');
    }
  } else {
    document.getElementById('gl')?.remove();
    bus.emit('skull:ready');
  }

  refs.skull = skull;
  const speech = await initSpeech();
  initPointer();
  initEggs({ skull, speech });
  if (!reduced) initScroll({ skull, speech, has3d: !!skull });

  // ── проводка событий ──
  bus.on('pointer:move', ({ nx, ny }) => {
    if (!skull) return;
    skull.lookAt(nx * 0.9, ny * 0.9);
    const w = skull.pointerToWorld(nx, ny);
    skull.pushMouse(w.x, w.y, 0.22);
  });
  bus.on('pointer:gyro', ({ nx, ny }) => skull && skull.lookAt(nx, ny));
  bus.on('pointer:tap', ({ nx, ny }) => {
    if (!skull || !mobile) return;
    const w = skull.pointerToWorld(nx, ny);
    skull.pushMouse(w.x, w.y, 0.5);
    skull.glitch(0.3, 0.25);
  });
  bus.on('pointer:burst', () => skull && skull.glitch(0.8, 0.35));
  bus.on('idle:sleep', () => skull && skull.setSleep(true));
  bus.on('idle:wake', () => skull && skull.setSleep(false));
  bus.on('speech:active', (on) => skull && skull.setJawNoise(on));
  bus.on('speech:boundary', () => skull && skull.pulseJaw());
  bus.on('speech:char', () => skull && skull.pulseJaw());
  bus.on('launch:open', () => { speech.react('launch'); if (skull) skull.glitch(1, 0.5); });

  // ── звук / субтитры ──
  const sndBtns = [...document.querySelectorAll('[data-snd]')];
  const ccBtns = [...document.querySelectorAll('[data-cc]')];
  const captions = document.getElementById('captions');
  let soundOn = false;
  let ccOn = true;

  const setSound = (on) => {
    soundOn = on;
    audio.enable(on);
    speech.setSound(on);
    sndBtns.forEach((b) => {
      b.textContent = b.dataset.short != null
        ? (on ? '[SND✓]' : '[SND✕]')
        : (on ? '[SOUND: ON]' : '[SOUND: OFF]');
    });
  };
  const setCC = (on) => {
    ccOn = on;
    captions.classList.toggle('is-off', !on);
    ccBtns.forEach((b) => { b.textContent = on ? '[CC✓]' : '[CC✕]'; });
  };
  sndBtns.forEach((b) => b.addEventListener('click', () => setSound(!soundOn)));
  ccBtns.forEach((b) => b.addEventListener('click', () => setCC(!ccOn)));

  refs.speech = speech;
  refs.setSound = setSound;

  // ── uptime в футере ──
  const upEl = document.getElementById('uptime');
  const t0 = Date.now();
  const uptime = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const d = String(Math.floor(s / 86400)).padStart(2, '0');
    const h = String(Math.floor(s / 3600) % 24).padStart(2, '0');
    const m = String(Math.floor(s / 60) % 60).padStart(2, '0');
    if (upEl) upEl.textContent = `UPTIME: ${d}d ${h}h ${m}m // BUILD v0.9.1-prelaunch`;
  };
  uptime();
  setInterval(uptime, 10000);

  // ── дебаг-хук для Playwright: ?debug=1 ──
  if (debugMode) {
    window.__NEGRA__ = {
      get fps() { return Math.round(getFps()); },
      get pointCount() { return skull ? skull.pointCount : 0; },
      get bootDone() { return bootDone; },
      get speechMode() { return speech.mode; },
      get voice() { return speech.voiceName; },
      get soundOn() { return soundOn; },
      has3d: !!skull,
      forceSleep() { bus.emit('idle:sleep'); },
      forceWake() { bus.emit('idle:wake'); },
      egg67() { bus.emit('egg:67'); },
      skull,
    };
  }
}

start();
