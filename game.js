import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------- audio ----------
// every sound is synthesized with the Web Audio API (oscillators + filtered
// noise) instead of loaded audio files, so there's nothing to download and
// no asset-loading delay
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.7;

// a small low-shelf nudge on the final output - just enough sub-bass
// support to feel physical without smearing the sound into mush
const bassBoost = audioCtx.createBiquadFilter();
bassBoost.type = 'lowshelf';
bassBoost.frequency.value = 110;
bassBoost.gain.value = 3;
masterGain.connect(bassBoost);
bassBoost.connect(audioCtx.destination);

// a soft-clip saturation stage that impact sounds route through for a
// grittier character - clean UI sounds and crack transients skip it so
// they stay sharp instead of turning to mush
function makeDistortionCurve(amount) {
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
const grit = audioCtx.createWaveShaper();
grit.curve = makeDistortionCurve(16);
grit.oversample = '4x';
grit.connect(masterGain);

// a short feedback-delay "space" bus - simulates the room reflections that
// make an impact sound big instead of dry/small. Sounds that want scale
// pass an `echo` send amount (0-1) and get routed here too.
const echoDelay = audioCtx.createDelay(1.0);
echoDelay.delayTime.value = 0.1;
const echoFeedback = audioCtx.createGain();
echoFeedback.gain.value = 0.38;
const echoFilter = audioCtx.createBiquadFilter();
echoFilter.type = 'lowpass';
echoFilter.frequency.value = 1600;
echoDelay.connect(echoFilter);
echoFilter.connect(echoFeedback);
echoFeedback.connect(echoDelay);
echoFilter.connect(masterGain);
const echoSend = audioCtx.createGain();
echoSend.gain.value = 1;
echoSend.connect(echoDelay);

function connectWithEcho(node, bus, echo) {
  node.connect(bus);
  if (echo > 0) {
    const send = audioCtx.createGain();
    send.gain.value = echo;
    node.connect(send).connect(echoSend);
  }
}

function unlockAudio() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone({ freq = 440, freqEnd = null, duration = 0.1, type = 'sine', volume = 0.3, delay = 0, bus = masterGain, echo = 0 }) {
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  connectWithEcho(gain, bus, echo);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playNoise({ duration = 0.15, volume = 0.3, filterFreq = 1200, delay = 0, bus = masterGain, echo = 0 }) {
  const t0 = audioCtx.currentTime + delay;
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  noise.connect(filter).connect(gain);
  connectWithEcho(gain, bus, echo);
  noise.start(t0);
  noise.stop(t0 + duration + 0.02);
}

// a sharp, bright "crack" transient - real gunshots are mostly this: a very
// short burst of high-frequency energy, not a bass boom. Linear (not
// exponential) decay so the cutoff itself feels snappy.
function playCrack({ duration = 0.02, volume = 0.5, highpassFreq = 1600, delay = 0, bus = masterGain, echo = 0 }) {
  const t0 = audioCtx.currentTime + delay;
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpassFreq;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.linearRampToValueAtTime(0.0001, t0 + duration);
  noise.connect(filter).connect(gain);
  connectWithEcho(gain, bus, echo);
  noise.start(t0);
  noise.stop(t0 + duration + 0.01);
}

// a punchy sub-bass "thump": fast attack, a brief hold at full volume, then
// a slower decay - the hold is what keeps it from sounding like a "pop"
function playThump({ freq = 60, freqEnd = 25, duration = 0.3, hold = 0.03, volume = 0.5, delay = 0, bus = masterGain, echo = 0 }) {
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.setValueAtTime(volume, t0 + 0.012 + hold);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  connectWithEcho(gain, bus, echo);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// real gunshots are mostly a sharp, bright, dry "crack" - the low end is
// only the supporting body, not the main event. Each shot layers:
// crack (bright, immediate, little/no echo) -> body (short mid snap) ->
// a tamed low punch (brief, not a boom) -> for bigger guns, a real tail.
const GUN_SHOT_SFX = {
  pistol: () => {
    playCrack({ duration: 0.018, volume: 0.55, highpassFreq: 1800 });
    playTone({ freq: 220, freqEnd: 90, duration: 0.05, type: 'square', volume: 0.22, bus: grit });
    playThump({ freq: 75, freqEnd: 32, duration: 0.13, hold: 0.006, volume: 0.32, echo: 0.12 });
  },
  rifle: () => {
    playCrack({ duration: 0.014, volume: 0.5, highpassFreq: 2000 });
    playTone({ freq: 200, freqEnd: 85, duration: 0.04, type: 'square', volume: 0.2, bus: grit });
    playThump({ freq: 80, freqEnd: 34, duration: 0.1, hold: 0.004, volume: 0.26, echo: 0.08 });
  },
  shotgun: () => {
    playCrack({ duration: 0.03, volume: 0.6, highpassFreq: 1100, bus: grit });
    playNoise({ duration: 0.16, volume: 0.42, filterFreq: 1600, bus: grit, echo: 0.15 });
    playThump({ freq: 48, freqEnd: 22, duration: 0.3, hold: 0.02, volume: 0.55, echo: 0.28 });
  },
  burst: () => {
    playCrack({ duration: 0.013, volume: 0.45, highpassFreq: 2000 });
    playTone({ freq: 205, freqEnd: 88, duration: 0.035, type: 'square', volume: 0.19, bus: grit });
    playThump({ freq: 82, freqEnd: 34, duration: 0.09, hold: 0.004, volume: 0.22, echo: 0.08 });
  },
  sniper: () => {
    playCrack({ duration: 0.026, volume: 0.7, highpassFreq: 1000, bus: grit });
    playTone({ freq: 160, freqEnd: 55, duration: 0.14, type: 'sawtooth', volume: 0.36, bus: grit });
    playThump({ freq: 42, freqEnd: 18, duration: 0.4, hold: 0.03, volume: 0.55, echo: 0.35 });
    playNoise({ duration: 0.28, volume: 0.16, filterFreq: 700, delay: 0.1, echo: 0.35 }); // distant echo tail
  },
};

function sfxShot(gunId) {
  (GUN_SHOT_SFX[gunId] || GUN_SHOT_SFX.pistol)();
}
function sfxEmptyClick() {
  playTone({ freq: 220, duration: 0.04, type: 'square', volume: 0.15 });
}
function sfxReloadStart() {
  playTone({ freq: 320, duration: 0.05, type: 'square', volume: 0.15 });
  playNoise({ duration: 0.04, volume: 0.12, filterFreq: 2000 });
}
function sfxReloadDone() {
  playTone({ freq: 520, duration: 0.06, type: 'square', volume: 0.2 });
  playTone({ freq: 740, duration: 0.08, type: 'square', volume: 0.2, delay: 0.07 });
  playNoise({ duration: 0.05, volume: 0.15, filterFreq: 3000, delay: 0.07 });
}
function sfxKnifeSwing() {
  playNoise({ duration: 0.12, volume: 0.2, filterFreq: 4000 });
}
function sfxHit() {
  playCrack({ duration: 0.012, volume: 0.35, highpassFreq: 2200 });
  playThump({ freq: 150, freqEnd: 55, duration: 0.1, hold: 0.005, volume: 0.28, echo: 0.1 });
}
function sfxCrit() {
  playCrack({ duration: 0.015, volume: 0.45, highpassFreq: 2400 });
  playThump({ freq: 170, freqEnd: 60, duration: 0.13, hold: 0.008, volume: 0.35, echo: 0.15 });
  playTone({ freq: 520, freqEnd: 900, duration: 0.14, type: 'square', volume: 0.32 });
}
// the kill confirmation is its own distinct shape, not just a bigger hit:
// a sharp finishing crack, a crunch of "debris", a falling pitch sweep as
// the enemy goes down, then a beat later a soft body-drop thud
function sfxEnemyDeath() {
  playCrack({ duration: 0.018, volume: 0.5, highpassFreq: 1800 });
  playNoise({ duration: 0.09, volume: 0.4, filterFreq: 1000, bus: grit, delay: 0.015 });
  playTone({ freq: 480, freqEnd: 50, duration: 0.3, type: 'square', volume: 0.26, bus: grit, delay: 0.02 });
  playThump({ freq: 70, freqEnd: 25, duration: 0.28, hold: 0.02, volume: 0.4, echo: 0.3, delay: 0.24 });
}
function sfxPlayerHurt() {
  playCrack({ duration: 0.016, volume: 0.4, highpassFreq: 1600 });
  playThump({ freq: 70, freqEnd: 24, duration: 0.22, hold: 0.015, volume: 0.42, echo: 0.15 });
  playTone({ freq: 120, freqEnd: 45, duration: 0.14, type: 'sawtooth', volume: 0.22, bus: grit });
}
function sfxJump() {
  playTone({ freq: 300, freqEnd: 520, duration: 0.1, type: 'sine', volume: 0.15 });
}
function sfxWaveStart() {
  playThump({ freq: 50, freqEnd: 24, duration: 0.5, hold: 0.05, volume: 0.5, echo: 0.4 });
  playTone({ freq: 440, duration: 0.14, type: 'triangle', volume: 0.25, echo: 0.15 });
  playTone({ freq: 660, duration: 0.18, type: 'triangle', volume: 0.25, delay: 0.14, echo: 0.15 });
}
function sfxUIClick() {
  playTone({ freq: 600, duration: 0.04, type: 'square', volume: 0.15 });
}
function sfxPurchase() {
  playTone({ freq: 500, duration: 0.08, type: 'triangle', volume: 0.2 });
  playTone({ freq: 750, duration: 0.1, type: 'triangle', volume: 0.2, delay: 0.08 });
}
function sfxHeartbeat() {
  playThump({ freq: 55, freqEnd: 25, duration: 0.22, hold: 0.02, volume: 0.5 });
}

// ---------- basic setup ----------
const scene = new THREE.Scene();
const FOG_COLOR = 0x0d1420;
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(FOG_COLOR, 15, 48);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// hit flash overlay
const hitFlash = document.createElement('div');
hitFlash.id = 'hit-flash';
document.body.appendChild(hitFlash);

// ---------- sky ----------
const skyGeo = new THREE.SphereGeometry(180, 24, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x142238) },
    bottomColor: { value: new THREE.Color(0x0d1420) },
    glowColor: { value: new THREE.Color(0x2d5a7a) },
  },
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vWorldPos;
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform vec3 glowColor;
    void main() {
      float h = normalize(vWorldPos).y;
      vec3 col = mix(bottomColor, topColor, smoothstep(-0.1, 0.6, h));
      float horizonGlow = 1.0 - smoothstep(0.0, 0.35, abs(h));
      col += glowColor * horizonGlow * 0.35;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// ---------- lighting ----------
scene.add(new THREE.AmbientLight(0x5a72a0, 0.55));
scene.add(new THREE.HemisphereLight(0x3f6e8f, 0x14171f, 0.5));
const dirLight = new THREE.DirectionalLight(0xfff0d8, 1.25);
dirLight.position.set(10, 20, 8);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
scene.add(dirLight);

// ---------- arena ----------
const ARENA_SIZE = 30;

// procedural noise texture so the floor/walls aren't flat, solid color
function makeNoiseTexture(baseColor, noiseColor, size, cell) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      if (Math.random() > 0.55) {
        ctx.fillStyle = noiseColor;
        ctx.globalAlpha = 0.08 + Math.random() * 0.12;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const groundTex = makeNoiseTexture('#262e3c', '#3a4658', 256, 8);
groundTex.repeat.set(ARENA_SIZE, ARENA_SIZE);
const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE * 2, ARENA_SIZE * 2), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// faint grid lines for movement/scale reference
const grid = new THREE.GridHelper(ARENA_SIZE * 2, 30, 0x4d7ea8, 0x1c222c);
grid.material.transparent = true;
grid.material.opacity = 0.25;
grid.position.y = 0.02;
scene.add(grid);

const wallTex = makeNoiseTexture('#333f52', '#455872', 256, 16);
wallTex.repeat.set(ARENA_SIZE / 2, 1.5);
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
const wallHeight = 6;
const trimMat = new THREE.MeshStandardMaterial({
  color: 0x4dd8ff,
  emissive: 0x1f8fbd,
  emissiveIntensity: 1.4,
  roughness: 0.4,
});
function makeWall(w, d, x, z) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
  wall.position.set(x, wallHeight / 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.08, d * 0.98), trimMat);
  trim.position.set(x, 0.35, z);
  scene.add(trim);
}
makeWall(ARENA_SIZE * 2, 1, 0, -ARENA_SIZE);
makeWall(ARENA_SIZE * 2, 1, 0, ARENA_SIZE);
makeWall(1, ARENA_SIZE * 2, -ARENA_SIZE, 0);
makeWall(1, ARENA_SIZE * 2, ARENA_SIZE, 0);

