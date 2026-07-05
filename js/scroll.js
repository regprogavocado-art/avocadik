import { LIVE_LINES } from './config.js';
import { bus } from './bus.js';
import { clamp } from './utils.js';

// Вся ScrollTrigger-хореография. GSAP подключён как UMD-глобал.

const GLYPHS = '#$%@&*+=?!<>{}[]/\\|01';
const rndGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

export function initScroll({ skull, speech, has3d }) {
  gsap.registerPlugin(ScrollTrigger);

  // эффективный разлёт = скролл-разлёт минус пересборка у финала
  let scatterHero = 0;
  let reassemble = 0;
  const applyScatter = () => {
    if (skull) skull.setScatter(clamp(scatterHero - reassemble, 0, 1));
  };

  // ── HERO: пин, череп в профиль → рассыпается, NEGRA разъезжается ──
  const heroUI = document.querySelectorAll('.hero-ui');
  const letters = document.querySelectorAll('.h1-letter');

  ScrollTrigger.create({
    trigger: '#hero',
    start: 'top top',
    end: '+=150%',
    pin: true,
    scrub: 0.5,
    onUpdate(self) {
      const p = self.progress;
      if (has3d && skull) {
        skull.group.children[0].rotation.y = p * 1.15;          // в профиль
        skull.group.scale.setScalar(skull.baseScale * (1 - p * 0.4));
        skull.group.position.y = 0.12 - p * 0.5;
        scatterHero = clamp((p - 0.45) / 0.5, 0, 1);
        applyScatter();
      }
      const fade = clamp(1 - (p - 0.2) / 0.35, 0, 1);
      heroUI.forEach((el) => { el.style.opacity = fade; });
      letters.forEach((el, i) => {
        const dir = i - (letters.length - 1) / 2;
        el.style.transform = `translateX(${dir * p * 38}vw)`;
        el.style.opacity = clamp(1 - p * 1.3, 0, 1);
      });
      // монолог: ушли с херо — пауза, вернулись — продолжение
      if (speech) { if (p > 0.85) speech.pause(); else speech.resume(); }
    },
  });

  // ── МАНИФЕСТ: пин + построчная дешифровка ──
  const lines = [...document.querySelectorAll('.mf-line')];
  lines.forEach((l) => { l.dataset.text = l.textContent.trim(); l.textContent = ''; });
  let redFired = false;

  ScrollTrigger.create({
    trigger: '#manifesto',
    start: 'top top',
    end: '+=200%',
    pin: true,
    scrub: 0.4,
    onUpdate(self) {
      const p = self.progress;
      const seg = 1 / lines.length;
      lines.forEach((l, i) => {
        const lp = clamp((p - i * seg * 0.8) / seg, 0, 1);
        const text = l.dataset.text;
        if (lp <= 0) { l.textContent = ''; return; }
        const k = Math.floor(lp * text.length);
        let out = text.slice(0, k);
        if (k < text.length && lp < 1) {
          for (let j = k; j < Math.min(k + 6, text.length); j++) {
            out += text[j] === ' ' ? ' ' : rndGlyph();
          }
          out += text.slice(Math.min(k + 6, text.length)).replace(/\S/g, ' ');
        }
        l.textContent = out;
        if (l.classList.contains('is-red') && lp > 0.9 && !redFired) {
          redFired = true;
          flashGlitch();
          if (skull) skull.glitch(0.5, 0.3);
        }
      });
    },
  });

  // ── ЧТО ВНУТРИ: карточки включаются как ЭЛТ-мониторы ──
  ScrollTrigger.batch('.bento-card', {
    start: 'top 88%',
    once: true,
    onEnter(batch) {
      batch.forEach((el, i) => setTimeout(() => el.classList.add('is-on'), i * 90));
    },
  });

  // живой терминал — строки бегут только когда секция видна
  const term = document.getElementById('liveTerm');
  if (term) {
    let li = 0;
    let timer = null;
    const push = () => {
      const div = document.createElement('div');
      div.textContent = LIVE_LINES[li++ % LIVE_LINES.length];
      term.appendChild(div);
      while (term.children.length > 6) term.removeChild(term.firstChild);
    };
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (!timer) { push(); timer = setInterval(push, 2200); }
      } else { clearInterval(timer); timer = null; }
    }).observe(term);
  }

  // ── ПРИВИЛЕГИИ: пин, номер бежит вверх, штамп FOUNDER ──
  const numEl = document.getElementById('memberNum');
  const capEl = document.getElementById('passCaption');
  const badge = document.getElementById('badge');
  const items = [...document.querySelectorAll('.priv-item')];
  let stamped = false;
  let lastNum = -1;

  ScrollTrigger.create({
    trigger: '#early',
    start: 'top top',
    end: '+=250%',
    pin: true,
    scrub: 0.4,
    onUpdate(self) {
      const p = self.progress;
      if (numEl) {
        const n = Math.round(Math.pow(2048, Math.pow(p, 1.4)));
        if (n !== lastNum) {
          lastNum = n;
          numEl.textContent = '#' + String(n).padStart(4, '0');
          numEl.classList.remove('is-glitch');
          void numEl.offsetWidth;
          numEl.classList.add('is-glitch');
        }
      }
      if (capEl) {
        capEl.textContent = p < 0.5
          ? 'ТВОЙ НОМЕР ПРЯМО СЕЙЧАС:'
          : 'ТВОЙ НОМЕР, ЕСЛИ ПОДУМАЕШЬ ЕЩЁ НЕДЕЛЮ:';
      }
      const active = Math.min(items.length - 1, Math.floor(p * items.length * 1.15));
      items.forEach((el, i) => el.classList.toggle('is-active', i <= active));
      if (badge && p > 0.85 && !stamped) {
        stamped = true;
        badge.classList.add('is-stamped');
        bus.emit('badge:stamp');
        flashGlitch();
      }
    },
  });

  // ── ФИНАЛЬНЫЙ CTA: череп собирается маленьким и смотрит в упор ──
  ScrollTrigger.create({
    trigger: '#final',
    start: 'top 90%',
    end: 'top 15%',
    scrub: 0.5,
    onUpdate(self) {
      if (!has3d || !skull) return;
      reassemble = self.progress;
      applyScatter();
    },
  });
  ScrollTrigger.create({
    trigger: '#final',
    start: 'top 60%',
    onEnter() {
      if (speech) speech.resume();
      if (skull) {
        skull.lookAt(0, 0);
        gsap.to(skull.group.position, { y: 0.42, duration: 0.8, ease: 'power2.out' });
        gsap.to(skull.group.scale, { x: 0.38, y: 0.38, z: 0.38, duration: 0.8, ease: 'power2.out' });
        gsap.to(skull.group.children[0].rotation, { y: 0, duration: 0.8 });
      }
      flashGlitch();
      document.getElementById('finalBtn')?.classList.add('is-decoded');
    },
    onLeaveBack() {
      if (skull) gsap.to(skull.group.position, { y: -0.4, duration: 0.6 });
    },
  });

  // мобильный sticky-бар — после того как прокрутили херо
  ScrollTrigger.create({
    trigger: '#manifesto',
    start: 'top 80%',
    onEnter: () => document.querySelector('.mobilebar')?.classList.add('is-on'),
    onLeaveBack: () => document.querySelector('.mobilebar')?.classList.remove('is-on'),
  });
}

// Полноэкранный глитч-кадр (1-2 кадра RGB-сдвига)
export function flashGlitch() {
  document.body.classList.remove('flash-glitch');
  void document.body.offsetWidth;
  document.body.classList.add('flash-glitch');
  setTimeout(() => document.body.classList.remove('flash-glitch'), 160);
}
