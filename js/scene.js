import * as THREE from 'three';
import { CONFIG } from './config.js';
import { isMobile } from './utils.js';
import { bus } from './bus.js';

// Единственный RAF живёт здесь; модули регистрируют свои апдейтеры.
const updaters = [];
let renderer, scene, camera, clock;
let paused = false;
let fpsSamples = [];
let fps = 60;
let qualityChecked = false;

export function registerUpdate(fn) {
  updaters.push(fn);
}

export function getFps() {
  return fps;
}

export function initScene(canvas) {
  const mobile = isMobile();
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true, // canvas лежит поверх DOM-типографики
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(CONFIG.bg, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? CONFIG.dprCap.mobile : CONFIG.dprCap.desktop));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 50);
  camera.position.set(0, 0, 3.4);

  clock = new THREE.Clock();

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    bus.emit('scene:resize', {
      height: renderer.domElement.height,
      projScale: renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)),
    });
  };
  addEventListener('resize', resize);
  resize();

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (paused) speechSynthesis?.cancel?.();
    else clock.getDelta(); // сброс дельты, чтобы не было скачка анимации
  });

  const loop = () => {
    requestAnimationFrame(loop);
    if (paused) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // скользящий FPS для adaptive quality
    if (dt > 0) {
      fpsSamples.push(1 / dt);
      if (fpsSamples.length > 90) fpsSamples.shift();
      fps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    }

    for (const fn of updaters) fn(dt, t);
    renderer.render(scene, camera);
  };
  loop();

  // adaptive quality: замер через 6с после boot:done
  bus.on('boot:done', () => {
    setTimeout(() => {
      if (qualityChecked) return;
      qualityChecked = true;
      if (fps < 45) {
        bus.emit('quality:degrade', { fps });
        if (fps < 30) renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25));
      }
    }, 6000);
  });

  return { renderer, scene, camera };
}
