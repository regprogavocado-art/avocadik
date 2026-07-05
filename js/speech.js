import { CONFIG, MONOLOGUE, MONOLOGUE_MOBILE, IDLE_LINES, REACTIONS, SLEEP_SUBTITLE } from './config.js';
import { bus } from './bus.js';
import { isMobile } from './utils.js';

// Речь черепа: TTS (Web Speech API) + терминальные субтитры.
// Деградация: нет голоса / звук выключен → «терминал» (печать + клики).

const synth = window.speechSynthesis || null;
const keepAlive = []; // защита utterance от GC (известный баг Chrome)

function pickVoice() {
  return new Promise((resolve) => {
    if (!synth) return resolve(null);
    const choose = () => {
      const voices = synth.getVoices();
      if (!voices.length) return null;
      const ru = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('ru'));
      return ru.find((v) => v.localService) || ru[0] || null;
    };
    const v = choose();
    if (v) return resolve(v);
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(choose()); } };
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 2000);
  });
}

export async function initSpeech() {
  const mobile = isMobile();
  const capText = document.querySelector('#captions .cap-text');
  const capEl = document.getElementById('captions');

  const voice = await pickVoice();
  let soundOn = false;
  let boundaryWorks = true; // оптимизм; выключаем, если boundary не пришёл
  let speaking = false;
  let stopCurrent = null;   // прерывание текущей фразы
  let paused = false;
  let sleeping = false;
  let lastReaction = 0;
  const pendingReactions = [];
  let monologueDone = false;

  const setActive = (on) => {
    if (speaking === on) return;
    speaking = on;
    bus.emit('speech:active', on);
  };

  const showCaption = (text) => {
    capEl.classList.add('is-on');
    capText.textContent = text;
  };

  // ── одна фраза ────────────────────────────────────────────────
  function speakTTS(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.9;
      u.pitch = 0.7;
      keepAlive.push(u);
      let shown = 0;
      let gotBoundary = false;
      let finished = false;
      let estTimer = null;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(estTimer);
        keepAlive.splice(keepAlive.indexOf(u), 1);
        showCaption(text);
        stopCurrent = null;
        resolve();
      };
      stopCurrent = () => { synth.cancel(); finish(); };

      const startEstimated = () => {
        const cps = 13 * u.rate;
        estTimer = setInterval(() => {
          shown = Math.min(text.length, shown + Math.max(1, Math.round(cps / 10)));
          showCaption(text.slice(0, shown));
          if (shown >= text.length) clearInterval(estTimer);
        }, 100);
      };

      u.onstart = () => {
        showCaption('');
        setTimeout(() => { if (!gotBoundary && !finished) { boundaryWorks = false; startEstimated(); } }, 1200);
      };
      u.onboundary = (e) => {
        gotBoundary = true;
        shown = Math.min(text.length, (e.charIndex || 0) + (e.charLength || 6));
        showCaption(text.slice(0, shown));
        bus.emit('speech:boundary', { charIndex: e.charIndex });
      };
      u.onend = finish;
      u.onerror = finish;

      // страховка от повисшего utterance
      setTimeout(finish, (text.length / 8) * 1000 + 4000);
      synth.speak(u);
    });
  }

  function speakTyped(text) {
    return new Promise((resolve) => {
      showCaption('');
      let i = 0;
      let finished = false;
      const cps = 38;
      const timer = setInterval(() => {
        i++;
        showCaption(text.slice(0, i));
        bus.emit('speech:char');
        if (i >= text.length) {
          clearInterval(timer);
          if (!finished) { finished = true; stopCurrent = null; setTimeout(resolve, 350); }
        }
      }, 1000 / cps + Math.random() * 8);
      stopCurrent = () => {
        clearInterval(timer);
        if (!finished) { finished = true; showCaption(text); stopCurrent = null; resolve(); }
      };
    });
  }

  const speakPhrase = (text) =>
    (soundOn && voice && synth) ? speakTTS(text) : speakTyped(text);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitWhile = async (cond) => { while (cond()) await wait(200); };

  // ── реплика = массив фраз ─────────────────────────────────────
  async function playPhrases(phrases, { interruptible = true } = {}) {
    setActive(true);
    for (const ph of phrases) {
      if (interruptible) {
        await waitWhile(() => paused || sleeping || document.hidden);
        if (pendingReactions.length) break;
      }
      bus.emit('speech:phrase', { text: ph });
      await speakPhrase(ph);
      await wait(600 + Math.random() * 300);
    }
    setActive(false);
  }

  async function drainReactions() {
    while (pendingReactions.length) {
      const phrases = pendingReactions.shift();
      await playPhrases(phrases, { interruptible: false });
      await wait(400);
    }
  }

  // ── публичный API ─────────────────────────────────────────────
  const api = {
    get mode() { return (soundOn && voice && synth) ? 'tts' : 'fallback'; },
    get voiceName() { return voice ? voice.name : null; },

    setSound(on) {
      soundOn = on;
      if (!on && synth) { synth.cancel(); }
    },

    react(key, { silent = false } = {}) {
      const now = performance.now();
      if (now - lastReaction < CONFIG.reactionMinGapMs) return;
      lastReaction = now;
      const phrases = REACTIONS[key];
      if (!phrases) return;
      if (silent) {
        // только субтитры, без очереди и голоса
        showCaption(phrases[0]);
        return;
      }
      pendingReactions.push(phrases);
      if (!speaking) drainReactions();
    },

    async startMonologue() {
      const script = mobile ? MONOLOGUE_MOBILE : MONOLOGUE;
      for (const replica of script) {
        await waitWhile(() => paused || sleeping || document.hidden);
        await drainReactions();
        await playPhrases(replica.phrases);
        await wait(2500 + Math.random() * 2000);
      }
      monologueDone = true;
      // цикл при бездействии
      setInterval(async () => {
        if (speaking || paused || sleeping || document.hidden) return;
        const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
        pendingReactions.push(line);
        drainReactions();
      }, CONFIG.idleLineEveryMs);
    },

    pause() { paused = true; if (synth) synth.cancel(); if (stopCurrent) stopCurrent(); },
    resume() { paused = false; },
  };

  // ── события ───────────────────────────────────────────────────
  bus.on('idle:sleep', () => {
    sleeping = true;
    if (stopCurrent) stopCurrent();
    if (synth) synth.cancel();
    setActive(false);
    showCaption(SLEEP_SUBTITLE);
  });
  bus.on('idle:wake', () => {
    sleeping = false;
    lastReaction = 0; // пробуждение всегда комментируем
    api.react('wake');
  });
  addEventListener('pagehide', () => synth && synth.cancel());

  // heartbeat против «вечной паузы» Chrome
  if (synth) setInterval(() => { if (speaking && soundOn) synth.resume(); }, 10000);

  return api;
}
