import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------- basic setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
scene.fog = new THREE.Fog(0x0a0e14, 15, 45);

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

// ---------- lighting ----------
scene.add(new THREE.AmbientLight(0x6677aa, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
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

const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a3240, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE * 2, ARENA_SIZE * 2), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// grid lines for visual reference
const grid = new THREE.GridHelper(ARENA_SIZE * 2, 30, 0x445066, 0x1c222c);
grid.position.y = 0.01;
scene.add(grid);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4356, roughness: 0.8 });
const wallHeight = 6;
function makeWall(w, d, x, z) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
  wall.position.set(x, wallHeight / 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}
makeWall(ARENA_SIZE * 2, 1, 0, -ARENA_SIZE);
makeWall(ARENA_SIZE * 2, 1, 0, ARENA_SIZE);
makeWall(1, ARENA_SIZE * 2, -ARENA_SIZE, 0);
makeWall(1, ARENA_SIZE * 2, ARENA_SIZE, 0);

// scattered cover boxes (also act as climbable obstacles)
const coverMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.7 });
const obstacles = [];
for (let i = 0; i < 10; i++) {
  const s = 1.0 + Math.random() * 0.6;
  const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), coverMat);
  const angle = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * 16;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  box.position.set(x, s / 2, z);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
  obstacles.push({ x, z, hx: s / 2, hz: s / 2, height: s });
}

// ---------- gun view model ----------
const gunGroup = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.6 });
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), gunMat);
gunBody.position.set(0.22, -0.22, -0.5);
gunGroup.add(gunBody);
camera.add(gunGroup);
scene.add(camera);

// muzzle flash
const flashLight = new THREE.PointLight(0xffcc66, 0, 4);
flashLight.position.set(0.22, -0.18, -0.9);
camera.add(flashLight);

// ---------- controls ----------
const controls = new PointerLockControls(camera, renderer.domElement);

const startScreen = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const startTitle = startScreen.querySelector('h1');

startBtn.addEventListener('click', () => controls.lock());
restartBtn.addEventListener('click', () => {
  gameoverScreen.classList.add('hidden');
  resetGame();
  controls.lock();
});

let needsWaveStart = true;

controls.addEventListener('lock', () => {
  startScreen.classList.add('hidden');
  gameState = 'playing';
  if (needsWaveStart) {
    needsWaveStart = false;
    startWave();
  }
});
controls.addEventListener('unlock', () => {
  if (gameState === 'playing') {
    gameState = 'paused';
    startTitle.textContent = 'PAUSED';
    startBtn.textContent = '클릭해서 계속하기';
    startScreen.classList.remove('hidden');
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
const GRAVITY = -18;
const JUMP_SPEED = 8;
const CLIMB_SPEED = 2.5;
const PLAYER_RADIUS = 0.35;
const ENEMY_RADIUS = 0.45;

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

window.addEventListener('mousedown', (e) => {
  if (gameState !== 'playing' || e.button !== 0) return;
  shoot();
});

let recoil = 0;
function shoot() {
  flashLight.intensity = 3;
  recoil = 0.08;

  raycaster.setFromCamera(center, camera);
  const meshes = enemies.map((en) => en.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length > 0) {
    let hitMesh = hits[0].object;
    const enemy = enemies.find((en) => en.mesh === hitMesh || en.mesh === hitMesh.parent);
    if (enemy) damageEnemy(enemy, 34);
  }
}

// ---------- enemies ----------
const enemies = [];
const enemyGeo = new THREE.ConeGeometry(0.5, 1.6, 6);
const enemyMatBase = 0xd94b4b;

function spawnEnemy(speedMult) {
  const mat = new THREE.MeshStandardMaterial({ color: enemyMatBase, roughness: 0.6, emissive: 0x330000 });
  const mesh = new THREE.Mesh(enemyGeo, mat);
  mesh.castShadow = true;

  const angle = Math.random() * Math.PI * 2;
  const r = 16 + Math.random() * 8;
  mesh.position.set(Math.cos(angle) * r, 0.8, Math.sin(angle) * r);
  scene.add(mesh);

  enemies.push({
    mesh,
    hp: 100,
    maxHp: 100,
    speed: (1.4 + Math.random() * 0.6) * speedMult,
    attackCooldown: 0,
    y: 0,
    velY: 0,
    grounded: true,
  });
}

function damageEnemy(enemy, amount) {
  enemy.hp -= amount;
  enemy.mesh.material.emissive.setHex(0xffffff);
  setTimeout(() => enemy.mesh.material && enemy.mesh.material.emissive.setHex(0x330000), 60);

  if (enemy.hp <= 0) {
    scene.remove(enemy.mesh);
    const idx = enemies.indexOf(enemy);
    if (idx !== -1) enemies.splice(idx, 1);
    score += 10;
    updateHUD();
  }
}

// ---------- waves ----------
let wave = 1;
let waveActive = false;

function startWave() {
  waveActive = true;
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
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const finalScoreEl = document.getElementById('final-score');

function updateHUD() {
  healthFill.style.width = Math.max(0, health) + '%';
  scoreEl.textContent = 'SCORE ' + score;
  waveEl.textContent = 'WAVE ' + wave;
}

function takeDamage(amount) {
  health -= amount;
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
  health = 100;
  score = 0;
  wave = 1;
  waveActive = false;
  camera.position.set(0, EYE_HEIGHT, 0);
  playerY = 0;
  playerVelY = 0;
  playerGrounded = true;
  startTitle.textContent = 'WAVE SHOOTER';
  startBtn.textContent = '클릭해서 시작';
  needsWaveStart = true;
  updateHUD();
}

// ---------- main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (gameState === 'playing') {
    // movement
    const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    velocity.set(strafe, 0, forward);
    if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(MOVE_SPEED * delta);

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
    camera.position.y = playerY + EYE_HEIGHT;

    // gun feel
    recoil = THREE.MathUtils.lerp(recoil, 0, delta * 10);
    gunGroup.position.z = recoil;
    flashLight.intensity = THREE.MathUtils.lerp(flashLight.intensity, 0, delta * 20);
    const bob = Math.sin(performance.now() * 0.01) * (velocity.lengthSq() > 0 ? 0.015 : 0);
    gunGroup.position.y = -0.02 + bob;

    // enemies
    for (const enemy of enemies) {
      const dir = new THREE.Vector3(
        camera.position.x - enemy.mesh.position.x,
        0,
        camera.position.z - enemy.mesh.position.z
      );
      const dist = dir.length();
      dir.normalize();

      enemy.mesh.rotation.y = Math.atan2(dir.x, dir.z);

      let blocked = false;
      if (dist > 1.6) {
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
      enemy.mesh.position.y = enemy.y + 0.8;
    }

    // wave clear check
    if (waveActive && enemies.length === 0) {
      waveActive = false;
      wave += 1;
      setTimeout(() => {
        if (gameState === 'playing' || gameState === 'paused') startWave();
      }, 1800);
      updateHUD();
    }
  }

  renderer.render(scene, camera);
}

updateHUD();
animate();
