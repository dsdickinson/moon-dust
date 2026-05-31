import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const canvas = document.querySelector("#game");
const shell = document.querySelector("#game-shell");
const startButton = document.querySelector("#start");
const message = document.querySelector("#message");
const healthEl = document.querySelector("#health");
const shieldEl = document.querySelector("#shield");
const shieldReadout = document.querySelector(".shield-readout");
const targetsEl = document.querySelector("#targets");
const scoreEl = document.querySelector("#score");
const damageEl = document.querySelector("#damage");
const shieldFlareEl = document.querySelector("#shield-flare");

const MOON_RADIUS = 42;
const HOVER_HEIGHT = 9;
const PLAYER_RADIUS = 1.5;
const TARGET_COUNT = 26;
const PLAYER_SHOT_SPEED = 78;
const ENEMY_SHOT_SPEED = 31;
const TARGET_RADIUS = 1.75;
const SURFACE_EPSILON = 0.1;
const SHIELD_MAX = 100;
const SHIELD_DRAIN_RATE = 31;
const SHIELD_RECHARGE_RATE = 18;
const SHIELD_RECHARGE_DELAY = 1.15;
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02040a, 0.011);

const camera = new THREE.PerspectiveCamera(
  58,
  window.innerWidth / window.innerHeight,
  0.1,
  420
);

const ambient = new THREE.HemisphereLight(0xbedcff, 0x141820, 0.7);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 2.35);
sun.position.set(-62, 88, 54);
scene.add(sun);

const rim = new THREE.DirectionalLight(0x5ee7ff, 0.7);
rim.position.set(44, -28, -38);
scene.add(rim);

const stars = makeStars();
scene.add(stars);

const moon = makeMoon();
scene.add(moon);

const playerRig = new THREE.Group();
scene.add(playerRig);

const cockpit = makeCockpit();
camera.add(cockpit);

const shieldBubble = makeShieldBubble();
camera.add(shieldBubble);
scene.add(camera);

const keys = new Set();
const targets = [];
const playerShots = [];
const enemyShots = [];
const explosions = [];
const clock = new THREE.Clock();

let playerNormal = new THREE.Vector3(0.12, 0.58, 0.81).normalize();
let playerForward = projectOnTangent(new THREE.Vector3(0, 0, -1), playerNormal);
let health = 100;
let shield = SHIELD_MAX;
let shieldRechargeDelay = 0;
let shieldImpactTimer = 0;
let score = 0;
let active = false;
let fireCooldown = 0;
let restartCooldown = 0;
let gameOver = false;

spawnTargets();
syncHud();
message.textContent = "Destroy the lunar defense grid";

startButton.addEventListener("click", () => beginGame());
window.addEventListener("pointerdown", () => {
  if (!active) beginGame();
  firePlayerShot();
});
window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space") {
    event.preventDefault();
    if (!active) beginGame();
    firePlayerShot();
  }
  if (event.code === "KeyR" && restartCooldown <= 0) {
    restart();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("resize", resize);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.033);
  update(dt);
  renderer.render(scene, camera);
});

function beginGame() {
  if (gameOver) restart();
  active = true;
  shell.classList.add("playing");
}

function restart() {
  health = 100;
  shield = SHIELD_MAX;
  shieldRechargeDelay = 0;
  shieldImpactTimer = 0;
  score = 0;
  active = true;
  gameOver = false;
  restartCooldown = 0.35;
  playerNormal.set(0.12, 0.58, 0.81).normalize();
  playerForward = projectOnTangent(new THREE.Vector3(0, 0, -1), playerNormal);
  clearObjects(playerShots);
  clearObjects(enemyShots);
  clearObjects(explosions);
  targets.splice(0).forEach((target) => scene.remove(target.group));
  spawnTargets();
  shell.classList.add("playing");
  syncHud();
}

function update(dt) {
  stars.rotation.y += dt * 0.006;
  moon.rotation.y += dt * 0.005;
  fireCooldown = Math.max(0, fireCooldown - dt);
  restartCooldown = Math.max(0, restartCooldown - dt);
  shieldImpactTimer = Math.max(0, shieldImpactTimer - dt);

  if (active && !gameOver) {
    updatePlayer(dt);
    updateShield(dt);
    updateTargets(dt);
    updateShots(dt);
    if (targets.every((target) => !target.alive)) {
      win();
    }
  }

  updateCamera(dt);
  updateExplosions(dt);
}

