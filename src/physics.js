import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _slope = new THREE.Vector2();

// Pool wall as a superellipse |x/a|^n + |z/b|^n = 1 (matches the Blender pool at water level).
export const POOL = { a: 8.05, b: 4.55, n: 5 };

// Something that sits on the water: circle collider on the XZ plane, bobs and tilts with ripples.
export class Floater {
  constructor(obj, {
    radius, mass = 1, drag = 1.0, restitution = 0.5,
    ride = 0, tilt = 1, bob = 0.02, wake = 0.004, kind = 'prop',
  }) {
    this.obj = obj; this.kind = kind;
    this.radius = radius; this.mass = mass; this.drag = drag; this.restitution = restitution;
    this.ride = ride;          // height of the object's origin above the water surface
    this.tilt = tilt; this.bob = bob; this.wake = wake;
    this.pos = new THREE.Vector2(obj.position.x, obj.position.z);
    this.vel = new THREE.Vector2();
    this.yaw = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ').y;
    this.spin = 0;             // yaw speed, rad/s
    this.roll = new THREE.Quaternion();          // accumulated rolling (beach ball)
    this.baseQuat = obj.quaternion.clone();      // original orientation from Blender
    this.baseYaw = this.yaw;
    this.lean = new THREE.Euler();               // extra local lean (boat)
    this.lift = 0; this.liftV = 0;               // hop
    this.phase = Math.random() * Math.PI * 2;
    this.rollsWithMotion = false;
  }
}

function wallCollide(f, water, onHit) {
  const a = POOL.a - f.radius, b = POOL.b - f.radius, n = POOL.n;
  const x = f.pos.x, z = f.pos.y;
  const g = Math.abs(x / a) ** n + Math.abs(z / b) ** n;
  if (g <= 1) return;
  const s = g ** (-1 / n);
  f.pos.set(x * s, z * s);
  // outward normal from the gradient
  const nx = Math.sign(x) * Math.abs(x) ** (n - 1) / a ** n;
  const nz = Math.sign(z) * Math.abs(z) ** (n - 1) / b ** n;
  const len = Math.hypot(nx, nz) || 1;
  const Nx = nx / len, Nz = nz / len;
  const vn = f.vel.x * Nx + f.vel.y * Nz;
  if (vn > 0) {
    f.vel.x -= (1 + f.restitution) * vn * Nx;
    f.vel.y -= (1 + f.restitution) * vn * Nz;
    // glancing hits spin things a little
    f.spin += (f.vel.x * Nz - f.vel.y * Nx) * 0.3 / f.radius;
    onHit?.(f.pos.x + Nx * f.radius, f.pos.y + Nz * f.radius, vn);
  }
}

function pairCollide(A, B, onHit) {
  const dx = B.pos.x - A.pos.x, dz = B.pos.y - A.pos.y;
  const dist = Math.hypot(dx, dz), minD = A.radius + B.radius;
  if (dist >= minD || dist === 0) return;
  const nx = dx / dist, nz = dz / dist;
  const overlap = minD - dist, total = A.mass + B.mass;
  A.pos.x -= nx * overlap * (B.mass / total); A.pos.y -= nz * overlap * (B.mass / total);
  B.pos.x += nx * overlap * (A.mass / total); B.pos.y += nz * overlap * (A.mass / total);
  const rvx = B.vel.x - A.vel.x, rvz = B.vel.y - A.vel.y;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return;
  const e = Math.min(A.restitution, B.restitution);
  const j = (-(1 + e) * vn) / (1 / A.mass + 1 / B.mass);
  A.vel.x -= (j / A.mass) * nx; A.vel.y -= (j / A.mass) * nz;
  B.vel.x += (j / B.mass) * nx; B.vel.y += (j / B.mass) * nz;
  // tangential slip becomes spin
  const vt = rvx * -nz + rvz * nx;
  A.spin -= vt * 0.25 / A.radius; B.spin += vt * 0.25 / B.radius;
  onHit?.(A.pos.x + nx * A.radius, A.pos.y + nz * A.radius, -vn);
}

export function stepPhysics(floaters, obstacles, water, dt, time, onHit) {
  for (const f of floaters) {
    // ripples push floaters downhill, so waves carry things around
    water.slopeAt(f.pos.x, f.pos.y, f.radius * 0.5, _slope);
    f.vel.x -= _slope.x * 9 * dt / Math.sqrt(f.mass);
    f.vel.y -= _slope.y * 9 * dt / Math.sqrt(f.mass);

    const k = Math.exp(-f.drag * dt);
    f.vel.multiplyScalar(k);
    f.spin *= Math.exp(-1.5 * dt);
    f.pos.addScaledVector(f.vel, dt);
    f.yaw += f.spin * dt;

    // hop
    if (f.lift > 0 || f.liftV > 0) {
      f.liftV -= 14 * dt; f.lift += f.liftV * dt;
      if (f.lift <= 0) {
        water.disturb(f.pos.x, f.pos.y, f.radius * 1.1, -0.18 * Math.min(1, -f.liftV / 5));
        f.lift = 0; f.liftV = 0;
      }
    }

    // wake
    const speed = f.vel.length();
    if (speed > 0.25 && f.lift === 0) water.disturb(f.pos.x, f.pos.y, f.radius * 0.7, -f.wake * speed);
  }

  for (let i = 0; i < floaters.length; i++) {
    for (let j = i + 1; j < floaters.length; j++) pairCollide(floaters[i], floaters[j], onHit);
    for (const o of obstacles) {
      const f = floaters[i];
      const dx = f.pos.x - o.x, dz = f.pos.y - o.z, d = Math.hypot(dx, dz), m = f.radius + o.r;
      if (d < m && d > 0) {
        const nx = dx / d, nz = dz / d;
        f.pos.set(o.x + nx * m, o.z + nz * m);
        const vn = f.vel.x * nx + f.vel.y * nz;
        if (vn < 0) { f.vel.x -= 1.5 * vn * nx; f.vel.y -= 1.5 * vn * nz; }
      }
    }
    wallCollide(floaters[i], water, onHit);
  }
}

// Push physics state into the three.js objects.
export function syncFloater(f, water, dt, time) {
  const { obj } = f;
  const surface = water.level + water.heightAt(f.pos.x, f.pos.y);
  obj.position.set(f.pos.x, surface + f.ride + f.lift + Math.sin(time * 1.6 + f.phase) * f.bob, f.pos.y);

  water.slopeAt(f.pos.x, f.pos.y, f.radius * 0.6, _slope);
  _n.set(-_slope.x * f.tilt * 6, 1, -_slope.y * f.tilt * 6).normalize();
  const tiltQ = _q.setFromUnitVectors(UP, _n);

  if (f.rollsWithMotion) {
    const s = f.vel.length();
    if (s > 1e-4) {
      const axis = new THREE.Vector3(f.vel.y, 0, -f.vel.x).normalize();
      f.roll.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (s * dt) / f.radius * 0.6));
    }
    obj.quaternion.copy(tiltQ).multiply(f.roll).multiply(f.baseQuat);
    return;
  }

  const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, f.yaw - f.baseYaw);
  const leanQ = new THREE.Quaternion().setFromEuler(f.lean);
  obj.quaternion.copy(tiltQ).multiply(yawQ).multiply(f.baseQuat).multiply(leanQ);
}