// ---------- arena layout: cover, platforms, corner landmarks ----------
const obstacles = [];
const footprints = []; // {x, z, r} of everything placed so far, for spacing checks

function overlapsPlaced(x, z, r, margin) {
  return footprints.some((p) => {
    const dx = x - p.x;
    const dz = z - p.z;
    return Math.hypot(dx, dz) < r + p.r + margin;
  });
}

// pick a random spot that stays clear of the center spawn and other props
function pickSpot(radius, minSpawnDist, maxTries = 30) {
  for (let t = 0; t < maxTries; t++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 16;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (Math.hypot(x, z) < minSpawnDist) continue;
    if (overlapsPlaced(x, z, radius, 1.4)) continue;
    footprints.push({ x, z, r: radius });
    return { x, z };
  }
  return null;
}

// four raised combat platforms, one per quadrant, for real high-ground fights
const platformMat = new THREE.MeshStandardMaterial({ color: 0x384252, roughness: 0.75 });
const PLATFORM_SIZE = 3.6;
const PLATFORM_HEIGHT = 1.5;
const platformSpots = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
for (const [sx, sz] of platformSpots) {
  const x = sx * 11;
  const z = sz * 11;
  footprints.push({ x, z, r: PLATFORM_SIZE * 0.75 });

  const plat = new THREE.Mesh(new THREE.BoxGeometry(PLATFORM_SIZE, PLATFORM_HEIGHT, PLATFORM_SIZE), platformMat);
  plat.position.set(x, PLATFORM_HEIGHT / 2, z);
  plat.castShadow = true;
  plat.receiveShadow = true;
  scene.add(plat);

  const platTrim = new THREE.Mesh(new THREE.BoxGeometry(PLATFORM_SIZE * 0.97, 0.05, PLATFORM_SIZE * 0.97), trimMat);
  platTrim.position.set(x, PLATFORM_HEIGHT + 0.03, z);
  scene.add(platTrim);

  obstacles.push({ x, z, hx: PLATFORM_SIZE / 2, hz: PLATFORM_SIZE / 2, height: PLATFORM_HEIGHT });
}

// small cover: a mix of crates and barrels, scattered but never overlapping
const coverMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.7 });
const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5c4a34, roughness: 0.7, metalness: 0.1 });
for (let i = 0; i < 12; i++) {
  const isBarrel = Math.random() < 0.35;
  const s = 1.0 + Math.random() * 0.6;
  const spot = pickSpot(s * 0.7, 5);
  if (!spot) continue;

  let mesh;
  if (isBarrel) {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.35, s * 0.38, s * 0.9, 10), barrelMat);
    mesh.position.set(spot.x, (s * 0.9) / 2, spot.z);
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), coverMat);
    mesh.position.set(spot.x, s / 2, spot.z);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const height = isBarrel ? s * 0.9 : s;
  obstacles.push({ x: spot.x, z: spot.z, hx: s / 2, hz: s / 2, height });
}

// glowing corner pillars as landmarks so the arena doesn't feel featureless
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.6 });
const cornerSigns = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
for (const [sx, sz] of cornerSigns) {
  const x = sx * (ARENA_SIZE - 2);
  const z = sz * (ARENA_SIZE - 2);

  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 5, 8), pillarMat);
  pillar.position.set(x, 2.5, z);
  pillar.castShadow = true;
  scene.add(pillar);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), trimMat);
  cap.position.set(x, 5.05, z);
  scene.add(cap);

  const cornerLight = new THREE.PointLight(0x4dd8ff, 1.1, 14);
  cornerLight.position.set(x, 4.6, z);
  scene.add(cornerLight);

  obstacles.push({ x, z, hx: 0.4, hz: 0.4, height: 5 });
}

// ---------- ambient dust ----------
function makeDotTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(200,220,255,0.9)');
  grad.addColorStop(1, 'rgba(200,220,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const DUST_COUNT = 140;
const dustGeo = new THREE.BufferGeometry();
const dustPositions = new Float32Array(DUST_COUNT * 3);
const dustSeeds = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPositions[i * 3] = (Math.random() - 0.5) * ARENA_SIZE * 2;
  dustPositions[i * 3 + 1] = Math.random() * 5;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * ARENA_SIZE * 2;
  dustSeeds[i] = Math.random() * Math.PI * 2;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dustMat = new THREE.PointsMaterial({
  size: 0.09,
  map: makeDotTexture(),
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  sizeAttenuation: true,
});
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

// ---------- gun view model ----------
// gunGroup stays at the origin and is what the per-frame bob/recoil code
// nudges; gunModel carries the fixed "resting" offset so parts can be
// positioned relative to each other instead of the camera.
const gunGroup = new THREE.Group();
const gunModel = new THREE.Group();
gunModel.position.set(0.26, -0.2, -0.34);
gunGroup.add(gunModel);

const gunMat = new THREE.MeshStandardMaterial({ color: 0x22282f, roughness: 0.4, metalness: 0.7 });
const gunAccentMat = new THREE.MeshStandardMaterial({
  color: 0x4dd8ff,
  emissive: 0x1a5670,
  emissiveIntensity: 1,
  roughness: 0.4,
});

// lower frame (the part the grip and trigger guard hang off of)
const frame = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.075, 0.15), gunMat);
frame.position.set(0, -0.015, -0.03);
gunModel.add(frame);

