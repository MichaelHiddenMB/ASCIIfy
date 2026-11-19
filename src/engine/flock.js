// A Flock is the population of one kind of animal: it decides how many there are, creates
// and removes them, and gives them shared steering helpers.
// Adapted from ascii-animals (MIT, see licenses/ascii-animals-LICENSE.txt).
//
// Size stands in for distance. Each creature gets a fixed random "roll" that's turned into a
// depth between 0 (far away / deep down) and 1 (close / near the surface). Depth sets its
// size, its speed (far things seem to move slower) and how much it fades into the
// background. The list is kept sorted far-to-near so near creatures are drawn on top.
//
// An "animal" is a plain object describing one species. It must have:
//   defaults (its settings), area, scale, speed, create(c, flock), update(c, flock, dt),
// and can have: enter, prepare, tap, startle, draw or drawAll.
import { angleDiff, clamp, rand } from './math.js';

// Settings every animal has. Each animal's own defaults start from these.
export const SHARED_TUNING = {
  density: 1, // how many, relative to the default for the screen size
  corner: false, // cross corner to corner instead of using `direction`
  direction: 49, // the stream's direction in degrees (0 = right, 90 = up)
  speed: 1,
  sway: 0.04, // how much the whole stream drifts off course
  spread: 0.06, // how much each individual's course differs
  size: 1,
  farthest: 0.45, // depth of the farthest individuals (1 = all equally close)
  farBias: 1.6, // above 1 puts more of them far away
  grip: 2, // how firmly they hold their course
  separation: 300, // how hard neighbours push apart
  shimmer: 0.3,
  sparkle: 0.12,
  fog: 0.75, // how much far ones fade into the background
  trail: 1, // how much they leave in the trail (ripples)
  trailFade: 1.3, // how quickly the trail fades
  grid: 1.05, // how visible the background grid is
};

const STARTLE_RADIUS = 240;
// Animals are tuned for a laptop-sized screen; smaller screens draw everyone smaller and
// add more of them so the screen looks just as full.
const REFERENCE_SIZE = 160;

export class Flock {
  constructor(animal, tuning, count) {
    this.animal = animal;
    this.tuning = tuning;
    this.count = count; // optional: a fixed population, ignoring density
    this.width = 0;
    this.height = 0;
    this.time = 0;
    this.creatures = [];
    this.events = []; // ripples to add to the trail this frame: { x, y, radius, amount }
    this.base = 120; // size of the nearest individuals, in pixels
    this.acc = { x: 0, y: 0 }; // scratch acceleration the steering helpers add into
    this.nextId = 1;
  }