function updatePlayer(dt) {
  const turn = new THREE.Vector3();
  const right = new THREE.Vector3().crossVectors(playerForward, playerNormal).normalize();

  if (keys.has("KeyW") || keys.has("ArrowUp")) turn.sub(playerForward);
  if (keys.has("KeyS") || keys.has("ArrowDown")) turn.add(playerForward);
  if (keys.has("KeyD") || keys.has("ArrowRight")) turn.sub(right);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) turn.add(right);

  if (turn.lengthSq() > 0) {
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1.42 : 0.82;
    const axis = new THREE.Vector3().crossVectors(turn.normalize(), playerNormal).normalize();
    const angle = speed * dt;
    playerNormal.applyAxisAngle(axis, angle).normalize();
    playerForward.applyAxisAngle(axis, angle);
  }

  if (keys.has("KeyQ")) {
    playerForward.applyAxisAngle(playerNormal, 1.6 * dt);
  }
  if (keys.has("KeyE")) {
    playerForward.applyAxisAngle(playerNormal, -1.6 * dt);
  }

  playerForward = projectOnTangent(playerForward, playerNormal);
}

function updateCamera(dt) {
  const pos = playerNormal.clone().multiplyScalar(MOON_RADIUS + HOVER_HEIGHT);
  const right = new THREE.Vector3().crossVectors(playerForward, playerNormal).normalize();
  const lookTarget = pos
    .clone()
    .add(playerForward.clone().multiplyScalar(13))
    .sub(playerNormal.clone().multiplyScalar(18));

  camera.position.lerp(pos, active ? 1 - Math.pow(0.0001, dt) : 0.03);
  camera.up.copy(playerNormal);
  camera.lookAt(lookTarget);

  playerRig.position.copy(pos);
  playerRig.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, playerNormal, playerForward.clone().negate())
  );
}

function updateTargets(dt) {
  const playerPos = playerNormal.clone().multiplyScalar(MOON_RADIUS + HOVER_HEIGHT);
  targets.forEach((target) => {
    if (!target.alive) return;

    target.group.lookAt(target.normal.clone().multiplyScalar(MOON_RADIUS + 20));
    target.barrel.rotation.y += dt * 2.6;
    target.cooldown -= dt;

    const visible = target.normal.dot(playerNormal) > 0.38;
    if (visible && target.cooldown <= 0) {
      target.cooldown = 1.8 + Math.random() * 1.35;
      fireEnemyShot(target, playerPos);
    }
  });
}

function updateShots(dt) {
  for (let index = playerShots.length - 1; index >= 0; index -= 1) {
    const shot = playerShots[index];
    shot.life -= dt;
    shot.mesh.position.addScaledVector(shot.velocity, dt);

    let spent = shot.life <= 0 || shot.mesh.position.length() < MOON_RADIUS + SURFACE_EPSILON;
    for (const target of targets) {
      if (!target.alive) continue;
      if (shot.mesh.position.distanceTo(target.group.position) < TARGET_RADIUS) {
        destroyTarget(target);
        spent = true;
        break;
      }
    }

    if (spent) removeShot(playerShots, index);
  }

  const playerPos = playerNormal.clone().multiplyScalar(MOON_RADIUS + HOVER_HEIGHT);
  for (let index = enemyShots.length - 1; index >= 0; index -= 1) {
    const shot = enemyShots[index];
    shot.life -= dt;
    shot.mesh.position.addScaledVector(shot.velocity, dt);

    const hitPlayer = shot.mesh.position.distanceTo(playerPos) < PLAYER_RADIUS;
    const hitMoon = shot.mesh.position.length() < MOON_RADIUS + SURFACE_EPSILON;
    if (hitPlayer) absorbEnemyHit(10);
    if (hitPlayer || hitMoon || shot.life <= 0) {
      removeShot(enemyShots, index);
    }
  }
}

function firePlayerShot() {
  if (!active || gameOver || fireCooldown > 0) return;
  fireCooldown = 0.22;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const origin = camera.position.clone().add(direction.clone().multiplyScalar(1.8));
  const shot = makeShot(0x7df4ff, 0xffffff, 0.34);
  shot.position.copy(origin);
  scene.add(shot);
  playerShots.push({
    mesh: shot,
    velocity: direction.multiplyScalar(PLAYER_SHOT_SPEED),
    life: 1.8,
  });
}

function fireEnemyShot(target, playerPos) {
  const origin = target.normal.clone().multiplyScalar(MOON_RADIUS + 1.55);
  const direction = playerPos.clone().sub(origin).normalize();
  const shot = makeShot(0xff5c3f, 0xfff0c2, 0.26);
  shot.position.copy(origin.add(direction.clone().multiplyScalar(1.5)));
  scene.add(shot);
  enemyShots.push({
    mesh: shot,
    velocity: direction.multiplyScalar(ENEMY_SHOT_SPEED),
    life: 3.2,
  });
}

