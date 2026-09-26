import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Water } from './water.js';
import { Floater, stepPhysics, syncFloater } from './physics.js';
import { Input } from './input.js';
import { Puffs } from './puffs.js';

const STEP = 1 / 60;

async function main() {
  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe7f4');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(9, 11, 14);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI * 0.44;

  scene.add(new THREE.HemisphereLight('#ffffff', '#f6d8b8', 1.3));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
  sun.position.set(9, 18, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // ---------- load the Blender scene ----------
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/pool-scene.glb`);
  const root = gltf.scene;
  scene.add(root);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const get = (name) => {
    const o = scene.getObjectByName(name);
    if (!o) throw new Error(`Missing "${name}" in pool-scene.glb. Re-export from Blender with that object visible.`);
    return o;
  };

  // swap Blender's flat water for the live one
  get('PoolWater').visible = false;
  const water = new Water();
  scene.add(water.mesh);

  // pull the floaty things out to world space so physics owns them
  const boatObj = get('CuteBoat'), ballObj = get('BeachBall'), donutObj = get('DonutFloatie');
  for (const o of [boatObj, ballObj, donutObj]) scene.attach(o);

  const boat = new Floater(boatObj, { kind: 'boat', radius: 1.0, mass: 4, drag: 0.9, ride: 0.05, tilt: 0.7, bob: 0.025, wake: 0.0018, restitution: 0.35 });
  const ball = new Floater(ballObj, { kind: 'ball', radius: 0.55, mass: 0.6, drag: 0.5, ride: 0.2, tilt: 0, bob: 0.03, wake: 0.0008, restitution: 0.75 });
  ball.rollsWithMotion = true;
  const donut = new Floater(donutObj, { kind: 'donut', radius: 1.05, mass: 1.1, drag: 0.6, ride: 0.04, tilt: 1.2, bob: 0.02, wake: 0.001, restitution: 0.6 });
  const floaters = [boat, ball, donut];
  const obstacles = [{ x: 3.1, z: -4.55, r: 0.15 }, { x: 3.9, z: -4.55, r: 0.15 }]; // ladder rails

  // ---------- cute bits: blinking, flag, smoke ----------
  const eyePivots = ['L', 'R'].map((s) => {
    const eye = get(`Eye_${s}`), glint = get(`EyeGlint_${s}`);
    const pivot = new THREE.Object3D();
    pivot.position.copy(eye.position);
    eye.parent.add(pivot);
    pivot.attach(eye); pivot.attach(glint);
    return pivot;
  });
  const pennant = get('Pennant');
  const flagPivot = new THREE.Object3D();
  flagPivot.position.set(0.1, 1.14, 0);
  pennant.parent.add(flagPivot);
  flagPivot.attach(pennant);

  const puffs = new Puffs(scene);
  const chimneyTop = new THREE.Vector3(-0.56, 1.24, 0);

  // ---------- input ----------
  const input = new Input();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 300;
    down = null;
    if (moved > 6 || !quick) return; // that was an orbit drag
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);

    const hit = raycaster.intersectObjects(floaters.map((f) => f.obj), true)[0];
    if (hit) {
      const f = floaters.find((fl) => { let o = hit.object; while (o) { if (o === fl.obj) return true; o = o.parent; } return false; });
      const dir = new THREE.Vector2(f.pos.x - camera.position.x, f.pos.y - camera.position.z).normalize();
      f.vel.addScaledVector(dir, 4.5 / Math.sqrt(f.mass));
      f.spin += (Math.random() - 0.5) * 4;
      water.disturb(f.pos.x, f.pos.y, f.radius, -0.12);
      return;
    }
    const wh = raycaster.intersectObject(water.mesh)[0];
    if (wh) water.disturb(wh.point.x, wh.point.z, 0.6, -0.3);
  });

  // ---------- boat driving ----------
  const fwd = new THREE.Vector2(), side = new THREE.Vector2();
  function driveBoat(dt) {
    const thr = input.throttle, steer = input.steer;
    fwd.set(Math.cos(boat.yaw), -Math.sin(boat.yaw));
    side.set(-fwd.y, fwd.x);
    const accel = thr >= 0 ? 6.5 : 3.5;
    boat.vel.addScaledVector(fwd, thr * accel * dt);
    // keel: kill most sideways slide so it steers like a boat, not a puck
    const lateral = boat.vel.dot(side);
    boat.vel.addScaledVector(side, -lateral * Math.min(1, 3.5 * dt));
    const speed = boat.vel.dot(fwd);
    const grip = 0.35 + 0.65 * Math.min(1, Math.abs(speed) / 2.5);
    boat.spin += (-steer * 2.4 * grip * Math.sign(speed || 1) - boat.spin) * Math.min(1, 6 * dt);
    // lean into turns, lift the nose on throttle
    boat.lean.x += (steer * Math.abs(speed) * 0.05 - boat.lean.x) * Math.min(1, 5 * dt);
    boat.lean.z += (thr * 0.06 - boat.lean.z) * Math.min(1, 3 * dt);
    if (input.takeHop() && boat.lift === 0) boat.liftV = 4.2;
    return { thr, speed };
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let acc = 0, time = 0, nextBlink = 2, blinkT = -1, puffT = 0;
  const lastBoat = boatObj.position.clone();
  controls.target.copy(boatObj.position);

  const onHit = (x, z, v) => { if (v > 0.6) water.disturb(x, z, 0.5, -Math.min(0.15, v * 0.04)); };

  document.getElementById('loading').remove();
  document.getElementById('hud').hidden = false;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    acc += dt;
    let drive = { thr: 0, speed: 0 };
    while (acc >= STEP) {
      drive = driveBoat(STEP);
      stepPhysics(floaters, obstacles, water, STEP, time, onHit);
      water.step();
      acc -= STEP; time += STEP;
    }
    water.updateMesh();
    for (const f of floaters) syncFloater(f, water, dt, time);

    // blink
    if (time > nextBlink && blinkT < 0) blinkT = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      const s = blinkT < 0.07 ? 1 - blinkT / 0.07 : Math.min(1, (blinkT - 0.07) / 0.09);
      for (const p of eyePivots) p.scale.y = Math.max(0.08, s);
      if (blinkT > 0.16) { blinkT = -1; nextBlink = time + 2 + Math.random() * 3; for (const p of eyePivots) p.scale.y = 1; }
    }
    // flag flutters harder when moving
    flagPivot.rotation.y = Math.sin(time * (5 + Math.abs(drive.speed) * 3)) * (0.12 + Math.min(0.35, Math.abs(drive.speed) * 0.1));

    // smoke puffs, more with throttle
    puffT -= dt;
    if (puffT <= 0) {
      puffs.spawn(boatObj.localToWorld(chimneyTop.clone()), 0.8 + Math.abs(drive.thr) * 0.5);
      puffT = drive.thr !== 0 ? 0.18 : 0.6;
    }
    puffs.update(dt);

    // camera follows the boat, keeping your orbit angle
    const delta = boatObj.position.clone().sub(lastBoat).setY(0);
    camera.position.add(delta); controls.target.add(delta);
    lastBoat.copy(boatObj.position);
    controls.update();

    renderer.render(scene, camera);
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Couldn't load the pool: ${err.message}`;
});