// slide sits on top of the frame and overhangs the front for the classic
// stepped pistol silhouette
const slide = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.05, 0.22), gunMat);
slide.position.set(0, 0.045, -0.06);
gunModel.add(slide);

// short barrel stub poking out past the front of the slide
const barrelTip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.045, 8), gunMat);
barrelTip.rotation.x = Math.PI / 2;
barrelTip.position.set(0, 0.045, -0.185);
gunModel.add(barrelTip);

// grip: rakes backward under the hand, the defining pistol silhouette cue
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.15, 0.075), gunMat);
grip.position.set(0, -0.12, 0.05);
grip.rotation.x = -0.22;
gunModel.add(grip);

const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.06), gunMat);
magBase.position.set(0, -0.205, 0.06);
magBase.rotation.x = -0.22;
gunModel.add(magBase);

const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.016), gunMat);
rearSight.position.set(0, 0.076, 0.02);
gunModel.add(rearSight);

const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.012), gunMat);
frontSight.position.set(0, 0.076, -0.165);
gunModel.add(frontSight);

const gunAccent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.19), gunAccentMat);
gunAccent.position.set(0.037, 0.045, -0.06);
gunModel.add(gunAccent);

// ---------- assault rifle view model (second purchasable gun) ----------
const rifleModel = new THREE.Group();
rifleModel.position.set(0.25, -0.17, -0.22);
rifleModel.visible = false;
gunGroup.add(rifleModel);

const rifleAccentMat = new THREE.MeshStandardMaterial({
  color: 0xff9d4d,
  emissive: 0x7a3d10,
  emissiveIntensity: 1,
  roughness: 0.4,
});

const rifleReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 0.34), gunMat);
rifleReceiver.position.set(0, 0, -0.05);
rifleModel.add(rifleReceiver);

const rifleBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.4, 8), gunMat);
rifleBarrel.rotation.x = Math.PI / 2;
rifleBarrel.position.set(0, 0.008, -0.42);
rifleModel.add(rifleBarrel);

const rifleHandguard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.18), gunMat);
rifleHandguard.position.set(0, -0.008, -0.28);
rifleModel.add(rifleHandguard);

const rifleStock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.2), gunMat);
rifleStock.position.set(0, -0.005, 0.17);
rifleModel.add(rifleStock);

const rifleGrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.05), gunMat);
rifleGrip.position.set(0, -0.085, -0.02);
rifleGrip.rotation.x = -0.15;
rifleModel.add(rifleGrip);

const rifleMag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.05), gunMat);
rifleMag.position.set(0, -0.1, -0.1);
rifleMag.rotation.x = 0.25;
rifleModel.add(rifleMag);

const rifleFrontSight = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.035, 0.01), gunMat);
rifleFrontSight.position.set(0, 0.035, -0.4);
rifleModel.add(rifleFrontSight);

const rifleRearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, 0.02), gunMat);
rifleRearSight.position.set(0, 0.05, 0.06);
rifleModel.add(rifleRearSight);

const rifleAccent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.4), rifleAccentMat);
rifleAccent.position.set(0.033, 0, -0.15);
rifleModel.add(rifleAccent);

// ---------- shotgun view model (third purchasable gun) ----------
const shotgunModel = new THREE.Group();
shotgunModel.position.set(0.26, -0.18, -0.28);
shotgunModel.visible = false;
gunGroup.add(shotgunModel);

const shotgunWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a22, roughness: 0.75 });
const shotgunAccentMat = new THREE.MeshStandardMaterial({
  color: 0xff5d5d,
  emissive: 0x801f1f,
  emissiveIntensity: 1,
  roughness: 0.4,
});

const sgReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.07, 0.16), gunMat);
sgReceiver.position.set(0, 0, -0.02);
shotgunModel.add(sgReceiver);

const sgBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), gunMat);
sgBarrel.rotation.x = Math.PI / 2;
sgBarrel.position.set(0, 0.025, -0.28);
shotgunModel.add(sgBarrel);

const sgMagTube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), gunMat);
sgMagTube.rotation.x = Math.PI / 2;
sgMagTube.position.set(0, -0.012, -0.26);
shotgunModel.add(sgMagTube);

const sgPump = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.09), shotgunWoodMat);
sgPump.position.set(0, -0.005, -0.22);
shotgunModel.add(sgPump);

const sgStock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), shotgunWoodMat);
sgStock.position.set(0, -0.01, 0.15);
shotgunModel.add(sgStock);

const sgGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), gunMat);
sgGrip.position.set(0, -0.075, 0);
sgGrip.rotation.x = -0.2;
shotgunModel.add(sgGrip);

const sgAccent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.3), shotgunAccentMat);
sgAccent.position.set(0.032, 0.025, -0.15);
shotgunModel.add(sgAccent);

// ---------- burst rifle view model (fourth purchasable gun) ----------
const burstModel = new THREE.Group();
burstModel.position.set(0.25, -0.18, -0.26);
burstModel.visible = false;
gunGroup.add(burstModel);

const burstAccentMat = new THREE.MeshStandardMaterial({
  color: 0x4dff9d,
  emissive: 0x158a4f,
  emissiveIntensity: 1,
  roughness: 0.4,
});

const brReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.065, 0.28), gunMat);
brReceiver.position.set(0, 0, -0.04);
burstModel.add(brReceiver);

const brBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), gunMat);
brBarrel.rotation.x = Math.PI / 2;
brBarrel.position.set(0, 0.01, -0.32);
burstModel.add(brBarrel);

const brHandguard = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.04, 0.14), gunMat);
brHandguard.position.set(0, -0.008, -0.22);
burstModel.add(brHandguard);

const brStock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.16), gunMat);
brStock.position.set(0, -0.005, 0.13);
burstModel.add(brStock);

const brGrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.05), gunMat);
brGrip.position.set(0, -0.08, -0.02);
brGrip.rotation.x = -0.15;
burstModel.add(brGrip);

const brMag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.05), gunMat);
brMag.position.set(0, -0.09, -0.09);
brMag.rotation.x = 0.2;
burstModel.add(brMag);

const brDial = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.015), burstAccentMat);
brDial.position.set(0.033, 0.02, 0);
burstModel.add(brDial);

const brAccent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.34), burstAccentMat);
brAccent.position.set(0.032, 0, -0.15);
burstModel.add(brAccent);

// ---------- sniper rifle view model (fifth purchasable gun) ----------
const sniperModel = new THREE.Group();
sniperModel.position.set(0.25, -0.16, -0.2);
sniperModel.visible = false;
gunGroup.add(sniperModel);

const sniperAccentMat = new THREE.MeshStandardMaterial({
  color: 0xffd23d,
  emissive: 0x8a6a10,
  emissiveIntensity: 1,
  roughness: 0.4,
});
const scopeGlassMat = new THREE.MeshStandardMaterial({
  color: 0x1a2e3d,
  emissive: 0x2d5a7a,
  emissiveIntensity: 0.8,
  roughness: 0.2,
  metalness: 0.6,
});

const snReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.3), gunMat);
snReceiver.position.set(0, 0, -0.05);
sniperModel.add(snReceiver);

const snBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.55, 8), gunMat);
snBarrel.rotation.x = Math.PI / 2;
snBarrel.position.set(0, 0.005, -0.55);
sniperModel.add(snBarrel);

// muzzle brake: a wider stub at the barrel tip for a heavy-caliber look
const snMuzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), gunMat);
snMuzzleBrake.rotation.x = Math.PI / 2;
snMuzzleBrake.position.set(0, 0.005, -0.8);
sniperModel.add(snMuzzleBrake);

// picatinny-style rail connecting the receiver to the scope mount
const snRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.24), gunMat);
snRail.position.set(0, 0.038, -0.14);
sniperModel.add(snRail);

const snScopeRiser = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.06), gunMat);
snScopeRiser.position.set(0, 0.045, -0.1);
sniperModel.add(snScopeRiser);

const snScopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.18, 10), gunMat);
snScopeTube.rotation.x = Math.PI / 2;
snScopeTube.position.set(0, 0.078, -0.1);
sniperModel.add(snScopeTube);

// adjustment turret knobs on top of the scope
const turretGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8);
const snTurretTop = new THREE.Mesh(turretGeo, sniperAccentMat);
snTurretTop.position.set(0, 0.104, -0.13);
sniperModel.add(snTurretTop);
const snTurretSide = new THREE.Mesh(turretGeo, sniperAccentMat);
snTurretSide.rotation.z = Math.PI / 2;
snTurretSide.position.set(0.034, 0.078, -0.13);
sniperModel.add(snTurretSide);

const snScopeLensFront = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10), scopeGlassMat);
snScopeLensFront.rotation.x = Math.PI / 2;
snScopeLensFront.position.set(0, 0.075, -0.19);
sniperModel.add(snScopeLensFront);

