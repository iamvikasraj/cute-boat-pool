// All sound is synthesized with Web Audio, no files. Browsers keep audio locked
// until a gesture, so nothing plays until unlock() runs from a key or pointer event.
const MUTE_KEY = 'cute-boat-pool:muted';

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}
    this.last = new Map(); // rate limit per sound key
    this.nextBird = 4;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);

    // shared white noise
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.#ambience();
    this.#engine();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch {}
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---------- continuous layers ----------

  #loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.start(0, Math.random() * 2); // random offset so layers don't line up
    return src;
  }

  #ambience() {
    const { ctx } = this;
    // gentle lapping: low band of noise, swelling slowly
    const lap = ctx.createBiquadFilter();
    lap.type = 'bandpass'; lap.frequency.value = 420; lap.Q.value = 0.8;
    const lapGain = ctx.createGain(); lapGain.gain.value = 0.05;
    const swell = ctx.createOscillator(); swell.frequency.value = 0.17;
    const swellDepth = ctx.createGain(); swellDepth.gain.value = 0.03;
    swell.connect(swellDepth).connect(lapGain.gain);
    this.#loopNoise().connect(lap).connect(lapGain).connect(this.master);
    swell.start();

    // wake: brighter swish that follows how fast things move through the water
    this.wakeFilter = ctx.createBiquadFilter();
    this.wakeFilter.type = 'bandpass'; this.wakeFilter.frequency.value = 900; this.wakeFilter.Q.value = 0.9;
    this.wakeGain = ctx.createGain(); this.wakeGain.gain.value = 0;
    this.#loopNoise().connect(this.wakeFilter).connect(this.wakeGain).connect(this.master);
  }

  #engine() {
    const { ctx } = this;
    // toy putt-putt: a buzzy low tone, chopped into soft pulses by a rounded square LFO
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 62;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 380; tone.Q.value = 3;
    const amp = ctx.createGain(); amp.gain.value = 0.5;

    this.puttLfo = ctx.createOscillator();
    this.puttLfo.type = 'square'; this.puttLfo.frequency.value = 5;
    const round = ctx.createBiquadFilter();
    round.type = 'lowpass'; round.frequency.value = 45;
    const depth = ctx.createGain(); depth.gain.value = 0.5;
    this.puttLfo.connect(round).connect(depth).connect(amp.gain);

    this.engPan = ctx.createStereoPanner();
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc.connect(tone).connect(amp).connect(this.engGain).connect(this.engPan).connect(this.master);
    this.engOsc.start(); this.puttLfo.start();
  }

  // Called every frame. thr/speed from the boat, stir = total motion in the pool, pan from screen x.
  update(dt, { thr, speed, stir, pan }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, a = Math.abs(thr), s = Math.abs(speed);
    this.engGain.gain.setTargetAtTime(0.05 + a * 0.08 + Math.min(s, 3) * 0.01, t, 0.12);
    this.engOsc.frequency.setTargetAtTime(58 + a * 22 + s * 7, t, 0.15);
    this.puttLfo.frequency.setTargetAtTime(4.5 + a * 5 + s * 1.8, t, 0.15);
    this.engPan.pan.setTargetAtTime(pan, t, 0.1);

    const w = Math.min(1, stir / 4);
    this.wakeGain.gain.setTargetAtTime(w * 0.09, t, 0.2);
    this.wakeFilter.frequency.setTargetAtTime(700 + w * 900, t, 0.2);

    this.nextBird -= dt;
    if (this.nextBird <= 0) { this.#bird(); this.nextBird = 7 + Math.random() * 12; }
  }

  // ---------- one-shots ----------

  #ok(key, gap) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(key) ?? -1) < gap) return false;
    this.last.set(key, now);
    return true;
  }

  #out(pan, gain) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master);
    return g;
  }

  // a pitched blip: frequency path [[time, hz], ...], quick attack, exponential tail
  #tone(out, { type = 'sine', at = 0, freqs, dur, vol = 1, attack = 0.005 }) {
    const { ctx } = this, t0 = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freqs[0][1], t0);
    for (const [dt, f] of freqs.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t0 + dt);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return o;
  }

  #hiss(out, { at = 0, dur, vol = 1, type = 'bandpass', from, to, q = 1 }) {
    const { ctx } = this, t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  // strength 0..1
  splash(pan, strength = 0.6) {
    if (!this.#ok('splash', 0.06)) return;
    const out = this.#out(pan, 0.25 + strength * 0.45);
    this.#hiss(out, { dur: 0.18 + strength * 0.25, from: 2600, to: 500, q: 0.7 });
    this.#hiss(out, { dur: 0.08, vol: 0.6, type: 'highpass', from: 3000, to: 2000 });
    // bubbles rise in pitch as they pop
    const n = 1 + Math.round(strength * 3);
    for (let i = 0; i < n; i++) {
      const f = 350 + Math.random() * 500;
      this.#tone(out, { at: 0.03 + Math.random() * 0.2, freqs: [[0, f], [0.06, f * 2.2]], dur: 0.08, vol: 0.35 });
    }
  }

  hop(pan) {
    if (!this.#ok('hop', 0.1)) return;
    const out = this.#out(pan, 0.35);
    this.#tone(out, { freqs: [[0, 170], [0.16, 560]], dur: 0.22, vol: 0.8 });
    this.#tone(out, { type: 'triangle', freqs: [[0, 340], [0.16, 1120]], dur: 0.16, vol: 0.25 });
  }

  toot(pan) {
    if (!this.#ok('toot', 0.5)) return;
    const { ctx } = this;
    const out = this.#out(pan, 0.22);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 2;
    lp.connect(out);
    // toot-toot on a little major third
    for (const [at, dur] of [[0, 0.16], [0.22, 0.34]]) {
      for (const [f, det] of [[392, -6], [494, 5]]) {
        const o = this.#tone(lp, { type: 'sawtooth', at, freqs: [[0, f * 0.97], [0.04, f]], dur, vol: 0.5, attack: 0.03 });
        o.detune.value = det;
      }
    }
  }

  // v is impact speed. what: 'boat' | 'ball' | 'donut' | 'wall'
  bump(what, pan, v) {
    const k = Math.min(1, v / 4);
    if (k < 0.08 || !this.#ok(`bump-${what}`, 0.09)) return;
    const out = this.#out(pan, 0.15 + k * 0.5);
    const j = 1 + (Math.random() - 0.5) * 0.12; // keep repeats from sounding identical
    if (what === 'ball') {
      this.#tone(out, { freqs: [[0, 420 * j], [0.09, 190 * j]], dur: 0.14, vol: 0.9 });
      this.#tone(out, { type: 'triangle', freqs: [[0, 860 * j], [0.05, 400 * j]], dur: 0.06, vol: 0.3 });
    } else if (what === 'donut') {
      // rubbery squeak with a wobble
      this.#tone(out, { type: 'triangle', freqs: [[0, 780 * j], [0.04, 1250 * j], [0.1, 950 * j], [0.16, 1100 * j]], dur: 0.18, vol: 0.6, attack: 0.015 });
    } else if (what === 'boat') {
      this.#tone(out, { type: 'triangle', freqs: [[0, 240 * j], [0.07, 150 * j]], dur: 0.12, vol: 0.9 });
      this.#hiss(out, { dur: 0.04, vol: 0.5, from: 1800, to: 900, q: 2 });
    } else {
      // tiled pool wall
      this.#tone(out, { freqs: [[0, 150 * j], [0.1, 95 * j]], dur: 0.16, vol: 1 });
      this.#hiss(out, { dur: 0.05, vol: 0.4, from: 1200, to: 500, q: 1.5 });
    }
    if (k > 0.35) this.splash(pan, k * 0.5);
  }

  #bird() {
    if (this.muted) return;
    const out = this.#out((Math.random() - 0.5) * 1.6, 0.05);
    const base = 2600 + Math.random() * 1200;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + (Math.random() - 0.5) * 0.25);
      this.#tone(out, { at: i * 0.13, freqs: [[0, f], [0.04, f * 1.35], [0.08, f * 0.9]], dur: 0.09, vol: 1, attack: 0.01 });
    }
  }
}
