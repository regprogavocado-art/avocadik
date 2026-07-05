import { CONFIG } from './config.js';
import { bus } from './bus.js';
import { isMobile } from './utils.js';

// Мышь/тач/гироскоп → нормализованные координаты, скорость, idle-таймер.
export function initPointer() {
  const mobile = isMobile();
  let lastX = 0, lastY = 0, lastT = performance.now();
  let idleTimer = null;
  let sleeping = false;
  let lastBurst = 0;

  const cursor = document.getElementById('cursor');

  const wake = () => {
    if (sleeping) {
      sleeping = false;
      bus.emit('idle:wake');
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      sleeping = true;
      bus.emit('idle:sleep');
    }, CONFIG.sleepAfterMs);
  };
  wake();

  const emitMove = (x, y) => {
    const nx = (x / innerWidth) * 2 - 1;
    const ny = -(y / innerHeight) * 2 + 1;
    bus.emit('pointer:move', { x, y, nx, ny });
  };

  addEventListener('pointermove', (e) => {
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const speed = (Math.hypot(e.clientX - lastX, e.clientY - lastY) / dt) * 1000;
    lastX = e.clientX; lastY = e.clientY; lastT = now;

    if (cursor) {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }
    if (speed > CONFIG.burstSpeed && now - lastBurst > CONFIG.burstCooldownMs) {
      lastBurst = now;
      bus.emit('pointer:burst', { speed });
    }
    emitMove(e.clientX, e.clientY);
    wake();
  }, { passive: true });

  addEventListener('pointerdown', (e) => {
    bus.emit('pointer:tap', {
      x: e.clientX, y: e.clientY,
      nx: (e.clientX / innerWidth) * 2 - 1,
      ny: -(e.clientY / innerHeight) * 2 + 1,
    });
    wake();
  }, { passive: true });

  addEventListener('scroll', wake, { passive: true });
  addEventListener('keydown', wake);

  // Гироскоп: Android — сразу; iOS — по первому тапу (requestPermission)
  if (mobile) {
    const useGyro = () => {
      addEventListener('deviceorientation', (e) => {
        if (e.gamma == null || e.beta == null) return;
        const nx = Math.max(-1, Math.min(1, e.gamma / 30));
        const ny = Math.max(-1, Math.min(1, (e.beta - 45) / -30));
        bus.emit('pointer:gyro', { nx, ny });
      }, { passive: true });
    };
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const ask = () => {
        DOE.requestPermission().then((s) => { if (s === 'granted') useGyro(); }).catch(() => {});
        removeEventListener('pointerdown', ask);
      };
      addEventListener('pointerdown', ask);
    } else if (DOE) {
      useGyro();
    }
  }

  // Ховеры по интерактиву — состояние кастомного курсора
  if (cursor && !mobile) {
    document.addEventListener('mouseover', (e) => {
      cursor.classList.toggle('is-link', !!e.target.closest('a, button, [data-hover]'));
    });
  }
}