const snScopeLensRear = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 10), scopeGlassMat);
snScopeLensRear.rotation.x = Math.PI / 2;
snScopeLensRear.position.set(0, 0.075, -0.01);
sniperModel.add(snScopeLensRear);

const snStock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.28), gunMat);
snStock.position.set(0, -0.005, 0.19);
sniperModel.add(snStock);

// raised cheek rest so the sightline lines up with the scope
const snCheekRest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.16), shotgunWoodMat);
snCheekRest.position.set(0, 0.028, 0.16);
sniperModel.add(snCheekRest);

const snGrip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.05), gunMat);
snGrip.position.set(0, -0.075, -0.05);
snGrip.rotation.x = -0.15;
sniperModel.add(snGrip);

const snMag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.05), gunMat);
snMag.position.set(0, -0.11, -0.12);
snMag.rotation.x = 0.2;
sniperModel.add(snMag);

const bipodGeo = new THREE.BoxGeometry(0.012, 0.14, 0.012);
const snBipodL = new THREE.Mesh(bipodGeo, gunMat);
snBipodL.position.set(-0.04, -0.06, -0.45);
snBipodL.rotation.z = 0.35;
sniperModel.add(snBipodL);
const snBipodR = new THREE.Mesh(bipodGeo, gunMat);
snBipodR.position.set(0.04, -0.06, -0.45);
snBipodR.rotation.z = -0.35;
sniperModel.add(snBipodR);

const snAccent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.28), sniperAccentMat);
snAccent.position.set(0.03, 0, -0.05);
sniperModel.add(snAccent);

camera.add(gunGroup);

// ---------- knife view model ----------
const knifeGroup = new THREE.Group();
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd7e0ea, roughness: 0.2, metalness: 0.85 });
const guardMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.5, metalness: 0.6 });
const handleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85 });

// tapered blade: two shrinking flat segments plus a pyramid tip, all
// axis-aligned so the taper reads correctly without any ambiguous rotation
const bladeBase = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.16), bladeMat);
bladeBase.position.set(0, 0, -0.09);
knifeGroup.add(bladeBase);

const bladeMid = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.01, 0.14), bladeMat);
bladeMid.position.set(0, 0, -0.24);
knifeGroup.add(bladeMid);

const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 4), bladeMat);
bladeTip.rotation.x = -Math.PI / 2;
bladeTip.position.set(0, 0, -0.35);
knifeGroup.add(bladeTip);

const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.022), guardMat);
guard.position.set(0, 0, -0.015);
knifeGroup.add(guard);

const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.15, 8), handleMat);
handle.rotation.x = Math.PI / 2;
handle.position.set(0, 0, 0.06);
knifeGroup.add(handle);

const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), guardMat);
pommel.position.set(0, 0, 0.135);
knifeGroup.add(pommel);

knifeGroup.position.set(0.26, -0.24, -0.4);
knifeGroup.rotation.x = -0.3;
knifeGroup.visible = false;
camera.add(knifeGroup);

scene.add(camera);

// muzzle flash: a point light plus a soft glow sprite at the barrel tip
const flashLight = new THREE.PointLight(0xffcc66, 0, 4);
flashLight.position.set(0.26, -0.155, -0.55);
camera.add(flashLight);

function makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.4, 'rgba(255,190,90,0.8)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const glowTex = makeGlowTexture();
const muzzleSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0 })
);
muzzleSprite.scale.set(0, 0, 0);
muzzleSprite.position.set(0.26, -0.15, -0.57);
camera.add(muzzleSprite);

// ---------- intro / loading screen ----------
const introScreen = document.getElementById('intro-screen');
const loadingFill = document.getElementById('loading-fill');
const introPrompt = document.getElementById('intro-prompt');

requestAnimationFrame(() => loadingFill.classList.add('filling'));
setTimeout(() => introPrompt.classList.remove('hidden'), 1300);

introScreen.addEventListener('click', () => {
  if (introPrompt.classList.contains('hidden')) return; // still "loading"
  unlockAudio();
  introScreen.classList.add('fade-out');
  setTimeout(() => introScreen.classList.add('hidden'), 400);
  document.getElementById('start-screen').classList.remove('hidden');
});

// every button click gets a light UI blip - unlockAudio() here too since a
// browser may not have granted audio yet if this is somehow the first click
document.addEventListener('click', (e) => {
  if (e.target.closest('button')) {
    unlockAudio();
    sfxUIClick();
  }
});

// ---------- controls ----------
const controls = new PointerLockControls(camera, renderer.domElement);

const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const startBtn = document.getElementById('start-btn');
const resumeBtn = document.getElementById('resume-btn');
const restartBtn = document.getElementById('restart-btn');

startBtn.addEventListener('click', () => controls.lock());
resumeBtn.addEventListener('click', () => controls.lock());
restartBtn.addEventListener('click', () => {
  gameoverScreen.classList.add('hidden');
  resetGame();
  controls.lock();
});

let needsWaveStart = true;

controls.addEventListener('lock', () => {
  unlockAudio();
  startScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  gameState = 'playing';
  if (needsWaveStart) {
    needsWaveStart = false;
    startWave();
  }
});
controls.addEventListener('unlock', () => {
  if (gameState === 'playing') {
    gameState = 'paused';
    pauseScreen.classList.remove('hidden');
  }
});

// ---------- main menu: main / armory / settings sub-views ----------
const menuPanels = document.querySelectorAll('#start-screen .menu-panel');
function showMenuView(view) {
  menuPanels.forEach((p) => p.classList.toggle('hidden', p.dataset.view !== view));
  if (view === 'armory') renderArmory();
  if (view === 'shop') renderShop();
}
document.querySelectorAll('#start-screen [data-open]').forEach((btn) => {
  btn.addEventListener('click', () => showMenuView(btn.dataset.open));
});
document.querySelectorAll('#start-screen [data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showMenuView('main'));
});

// ---------- settings: mouse sensitivity + field of view ----------
const sensSlider = document.getElementById('sens-slider');
const sensVal = document.getElementById('sens-val');
const fovSlider = document.getElementById('fov-slider');
const fovVal = document.getElementById('fov-val');

// the "resting" (non-scoped) sensitivity/FOV the sliders control; while
// aiming down a scope the animate loop lerps away from these and back
let baseSens = parseFloat(sensSlider.value);
let baseFov = parseFloat(fovSlider.value);

sensSlider.addEventListener('input', () => {
  const v = parseFloat(sensSlider.value);
  baseSens = v;
  if (!isAiming) controls.pointerSpeed = v;
  sensVal.textContent = v.toFixed(2);
});
fovSlider.addEventListener('input', () => {
  const v = parseFloat(fovSlider.value);
  baseFov = v;
  if (!isAiming) {
    camera.fov = v;
    camera.updateProjectionMatrix();
  }
  fovVal.textContent = v;
});

