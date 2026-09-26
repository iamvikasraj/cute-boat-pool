// Keyboard + on-screen stick. Exposes throttle (-1..1), steer (-1..1), and hop requests.
export class Input {
  constructor() {
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.hopQueued = false;

    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { if (!e.repeat) this.hopQueued = true; e.preventDefault(); }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch) this.#setupStick();
  }

  #setupStick() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('knob');
    const hop = document.getElementById('hop');
    stick.hidden = false; hop.hidden = false;
    hop.addEventListener('pointerdown', (e) => { e.preventDefault(); this.hopQueued = true; });

    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2 - 20;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / max; this.stick.y = -dy / max;
    };
    const end = () => { id = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  get throttle() {
    const k = this.keys;
    let v = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) v += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) v -= 1;
    return Math.abs(this.stick.y) > 0.1 ? this.stick.y : v;
  }

  get steer() {
    const k = this.keys;
    let v = 0;
    if (k.has('KeyD') || k.has('ArrowRight')) v += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) v -= 1;
    return Math.abs(this.stick.x) > 0.1 ? this.stick.x : v;
  }

  takeHop() { const h = this.hopQueued; this.hopQueued = false; return h; }
}