  resize(width, height) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.base = clamp(Math.min(width, height) * 0.2, 80, 190) * this.animal.scale;
    if (first) this.populate(true);
  }

  // The direction the stream travels, in radians (screen space, so y points down).
  get course() {
    const k = this.tuning;
    return k.corner ? Math.atan2(-this.height, this.width) : (-k.direction * Math.PI) / 180;
  }

  get heading() {
    const t = this.time;
    return this.course + this.tuning.sway * (Math.sin(t * 0.13) + 0.5 * Math.sin(t * 0.31 + 1.7));
  }

  // How many to keep on screen, based on how much of the screen they'd cover.
  get target() {
    const { width: W, height: H, animal } = this;
    const shrink = (this.base / animal.scale / REFERENCE_SIZE) ** 2;
    return this.count ?? clamp(Math.round(((W * H) / (animal.area * shrink)) * this.tuning.density), 1, animal.max ?? 200);
  }

  depthOf(roll) {
    const k = this.tuning;
    return k.farthest + (1 - k.farthest) * Math.pow(roll, k.farBias);
  }

  // Cruising speed: far individuals cover less screen per second (parallax).
  cruise(c) {
    return this.animal.speed * (0.55 + 0.45 * c.depth) * this.tuning.speed;
  }

  // A click: the animal can take it itself (koi: dropping food), or everyone nearby is startled.
  startle(x, y) {
    if (this.animal.tap) {
      this.animal.tap(x, y, this);
      return;
    }
    this.events.push({ x, y, radius: 6, amount: 1.4 });
    for (const c of this.creatures) {
      const dx = c.x - x;
      const dy = c.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > STARTLE_RADIUS) continue;
      const strength = 1 - d / STARTLE_RADIUS;
      if (this.animal.startle) {
        this.animal.startle(c, dx / d, dy / d, strength, this);
      } else {
        const k = strength * 420 * c.depth;
        c.vx += (dx / d) * k;
        c.vy += (dy / d) * k;
        c.startledUntil = this.time + rand(0.6, 1.2);
      }
    }
  }

  step(dt) {
    this.time += dt;
    this.populate(false);
    for (const c of this.creatures) {
      c.depth = this.depthOf(c.roll);
      c.span = this.base * c.depth * this.tuning.size;
    }
    this.animal.prepare?.(this, dt);
    for (const c of this.creatures) this.animal.update(c, this, dt);
  }

  // Adds or removes individuals until the population matches the settings.
  populate(scatter) {
    const target = this.target;
    while (this.creatures.length > target) {
      const [c] = this.creatures.splice(Math.floor(Math.random() * this.creatures.length), 1);
      c.gone = true;
    }
    while (this.creatures.length < target) {
      const c = this.spawn();
      if (scatter || Math.random() < 0.5) {
        // Drop it in anywhere so the screen fills straight away.
        c.x = rand(0, this.width);
        c.y = rand(0, this.height);
        this.animal.enter?.(c, this);
      }
      this.insert(c);
    }
  }

  // Keeps farther individuals first so the near ones are drawn over them.
  insert(c) {
    const at = this.creatures.findIndex((o) => o.roll > c.roll);
    this.creatures.splice(at < 0 ? this.creatures.length : at, 0, c);
  }

  spawn() {
    const base = {
      id: this.nextId++,
      roll: Math.random(),
      depth: 1,
      span: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      bias: 0,
      startledUntil: 0,
      gone: false,
    };
    base.depth = this.depthOf(base.roll);
    base.span = this.base * base.depth * this.tuning.size;
    const c = this.animal.create(base, this);
    this.reenter(c);
    return c;
  }

  // Brings a creature back in from the upstream edge of the screen.
  reenter(c) {
    const { width: W, height: H, course } = this;
    const m = c.span * 0.6;
    const cos = Math.cos(course);
    const sin = Math.sin(course);
    const sideways = H * Math.abs(cos);
    const vertical = W * Math.abs(sin);
    if (Math.random() * (sideways + vertical) < sideways) {
      c.x = cos >= 0 ? -m : W + m;
      c.y = rand(0, H);
    } else {
      c.x = rand(0, W);
      c.y = sin <= 0 ? H + m : -m;
    }
    const cruise = this.cruise(c);
    c.heading = course;
    c.vx = cos * cruise;
    c.vy = sin * cruise;
    c.bias = rand(-1, 1);
    this.animal.enter?.(c, this);
  }

  // True once a creature has left past the downstream edge (or got lost far off screen).
  passed(c, margin = c.span) {
    const { width: W, height: H, course } = this;
    const cos = Math.cos(course);
    const sin = Math.sin(course);
    const out =
      (cos > 0.05 && c.x > W + margin) || (cos < -0.05 && c.x < -margin) ||
      (sin < -0.05 && c.y < -margin) || (sin > 0.05 && c.y > H + margin);
    const lost = c.x < -3 * margin || c.x > W + 3 * margin || c.y < -3 * margin || c.y > H + 3 * margin;
    return out || lost;
  }

  // Which way is back toward the middle, and how urgently (0 = well inside, 1 = at or past
  // the edge). For animals that should stay on screen instead of crossing it.
  inward(c, margin) {
    const { width: W, height: H } = this;
    const ix = c.x < margin ? (margin - c.x) / margin : c.x > W - margin ? -(c.x - (W - margin)) / margin : 0;
    const iy = c.y < margin ? (margin - c.y) / margin : c.y > H - margin ? -(c.y - (H - margin)) / margin : 0;
    return { angle: Math.atan2(iy, ix), push: Math.min(1, Math.hypot(ix, iy)) };
  }

  // ---- steering helpers: each adds into this.acc ----

  begin() {
    this.acc.x = 0;
    this.acc.y = 0;
    return this.acc;
  }

  steer(c, dir, speed, grip) {
    this.acc.x += (Math.cos(dir) * speed - c.vx) * grip;
    this.acc.y += (Math.sin(dir) * speed - c.vy) * grip;
  }

  // Pushes away from neighbours at about the same depth.
  separate(c, strength = this.tuning.separation, range = 0.42) {
    if (strength <= 0) return;
    for (const o of this.creatures) {
      if (o === c || Math.abs(o.depth - c.depth) > 0.18) continue;
      const ox = c.x - o.x;
      const oy = c.y - o.y;
      const d = Math.hypot(ox, oy);
      const r = (c.span + o.span) * range;
      if (d < r && d > 1e-3) {
        const w = (1 - d / r) * strength;
        this.acc.x += (ox / d) * w;
        this.acc.y += (oy / d) * w;
      }
    }
  }

  move(c, dt, max) {
    c.vx += this.acc.x * dt;
    c.vy += this.acc.y * dt;
    let speed = Math.hypot(c.vx, c.vy);
    const cap = max + (this.time < c.startledUntil ? 300 : 0);
    if (speed > cap) {
      c.vx *= cap / speed;
      c.vy *= cap / speed;
      speed = cap;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    return speed;
  }

  face(c, dt, rate = 7, angle = Math.atan2(c.vy, c.vx)) {
    const turn = rate * dt;
    c.heading += clamp(angleDiff(c.heading, angle), -turn, turn);
  }
}