const VOLUME_KEY = 'waveShooterVolume';
const volumeSlider = document.getElementById('volume-slider');
const volumeVal = document.getElementById('volume-val');
function loadVolume() {
  try {
    const saved = parseFloat(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(saved) ? saved : 70;
  } catch (e) {
    return 70;
  }
}
const savedVolume = loadVolume();
volumeSlider.value = savedVolume;
volumeVal.textContent = savedVolume;
masterGain.gain.value = savedVolume / 100;
volumeSlider.addEventListener('input', () => {
  const v = parseFloat(volumeSlider.value);
  masterGain.gain.value = v / 100;
  volumeVal.textContent = v;
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch (e) {
    // ignore - setting still applies for this session
  }
});

const NUMKEY_SETTING_KEY = 'waveShooterNumKeySwitch';
function loadNumberKeySetting() {
  try {
    return localStorage.getItem(NUMKEY_SETTING_KEY) !== 'off';
  } catch (e) {
    return true;
  }
}
let numberKeySwitchEnabled = loadNumberKeySetting();
const numkeyToggle = document.getElementById('numkey-toggle');
numkeyToggle.checked = numberKeySwitchEnabled;
numkeyToggle.addEventListener('change', () => {
  numberKeySwitchEnabled = numkeyToggle.checked;
  try {
    localStorage.setItem(NUMKEY_SETTING_KEY, numberKeySwitchEnabled ? 'on' : 'off');
  } catch (e) {
    // ignore - setting still applies for this session
  }
});

// ---------- movement ----------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));

const velocity = new THREE.Vector3();
const MOVE_SPEED = 6;
const BOUND = ARENA_SIZE - 1.5;

// ---------- jump / obstacle collision ----------
const EYE_HEIGHT = 1.7;
const CROUCH_EYE_HEIGHT = 1.1;
const GRAVITY = -18;
const JUMP_SPEED = 8;
const CLIMB_SPEED = 2.5;
const PLAYER_RADIUS = 0.35;
const ENEMY_RADIUS = 0.45;

let eyeHeight = EYE_HEIGHT;

// ---------- guns: catalog of purchasable ranged weapons ----------
// each entry's muzzle offset is that gun's barrel-tip position in camera
// space, used to reposition the shared flash light/sprite when equipped
const GUN_CATALOG = {
  pistol: {
    id: 'pistol',
    name: '권총 (Pistol)',
    price: 0,
    damage: 32,
    auto: false,
    cooldown: 0.18,
    magSize: 10,
    reloadTime: 1.0,
    muzzle: { x: 0.26, y: -0.155, z: -0.55 },
  },
  rifle: {
    id: 'rifle',
    name: '돌격소총 (Assault Rifle)',
    price: 250,
    damage: 26,
    auto: true,
    cooldown: 0.1,
    magSize: 25,
    reloadTime: 1.6,
    muzzle: { x: 0.25, y: -0.16, z: -0.84 },
  },
  shotgun: {
    id: 'shotgun',
    name: '샷건 (Shotgun)',
    price: 320,
    damage: 26,
    pellets: 7,
    spread: 0.1,
    recoilMult: 2.4,
    auto: false,
    cooldown: 0.75,
    magSize: 6,
    reloadTime: 2.2,
    muzzle: { x: 0.26, y: -0.155, z: -0.72 },
  },
  burst: {
    id: 'burst',
    name: '점사 소총 (Burst Rifle)',
    price: 300,
    damage: 24,
    burstCount: 3,
    burstDelay: 70, // ms between rounds within one burst
    recoilMult: 0.5, // each round kicks less since 3 stack up per click
    auto: false,
    cooldown: 0.55, // cooldown starts once the whole burst is triggered
    magSize: 21, // 7 bursts per magazine
    reloadTime: 1.8,
    muzzle: { x: 0.25, y: -0.17, z: -0.71 },
  },
  sniper: {
    id: 'sniper',
    name: '저격총 (Sniper Rifle)',
    price: 480,
    damage: 100,
    auto: false,
    cooldown: 1.15,
    recoilMult: 3.2, // heaviest kick in the catalog
    zoomFov: 25, // FOV while aiming down the scope (right-click)
    magSize: 5,
    reloadTime: 2.4,
    muzzle: { x: 0.25, y: -0.155, z: -1.03 },
  },
};
const gunModelsById = {
  pistol: gunModel,
  rifle: rifleModel,
  shotgun: shotgunModel,
  burst: burstModel,
  sniper: sniperModel,
};

// the specific part on each gun that acts out the reload: a detachable
// magazine drops out and back in for most guns, while the pump shotgun
// racks its pump instead. { part, axis, amount } - amount is the local
// offset (in that axis) added at the peak of the reload, then undone.
const gunReloadPartsById = {
  pistol: { part: magBase, axis: 'y', amount: -0.22, restY: magBase.position.y },
  rifle: { part: rifleMag, axis: 'y', amount: -0.24, restY: rifleMag.position.y },
  shotgun: { part: sgPump, axis: 'z', amount: 0.09, restZ: sgPump.position.z },
  burst: { part: brMag, axis: 'y', amount: -0.2, restY: brMag.position.y },
  sniper: { part: snMag, axis: 'y', amount: -0.26, restY: snMag.position.y },
};

const OWNED_GUNS_KEY = 'waveShooterOwnedGuns';
const EQUIPPED_GUN_KEY = 'waveShooterEquippedGun';

function loadOwnedGuns() {
  try {
    const saved = JSON.parse(localStorage.getItem(OWNED_GUNS_KEY));
    if (Array.isArray(saved) && saved.length) return saved.filter((id) => GUN_CATALOG[id]);
  } catch (e) {
    // ignore malformed/unavailable storage
  }
  return ['pistol'];
}
function saveOwnedGuns() {
  try {
    localStorage.setItem(OWNED_GUNS_KEY, JSON.stringify(ownedGuns));
  } catch (e) {
    // ignore - purchase still applies for this session
  }
}
function loadEquippedGun() {
  try {
    const saved = localStorage.getItem(EQUIPPED_GUN_KEY);
    if (saved && GUN_CATALOG[saved]) return saved;
  } catch (e) {
    // ignore
  }
  return 'pistol';
}
function saveEquippedGun() {
  try {
    localStorage.setItem(EQUIPPED_GUN_KEY, equippedGunId);
  } catch (e) {
    // ignore
  }
}

let ownedGuns = loadOwnedGuns();
let equippedGunId = loadEquippedGun();
if (!ownedGuns.includes(equippedGunId)) equippedGunId = 'pistol';

// swaps the visible gun model and moves the shared muzzle flash to match
function applyEquippedGunModel() {
  for (const id in gunModelsById) gunModelsById[id].visible = id === equippedGunId;
  const def = GUN_CATALOG[equippedGunId];
  flashLight.position.set(def.muzzle.x, def.muzzle.y, def.muzzle.z);
  muzzleSprite.position.set(def.muzzle.x, def.muzzle.y + 0.01, def.muzzle.z - 0.02);
}

// ---------- weapons ----------
const WEAPONS = ['gun', 'knife'];
let weaponIndex = 0;
let currentWeapon = WEAPONS[weaponIndex];
const weaponLabelEl = document.getElementById('weapon-label');
const crosshairEl = document.getElementById('crosshair');
const hitMarkerEl = document.getElementById('hit-marker');
const critPopupEl = document.getElementById('crit-popup');
const CRIT_MULTIPLIER = 2;
const KNIFE_SPEED_MULT = 1.35;
const KNIFE_RANGE = 3.2;
const KNIFE_DAMAGE = 55;
const KNIFE_CONE_COS = Math.cos(THREE.MathUtils.degToRad(70));
const KNIFE_COOLDOWN = 0.45;
let knifeCooldown = 0;
let knifeSwing = 0;

function setWeapon(name) {
  currentWeapon = name;
  gunGroup.visible = name === 'gun';
  knifeGroup.visible = name === 'knife';
  weaponLabelEl.textContent = name === 'gun' ? GUN_CATALOG[equippedGunId].id.toUpperCase() : 'KNIFE';
  crosshairEl.classList.toggle('knife', name === 'knife');

  // cancel scoping if the newly selected weapon/gun can't zoom
  const def = name === 'gun' ? GUN_CATALOG[equippedGunId] : null;
  if (isAiming && !(def && def.zoomFov)) {
    isAiming = false;
    scopeOverlayEl.classList.remove('active');
    crosshairEl.classList.remove('hidden');
  }

  updateAmmoHUD();
}

let hitMarkerTimeout = null;
let critPopupTimeout = null;
function showHitMarker(isCrit) {
  hitMarkerEl.classList.remove('active');
  hitMarkerEl.classList.toggle('crit', !!isCrit);
  void hitMarkerEl.offsetWidth; // restart the CSS animation
  hitMarkerEl.classList.add('active');
  clearTimeout(hitMarkerTimeout);
  hitMarkerTimeout = setTimeout(() => hitMarkerEl.classList.remove('active'), 250);

  if (isCrit) {
    critPopupEl.classList.remove('show');
    void critPopupEl.offsetWidth;
    critPopupEl.classList.add('show');
    clearTimeout(critPopupTimeout);
    critPopupTimeout = setTimeout(() => critPopupEl.classList.remove('show'), 500);
  }
}

let crosshairFireTimeout = null;
function pulseCrosshair() {
  crosshairEl.classList.add('fire');
  clearTimeout(crosshairFireTimeout);
  crosshairFireTimeout = setTimeout(() => crosshairEl.classList.remove('fire'), 90);
}

// a single physical scroll "click" fires many small wheel events (especially
// on trackpads), so debounce with a cooldown instead of switching on every one
let lastWheelSwitchTime = 0;
const WHEEL_SWITCH_COOLDOWN = 220; // ms
window.addEventListener(
  'wheel',
  (e) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelSwitchTime < WHEEL_SWITCH_COOLDOWN) return;
    lastWheelSwitchTime = now;
    weaponIndex = (weaponIndex + (e.deltaY > 0 ? 1 : -1) + WEAPONS.length) % WEAPONS.length;
    setWeapon(WEAPONS[weaponIndex]);
  },
  { passive: false }
);

// number-key quick equip: 1/2/3 -> pistol/rifle/shotgun, only among owned guns
const GUN_HOTKEY_ORDER = ['pistol', 'rifle', 'shotgun', 'burst', 'sniper'];
const GUN_HOTKEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
window.addEventListener('keydown', (e) => {
  if (gameState !== 'playing' || !numberKeySwitchEnabled) return;
  const idx = GUN_HOTKEY_CODES.indexOf(e.code);
  if (idx === -1) return;
  const gunId = GUN_HOTKEY_ORDER[idx];
  if (!gunId || !ownedGuns.includes(gunId) || gunId === equippedGunId) return;
  equippedGunId = gunId;
  saveEquippedGun();
  applyEquippedGunModel();
  cancelReload();
  weaponIndex = WEAPONS.indexOf('gun');
  setWeapon('gun');
});

let playerY = 0;
let playerVelY = 0;
let playerGrounded = true;