function destroyTarget(target) {
  target.alive = false;
  target.group.visible = false;
  score += 100;
  spawnExplosion(target.group.position, 0x8df6ff);
  syncHud();
}

function absorbEnemyHit(amount) {
  if (isShieldActive()) {
    shield = Math.max(0, shield - amount * 1.6);
    shieldRechargeDelay = SHIELD_RECHARGE_DELAY;
    shieldImpactTimer = 0.18;
    shieldFlareEl.classList.add("impact");
    window.setTimeout(() => shieldFlareEl.classList.remove("impact"), 130);
    spawnExplosion(camera.position, 0x7df4ff);
    syncHud();
    return;
  }

  damagePlayer(amount);
}

function damagePlayer(amount) {
  if (gameOver) return;
  health = Math.max(0, health - amount);
  damageEl.classList.add("hit");
  window.setTimeout(() => damageEl.classList.remove("hit"), 120);
  syncHud();
  if (health <= 0) lose();
}

function win() {
  gameOver = true;
  active = false;
  shell.classList.remove("playing");
  message.textContent = "Defense grid destroyed";
  startButton.textContent = "Fly again";
}

function lose() {
  gameOver = true;
  active = false;
  shell.classList.remove("playing");
  message.textContent = "Hull breached";
  startButton.textContent = "Retry";
}

function updateShield(dt) {
  if (isShieldActive()) {
    shield = Math.max(0, shield - SHIELD_DRAIN_RATE * dt);
    shieldRechargeDelay = SHIELD_RECHARGE_DELAY;
  } else if (shieldRechargeDelay > 0) {
    shieldRechargeDelay = Math.max(0, shieldRechargeDelay - dt);
  } else if (shield < SHIELD_MAX) {
    shield = Math.min(SHIELD_MAX, shield + SHIELD_RECHARGE_RATE * dt);
  }

  const visible = isShieldActive() || shieldImpactTimer > 0;
  shieldBubble.visible = visible;
  shieldBubble.material.opacity = isShieldActive() ? 0.28 : 0.46;
  shieldBubble.rotation.z += dt * 0.9;
  shieldFlareEl.classList.toggle("active", isShieldActive());
  syncHud();
}

function isShieldActive() {
  return active && !gameOver && shield > 0 && keys.has("KeyF");
}

function syncHud() {
  healthEl.textContent = Math.ceil(health);
  shieldEl.textContent = Math.ceil(shield);
  shieldReadout.classList.toggle("active", isShieldActive());
  targetsEl.textContent = targets.filter((target) => target.alive).length;
  scoreEl.textContent = score;
}

function makeMoon() {
  const geometry = new THREE.IcosahedronGeometry(MOON_RADIUS, 76);
  const position = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];

  for (let index = 0; index < position.count; index += 1) {
    tmpVec.fromBufferAttribute(position, index).normalize();
    const roughness =
      Math.sin(tmpVec.x * 19.1) * 0.42 +
      Math.sin(tmpVec.y * 28.7) * 0.3 +
      Math.sin(tmpVec.z * 37.3) * 0.26 +
      Math.sin((tmpVec.x + tmpVec.y) * 61.4) * 0.15;
    const radius = MOON_RADIUS + roughness;
    position.setXYZ(index, tmpVec.x * radius, tmpVec.y * radius, tmpVec.z * radius);

    const shade = THREE.MathUtils.clamp(0.46 + roughness * 0.08 + Math.random() * 0.05, 0.34, 0.68);
    color.setRGB(shade, shade * 1.02, shade * 1.08);
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.03,
  });

  const moonMesh = new THREE.Mesh(geometry, material);
  moonMesh.add(makeCraters());
  return moonMesh;
}

function makeCraters() {
  const group = new THREE.Group();
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a9fa4,
    roughness: 1,
    metalness: 0,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x565b61,
    roughness: 1,
    metalness: 0,
  });

  for (let index = 0; index < 70; index += 1) {
    const normal = randomNormal();
    const radius = THREE.MathUtils.randFloat(0.8, 2.8);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 18),
      floorMaterial
    );
    orientSurfaceObject(floor, normal, MOON_RADIUS + 0.035);
    group.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.07 + radius * 0.035, 8, 26),
      ringMaterial
    );
    orientSurfaceObject(ring, normal, MOON_RADIUS + 0.08);
    group.add(ring);
  }
  return group;
}

function makeStars() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  for (let index = 0; index < 1300; index += 1) {
    const normal = randomNormal();
    const radius = THREE.MathUtils.randFloat(170, 285);
    positions.push(normal.x * radius, normal.y * radius, normal.z * radius);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xe8f5ff,
    size: 0.52,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.86,
  });
  return new THREE.Points(geometry, material);
}

