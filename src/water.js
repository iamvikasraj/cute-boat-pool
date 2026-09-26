import * as THREE from 'three';

// Height-field ripple sim on a grid, masked to the pool's rounded shape.
// Anything can poke it with disturb(); floaters read heightAt()/slopeAt().
export class Water {
  constructor({
    halfX = 8.4, halfZ = 4.9, cell = 0.1, level = -0.05,
    wallA = 8.1, wallB = 4.6, n = 5, damping = 0.985, maxH = 0.22,
  } = {}) {
    this.halfX = halfX; this.halfZ = halfZ; this.level = level;
    this.segX = Math.round((halfX * 2) / cell);
    this.segZ = Math.round((halfZ * 2) / cell);
    this.W = this.segX + 1; this.H = this.segZ + 1;
    this.dx = (halfX * 2) / this.segX; this.dz = (halfZ * 2) / this.segZ;
    this.damping = damping; this.maxH = maxH;

    const N = this.W * this.H;
    this.h = new Float32Array(N);
    this.p = new Float32Array(N);
    this.mask = new Uint8Array(N);
    for (let j = 0; j < this.H; j++) {
      for (let i = 0; i < this.W; i++) {
        const x = -halfX + i * this.dx, z = -halfZ + j * this.dz;
        const f = Math.abs(x / wallA) ** n + Math.abs(z / wallB) ** n;
        this.mask[j * this.W + i] = f < 1 ? 1 : 0;
      }
    }

    const geo = new THREE.PlaneGeometry(halfX * 2, halfZ * 2, this.segX, this.segZ);
    geo.rotateX(-Math.PI / 2); // row j now runs along +z from -halfZ
    geo.computeBoundingSphere();
    this.geometry = geo;
    this.material = new THREE.MeshStandardMaterial({
      color: '#3fc4e0', transparent: true, opacity: 0.6,
      roughness: 0.06, metalness: 0.0, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'SimWater';
  }

  step() {
    const { W, H, h, p, mask, damping } = this;
    for (let j = 1; j < H - 1; j++) {
      let k = j * W + 1;
      for (let i = 1; i < W - 1; i++, k++) {
        if (!mask[k]) { p[k] = 0; continue; }
        let v = ((h[k - 1] + h[k + 1] + h[k - W] + h[k + W]) * 0.5 - p[k]) * damping;
        p[k] = v > this.maxH ? this.maxH : v < -this.maxH ? -this.maxH : v;
      }
    }
    this.h = p; this.p = h;
    // pushing down adds up over time; nudge the average level back to rest
    let sum = 0, cnt = 0;
    for (let k = 0; k < p.length; k++) if (mask[k]) { sum += p[k]; cnt++; }
    const mean = sum / cnt;
    if (Math.abs(mean) > 1e-5) for (let k = 0; k < p.length; k++) if (mask[k]) { p[k] -= mean; h[k] -= mean; }
  }

  // Push the surface at (x, z). Negative strength = press down.
  disturb(x, z, radius, strength) {
    const { W, H, dx, dz, halfX, halfZ, mask } = this;
    const ci = (x + halfX) / dx, cj = (z + halfZ) / dz;
    const ri = Math.ceil(radius / dx), rj = Math.ceil(radius / dz);
    const i0 = Math.max(1, Math.floor(ci - ri)), i1 = Math.min(W - 2, Math.ceil(ci + ri));
    const j0 = Math.max(1, Math.floor(cj - rj)), j1 = Math.min(H - 2, Math.ceil(cj + rj));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (!mask[k]) continue;
        const d = Math.hypot((i - ci) * dx, (j - cj) * dz) / radius;
        if (d < 1) this.h[k] += strength * 0.5 * (1 + Math.cos(Math.PI * d));
      }
    }
  }

  heightAt(x, z) {
    const { W, H, dx, dz, halfX, halfZ, h } = this;
    const fi = THREE.MathUtils.clamp((x + halfX) / dx, 0, W - 1.001);
    const fj = THREE.MathUtils.clamp((z + halfZ) / dz, 0, H - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const k = j * W + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + W] * (1 - u) + h[k + W + 1] * u) * v;
  }

  // Surface slope sampled over a footprint, so big floaters tilt smoothly.
  slopeAt(x, z, r = 0.4, out = new THREE.Vector2()) {
    out.set(
      (this.heightAt(x + r, z) - this.heightAt(x - r, z)) / (2 * r),
      (this.heightAt(x, z + r) - this.heightAt(x, z - r)) / (2 * r),
    );
    return out;
  }

  updateMesh() {
    const pos = this.geometry.attributes.position;
    const arr = pos.array, h = this.h;
    for (let k = 0, n = h.length; k < n; k++) arr[k * 3 + 1] = h[k];
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