function groundHeightAt(x, z) {
  let h = 0;
  for (const ob of obstacles) {
    if (x > ob.x - ob.hx && x < ob.x + ob.hx && z > ob.z - ob.hz && z < ob.z + ob.hz) {
      h = Math.max(h, ob.height);
    }
  }
  return h;
}

// pushes pos (x/z) out of any obstacle it overlaps at ground level; returns true if it was blocked
function resolveObstacleCollision(pos, feetY, radius) {
  let blocked = false;
  for (const ob of obstacles) {
    if (feetY >= ob.height - 0.12) continue; // standing on/above it, not a wall from here
    const dx = pos.x - ob.x;
    const dz = pos.z - ob.z;
    const closestX = THREE.MathUtils.clamp(dx, -ob.hx, ob.hx);
    const closestZ = THREE.MathUtils.clamp(dz, -ob.hz, ob.hz);
    const diffX = dx - closestX;
    const diffZ = dz - closestZ;
    const distSq = diffX * diffX + diffZ * diffZ;
    if (distSq < radius * radius) {
      blocked = true;
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = radius - dist;
      pos.x += (diffX / dist) * push;
      pos.z += (diffZ / dist) * push;
    }
  }
  return blocked;
}

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

// gun fire is held-triggered so automatic weapons can repeat while the
// button stays down; semi-auto guns just have a cooldown long enough that
// holding does nothing extra
let mouseHeld = false;
let gunFireTimer = 0;

// right-click aims down the scope on guns that have a zoomFov (currently
// just the sniper) - zooms the camera in and steadies the mouse
let isAiming = false;
const scopeOverlayEl = document.getElementById('scope-overlay');

window.addEventListener('contextmenu', (e) => {
  if (gameState === 'playing') e.preventDefault();
});

window.addEventListener('mousedown', (e) => {
  if (gameState !== 'playing') return;
  if (e.button === 2) {
    const def = currentWeapon === 'gun' ? GUN_CATALOG[equippedGunId] : null;
    if (def && def.zoomFov) {
      isAiming = true;
      scopeOverlayEl.classList.add('active');
      crosshairEl.classList.add('hidden');
    }
    return;
  }
  if (e.button !== 0) return;
  mouseHeld = true;
  if (currentWeapon === 'knife') {
    meleeAttack();
    return;
  }
  tryFireGun();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseHeld = false;
  if (e.button === 2) {
    isAiming = false;
    scopeOverlayEl.classList.remove('active');
    crosshairEl.classList.remove('hidden');
  }
});

let recoil = 0;

// spring-damper recoil: a shot adds angular velocity (an impulse), then a
// spring pulls the view back to center while damping bleeds off the motion,
// same as a mass on a spring rather than a hand-tuned lerp back to zero.
const RECOIL_STIFFNESS = 180; // spring constant (rad/s^2 per rad of offset)
const RECOIL_DAMPING = 20; // damping coefficient (slightly underdamped for a little settle-bounce)
const RECOIL_KICK_VEL = 2.4; // angular velocity added per shot (rad/s)
let recoilOffset = 0; // current angular offset from the spring's rest position
let recoilVel = 0; // current angular velocity of the recoil spring

// ---------- ammo & reload ----------
// each gun keeps its own magazine; switching guns keeps whatever ammo that
// gun had left, but cancels any reload in progress
let ammoState = {};
function refillAllAmmo() {
  for (const id in GUN_CATALOG) ammoState[id] = GUN_CATALOG[id].magSize;
}
refillAllAmmo();

let isReloading = false;
let reloadTimer = 0;
let reloadDuration = 0;

const ammoHudEl = document.getElementById('ammo-hud');
const ammoCurrentEl = document.getElementById('ammo-current');
const ammoMaxEl = document.getElementById('ammo-max');
const reloadBarEl = document.getElementById('reload-bar');
const reloadBarFillEl = document.getElementById('reload-bar-fill');

function updateAmmoHUD() {
  if (currentWeapon !== 'gun') {
    ammoHudEl.classList.add('hidden');
    return;
  }
  ammoHudEl.classList.remove('hidden');
  const def = GUN_CATALOG[equippedGunId];
  ammoCurrentEl.textContent = ammoState[def.id];
  ammoMaxEl.textContent = def.magSize;
  ammoHudEl.classList.toggle('empty', ammoState[def.id] <= 0 && !isReloading);
  reloadBarEl.classList.toggle('hidden', !isReloading);
}

function cancelReload() {
  isReloading = false;
  reloadTimer = 0;
  reloadDuration = 0;
}

function startReload() {
  const def = GUN_CATALOG[equippedGunId];
  if (isReloading || ammoState[def.id] >= def.magSize) return;
  sfxReloadStart();
  isReloading = true;
  reloadDuration = def.reloadTime;
  reloadTimer = def.reloadTime;
  reloadBarFillEl.style.animation = 'none';
  void reloadBarFillEl.offsetWidth; // restart the CSS animation with the new duration
  reloadBarFillEl.style.animation = `reload-fill ${def.reloadTime}s linear forwards`;
  updateAmmoHUD();
}

window.addEventListener('keydown', (e) => {
  if (gameState !== 'playing' || currentWeapon !== 'gun') return;
  if (e.code === 'KeyR') startReload();
});

function tryFireGun() {
  if (gunFireTimer > 0 || isReloading) return;
  const def = GUN_CATALOG[equippedGunId];
  if ((ammoState[def.id] || 0) <= 0) {
    sfxEmptyClick();
    startReload();
    return;
  }
  gunFireTimer = def.cooldown;

  if (def.burstCount) {
    for (let i = 0; i < def.burstCount; i++) {
      setTimeout(() => {
        if (gameState === 'playing' && !isReloading && (ammoState[def.id] || 0) > 0) shoot(def);
      }, i * (def.burstDelay || 70));
    }
  } else {
    shoot(def);
  }
}

function shoot(def) {
  ammoState[def.id] = Math.max(0, (ammoState[def.id] || 0) - 1);
  updateAmmoHUD();
  sfxShot(def.id);
  const recoilMult = def.recoilMult || 1;
  flashLight.intensity = 3;
  recoil = 0.08 * recoilMult;
  pulseCrosshair();
  muzzleSprite.material.opacity = 1;
  muzzleSprite.scale.set(0.32, 0.32, 0.32);

  recoilVel += RECOIL_KICK_VEL * recoilMult;

  // shotguns fire several pellets in a small spread cone; other guns are
  // just a single pellet with zero spread, so this path covers both
  const meshes = enemies.map((en) => en.mesh);
  const pelletCount = def.pellets || 1;
  const spread = def.spread || 0;
  let anyHit = false;
  let anyCrit = false;
  for (let i = 0; i < pelletCount; i++) {
    const jitterX = spread ? (Math.random() - 0.5) * spread : 0;
    const jitterY = spread ? (Math.random() - 0.5) * spread : 0;
    raycaster.setFromCamera(spread ? new THREE.Vector2(jitterX, jitterY) : center, camera);
    const hits = raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      const enemy = enemies.find((en) => en.mesh === hitMesh || en.mesh === hitMesh.parent);
      if (enemy) {
        const isHeadshot = !!hitMesh.userData.isHead;
        damageEnemy(enemy, isHeadshot ? def.damage * CRIT_MULTIPLIER : def.damage);
        anyHit = true;
        if (isHeadshot) anyCrit = true;
      }
    }
  }
  if (anyHit) {
    showHitMarker(anyCrit);
    if (anyCrit) sfxCrit();
    else sfxHit();
  }
}

function meleeAttack() {
  if (knifeCooldown > 0) return;
  knifeCooldown = KNIFE_COOLDOWN;
  knifeSwing = 1;
  pulseCrosshair();
  sfxKnifeSwing();

  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);

  let target = null;
  let bestDot = KNIFE_CONE_COS;
  for (const enemy of enemies) {
    const toEnemy = new THREE.Vector3().subVectors(enemy.mesh.position, camera.position);
    const dist = toEnemy.length();
    if (dist > KNIFE_RANGE) continue;
    toEnemy.normalize();
    const dot = toEnemy.dot(camDir);
    if (dot > bestDot) {
      bestDot = dot;
      target = enemy;
    }
  }
  if (target) {
    damageEnemy(target, KNIFE_DAMAGE);
    showHitMarker();
    sfxHit();
  }
}

// ---------- enemies ----------
const enemies = [];
const ENEMY_BASE_HP = 100;
const ENEMY_HP_PER_WAVE = 8;

function buildEnemyMesh() {
  const group = new THREE.Group();

  const skinColor = 0x9c2b2b;
  const bodyMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.55, emissive: 0x2a0000 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 0.5, emissive: 0x2a0000 });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff7a1a,
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 4, 8), bodyMat);
  body.position.y = 0.78;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), headMat);
  head.position.y = 1.48;
  head.castShadow = true;
  head.userData.isHead = true;
  group.add(head);

  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 6), bodyMat);
  horn.position.y = 1.82;
  horn.userData.isHead = true;
  group.add(horn);

  const eyeGeo = new THREE.SphereGeometry(0.055, 6, 6);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.12, 1.5, 0.24);
  eyeL.userData.isHead = true;
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.12, 1.5, 0.24);
  eyeR.userData.isHead = true;
  group.add(eyeL, eyeR);

  group.userData.flashMats = [bodyMat, headMat];
  return group;
}