function makeShieldBubble() {
  const geometry = new THREE.SphereGeometry(2.8, 36, 18);
  const material = new THREE.MeshBasicMaterial({
    color: 0x73efff,
    transparent: true,
    opacity: 0.28,
    wireframe: true,
    depthTest: false,
  });
  const bubble = new THREE.Mesh(geometry, material);
  bubble.renderOrder = 10;
  bubble.visible = false;
  return bubble;
}

function makeCockpit() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x101928,
    transparent: true,
    opacity: 0.78,
    depthTest: false,
  });
  const glow = new THREE.MeshBasicMaterial({
    color: 0x69e4ff,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
  });

  const left = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 1.2), material);
  left.position.set(-0.62, -0.36, -1.05);
  left.rotation.z = -0.18;
  group.add(left);

  const right = left.clone();
  right.position.x = 0.62;
  right.rotation.z = 0.18;
  group.add(right);

  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.24), material);
  dash.position.set(0, -0.58, -1.03);
  group.add(dash);

  const sight = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.061, 24), glow);
  sight.position.set(0, 0, -1.2);
  group.add(sight);
  return group;
}

function spawnTargets() {
  for (let index = 0; index < TARGET_COUNT; index += 1) {
    const normal = randomNormal();
    if (normal.dot(playerNormal) > 0.74) {
      index -= 1;
      continue;
    }
    const target = makeTarget(normal);
    targets.push(target);
    scene.add(target.group);
  }
  syncHud();
}

function makeTarget(normal) {
  const group = new THREE.Group();
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xb13f35,
    emissive: 0x3a0603,
    roughness: 0.62,
    metalness: 0.35,
  });
  const gunMaterial = new THREE.MeshStandardMaterial({
    color: 0x2e3743,
    emissive: 0x200b0a,
    roughness: 0.48,
    metalness: 0.7,
  });

  const base = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.7, 7), baseMaterial);
  base.rotation.x = Math.PI;
  base.position.y = 0.7;
  group.add(base);

  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 1.9), gunMaterial);
  barrel.position.set(0, 1.55, 0.5);
  group.add(barrel);

  const dish = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.08, 8, 24), gunMaterial);
  dish.position.y = 1.46;
  dish.rotation.x = Math.PI / 2;
  group.add(dish);

  orientSurfaceObject(group, normal, MOON_RADIUS + 0.48);
  return {
    group,
    barrel,
    normal: normal.clone(),
    cooldown: 1 + Math.random() * 2.5,
    alive: true,
  };
}

function makeShot(coreColor, lightColor, radius) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: coreColor });
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  group.add(core);

  const point = new THREE.PointLight(lightColor, 1.7, 10);
  group.add(point);
  return group;
}

function spawnExplosion(position, colorValue) {
  const geometry = new THREE.SphereGeometry(1, 16, 10);
  const material = new THREE.MeshBasicMaterial({
    color: colorValue,
    transparent: true,
    opacity: 0.92,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  scene.add(mesh);
  explosions.push({ mesh, life: 0.42, maxLife: 0.42 });
}

function updateExplosions(dt) {
  for (let index = explosions.length - 1; index >= 0; index -= 1) {
    const explosion = explosions[index];
    explosion.life -= dt;
    const t = 1 - explosion.life / explosion.maxLife;
    explosion.mesh.scale.setScalar(1 + t * 4.2);
    explosion.mesh.material.opacity = Math.max(0, 0.9 - t);
    if (explosion.life <= 0) {
      scene.remove(explosion.mesh);
      explosion.mesh.geometry.dispose();
      explosion.mesh.material.dispose();
      explosions.splice(index, 1);
    }
  }
}

function removeShot(collection, index) {
  const [shot] = collection.splice(index, 1);
  scene.remove(shot.mesh);
  shot.mesh.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
}

function clearObjects(collection) {
  while (collection.length) {
    const item = collection.pop();
    scene.remove(item.mesh);
  }
}

function randomNormal() {
  const z = THREE.MathUtils.randFloatSpread(2);
  const theta = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);
  return new THREE.Vector3(
    radius * Math.cos(theta),
    z,
    radius * Math.sin(theta)
  ).normalize();
}

function projectOnTangent(vector, normal) {
  const projected = vector.clone().sub(normal.clone().multiplyScalar(vector.dot(normal)));
  if (projected.lengthSq() < 0.0001) {
    projected.copy(new THREE.Vector3(0, 1, 0).cross(normal));
  }
  return projected.normalize();
}

function orientSurfaceObject(object, normal, radius) {
  object.position.copy(normal.clone().multiplyScalar(radius));
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  object.rotateY(Math.random() * Math.PI * 2);
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
