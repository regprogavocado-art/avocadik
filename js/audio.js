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
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(4);
  noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 110;
  const ng = ctx.createGain();
  ng.gain.value = 0.05;

  const hum = ctx.createOscillator();
  hum.type = 'sine';
  hum.frequency.value = 42;
  const hg = ctx.createGain();
  hg.gain.value = 0.02;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.012;
  lfo.connect(lfoG).connect(hg.gain);

  noise.connect(lp).connect(ng).connect(master);
  hum.connect(hg).connect(master);
  noise.start(); hum.start(); lfo.start();
  ambientNodes = [noise, hum, lfo];
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

  enable(on) {
    enabled = on;
    if (on) {
      ensureCtx();
      ctx.resume();
      if (!ambientNodes.length) startAmbient();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.8);
    } else if (ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    }
  },

  click: () => burst({ freq: 2800, dur: 0.025, gain: 0.09 }),
  blip: () => tone({ from: 1400, to: 900, dur: 0.05, gain: 0.035 }),
  pop: () => burst({ freq: 1200, type: 'highpass', dur: 0.06, gain: 0.16 }),
  bassHit: () => {
    tone({ from: 110, to: 36, dur: 0.32, gain: 0.5, type: 'sine' });
    burst({ freq: 220, type: 'lowpass', dur: 0.12, gain: 0.3 });
  },
  stamp: () => {
    tone({ from: 90, to: 40, dur: 0.2, gain: 0.55, type: 'sine' });
    burst({ freq: 800, type: 'bandpass', dur: 0.05, gain: 0.2 });
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