function spawnEnemy(speedMult) {
  const mesh = buildEnemyMesh();

  const angle = Math.random() * Math.PI * 2;
  const r = 16 + Math.random() * 8;
  mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
  scene.add(mesh);

  const hp = ENEMY_BASE_HP + (wave - 1) * ENEMY_HP_PER_WAVE;

  enemies.push({
    mesh,
    hp,
    maxHp: hp,
    speed: (1.4 + Math.random() * 0.6) * speedMult,
    attackCooldown: 0,
    y: 0,
    velY: 0,
    grounded: true,
  });
}

// ---------- particles (enemy death bursts) ----------
const particles = [];
const particleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
function spawnDeathBurst(position) {
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c2b2b, roughness: 0.6 });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.position.copy(position);
    mesh.position.y += 0.9;
    scene.add(mesh);
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 2.5;
    particles.push({
      mesh,
      vel: new THREE.Vector3(Math.cos(angle) * speed, 3 + Math.random() * 2, Math.sin(angle) * speed),
      life: 0.55 + Math.random() * 0.3,
      age: 0,
    });
  }
}

function clearParticles() {
  for (const p of particles) {
    scene.remove(p.mesh);
    p.mesh.material.dispose();
  }
  particles.length = 0;
}

function damageEnemy(enemy, amount) {
  enemy.hp -= amount;
  const flashMats = enemy.mesh.userData.flashMats;
  flashMats.forEach((m) => m.emissive.setHex(0xffffff));
  setTimeout(() => flashMats.forEach((m) => m.emissive.setHex(0x2a0000)), 60);

  if (enemy.hp <= 0) {
    sfxEnemyDeath();
    spawnDeathBurst(enemy.mesh.position);
    scene.remove(enemy.mesh);
    const idx = enemies.indexOf(enemy);
    if (idx !== -1) enemies.splice(idx, 1);
    score += 10;
    addMoney(KILL_REWARD);
    updateHUD();
  }
}

// ---------- waves ----------
let wave = 1;
let waveActive = false;

const waveBannerEl = document.getElementById('wave-banner');
const waveBannerTextEl = document.getElementById('wave-banner-text');
function showWaveBanner(n) {
  waveBannerTextEl.textContent = 'WAVE ' + n;
  waveBannerEl.classList.remove('show');
  void waveBannerEl.offsetWidth; // restart the CSS animation
  waveBannerEl.classList.add('show');
}

function startWave() {
  waveActive = true;
  showWaveBanner(wave);
  sfxWaveStart();
  const count = 3 + wave * 2;
  const speedMult = 1 + wave * 0.08;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      if (gameState === 'playing' || gameState === 'paused') spawnEnemy(speedMult);
    }, i * 350);
  }
  updateHUD();
}

// ---------- player state ----------
let health = 100;
let score = 0;
let gameState = 'menu'; // menu | playing | paused | gameover

const healthFill = document.getElementById('health-fill');
const healthNumEl = document.getElementById('health-num');
const scoreValEl = document.getElementById('score-val');
const waveValEl = document.getElementById('wave-val');
const finalScoreEl = document.getElementById('final-score');
const lowHpEl = document.getElementById('low-hp-overlay');
let lowHpInterval = null;

// ---------- currency: earned per kill and per wave clear, persists across runs ----------
const GOLD_STORAGE_KEY = 'waveShooterGold';
const KILL_REWARD = 3;
function waveClearReward(clearedWave) {
  return 25 + clearedWave * 5;
}

function loadMoney() {
  try {
    const saved = parseInt(localStorage.getItem(GOLD_STORAGE_KEY), 10);
    return Number.isFinite(saved) ? saved : 0;
  } catch (e) {
    return 0;
  }
}
function saveMoney() {
  try {
    localStorage.setItem(GOLD_STORAGE_KEY, String(money));
  } catch (e) {
    // storage unavailable (private mode, etc.) - just keep it in memory
  }
}

let money = loadMoney();
const goldValEl = document.getElementById('gold-val');
const goldPopupEl = document.getElementById('gold-popup');
const menuGoldValEl = document.getElementById('menu-gold-val');

function addMoney(amount) {
  money += amount;
  saveMoney();
  goldValEl.textContent = money;
  menuGoldValEl.textContent = money;
  goldPopupEl.textContent = '+' + amount;
  goldPopupEl.classList.remove('pop');
  void goldPopupEl.offsetWidth; // restart the CSS animation
  goldPopupEl.classList.add('pop');
}

function spendMoney(amount) {
  money -= amount;
  saveMoney();
  goldValEl.textContent = money;
  menuGoldValEl.textContent = money;
}

function updateHUD() {
  const pct = Math.max(0, health);
  healthFill.style.width = pct + '%';
  healthFill.style.background =
    pct > 50
      ? 'linear-gradient(90deg, #3ddc84, #8fe74d)'
      : pct > 25
      ? 'linear-gradient(90deg, #ffb648, #ffd23d)'
      : 'linear-gradient(90deg, #ff4d5e, #ff8a3d)';
  healthNumEl.textContent = pct;
  scoreValEl.textContent = score;
  waveValEl.textContent = wave;
  goldValEl.textContent = money;
  menuGoldValEl.textContent = money;
  const isLow = pct > 0 && pct <= 30;
  lowHpEl.classList.toggle('active', isLow);
  if (isLow && !lowHpInterval) {
    sfxHeartbeat();
    lowHpInterval = setInterval(sfxHeartbeat, 1100); // matches the CSS pulse cycle
  } else if (!isLow && lowHpInterval) {
    clearInterval(lowHpInterval);
    lowHpInterval = null;
  }
}

function takeDamage(amount) {
  health -= amount;
  sfxPlayerHurt();
  hitFlash.style.opacity = 0.5;
  setTimeout(() => (hitFlash.style.opacity = 0), 150);
  if (health <= 0) {
    health = 0;
    endGame();
  }
  updateHUD();
}

function endGame() {
  gameState = 'gameover';
  controls.unlock();
  finalScoreEl.textContent = 'SCORE ' + score + '  •  WAVE ' + wave;
  gameoverScreen.classList.remove('hidden');
}

function resetGame() {
  enemies.forEach((en) => scene.remove(en.mesh));
  enemies.length = 0;
  clearParticles();
  health = 100;
  score = 0;
  wave = 1;
  waveActive = false;
  camera.position.set(0, EYE_HEIGHT, 0);
  playerY = 0;
  playerVelY = 0;
  playerGrounded = true;
  eyeHeight = EYE_HEIGHT;
  recoilOffset = 0;
  recoilVel = 0;
  knifeCooldown = 0;
  knifeSwing = 0;
  gunFireTimer = 0;
  mouseHeld = false;
  isAiming = false;
  scopeOverlayEl.classList.remove('active');
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
  refillAllAmmo();
  cancelReload();
  weaponIndex = 0;
  setWeapon('gun');
  needsWaveStart = true;
  updateHUD();
}

