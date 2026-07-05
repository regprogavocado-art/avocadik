import * as THREE from 'three';
import { CONFIG } from './config.js';
import { bus } from './bus.js';
import { isMobile, mulberry32, clamp } from './utils.js';
import { buildGlyphAtlas, GLYPH_COUNT } from './glyphAtlas.js';
import { registerUpdate } from './scene.js';

// ────────────────────────────────────────────────────────────────
// Процедурный череп на SDF: полностью оригинальная геометрия,
// ноль внешних ассетов. Сэмплируем точки на поверхности |sdf|≈0.
// ────────────────────────────────────────────────────────────────

const KIND = { SKULL: 0, JAW: 1, EYE: 2 };
const JAW_PIVOT = new THREE.Vector3(0, -0.44, -0.10);

// — SDF-примитивы (по x,y,z, без аллокаций) —
function sdSphere(x, y, z, cx, cy, cz, r) {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
function sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
function sdRoundBox(x, y, z, cx, cy, cz, bx, by, bz, r) {
  const qx = Math.abs(x - cx) - bx, qy = Math.abs(y - cy) - by, qz = Math.abs(z - cz) - bz;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
const smin = (a, b, k) => {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};
const smax = (a, b, k) => -smin(-a, -b, k);

// Черепная коробка + лицевой блок + скулы, минус глазницы и носовая полость
function sdfSkull(x, y, z) {
  let d = sdEllipsoid(x, y, z, 0, 0.30, -0.06, 0.60, 0.66, 0.70);           // черепная коробка
  d = smin(d, sdRoundBox(x, y, z, 0, -0.28, 0.26, 0.22, 0.17, 0.18, 0.10), 0.18); // верхняя челюсть
  d = smin(d, sdSphere(x, y, z, 0.38, -0.12, 0.24, 0.12), 0.10);            // скула правая
  d = smin(d, sdSphere(x, y, z, -0.38, -0.12, 0.24, 0.12), 0.10);           // скула левая
  d = smax(d, -sdSphere(x, y, z, 0.23, 0.0, 0.56, 0.22), 0.05);             // глазница правая
  d = smax(d, -sdSphere(x, y, z, -0.23, 0.0, 0.56, 0.22), 0.05);            // глазница левая
  d = smax(d, -sdRoundBox(x, y, z, 0, -0.22, 0.55, 0.05, 0.12, 0.10, 0.03), 0.04); // нос
  return d;
}
// Нижняя челюсть: тело + подбородок + две ветви
function sdfJaw(x, y, z) {
  let d = sdRoundBox(x, y, z, 0, -0.62, 0.13, 0.17, 0.07, 0.13, 0.07);
  d = smin(d, sdSphere(x, y, z, 0, -0.64, 0.30, 0.09), 0.08);
  d = smin(d, sdRoundBox(x, y, z, 0.26, -0.44, -0.03, 0.035, 0.13, 0.07, 0.03), 0.06);
  d = smin(d, sdRoundBox(x, y, z, -0.26, -0.44, -0.03, 0.035, 0.13, 0.07, 0.03), 0.06);
  return d;
}

function sampleSurface(sdf, bbox, count, rng, out, kind) {
  const EPS = 1e-3;
  let made = 0, guard = 0;
  while (made < count && guard < count * 400) {
    guard++;
    let x = bbox.min[0] + rng() * (bbox.max[0] - bbox.min[0]);
    let y = bbox.min[1] + rng() * (bbox.max[1] - bbox.min[1]);
    let z = bbox.min[2] + rng() * (bbox.max[2] - bbox.min[2]);
    let d = sdf(x, y, z);
    if (Math.abs(d) > 0.22) continue;
    // проекция на поверхность градиентным спуском
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 4; i++) {
      nx = sdf(x + EPS, y, z) - sdf(x - EPS, y, z);
      ny = sdf(x, y + EPS, z) - sdf(x, y - EPS, z);
      nz = sdf(x, y, z + EPS) - sdf(x, y, z - EPS);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      x -= nx * d; y -= ny * d; z -= nz * d;
      d = sdf(x, y, z);
    }
    if (Math.abs(d) > 0.005) continue;
    out.push({ x, y, z, nx, ny, nz, kind });
    made++;
  }
  return made;
}

// ────────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec3 aNrm;
attribute vec3 aScatter;
attribute vec4 aRand;
attribute float aGlyph;
attribute float aKind;

uniform float uTime, uAnim, uAssembly, uScatter, uSleep, uGlitch, uJaw;
uniform float uSize, uScale, uMouseStrength, uMouseRadius;
uniform vec3 uMouse;

varying float vGlyph, vShade, vKind, vDim;
varying vec4 vRand;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 rotJaw(vec3 p, float a){
  vec3 piv = vec3(0.0, -0.44, -0.10);
  p -= piv;
  float c = cos(a), s = sin(a);
  p.yz = mat2(c, -s, s, c) * p.yz;
  return p + piv;
}

void main() {
  // сборка (boot) и разлёт (скролл) с индивидуальным стаггером
  float prog = smoothstep(0.0, 1.0, clamp(uAssembly * 1.3 - aRand.x * 0.3, 0.0, 1.0));
  float sc   = smoothstep(0.0, 1.0, clamp(uScatter  * 1.3 - aRand.y * 0.3, 0.0, 1.0));
  float mixT = prog * (1.0 - sc);

  vec3 base = aBase + aNrm * sin(uAnim * 1.4 + aRand.y * 6.2831) * 0.008; // дыхание
  if (aKind > 0.5 && aKind < 1.5) base = rotJaw(base, uJaw * 0.35);       // челюсть

  // дрейф глифов в рассеянном состоянии — живой фон манифеста
  vec3 scat = aScatter + vec3(
    sin(uAnim * 0.15 + aRand.z * 6.2831),
    cos(uAnim * 0.12 + aRand.w * 6.2831),
    sin(uAnim * 0.10 + aRand.x * 6.2831)) * 0.4;

  vec3 pos = mix(scat, base, mixT);

  if (uGlitch > 0.001) {
    float g = hash(aRand.zw + floor(uTime * 24.0));
    pos += (vec3(hash(aRand.xy + g), hash(aRand.yz + g), hash(aRand.wx + g)) - 0.5) * uGlitch * 0.35;
  }

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec3 dm = world.xyz - uMouse;
  float push = smoothstep(uMouseRadius, 0.0, length(dm)) * uMouseStrength;
  world.xyz += normalize(dm + vec3(1e-4)) * push * mixT;

  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;

  float glyph = aGlyph;
  if (uGlitch > 0.15) {
    glyph = mod(glyph + floor(hash(aRand.xy + floor(uTime * 30.0)) * 64.0) * step(aRand.z, uGlitch + 0.3), 64.0);
  }
  vGlyph = glyph;
  vKind = aKind;
  vRand = aRand;

  vec3 n = normalize(mat3(modelMatrix) * aNrm);
  float shade = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 0.6, 1.0))), 0.0);
  shade *= 0.35 + 0.65 * smoothstep(-6.0, -2.0, mv.z); // depth fade
  vShade = shade;
  vDim = mix(1.0, 0.45, uSleep);

  float size = uSize * (0.8 + 0.4 * aRand.w);
  if (aKind > 1.5) size *= 1.5; // глаза
  gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 1.0, 64.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform vec3 uAccent;
