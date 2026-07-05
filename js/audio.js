import { bus } from './bus.js';

// Весь звук — синтез WebAudio, ноль файлов.
// Тёмный эмбиент-гул + UI-блипы + клики печати + бас-удары.

let ctx = null;
let master = null;
let ambientNodes = [];
let enabled = false;
let lastBlip = 0;

function ensureCtx() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
}

function noiseBuffer(seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // коричневый шум
    data[i] = last * 3.5;
  }
  return buf;
}

function startAmbient() {
  // низкий гул (для наушников/колонок с басом)
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(4);
  noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 180;
  const ng = ctx.createGain();
  ng.gain.value = 0.1;

  const hum = ctx.createOscillator();
  hum.type = 'sine';
  hum.frequency.value = 48;
  const hg = ctx.createGain();
  hg.gain.value = 0.05;

  // «воздух» серверной в среднем диапазоне — слышен на любых динамиках
  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(4);
  air.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 1.2;
  const ag = ctx.createGain();
  ag.gain.value = 0.022;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.025;
  lfo.connect(lfoG).connect(hg.gain);

  noise.connect(lp).connect(ng).connect(master);
  air.connect(bp).connect(ag).connect(master);
  hum.connect(hg).connect(master);
  noise.start(); air.start(); hum.start(); lfo.start();
  ambientNodes = [noise, air, hum, lfo];
}

function burst({ freq = 2800, type = 'bandpass', dur = 0.03, gain = 0.1 }) {
  if (!enabled || !ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.1);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(f).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + dur + 0.05);
}

function tone({ from = 1200, to = null, dur = 0.06, gain = 0.05, type = 'square' }) {
  if (!enabled || !ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, ctx.currentTime);
  if (to) o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + dur + 0.05);
}

export const audio = {
  get enabled() { return enabled; },
  get state() {
    return ctx ? { ctx: ctx.state, gain: +master.gain.value.toFixed(2), enabled } : { ctx: 'none', enabled };
  },

  // Синхронная разблокировка внутри пользовательского клика (iOS/автоплей-политики)
  unlock() {
    try {
      ensureCtx();
      ctx.resume();
      const b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, 22050);
      b.connect(ctx.destination);
      b.start(0);
    } catch { /* нет WebAudio — просто тишина */ }
  },

  enable(on) {
    enabled = on;
    if (on) {
      ensureCtx();
      ctx.resume();
      if (!ambientNodes.length) startAmbient();
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now); // без опорной точки ramp может не стартовать
      master.gain.linearRampToValueAtTime(1, now + 0.6);
      // слышимое подтверждение «звук включён»
      setTimeout(() => { audio.blip(); }, 150);
      setTimeout(() => { audio.bassHit(); }, 320);
    } else if (ctx) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.25);
    }
  },

  click: () => burst({ freq: 2800, dur: 0.03, gain: 0.22 }),
  blip: () => tone({ from: 1400, to: 900, dur: 0.06, gain: 0.09 }),
  pop: () => burst({ freq: 1200, type: 'highpass', dur: 0.06, gain: 0.28 }),
  bassHit: () => {
    tone({ from: 110, to: 36, dur: 0.32, gain: 0.7, type: 'sine' });
    burst({ freq: 300, type: 'lowpass', dur: 0.12, gain: 0.4 });
  },
  stamp: () => {
    tone({ from: 90, to: 40, dur: 0.2, gain: 0.7, type: 'sine' });
    burst({ freq: 800, type: 'bandpass', dur: 0.05, gain: 0.3 });
  },
};

export function initAudio() {
  bus.on('speech:char', () => audio.click());
  bus.on('boot:key', () => audio.click());
  bus.on('egg:beat', () => audio.bassHit());
  bus.on('pointer:burst', () => audio.pop());
  bus.on('badge:stamp', () => audio.stamp());

  document.addEventListener('mouseover', (e) => {
    if (!e.target.closest('a, button')) return;
    const now = performance.now();
    if (now - lastBlip < 90) return;
    lastBlip = now;
    audio.blip();
  });
}