// ---------- main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (gameState === 'playing') {
    const crouching = !!(keys['ControlLeft'] || keys['ControlRight']);

    // movement
    const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    velocity.set(strafe, 0, forward);
    const speedMult = crouching ? 0.5 : currentWeapon === 'knife' ? KNIFE_SPEED_MULT : 1;
    if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(MOVE_SPEED * speedMult * delta);

    controls.moveRight(velocity.x);
    controls.moveForward(velocity.z);

    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -BOUND, BOUND);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -BOUND, BOUND);
    resolveObstacleCollision(camera.position, playerY, PLAYER_RADIUS);

    // jump / gravity
    const groundY = groundHeightAt(camera.position.x, camera.position.z);
    if (keys['Space'] && playerGrounded) {
      playerVelY = JUMP_SPEED;
      playerGrounded = false;
      sfxJump();
    }
    playerVelY += GRAVITY * delta;
    playerY += playerVelY * delta;
    if (playerY <= groundY) {
      playerY = groundY;
      playerVelY = 0;
      playerGrounded = true;
    } else {
      playerGrounded = false;
    }

    // crouch (smoothly lerp eye height)
    const targetEyeHeight = crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    eyeHeight = THREE.MathUtils.lerp(eyeHeight, targetEyeHeight, delta * 10);
    camera.position.y = playerY + eyeHeight;

    // recoil: damped spring pulls the kicked-up view back to center
    const recoilAccel = -RECOIL_STIFFNESS * recoilOffset - RECOIL_DAMPING * recoilVel;
    recoilVel += recoilAccel * delta;
    const prevRecoilOffset = recoilOffset;
    recoilOffset += recoilVel * delta;
    camera.rotateX(recoilOffset - prevRecoilOffset);

    // scope zoom: lerp FOV/sensitivity toward the aimed values while
    // holding right-click on a gun that has one, otherwise back to normal
    const equippedDef = currentWeapon === 'gun' ? GUN_CATALOG[equippedGunId] : null;
    const aimingNow = isAiming && equippedDef && equippedDef.zoomFov;
    const targetFov = aimingNow ? equippedDef.zoomFov : baseFov;
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * 12);
    camera.updateProjectionMatrix();
    controls.pointerSpeed = aimingNow ? baseSens * 0.35 : baseSens;

    // weapon cooldowns / swing animation
    if (gunFireTimer > 0) gunFireTimer -= delta;
    if (mouseHeld && currentWeapon === 'gun' && GUN_CATALOG[equippedGunId].auto) {
      tryFireGun();
    }

    // reload timer + the dip shape used for the reload animation below
    let reloadDip = 0;
    if (isReloading) {
      reloadTimer -= delta;
      if (reloadTimer <= 0) {
        ammoState[equippedGunId] = GUN_CATALOG[equippedGunId].magSize;
        cancelReload();
        updateAmmoHUD();
        sfxReloadDone();
      } else {
        reloadDip = Math.sin((1 - reloadTimer / reloadDuration) * Math.PI); // 0 -> 1 -> 0
      }
    }
    if (knifeCooldown > 0) knifeCooldown -= delta;
    knifeSwing = Math.max(0, knifeSwing - delta * 3.2);
    const swingShape = Math.sin((1 - knifeSwing) * Math.PI); // 0 -> 1 -> 0 across the slash
    knifeGroup.rotation.z = -0.3 - swingShape * 2.1;
    knifeGroup.rotation.y = swingShape * 1.5;
    knifeGroup.position.x = 0.24 - swingShape * 0.32;
    knifeGroup.position.z = -0.42 - swingShape * 0.3;

    // gun feel
    recoil = THREE.MathUtils.lerp(recoil, 0, delta * 10);
    gunGroup.position.z = recoil + reloadDip * 0.06;
    flashLight.intensity = THREE.MathUtils.lerp(flashLight.intensity, 0, delta * 20);
    muzzleSprite.material.opacity = THREE.MathUtils.lerp(muzzleSprite.material.opacity, 0, delta * 18);
    const muzzleScale = THREE.MathUtils.lerp(muzzleSprite.scale.x, 0, delta * 14);
    muzzleSprite.scale.set(muzzleScale, muzzleScale, muzzleScale);
    const bob = Math.sin(performance.now() * 0.01) * (velocity.lengthSq() > 0 ? 0.015 : 0);
    // the gun leans down a little while reloading, as if looking at it -
    // the actual reload action is the magazine/pump animation below
    gunGroup.position.y = -0.02 + bob - reloadDip * 0.1;
    gunGroup.rotation.x = -reloadDip * 0.35;

    // reload action: the equipped gun's magazine drops out and slides back
    // in (or, for the pump shotgun, the pump racks back and forward)
    const reloadPart = gunReloadPartsById[equippedGunId];
    if (reloadPart) {
      if (reloadPart.axis === 'y') {
        reloadPart.part.position.y = reloadPart.restY + reloadDip * reloadPart.amount;
      } else {
        reloadPart.part.position.z = reloadPart.restZ + reloadDip * reloadPart.amount;
      }
    }

    // enemies
    for (const enemy of enemies) {
      const dir = new THREE.Vector3(
        camera.position.x - enemy.mesh.position.x,
        0,
        camera.position.z - enemy.mesh.position.z
      );
      const horizDist = dir.length();
      dir.normalize();

      enemy.mesh.rotation.y = Math.atan2(dir.x, dir.z);

      // "close enough to attack" has to check height too - otherwise an
      // enemy standing right under a platform the player is on reads as
      // being in melee range and just stands there instead of climbing up
      const heightGap = Math.abs(camera.position.y - (enemy.y + 1.5));
      const inMeleeRange = horizDist <= 1.6 && heightGap <= 1.8;

      let blocked = false;
      if (!inMeleeRange) {
        const tentative = new THREE.Vector3(
          enemy.mesh.position.x + dir.x * enemy.speed * delta,
          0,
          enemy.mesh.position.z + dir.z * enemy.speed * delta
        );
        blocked = resolveObstacleCollision(tentative, enemy.y, ENEMY_RADIUS);
        enemy.mesh.position.x = tentative.x;
        enemy.mesh.position.z = tentative.z;
      } else {
        enemy.attackCooldown -= delta;
        if (enemy.attackCooldown <= 0) {
          takeDamage(10);
          enemy.attackCooldown = 0.8;
        }
      }

      // vertical physics: climb obstacles blocking the path, otherwise fall/rest under gravity
      const enemyGroundY = groundHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
      if (blocked && enemy.grounded) {
        enemy.y += CLIMB_SPEED * delta;
        enemy.velY = 0;
      } else {
        enemy.velY += GRAVITY * delta;
        enemy.y += enemy.velY * delta;
      }
      if (enemy.y <= enemyGroundY) {
        enemy.y = enemyGroundY;
        enemy.velY = 0;
        enemy.grounded = true;
      } else {
        enemy.grounded = false;
      }
      enemy.mesh.position.y = enemy.y;
    }

    // death-burst particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += delta;
      p.vel.y += GRAVITY * delta;
      p.mesh.position.addScaledVector(p.vel, delta);
      p.mesh.rotation.x += delta * 6;
      p.mesh.rotation.y += delta * 4;
      const t = p.age / p.life;
      const s = Math.max(0, 1 - t);
      p.mesh.scale.set(s, s, s);
      if (p.age >= p.life) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }

    // wave clear check
    if (waveActive && enemies.length === 0) {
      waveActive = false;
      addMoney(waveClearReward(wave));
      wave += 1;
      setTimeout(() => {
        if (gameState === 'playing' || gameState === 'paused') startWave();
      }, 1800);
      updateHUD();
    }
  }

  dust.rotation.y += delta * 0.03;

  renderer.render(scene, camera);
}

function gunStatsLabel(def) {
  const fireType = def.auto ? '자동 연사' : '반자동';
  return `데미지 ${def.damage} · ${fireType}`;
}

// ---------- armory: equip any owned gun; the knife slot is fixed for now ----------
const armoryListEl = document.getElementById('armory-list');
function renderArmory() {
  armoryListEl.innerHTML = '';

  for (const gunId of ownedGuns) {
    const def = GUN_CATALOG[gunId];
    const row = document.createElement('div');
    row.className = 'armory-item';
    const isEquipped = gunId === equippedGunId;
    row.innerHTML = `
      <div class="info">
        <div class="name">${def.name}</div>
        <div class="stats">${gunStatsLabel(def)}</div>
      </div>
      <div class="equip-badge ${isEquipped ? 'equipped' : 'equip-action'}">${isEquipped ? '장착됨' : '장착'}</div>
    `;
    if (!isEquipped) {
      row.querySelector('.equip-badge').addEventListener('click', () => {
        equippedGunId = gunId;
        saveEquippedGun();
        applyEquippedGunModel();
        cancelReload();
        setWeapon(currentWeapon);
        renderArmory();
      });
    }
    armoryListEl.appendChild(row);
  }

  const knifeRow = document.createElement('div');
  knifeRow.className = 'armory-item';
  knifeRow.innerHTML = `
    <div class="info">
      <div class="name">나이프 (Knife)</div>
      <div class="stats">데미지 ${KNIFE_DAMAGE} · 근접 전용, 이동속도 증가</div>
    </div>
    <div class="equip-badge equipped">장착됨</div>
  `;
  armoryListEl.appendChild(knifeRow);
}

// ---------- shop: spend gold to unlock more guns ----------
const shopListEl = document.getElementById('shop-list');
const shopGoldValEl = document.getElementById('shop-gold-val');
function renderShop() {
  shopGoldValEl.textContent = money;
  shopListEl.innerHTML = '';

  for (const def of Object.values(GUN_CATALOG)) {
    const owned = ownedGuns.includes(def.id);
    const row = document.createElement('div');
    row.className = 'armory-item';

    let badgeHtml;
    if (owned) {
      badgeHtml = `<div class="equip-badge equipped">보유중</div>`;
    } else if (money >= def.price) {
      badgeHtml = `<div class="equip-badge buy-action">${def.price} G</div>`;
    } else {
      badgeHtml = `<div class="equip-badge disabled">${def.price} G</div>`;
    }

    row.innerHTML = `
      <div class="info">
        <div class="name">${def.name}</div>
        <div class="stats">${gunStatsLabel(def)}</div>
      </div>
      ${badgeHtml}
    `;

    if (!owned && money >= def.price) {
      row.querySelector('.equip-badge').addEventListener('click', () => {
        spendMoney(def.price);
        sfxPurchase();
        ownedGuns.push(def.id);
        saveOwnedGuns();
        renderShop();
      });
    }
    shopListEl.appendChild(row);
  }
}

applyEquippedGunModel();
setWeapon('gun');
updateHUD();
animate();
