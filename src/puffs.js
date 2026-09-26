import * as THREE from 'three';

// Little chimney smoke balls that rise, puff up, and fade.
export class Puffs {
  constructor(scene, count = 24) {
    const geo = new THREE.IcosahedronGeometry(0.1, 2);
    this.items = Array.from({ length: count }, () => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0 }));
      m.visible = false; scene.add(m);
      return { m, life: 0, max: 1, drift: new THREE.Vector3() };
    });
    this.i = 0;
  }
  spawn(pos, size = 1) {
    const p = this.items[this.i++ % this.items.length];
    p.m.position.copy(pos); p.life = 0; p.max = 1.4 + Math.random() * 0.6; p.size = size;
    p.drift.set((Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3);
    p.m.visible = true;
  }
  update(dt) {
    for (const p of this.items) {
      if (!p.m.visible) continue;
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) { p.m.visible = false; continue; }
      p.m.position.addScaledVector(p.drift, dt);
      p.m.scale.setScalar(p.size * (0.6 + t * 1.8));
      p.m.material.opacity = 0.9 * (1 - t) * Math.min(1, t * 8);
    }
  }
}