uniform float uEye, uTime;

varying float vGlyph, vShade, vKind, vDim;
varying vec4 vRand;

void main() {
  vec2 cell = vec2(mod(vGlyph, 8.0), floor(vGlyph / 8.0));
  vec2 uv = (cell + gl_PointCoord) / 8.0;
  float a = texture2D(uAtlas, uv).r;
  if (a < 0.12) discard;

  vec3 col = vec3(0.88);
  if (vRand.z > 0.975) col = uAccent * 1.1;                       // редкие красные глифы
  if (vKind > 1.5) {                                              // глаза
    col = uAccent * (1.3 + 0.6 * sin(uTime * 2.0 + vRand.y * 6.2831)) * uEye;
  }
  gl_FragColor = vec4(col * vShade * vDim, a * 0.58);
}
`;

// ────────────────────────────────────────────────────────────────

export async function createSkull(scene, camera) {
  const mobile = isMobile();
  const COUNT = mobile ? CONFIG.particles.mobile : CONFIG.particles.desktop;
  const rng = mulberry32(0x67);

  const atlas = await buildGlyphAtlas();
  atlas.flipY = false;
  atlas.needsUpdate = true;

  // — сэмплинг: 84% череп, 11% челюсть, 5% глаза —
  const pts = [];
  const skullBox = { min: [-0.75, -0.6, -0.85], max: [0.75, 1.05, 0.75] };
  const jawBox = { min: [-0.35, -0.8, -0.15], max: [0.35, -0.28, 0.45] };
  const nSkull = Math.floor(COUNT * 0.84);
  const nJaw = Math.floor(COUNT * 0.11);
  const nEye = COUNT - nSkull - nJaw;

  const CHUNK = 2500;
  for (let done = 0; done < nSkull; done += CHUNK) {
    sampleSurface(sdfSkull, skullBox, Math.min(CHUNK, nSkull - done), rng, pts, KIND.SKULL);
    bus.emit('skull:progress', pts.length / COUNT);
    await new Promise((r) => setTimeout(r));
  }
  sampleSurface(sdfJaw, jawBox, nJaw, rng, pts, KIND.JAW);
  // глаза — плотные сферы в глазницах
  for (let i = 0; i < nEye; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1), r = 0.075 * Math.cbrt(rng());
    pts.push({
      x: side * 0.23 + r * Math.sin(ph) * Math.cos(th),
      y: -0.02 + r * Math.sin(ph) * Math.sin(th),
      z: 0.44 + r * Math.cos(ph),
      nx: 0, ny: 0, nz: 1, kind: KIND.EYE,
    });
  }
  bus.emit('skull:progress', 1);

  // — буферы —
  const N = pts.length;
  const base = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3);
  const scatter = new Float32Array(N * 3);
  const rand = new Float32Array(N * 4);
  const glyph = new Float32Array(N);
  const kind = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const p = pts[i];
    base.set([p.x, p.y, p.z], i * 3);
    nrm.set([p.nx, p.ny, p.nz], i * 3);
    const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1), rr = 3.5 + rng() * 3;
    scatter.set([
      rr * Math.sin(ph) * Math.cos(th),
      rr * Math.sin(ph) * Math.sin(th) * 0.7,
      rr * Math.cos(ph) * 0.5 - 1.0,
    ], i * 3);
    rand.set([rng(), rng(), rng(), rng()], i * 4);
    glyph[i] = Math.floor(rng() * GLYPH_COUNT);
    kind[i] = p.kind;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3)); // для frustum-логики three
  geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  geo.setAttribute('aGlyph', new THREE.BufferAttribute(glyph, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);

  const uniforms = {
    uTime: { value: 0 },
    uAnim: { value: 0 },
    uAssembly: { value: 0 },
    uScatter: { value: 0 },
    uSleep: { value: 0 },
    uGlitch: { value: 0 },
    uJaw: { value: 0 },
    uSize: { value: mobile ? 0.030 : 0.022 }, // мировой размер глифа
    uScale: { value: 700 },
    uMouse: { value: new THREE.Vector3(99, 99, 99) },
    uMouseRadius: { value: 0.55 },
    uMouseStrength: { value: 0 },
    uAtlas: { value: atlas },
    uAccent: { value: new THREE.Color(CONFIG.accent) },
    uEye: { value: 1 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  group.position.y = 0.12;
  const baseScale = innerWidth < innerHeight ? 0.82 : 1; // портретные экраны
  group.scale.setScalar(baseScale);
  scene.add(group);

  bus.on('scene:resize', ({ projScale }) => { uniforms.uScale.value = projScale * (mobile ? 0.85 : 1); });
  bus.on('quality:degrade', () => geo.setDrawRange(0, Math.floor(N * 0.7)));

  // — состояние и per-frame апдейт —
  const state = {
    animSpeed: 1, animSpeedTarget: 1,
    yawT: 0, pitchT: 0,
    sleeping: false,
    jawActive: false, jawPulse: 0,
    mouseTarget: new THREE.Vector3(99, 99, 99),
    mouseStrengthTarget: 0,
  };

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  registerUpdate((dt, t) => {
    uniforms.uTime.value = t;
    state.animSpeed += (state.animSpeedTarget - state.animSpeed) * Math.min(1, dt * 2);
    uniforms.uAnim.value += dt * state.animSpeed;

    // ленивый доворот головы за курсором
    const k = Math.min(1, dt * 3.6);
    group.rotation.y += (state.yawT - group.rotation.y) * k;
    group.rotation.x += (state.pitchT + (state.sleeping ? 0.35 : 0) - group.rotation.x) * k;

    // пружина отталкивания
    uniforms.uMouse.value.lerp(state.mouseTarget, Math.min(1, dt * 8));
    state.mouseStrengthTarget *= Math.exp(-dt * 1.2);
    uniforms.uMouseStrength.value +=
      (state.mouseStrengthTarget - uniforms.uMouseStrength.value) * Math.min(1, dt * 6);

    // челюсть: шумовой осциллятор во время речи + затухающий импульс
    state.jawPulse *= Math.exp(-dt * 6);
    const osc = state.jawActive
      ? 0.30 + 0.38 * (0.5 + 0.5 * Math.sin(uniforms.uAnim.value * 52 + Math.sin(uniforms.uAnim.value * 13) * 2))
      : 0;
    uniforms.uJaw.value = clamp(osc + state.jawPulse, 0, 1);
  });

  // — публичный API (все твины — GSAP по uniform-ам) —
  const api = {
    group,
    uniforms,
    pointCount: N,
    baseScale,

    playAssembly(dur = 2.4) {
      gsap.to(uniforms.uAssembly, { value: 1, duration: dur, ease: 'power2.out' });
    },
    setScatter(v) { uniforms.uScatter.value = v; },
    setSleep(on) {
      state.sleeping = on;
      state.animSpeedTarget = on ? 0.25 : 1;
      gsap.to(uniforms.uSleep, { value: on ? 1 : 0, duration: on ? 2 : 0.35 });
      if (!on) api.glitch(0.35, 0.25);
    },
    glitch(intensity = 0.6, dur = 0.3) {
      gsap.to(uniforms.uGlitch, { value: intensity, duration: dur * 0.3, ease: 'power3.out' });
      gsap.to(uniforms.uGlitch, { value: 0, duration: dur * 0.7, delay: dur * 0.3, ease: 'power2.in' });
    },
    setJawNoise(on) { state.jawActive = on; },
    pulseJaw() { state.jawPulse = Math.min(1, state.jawPulse + 0.5); },
    lookAt(nx, ny) {
      state.yawT = clamp(nx, -1, 1) * 0.44;
      state.pitchT = clamp(-ny, -1, 1) * 0.26;
    },
    pushMouse(worldX, worldY, strength = 0.28) {
      state.mouseTarget.set(worldX, worldY, 0.4);
      state.mouseStrengthTarget = Math.max(state.mouseStrengthTarget, strength);
    },
    pointerToWorld(nx, ny) {
      raycaster.setFromCamera({ x: nx, y: ny }, camera);
      raycaster.ray.intersectPlane(plane, hit);
      return hit;
    },
    setEyeGlow(v, dur = 0.4) { gsap.to(uniforms.uEye, { value: v, duration: dur }); },

    // пасхалка «6 7»: череп качается в 4 такта, глифы брызгают на пиках
    playEgg67() {
      const tl = gsap.timeline();
      const beats = 4;
      for (let i = 0; i < beats; i++) {
        tl.to(group.rotation, {
          z: (i % 2 === 0 ? 1 : -1) * 0.35,
          duration: 0.25, ease: 'sine.inOut',
          onStart: () => { api.glitch(0.5, 0.22); bus.emit('egg:beat', { i }); },
        });
        tl.to(group.rotation, { z: 0, duration: 0.25, ease: 'sine.inOut' });
      }
      tl.to(group.rotation, { z: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      return tl;
    },
    // укоризненный медленный поворот в камеру («серьёзно?»)
    reproach() {
      state.yawT = 0; state.pitchT = 0;
      gsap.to(group.rotation, { y: 0, x: 0.06, duration: 1.2, ease: 'power2.inOut' });
    },
  };

  bus.emit('skull:ready');
  return api;
}
