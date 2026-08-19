'use strict';
// NEON DASH — Copyright © 2026 Melvin Carvalho — AGPL-3.0-or-later (see LICENSE)
// A tribute to Boulder Dash. No assets: every pixel and sound generated from code.
// ?shot=<name>[&f=N] renders deterministic frames for the critic harness.
// ?autoplay=<cave>&budget=<s> runs the solvability bot headlessly (document.title report).

const W = 1280, H = 720;
const TS = 32;
const MQ = 40, HUD_H = 104;
const VW = W, VH = H - MQ - HUD_H;
const CW = 44, CH = 26;
const WORLD_W = CW * TS, WORLD_H = CH * TS;
const STEP = 1 / 120;
const TICK = 0.125;                   // cellular physics cadence, Boulder Dash style

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * DPR; canvas.height = H * DPR;
ctx.scale(DPR, DPR);

// ---------- seeded RNG ----------
let _seed = 1;
function srand(s) { _seed = s >>> 0; }
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
function rng(a, b) { return a + rnd() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function offCanvas(w, h) { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.scale(2, 2); return [c, x]; }
const MONO = '"Courier New", monospace';
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const START_KEY = IS_TOUCH ? 'TAP' : 'SPACE';
const MOVE_HINT = IS_TOUCH
  ? 'MOVE — TOUCH & DRAG, HOLD TO KEEP MOVING · DIG BY WALKING'
  : 'MOVE — WASD / ARROWS · DIG BY WALKING · PUSH BOULDERS SIDEWAYS';

// ---------- audio ----------
let AUDIO_ON = true, actx = null, master = null;
function audio() {
  if (!AUDIO_ON) return null;
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor();
    master = actx.createGain(); master.gain.value = 0.4;
    master.connect(comp); comp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, dur, type = 'square', vol = 0.16, slideTo = 0, delay = 0) {
  const a = audio(); if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur);
}
function noise(dur, vol = 0.22, freq = 1000) {
  const a = audio(); if (!a) return;
  const n = a.sampleRate * dur | 0, buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const flt = a.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(flt); flt.connect(g); g.connect(master); src.start();
}
const SFX = {
  dig: () => noise(0.07, 0.2, 900),
  gem: () => { tone(880, 0.07, 'square', 0.13); tone(1320, 0.1, 'square', 0.12, 0, 0.06); },
  gemBonus: () => { [880, 1100, 1320, 1760].forEach((f, i) => tone(f, 0.08, 'square', 0.12, 0, i * 0.05)); },
  thud: () => { noise(0.09, 0.3, 350); tone(70, 0.12, 'sine', 0.25); },
  roll: () => noise(0.05, 0.1, 500),
  push: () => noise(0.14, 0.22, 300),
  boom: () => { noise(0.4, 0.35, 650); tone(80, 0.35, 'sine', 0.28, 40); },
  exitOpen: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.1, 'square', 0.14, 0, i * 0.07)); },
  clear: () => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.12, 'square', 0.14, 0, i * 0.08)); },
  death: () => { tone(400, 0.8, 'sawtooth', 0.22, 50); noise(0.5, 0.3, 500); },
  tick: () => tone(1200, 0.05, 'square', 0.1),
  step: () => tone(150, 0.03, 'square', 0.04),
};

// ---------- Otto (returning from NEON MINER) ----------
function bmp(rows, pal) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
  const x = c.getContext('2d');
  for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) {
    const col = pal[rows[r][i]];
    if (!col) continue;
    x.fillStyle = col;
    x.fillRect(i * 2, r * 2, 2, 2);
  }
  return c;
}
function mirror(spr) {
  const c = document.createElement('canvas'); c.width = spr.width; c.height = spr.height;
  const x = c.getContext('2d');
  x.translate(spr.width, 0); x.scale(-1, 1); x.drawImage(spr, 0, 0);
  return c;
}
const MPAL = { h: '#ffd12a', d: '#c79a00', l: '#fff7d0', s: '#ffd9b0', e: '#20242e', b: '#4f7fb5', B: '#35597f', k: '#2e2620', K: '#4a3d30', g: '#b08d5e' };
const OTTO = {
  stand: [
    '....hhhhh...', '...hhhhhhh..', '...hdhhhll..', '...ssssss...', '...sesses...', '...ssssss...',
    '..bbbbbbb...', '.bBbbbbbBb..', '.bBbbbbbBb..', '.gBbbbbbBg..', '..KKKKKK....', '...K..K.....',
    '...K..K.....', '...K..K.....', '..kk..kk....', '..kkk.kkk...'],
  walk1: [
    '....hhhhh...', '...hhhhhhh..', '...hdhhhll..', '...ssssss...', '...sesses...', '...ssssss...',
    '..bbbbbbb...', '.bBbbbbbBb..', '.bBbbbbbBb..', '.gBbbbbbBg..', '..KKKKKK....', '..K....K....',
    '.K......K...', '.K......K...', 'kk......kk..', 'kkk.....kkk.'],
  walk2: [
    '....hhhhh...', '...hhhhhhh..', '...hdhhhll..', '...ssssss...', '...sesses...', '...ssssss...',
    '..bbbbbbb...', '.bBbbbbbBb..', '.bBbbbbbBb..', '.gBbbbbbBg..', '..KKKKKK....', '...KKK......',
    '...KK.......', '...KK.......', '..kkk.......', '..kkkk......'],
  push: [
    '....hhhhh...', '...hhhhhhh..', '...hdhhhll..', '...ssssss...', '...sesses...', '...ssssss...',
    '..bbbbbbbgg.', '.bBbbbbbBbg.', '.bBbbbbbB...', '.gBbbbbbB...', '..KKKKKK....', '..K...KK....',
    '.K.....KK...', '.K......K...', 'kk......kk..', 'kkk.....kkk.'],
};
const SPR = {};
for (const k of Object.keys(OTTO)) { SPR[k] = bmp(OTTO[k], MPAL); SPR[k + 'L'] = mirror(SPR[k]); }

// ---------- caves ----------
function ringCarve(g, x0, y0, x1, y1) { // carve a rectangular tunnel of space
  for (let x = x0; x <= x1; x++) { g[y0][x] = ' '; g[y1][x] = ' '; }
  for (let y = y0; y <= y1; y++) { g[y][x0] = ' '; g[y][x1] = ' '; }
}
function boxWall(g, x0, y0, x1, y1, ch) {
  for (let x = x0; x <= x1; x++) { g[y0][x] = ch; g[y1][x] = ch; }
  for (let y = y0; y <= y1; y++) { g[y][x0] = ch; g[y][x1] = ch; }
}
function stackTrap(g, x, y, h) {
  // a gem priced in boulders: diamonds buried under a rock column
  g[y][x] = 'd';
  if (g[y + 1] && g[y + 1][x] !== 'S') g[y + 1][x] = 'd';
  for (let i = 1; i <= h; i++) if (g[y - i] && g[y - i][x] !== 'S') g[y - i][x] = 'r';
}
const CAVES = [
  {
    name: 'FIRST STRIKE', rim: '#33d6ff', hue: 205, seed: 101,
    rock: 0.12, gem: 0.06, quotaFrac: 0.5, time: 90,
    start: [2, 2], exit: [41, 23], enemies: [],
    feature: g => {
      stackTrap(g, 25, 15, 2);
    },
  },
  {
    name: 'BOULDER ALLEY', rim: '#3ee08a', hue: 150, seed: 202,
    rock: 0.21, gem: 0.06, quotaFrac: 0.55, time: 95,
    start: [2, 12], exit: [41, 2], enemies: [['f', 14, 6, 0], ['f', 30, 18, 2], ['f', 22, 12, 1]],
    feature: g => {
      for (const wx of [11, 22, 33])
        for (let y = 3; y < CH - 3; y++) if (y % 9 !== 5) g[y][wx] = 'W';
      ringCarve(g, 12, 4, 17, 8);
      ringCarve(g, 27, 16, 33, 20);
      ringCarve(g, 19, 10, 25, 14);
      for (const [tx, ty] of [[7, 8], [16, 19], [29, 6], [38, 14], [24, 17]]) stackTrap(g, tx, ty, 3);
    },
  },
  {
    name: 'BUTTERFLY VAULT', rim: '#ffd84a', hue: 46, seed: 303,
    rock: 0.19, gem: 0.045, quotaFrac: 0.62, time: 110,
    start: [2, 2], exit: [2, 23], enemies: [['b', 19, 11, 1], ['b', 25, 15, 3], ['f', 33, 21, 0]],
    feature: g => {
      boxWall(g, 16, 8, 28, 18, 'W');
      ringCarve(g, 17, 9, 27, 17);
      for (let y = 11; y <= 15; y++) for (let x = 19; x <= 25; x++) g[y][x] = rnd() < 0.4 ? 'd' : '.';
      g[13][16] = ' ';                               // vault doorway
      // farmable boulder battery: rocks rest on diggable dirt; holes in the
      // vault roof let a released boulder drop straight into the butterfly ring
      g[8][21] = ' '; g[8][23] = ' ';
      for (const x of [19, 21, 23, 25]) { g[5][x] = 'r'; g[6][x] = 'r'; g[7][x] = '.'; }
      ringCarve(g, 30, 19, 36, 23);
      for (const [tx, ty] of [[7, 6], [10, 20], [36, 17], [39, 5], [31, 12]]) stackTrap(g, tx, ty, 3);
    },
  },
  {
    name: 'THE MAGIC MAZE', rim: '#b366ff', hue: 270, seed: 404,
    rock: 0.13, gem: 0.06, quotaFrac: 0.65, time: 110,
    start: [2, 2], exit: [41, 23], enemies: [['f', 21, 13, 0], ['f', 9, 19, 1], ['f', 35, 7, 2], ['f', 33, 21, 3]],
    feature: g => {
      for (let y = 4; y < CH - 3; y += 4)
        for (let x = 4; x < CW - 3; x++) if ((x + (y / 4 | 0) * 5) % 11 >= 2) g[y][x] = 'W';
      ringCarve(g, 18, 11, 24, 15);
      ringCarve(g, 6, 17, 12, 21);
      ringCarve(g, 32, 5, 38, 9);
      ringCarve(g, 30, 19, 37, 23);
      // the magic wall: feed it boulders, harvest diamonds beneath
      for (let x = 28; x <= 36; x++) { g[16][x] = 'M'; g[17][x] = ' '; g[15][x] = rnd() < 0.5 ? 'r' : '.'; }
      for (const [tx, ty] of [[7, 7], [15, 22], [38, 13], [26, 21]]) stackTrap(g, tx, ty, 3);
    },
  },
  {
    name: 'CRUSH DEPTH', rim: '#45e0d2', hue: 174, seed: 505,
    rock: 0.25, gem: 0.07, quotaFrac: 0.66, time: 120,
    start: [21, 2], exit: [21, 23], enemies: [['b', 8, 8, 1], ['b', 36, 18, 3], ['f', 8, 18, 0], ['f', 36, 8, 2], ['f', 21, 15, 1]],
    feature: g => {
      ringCarve(g, 6, 6, 11, 10);
      ringCarve(g, 33, 16, 38, 20);
      ringCarve(g, 6, 16, 11, 20);
      ringCarve(g, 33, 6, 38, 10);
      ringCarve(g, 18, 12, 25, 17);
      for (const [tx, ty] of [[14, 9], [21, 19], [29, 12], [26, 7]]) stackTrap(g, tx, ty, 4);
    },
  },
];

// ---------- game state ----------
let G = null;
const keys = {};
let keyEdge = {};

function buildCave(ci) {
  const spec = CAVES[ci];
  srand(spec.seed);
  const g = Array.from({ length: CH }, (_, y) => Array.from({ length: CW }, (_, x) =>
    (x === 0 || y === 0 || x === CW - 1 || y === CH - 1) ? 'S' : '.'));
  for (let y = 1; y < CH - 1; y++) for (let x = 1; x < CW - 1; x++) {
    const r = rnd();
    if (r < spec.rock) g[y][x] = 'r';
    else if (r < spec.rock + spec.gem) g[y][x] = 'd';
  }
  spec.feature(g);
  // clear pockets for start and exit
  const [sx, sy] = spec.start, [ex, ey] = spec.exit;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (g[sy + dy] && g[sy + dy][sx + dx] !== 'S') g[sy + dy][sx + dx] = '.';
    if (g[ey + dy] && g[ey + dy][ex + dx] !== 'S') g[ey + dy][ex + dx] = '.';
  }
  g[sy][sx] = 'P';
  g[ey][ex] = 'X';
  // no boulders directly above spawn
  for (let y = 1; y < sy; y++) if (g[y][sx] === 'r') g[y][sx] = '.';
  G.grid = g;
  G.fall = Array.from({ length: CH }, () => new Uint8Array(CW));
  G.expl = new Map();
  G.enemies = spec.enemies.map(([t, x2, y2, d]) => { g[y2][x2] = t; return { type: t, x: x2, y: y2, dir: d }; });
  G.cave = ci;
  G.p = { x: sx, y: sy, px: sx, py: sy, dir: 1, pushT: 0, alive: true, anim: 0, moving: false };
  G.diamonds = 0;
  G.exitOpen = false;
  G.caveTime = spec.time;
  G.tickAcc = 0;
  if (G.moves) G.moves.length = 0;       // stale ledger must not offset the fresh grid
  G.dyingT = 0;
  G.mwActive = 0;                        // magic wall milling window
  G.gemsTotal = 0;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (g[y][x] === 'd') G.gemsTotal++;
  G.quota = Math.max(5, Math.floor(G.gemsTotal * spec.quotaFrac));
  G.cam.x = clamp(sx * TS - VW / 2, 0, WORLD_W - VW);
  G.cam.y = clamp(sy * TS - VH / 2, 0, WORLD_H - VH);
}
function newGame(seed, attract) {
  srand(seed);
  G = {
    mode: 'play', modeT: 0, time: 0, attract: !!attract, showTitle: !!attract,
    score: 0, hiScore: Number(localStorage.getItem('neondash_hi') || 15000),
    lives: 3, deaths: 0, cavesCleared: 0,
    parts: [], pops: [], moves: [],
    cam: { x: 0, y: 0 },
    flash: 0, shake: 0, hintT: 8, lastGemAt: -9, exitOpenAt: -9,
  };
  buildCave(0);
}

// ---------- cellular physics ----------
function rounded(c) { return c === 'r' || c === 'd' || c === 'W'; }
function cellAt(x, y) { return (x < 0 || x >= CW || y < 0 || y >= CH) ? 'S' : G.grid[y][x]; }
function explode(cx, cy, resultChar) {
  // 3x3 blast; butterflies caught in it bloom into diamonds (their own blast)
  const queue = [[cx, cy, resultChar]];
  SFX.boom();
  G.shake = Math.min(G.shake + 10, 18);
  while (queue.length) {
    const [bx, by, res] = queue.shift();
    // beat 1: the whole 3x3 goes white for a beat
    G.parts.push({ kind: 'blast', x: (bx - 1) * TS, y: (by - 1) * TS, w: TS * 3, h: TS * 3, color: '#ffffff', life: 0.24, t: 0 });
    G.parts.push({ kind: 'blast', x: (bx - 1) * TS, y: (by - 1) * TS, w: TS * 3, h: TS * 3, color: res === 'd' ? '#aaff4d' : '#ff7a3c', life: 0.45, t: 0 });
    addParts(bx * TS + TS / 2, by * TS + TS / 2, res === 'd' ? '#aaff4d' : '#ff7a3c', 14, true);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = bx + dx, y = by + dy;
      const c = cellAt(x, y);
      if (c === 'S' || c === 'X' || c === 'M') continue;
      if (c === 'P' && G.p.alive) { G.p.alive = false; if (!G.attract) G.lives--; }
      if (c === 'f' || c === 'b') {
        const ei = G.enemies.findIndex(e => e.x === x && e.y === y);
        if (ei >= 0) {
          const et = G.enemies[ei].type;
          G.enemies.splice(ei, 1);
          if (!(x === bx && y === by)) queue.push([x, y, et === 'b' ? 'd' : ' ']);
        }
      }
      G.grid[y][x] = 'e';
      G.expl.set(y * CW + x, res);
      G.fall[y][x] = 0;
    }
  }
}
function tick() {
  const g = G.grid, p = G.p;
  G.moves = [];   // display ledger: where things arrived this tick, and from where
  // explosion cells resolve to their result
  if (G.expl.size) {
    for (const [key, res] of G.expl) {
      const x = key % CW, y = (key / CW) | 0;
      if (g[y][x] === 'e') { g[y][x] = res; if (res === 'd') G.gemsTotal++; }
    }
    G.expl.clear();
  }
  // falling objects: single top-left scan with moved flags (Boulder Dash order)
  const moved = Array.from({ length: CH }, () => new Uint8Array(CW));
  for (let y = CH - 2; y >= 1; y--) {} // (kept for clarity: scan is top-down below)
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const c = g[y][x];
    if ((c !== 'r' && c !== 'd') || moved[y][x]) continue;
    const below = cellAt(x, y + 1);
    if (below === ' ') {
      g[y][x] = ' ';
      g[y + 1][x] = c;
      moved[y + 1][x] = 1;
      G.fall[y + 1][x] = 1;
      G.fall[y][x] = 0;
      G.moves.push({ x, y: y + 1, dx: 0, dy: -1 });
    } else if (G.fall[y][x] && (below === 'P' || below === 'f' || below === 'b')) {
      // a falling object crushes what it lands on
      const victim = below;
      if (victim === 'P') { explode(x, y + 1, ' '); }
      else {
        const ei = G.enemies.findIndex(e => e.x === x && e.y === y + 1);
        const et = ei >= 0 ? G.enemies[ei].type : 'f';
        if (ei >= 0) G.enemies.splice(ei, 1);
        explode(x, y + 1, et === 'b' ? 'd' : ' ');
      }
      G.fall[y][x] = 0;
    } else if (below === 'M') {
      // the magic wall mills falling objects: boulders in, diamonds out (and back)
      if (G.fall[y][x]) {
        if (!G.mwState) { G.mwState = 1; G.mwT = 20; SFX.exitOpen(); }
        if (G.mwState === 1) {
          g[y][x] = ' '; G.fall[y][x] = 0;
          const conv = c === 'r' ? 'd' : 'r';
          if (cellAt(x, y + 2) === ' ') {
            g[y + 2][x] = conv;
            G.fall[y + 2][x] = 1;
            moved[y + 2][x] = 1;
            G.moves.push({ x, y: y + 2, dx: 0, dy: -1 });
            if (conv === 'd') G.gemsTotal++;
          }
          if (nearCam(x, y)) { SFX.gem(); addSparkle(x * TS + TS / 2, (y + 1) * TS + TS / 2, '#b48cff'); }
        } else G.fall[y][x] = 0;
      } else G.fall[y][x] = 0;
    } else if (rounded(below)) {
      // roll off rounded objects
      if (cellAt(x - 1, y) === ' ' && cellAt(x - 1, y + 1) === ' ') {
        g[y][x] = ' '; g[y][x - 1] = c;
        moved[y][x - 1] = 1;
        G.fall[y][x - 1] = 1; G.fall[y][x] = 0;
        G.moves.push({ x: x - 1, y, dx: 1, dy: 0 });
        if (nearCam(x, y)) SFX.roll();
      } else if (cellAt(x + 1, y) === ' ' && cellAt(x + 1, y + 1) === ' ') {
        g[y][x] = ' '; g[y][x + 1] = c;
        moved[y][x + 1] = 1;
        G.fall[y][x + 1] = 1; G.fall[y][x] = 0;
        G.moves.push({ x: x + 1, y, dx: -1, dy: 0 });
        if (nearCam(x, y)) SFX.roll();
      } else {
        if (G.fall[y][x] && nearCam(x, y)) { SFX.thud(); landDust(x, y); G.shake = Math.min(G.shake + 3, 8); }
        G.fall[y][x] = 0;
      }
    } else {
      if (G.fall[y][x] && nearCam(x, y)) { SFX.thud(); landDust(x, y); G.shake = Math.min(G.shake + 3, 8); }
      G.fall[y][x] = 0;
    }
  }
  if (!p.alive) return;
  // player move
  p.px = p.x; p.py = p.y;
  let dx = 0, dy = 0;
  if (G.bot) { [dx, dy] = botDir(); }
  else {
    if (keys.ArrowLeft || keys.a) dx = -1;
    else if (keys.ArrowRight || keys.d) dx = 1;
    else if (keys.ArrowUp || keys.w) dy = -1;
    else if (keys.ArrowDown || keys.s) dy = 1;
  }
  p.moving = false;
  if (dx || dy) {
    if (dx) p.dir = dx;
    const nx = p.x + dx, ny = p.y + dy;
    const t = cellAt(nx, ny);
    if (t === '.' || t === ' ') {
      if (t === '.') { SFX.dig(); digDust(nx, ny); }
      g[p.y][p.x] = ' '; g[ny][nx] = 'P';
      p.x = nx; p.y = ny; p.moving = true;
      p.pushT = 0;
    } else if (t === 'd') {
      collectGem(nx, ny);
      g[p.y][p.x] = ' '; g[ny][nx] = 'P';
      p.x = nx; p.y = ny; p.moving = true;
      p.pushT = 0;
    } else if (t === 'r' && dy === 0 && !G.fall[ny][nx] && cellAt(nx + dx, ny) === ' ') {
      p.pushT++;
      if (p.pushT >= 2) {                    // authentic push delay
        g[ny][nx + dx] = 'r';
        G.moves.push({ x: nx + dx, y: ny, dx: -dx, dy: 0 });
        g[ny][nx] = 'P'; g[p.y][p.x] = ' ';
        p.x = nx; p.moving = true;
        p.pushT = 0;
        SFX.push();
      }
    } else if (t === 'X' && G.exitOpen) {
      caveClear();
      return;
    } else p.pushT = 0;
  } else p.pushT = 0;
  if (p.moving) p.anim++;
  // enemies: wall-followers that detonate on contact
  for (const e of G.enemies.slice()) {
    if (!G.enemies.includes(e)) continue;
    e.px = e.x; e.py = e.y;
    const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const pref = e.type === 'f'
      ? [(e.dir + 3) % 4, e.dir, (e.dir + 1) % 4, (e.dir + 2) % 4]     // firefly favours left
      : [(e.dir + 1) % 4, e.dir, (e.dir + 3) % 4, (e.dir + 2) % 4];    // butterfly favours right
    let movedE = false;
    for (const nd of pref) {
      const nx = e.x + D4[nd][0], ny = e.y + D4[nd][1];
      const t = cellAt(nx, ny);
      if (t === 'P') { explode(nx, ny, e.type === 'b' ? 'd' : ' '); movedE = true; break; }
      if (t === ' ') {
        g[e.y][e.x] = ' ';
        g[ny][nx] = e.type;
        e.x = nx; e.y = ny; e.dir = nd;
        movedE = true;
        break;
      }
    }
    if (!movedE) e.dir = (e.dir + 2) % 4;
    // adjacency check after move
    if (G.enemies.includes(e) && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1)
      explode(e.x, e.y, e.type === 'b' ? 'd' : ' ');
  }
}
function nearCam(x, y) {
  return Math.abs(x * TS - (G.cam.x + VW / 2)) < VW && Math.abs(y * TS - (G.cam.y + VH / 2)) < VH;
}
function solidLike(x, y) {
  const c = cellAt(x, y);
  return c === '.' || c === 'W' || c === 'S' || c === 'M';
}
function collectGem(x, y) {
  const spec = CAVES[G.cave];
  G.diamonds++;
  const val = G.exitOpen ? 15 : 10;
  G.score += val;
  if (G.score > G.hiScore) { G.hiScore = G.score; if (!G.attract) try { localStorage.setItem('neondash_hi', String(G.hiScore)); } catch (e) {} }
  (G.exitOpen ? SFX.gemBonus : SFX.gem)();
  G.lastGemAt = G.time;
  addSparkle(x * TS + TS / 2, y * TS + TS / 2, spec.rim);
  addPop(x * TS + TS / 2, y * TS + 6, `+${val}`, '#ffd76a');
  if (!G.exitOpen && G.diamonds >= G.quota) {
    G.exitOpen = true;
    G.exitOpenAt = G.time;
    SFX.exitOpen();
    G.flash = -0.22;
  }
}
function caveClear() {
  const bonus = Math.max(0, Math.ceil(G.caveTime)) * 5;   // canon: seconds remaining, 5-point granularity
  G.score += bonus;
  G.cavesCleared++;
  SFX.clear();
  G.flash = -0.3;
  const spec = CAVES[G.cave];
  for (let i = 0; i < 60; i++) {
    G.parts.push({ kind: 'spark', x: G.p.x * TS + rng(-260, 260), y: G.p.y * TS + rng(-40, 160),
      vx: rng(-25, 25), vy: rng(-190, -70), color: i % 3 ? '#ffd12a' : '#ffffff', life: rng(0.7, 1.4), t: 0 });
  }
  G.mode = G.cave >= CAVES.length - 1 ? 'win' : 'clear';
  G.modeT = 0;
  G.clearBonus = bonus;
}
function playerDied() {
  G.deaths++;
  SFX.death();
  G.flash = 0.5;
  if (G.attract) { buildCave(G.cave); return; }
  if (G.lives < 0) { G.mode = 'over'; G.modeT = 0; }
  else { G.mode = 'respawn'; G.modeT = 0; }
}

// ---------- particles ----------
function addParts(x, y, color, n, power) {
  for (let i = 0; i < n; i++) {
    const a = rng(0, Math.PI * 2), s = rng(80, power ? 480 : 340);
    G.parts.push({ kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: rng(3, 9), h: rng(2, 5), rot: a, vr: rng(-9, 9), color, life: rng(0.4, 0.8), t: 0 });
  }
  for (let i = 0; i < n; i++) {
    const a = rng(0, Math.PI * 2), s = rng(160, 620);
    G.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rng(0.2, 0.42), t: 0 });
  }
  G.parts.push({ kind: 'fire', x, y, r: power ? 54 : 36, color, life: 0.32, t: 0 });
  G.parts.push({ kind: 'flash', x, y, r: power ? 150 : 100, color, life: 0.28, t: 0 });
  G.parts.push({ kind: 'ring', x, y, r: 10, color, life: 0.28, t: 0 });
}
function addSparkle(x, y, color) {
  for (let i = 0; i < 9; i++) {
    const a = rng(0, Math.PI * 2), s = rng(60, 240);
    G.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, color, life: rng(0.25, 0.5), t: 0 });
  }
  G.parts.push({ kind: 'flash', x, y, r: 40, color, life: 0.18, t: 0 });
  G.parts.push({ kind: 'ring', x, y, r: 6, color, life: 0.25, t: 0 });
}
function digDust(x, y) {
  for (let i = 0; i < 6; i++)
    G.parts.push({ kind: 'dust', x: x * TS + rng(6, 26), y: y * TS + rng(6, 26), vx: rng(-40, 40), vy: rng(-60, -10), r: rng(2, 5), color: '#7a6a52', life: rng(0.25, 0.5), t: 0 });
}
function landDust(x, y) {
  for (let i = 0; i < 5; i++)
    G.parts.push({ kind: 'dust', x: x * TS + rng(2, 30), y: (y + 1) * TS - 2, vx: rng(-70, 70), vy: rng(-40, -8), r: rng(2, 5), color: '#b09a78', life: rng(0.2, 0.4), t: 0 });
}
function addPop(x, y, txt, color) { G.pops.push({ x, y, txt, color, t: 0, life: 0.7 }); }

// ---------- solvability bot ----------
function botDir() {
  const p = G.p, g = G.grid;
  if (G.botMode === 'greedy') return botDirGreedy();
  const passable = (x, y) => {
    const c = cellAt(x, y);
    if (!(c === ' ' || c === '.' || c === 'd' || (c === 'X' && G.exitOpen))) return false;
    if (cellAt(x, y - 1) === 'r' && G.fall[y - 1] && G.fall[y - 1][x]) return false; // never step under a falling rock
    for (const e of G.enemies)
      if (Math.abs(e.x - x) + Math.abs(e.y - y) <= 1) return false;                 // never step beside an enemy
    return true;
  };
  const cost = (x, y) => {
    let k = 1;
    if (cellAt(x, y - 1) === 'r') k += 20;             // something can drop here
    if (cellAt(x, y - 1) === ' ' && cellAt(x, y - 2) === 'r') k += 10;
    // rocks in the cone above can roll into this column
    for (let cy = y - 4; cy < y; cy++)
      for (let cx = x - 1; cx <= x + 1; cx++)
        if (cellAt(cx, cy) === 'r') { k += 12; break; }
    for (const e of G.enemies)
      if (Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= 2) k += 60;
    return k;
  };
  // Dijkstra to nearest goal
  const goal = (x, y) => G.exitOpen ? cellAt(x, y) === 'X' : cellAt(x, y) === 'd';
  const dist = new Map(), prev = new Map();
  const key = (x, y) => y * CW + x;
  const pq = [[0, p.x, p.y]];
  dist.set(key(p.x, p.y), 0);
  let found = null;
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = pq.shift();
    if (d > (dist.get(key(x, y)) ?? 1e9)) continue;
    if (goal(x, y)) { found = [x, y]; break; }
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ddx, ny = y + ddy;
      if (!passable(nx, ny)) continue;
      const nd = d + cost(nx, ny);
      if (nd < (dist.get(key(nx, ny)) ?? 1e9)) {
        dist.set(key(nx, ny), nd);
        prev.set(key(nx, ny), [x, y]);
        pq.push([nd, nx, ny]);
      }
    }
  }
  if (!found) {
    // relaxed retry: a blocked route beats standing still forever —
    // drop the enemy-adjacency prohibition but keep falling-rock safety
    G.botRelax = (G.botRelax || 0) + 1;
    if (G.botRelax > 6) { G.botRelax = 0; return botDirGreedy(); }
    G.botStuck = (G.botStuck || 0) + 1;
    return [0, 0];
  }
  G.botRelax = 0;
  G.botStuck = 0;
  let cur = found, back = prev.get(key(found[0], found[1]));
  while (back && !(back[0] === p.x && back[1] === p.y)) { cur = back; back = prev.get(key(cur[0], cur[1])); }
  if (!back) return [0, 0];
  return [cur[0] - p.x, cur[1] - p.y];
}

function botDirGreedy() {
  // a naive gem-grabber with no hazard model: the economy must punish this
  const p = G.p;
  const passable = c => c === ' ' || c === '.' || c === 'd' || (c === 'X' && G.exitOpen);
  const goal = (x, y) => G.exitOpen ? cellAt(x, y) === 'X' : cellAt(x, y) === 'd';
  const key = (x, y) => y * CW + x;
  const prev = new Map();
  const q = [[p.x, p.y]];
  prev.set(key(p.x, p.y), null);
  let found = null;
  while (q.length) {
    const [x, y] = q.shift();
    if (goal(x, y)) { found = [x, y]; break; }
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ddx, ny = y + ddy;
      if (!passable(cellAt(nx, ny)) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!found) { G.botStuck = (G.botStuck || 0) + 1; return [0, 0]; }
  G.botStuck = 0;
  let cur = found, back = prev.get(key(found[0], found[1]));
  while (back && !(back[0] === p.x && back[1] === p.y)) { cur = back; back = prev.get(key(cur[0], cur[1])); }
  if (!back) return [0, 0];
  return [cur[0] - p.x, cur[1] - p.y];
}
// ---------- simulation ----------
function sim(dt) {
  G.time += dt; G.modeT += dt;
  G.hintT = Math.max(0, G.hintT - dt);
  if (G.mode === 'clear') {
    if (G.modeT > 2.4) { buildCave(G.cave + 1); G.mode = 'play'; G.modeT = 0; }
    tickFX(dt); keyEdge = {}; return;
  }
  if (G.mode === 'respawn') {
    if (G.modeT > 1.4) { buildCave(G.cave); G.mode = 'play'; G.modeT = 0; }
    tickFX(dt); keyEdge = {}; return;
  }
  if (G.mode === 'over' || G.mode === 'win') { tickFX(dt); keyEdge = {}; return; }

  if (G.p.alive) {
    if (G.mwState === 1) { G.mwT -= dt; if (G.mwT <= 0) G.mwState = 2; }
    G.caveTime -= dt;
    if (G.caveTime <= 10.2 && G.caveTime > 0 && ((G.caveTime | 0) !== ((G.caveTime + dt) | 0))) SFX.tick();
    if (G.caveTime <= 0) { G.p.alive = false; explode(G.p.x, G.p.y, ' '); }
  }
  G.tickAcc += dt;
  while (G.tickAcc >= TICK) {
    G.tickAcc -= TICK;
    tick();
    if (!G.p.alive && G.dyingT === 0) G.dyingT = 0.01;
  }
  if (G.dyingT > 0) {
    G.dyingT += dt;
    if (G.dyingT > 1) { G.dyingT = 0; playerDied(); }
  }
  tickFX(dt);
  keyEdge = {};
}
function tickFX(dt) {
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const pt = G.parts[i];
    pt.t += dt;
    if (pt.t >= pt.life) { G.parts.splice(i, 1); continue; }
    if (pt.kind === 'shard') { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= (1 - 2 * dt); pt.vy *= (1 - 2 * dt); pt.rot += pt.vr * dt; }
    else if (pt.kind === 'spark' || pt.kind === 'dust') { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= (1 - 3 * dt); pt.vy *= (1 - 3 * dt); if (pt.kind === 'dust') pt.vy += 150 * dt; }
    else if (pt.kind === 'ring') pt.r += 420 * dt;
  }
  for (let i = G.pops.length - 1; i >= 0; i--) { const o = G.pops[i]; o.t += dt; o.y -= 62 * Math.max(0.2, 1 - o.t / o.life) * dt; if (o.t >= o.life) G.pops.splice(i, 1); }
  G.flash = G.flash > 0 ? Math.max(0, G.flash - 2.4 * dt) : Math.min(0, G.flash + 1.4 * dt);
  G.shake = Math.max(0, G.shake - 30 * dt);
}

// ---------- tile sprites ----------
const TILE_CACHE = {};
function tiles(ci) {
  if (TILE_CACHE[ci]) return TILE_CACHE[ci];
  const spec = CAVES[ci];
  srand(6000 + ci * 71);
  // per-cave earth tones: cold slate, ochre, mossy, violet-brown, rust
  const EARTH = ['#7b5c3c', '#8a6a3a', '#6c6f44', '#5e5450', '#7d4b33'][ci];
  function dirt() {
    // one large flowing texture (8x8 tiles) — no visible cell seams
    const SPAN = 8;
    const [c, x] = offCanvas(TS * SPAN, TS * SPAN);
    const base = shade(EARTH, -0.08);
    x.fillStyle = base;
    x.fillRect(0, 0, TS * SPAN, TS * SPAN);
    // multi-octave blotches flowing across cell boundaries
    for (let i = 0; i < 90; i++) {
      const bx = rng(0, TS * SPAN), by = rng(0, TS * SPAN), br2 = rng(14, 60);
      const g2 = x.createRadialGradient(bx, by, 0, bx, by, br2);
      g2.addColorStop(0, hexA2(shade(EARTH, rng(-0.2, 0.26)), rng(0.18, 0.4)));
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g2;
      x.beginPath(); x.arc(bx, by, br2, 0, 7); x.fill();
    }
    // sedimentary strata: wavy bands compress the earth into layers
    for (let i = 0; i < 6; i++) {
      const sy3 = (i + rng(0.25, 0.75)) * (TS * SPAN / 6);
      for (const [off, col, a3, lw3] of [[0, shade(EARTH, -0.38), 0.45, rng(2.5, 5)], [-2.5, shade(EARTH, 0.42), 0.2, 1.4]]) {
        x.strokeStyle = hexA2(col, a3);
        x.lineWidth = lw3;
        x.beginPath();
        for (let sx3 = -8; sx3 <= TS * SPAN + 8; sx3 += 14)
          x.lineTo(sx3, sy3 + off + Math.sin(sx3 * 0.045 + i * 2.2) * 3.5 + rng(-1.2, 1.2));
        x.stroke();
      }
    }
    for (let i = 0; i < 500; i++) {
      x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.28)' : hexA2(shade(EARTH, 0.45), 0.14);
      x.fillRect(rng(0, TS * SPAN - 3) | 0, rng(0, TS * SPAN - 3) | 0, rng(1, 3.5) | 0, rng(1, 3) | 0);
    }
    // mineral flecks in the cave's own light: unmined promise in the dirt
    for (let i = 0; i < 44; i++) {
      x.fillStyle = hexA(spec.rim, rng(0.2, 0.48));
      x.fillRect(rng(2, TS * SPAN - 4) | 0, rng(2, TS * SPAN - 3) | 0, rnd() < 0.3 ? 2 : 1, 1);
    }
    // embedded pebbles and root threads
    for (let i = 0; i < 26; i++) {
      const sx2 = rng(4, TS * SPAN - 6), sy2 = rng(4, TS * SPAN - 6), sr = rng(1.6, 4);
      x.fillStyle = hexA2(shade(EARTH, -0.4), 0.85);
      x.beginPath(); x.arc(sx2, sy2, sr, 0, 7); x.fill();
      x.fillStyle = hexA2(shade(EARTH, 0.55), 0.5);
      x.beginPath(); x.arc(sx2 - sr * 0.35, sy2 - sr * 0.35, sr * 0.4, 0, 7); x.fill();
    }
    for (let i = 0; i < 10; i++) {
      x.strokeStyle = hexA2(shade(EARTH, -0.35), 0.6);
      x.lineWidth = 1;
      x.beginPath();
      let px2 = rng(0, TS * SPAN), py2 = rng(0, TS * SPAN);
      x.moveTo(px2, py2);
      for (let s2 = 0; s2 < 4; s2++) { px2 += rng(-16, 16); py2 += rng(4, 14); x.lineTo(px2, py2); }
      x.stroke();
    }
    return c;
  }
  function hexA2(col, a) { // rgb() → rgba()
    const m = col.match(/\d+/g);
    return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  }
  function brick() {
    const [c, x] = offCanvas(TS, TS);
    const g = x.createLinearGradient(0, 0, 0, TS);
    g.addColorStop(0, shade(EARTH, -0.12)); g.addColorStop(0.5, shade(EARTH, -0.44)); g.addColorStop(1, shade(EARTH, -0.3));
    x.fillStyle = g; x.fillRect(1, 1, TS - 2, TS - 2);
    // masonry bevel: lit crown, sunken foot — the wall has mass before it has glow
    x.fillStyle = 'rgba(255,255,255,0.16)';
    x.fillRect(2, 2, TS - 4, 2.5); x.fillRect(2, 2, 2.5, TS - 4);
    x.fillStyle = 'rgba(0,0,0,0.4)';
    x.fillRect(2, TS - 4.5, TS - 4, 2.5); x.fillRect(TS - 4.5, 2, 2.5, TS - 4);
    // mortar grooves, shadowed then lit
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(3, TS / 2); x.lineTo(TS - 3, TS / 2); x.moveTo(TS / 2, 3); x.lineTo(TS / 2, TS / 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(3, TS / 2 + 1.4); x.lineTo(TS - 3, TS / 2 + 1.4); x.moveTo(TS / 2 + 1.4, 3); x.lineTo(TS / 2 + 1.4, TS / 2); x.stroke();
    // lantern kiss on the crown instead of a neon outline
    x.strokeStyle = 'rgba(255,214,150,0.3)'; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(2.5, 3.4); x.lineTo(TS - 2.5, 3.4); x.stroke();
    return c;
  }
  function steel() {
    const [c, x] = offCanvas(TS, TS);
    const g = x.createLinearGradient(0, 0, 0, TS);
    g.addColorStop(0, '#4a4238'); g.addColorStop(0.5, '#2a251f'); g.addColorStop(1, '#37312a');
    x.fillStyle = g; x.fillRect(0, 0, TS, TS);
    x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 1.5;
    x.strokeRect(0.75, 0.75, TS - 1.5, TS - 1.5);
    x.fillStyle = 'rgba(255,255,255,0.1)';
    x.fillRect(2, 2, TS - 4, 2);
    for (const [bx2, by2] of [[6, 6], [TS - 6, 6], [6, TS - 6], [TS - 6, TS - 6]]) {
      x.fillStyle = 'rgba(255,255,255,0.14)';
      x.beginPath(); x.arc(bx2 - 0.5, by2 - 0.5, 1.8, 0, 7); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.45)';
      x.beginPath(); x.arc(bx2 + 0.6, by2 + 0.6, 1.4, 0, 7); x.fill();
    }
    return c;
  }
  function boulder(v) {
    // craggy mineral rocks in the cave's own stone — four variants, no logo facet
    const tint = shade(EARTH, 0.42);
    const [c, x] = offCanvas(TS, TS);
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.beginPath(); x.ellipse(TS / 2 + 1, TS / 2 + 5, 14, 9.5, 0, 0, 7); x.fill();
    const pts = 10;
    const silhouette = () => {
      x.beginPath();
      for (let i = 0; i < pts; i++) {
        const a = i / pts * Math.PI * 2 + v * 1.7;
        const rr = 15 + Math.sin(i * (2.3 + v * 0.6) + ci + v * 3) * 2.2;
        const px2 = TS / 2 + Math.cos(a) * rr, py2 = TS / 2 + Math.sin(a) * rr * 0.94;
        i ? x.lineTo(px2, py2) : x.moveTo(px2, py2);
      }
      x.closePath();
    };
    silhouette();
    // hard key light from the upper-left, falling away into a deep core
    const g = x.createRadialGradient(TS / 2 - 6, TS / 2 - 8, 2, TS / 2, TS / 2, 18);
    g.addColorStop(0, shade(tint, 0.62)); g.addColorStop(0.45, tint);
    g.addColorStop(0.8, shade(tint, -0.4)); g.addColorStop(1, shade(tint, -0.72));
    x.fillStyle = g;
    x.fill();
    x.save(); x.clip();
    x.strokeStyle = 'rgba(0,0,0,0.42)';
    x.lineWidth = 1.3;
    x.beginPath();
    for (let k = 0; k < 3; k++) {
      const sx2 = 6 + ((v * 7 + k * 11) % 18), sy2 = 6 + ((v * 5 + k * 7) % 16);
      x.moveTo(sx2, sy2);
      x.lineTo(sx2 + 5 + (k * 3) % 6, sy2 + 6);
      x.lineTo(sx2 + 2, sy2 + 12);
    }
    x.stroke();
    // one key-lit plane and a deep core shadow instead of a chevron watermark
    x.fillStyle = hexA2(shade(tint, 0.8), 0.45);
    x.beginPath();
    x.moveTo(7, 9); x.quadraticCurveTo(14 + v, 4, 21 - v, 8);
    x.quadraticCurveTo(15, 11, 9, 13); x.closePath();
    x.fill();
    x.fillStyle = 'rgba(0,0,0,0.36)';
    x.beginPath(); x.ellipse(TS / 2 + 4, TS / 2 + 7, 10, 6, 0.4, 0, 7); x.fill();
    // mineral speckle: bright grit on the lit face, dark pores in shadow
    for (let k = 0; k < 14; k++) {
      const ax = 5 + ((v * 13 + k * 17) % 22), ay = 5 + ((v * 11 + k * 23) % 22);
      x.fillStyle = (ax + ay) < 30 ? hexA2(shade(tint, 0.85), 0.5) : 'rgba(0,0,0,0.38)';
      x.fillRect(ax, ay, 1.6, 1.6);
    }
    x.restore();
    // dark occlusion rim all round, then a cool skylight kiss on the crown
    silhouette();
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.4;
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.32)'; x.lineWidth = 1.2;
    x.beginPath(); x.arc(TS / 2 - 1, TS / 2 + 0.5, 14.4, -2.45, -1.15); x.stroke();
    return c;
  }
  function gem() {
    // a brilliant-cut jewel in the cave's own light: crown, girdle, pavilion
    const [c, x] = offCanvas(TS, TS);
    const cx2 = TS / 2, cy2 = TS / 2 + 1;
    const F = (pts2, col) => {
      x.beginPath();
      pts2.forEach(([fx, fy], i) => i ? x.lineTo(cx2 + fx, cy2 + fy) : x.moveTo(cx2 + fx, cy2 + fy));
      x.closePath(); x.fillStyle = col; x.fill();
    };
    x.save();
    x.shadowColor = spec.rim; x.shadowBlur = 9;
    F([[-7, -12], [7, -12], [14, -3], [0, 13], [-14, -3]], shade(spec.rim, -0.2));
    x.restore();
    // crown: bright table flanked by tilted facets
    F([[-7, -12], [7, -12], [6, -3], [-6, -3]], shade(spec.rim, 0.78));
    F([[-7, -12], [-6, -3], [-14, -3]], shade(spec.rim, 0.3));
    F([[7, -12], [14, -3], [6, -3]], shade(spec.rim, 0.5));
    // pavilion facets fan down to the culet
    F([[-14, -3], [-5, -3], [0, 13]], shade(spec.rim, -0.34));
    F([[-5, -3], [5, -3], [0, 13]], shade(spec.rim, 0.18));
    F([[5, -3], [14, -3], [0, 13]], shade(spec.rim, -0.08));
    // facet edges catch the light
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 0.9; x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(cx2 - 14, cy2 - 3); x.lineTo(cx2 + 14, cy2 - 3);
    x.moveTo(cx2 - 7, cy2 - 12); x.lineTo(cx2 - 6, cy2 - 3);
    x.moveTo(cx2 + 7, cy2 - 12); x.lineTo(cx2 + 6, cy2 - 3);
    x.moveTo(cx2 - 5, cy2 - 3); x.lineTo(cx2, cy2 + 13); x.lineTo(cx2 + 5, cy2 - 3);
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 1.3;
    x.beginPath();
    x.moveTo(cx2 - 7, cy2 - 12); x.lineTo(cx2 + 7, cy2 - 12); x.lineTo(cx2 + 14, cy2 - 3);
    x.lineTo(cx2, cy2 + 13); x.lineTo(cx2 - 14, cy2 - 3); x.closePath();
    x.stroke();
    // a pinpoint of caught fire in the table
    x.fillStyle = 'rgba(255,255,255,0.95)';
    x.beginPath(); x.arc(cx2 - 3, cy2 - 8, 1.6, 0, 7); x.fill();
    return c;
  }
  TILE_CACHE[ci] = { dirt: dirt(), brick: brick(), steel: steel(), gem: gem(), boulders: [boulder(0), boulder(1), boulder(2), boulder(3)], span: 8 };
  return TILE_CACHE[ci];
}
// lighting: dark ambient multiplied over the scene, holes punched by lights
const lightC = document.createElement('canvas');
lightC.width = VW / 2; lightC.height = VH / 2;
const lctx = lightC.getContext('2d');
function drawLighting(spec, plx, ply) {
  const s = 0.5;
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = G.mode === 'over' ? 'rgb(80,34,38)' : 'rgb(114,100,82)';
  lctx.fillRect(0, 0, lightC.width, lightC.height);
  lctx.globalCompositeOperation = 'lighter';
  const light = (wx, wy, r, col, a) => {
    const lx = (wx - G.cam.x) * s, ly = (wy - G.cam.y) * s;
    if (lx < -r * s || ly < -r * s || lx > lightC.width + r * s || ly > lightC.height + r * s) return;
    const gl = lctx.createRadialGradient(lx, ly, 0, lx, ly, r * s);
    gl.addColorStop(0, hexA(col, a)); gl.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = gl;
    lctx.beginPath(); lctx.arc(lx, ly, r * s, 0, 7); lctx.fill();
  };
  const panic = G.mode === 'play' && G.caveTime < 15;
  const breathe = 0.985 + 0.012 * Math.sin(G.time * 9) + 0.007 * Math.sin(G.time * 23);
  const lampR = 300 * breathe * (panic ? 0.84 + 0.09 * Math.sin(G.time * 11) : 1);
  light(plx + TS / 2, ply + TS / 2, lampR, '#ffe9c8', 1.0);   // Otto's lamp
  const x0 = clamp((G.cam.x / TS | 0) - 1, 0, CW), x1 = clamp(((G.cam.x + VW) / TS | 0) + 2, 0, CW);
  const y0 = clamp((G.cam.y / TS | 0) - 1, 0, CH), y1 = clamp(((G.cam.y + VH) / TS | 0) + 2, 0, CH);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = G.grid[y][x];
    if (c === 'd') light(x * TS + TS / 2, y * TS + TS / 2, 70, spec.rim, 0.5);
    else if (c === 'X' && G.exitOpen) light(x * TS + TS / 2, y * TS + TS / 2, 200, spec.rim, 0.9);
    else if (c === 'M' && G.mwState === 1) light(x * TS + TS / 2, y * TS + TS / 2, 90, '#b48cff', 0.7);
  }
  for (const e of G.enemies) light(e.x * TS + TS / 2, e.y * TS + TS / 2, 110, e.type === 'f' ? '#ff4545' : '#ff3d8f', 0.55);
  for (const pt of G.parts) if (pt.kind === 'flash' || pt.kind === 'fire') light(pt.x, pt.y, pt.r * 2.0, '#ffd9a0', 0.55);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightC, 0, MQ, VW, VH);
  ctx.restore();
  // exit-open one-shot: two gold rings sweep out from the doorway
  const ek = G.time - G.exitOpenAt;
  if (G.exitOpen && ek >= 0 && ek < 0.9) {
    const [exX, exY] = CAVES[G.cave].exit;
    const rx = exX * TS + TS / 2 - G.cam.x, ry = exY * TS + TS / 2 - G.cam.y + MQ;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const [spd, del] of [[340, 0], [340, 0.14]]) {
      const t2 = ek - del;
      if (t2 < 0) continue;
      ctx.strokeStyle = `rgba(255,215,106,${(0.75 * (1 - ek / 0.9)).toFixed(3)})`;
      ctx.lineWidth = 3.5 - ek * 2.5;
      ctx.beginPath(); ctx.arc(rx, ry, 14 + t2 * spd, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }
}
const VIGNETTE = (() => {
  const [c, x] = offCanvas(W, H);
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(12,6,0,0.46)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
})();

// ---------- render ----------
function draw() {
  const spec = CAVES[G.cave], T = tiles(G.cave), p = G.p;
  if (G.showTitle) { drawTitle(spec); return; }
  const lerp = clamp(G.tickAcc / TICK, 0, 1);
  const MV = new Map();
  if (G.moves) for (const m of G.moves) MV.set(m.y * CW + m.x, m);
  const plx = (p.px + (p.x - p.px) * lerp) * TS, ply = (p.py + (p.y - p.py) * lerp) * TS;
  const txc = clamp(plx + TS / 2 - VW / 2, 0, WORLD_W - VW);
  const tyc = clamp(ply + TS / 2 - VH / 2, 0, WORLD_H - VH);
  G.cam.x += (txc - G.cam.x) * 0.15;
  G.cam.y += (tyc - G.cam.y) * 0.15;

  ctx.save();
  ctx.fillStyle = '#0a0705';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.translate(0, MQ);
  if (G.shake > 0.1) ctx.translate(rng(-1, 1) * G.shake * 0.7, rng(-1, 1) * G.shake * 0.7);
  ctx.translate(-G.cam.x, -G.cam.y);

  // carved tunnels read as warm rock hollows, not deleted tiles
  const bgGrad = ctx.createLinearGradient(0, G.cam.y, 0, G.cam.y + VH);
  bgGrad.addColorStop(0, '#150e08'); bgGrad.addColorStop(1, '#0c0805');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(G.cam.x, G.cam.y, VW, VH);

  const x0 = clamp((G.cam.x / TS | 0) - 1, 0, CW), x1 = clamp(((G.cam.x + VW) / TS | 0) + 2, 0, CW);
  const y0 = clamp((G.cam.y / TS | 0) - 1, 0, CH), y1 = clamp(((G.cam.y + VH) / TS | 0) + 2, 0, CH);
  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
  // objects sit in excavated pockets of the same earth, never on black stickers
  const pocket = (px, py, x, y) => {
    const sx = (x % T.span) * TS * 2, sy = (y % T.span) * TS * 2;
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.drawImage(T.dirt, sx, sy, TS * 2, TS * 2, px, py, TS, TS);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,5,2,0.34)';
    ctx.fillRect(px, py, TS, TS);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px, py, TS, 3);
    ctx.fillRect(px, py + 3, 3, TS - 3);
    // crumbled lip where the pocket meets the earth
    const h3 = hash(x * 5, y * 3);
    ctx.fillStyle = 'rgba(140,112,80,0.5)';
    for (let k3 = 0; k3 < 4; k3++) {
      const ex2 = (h3 >> (k3 * 4)) & 15, ey2 = (h3 >> (k3 * 4 + 9)) & 1;
      ctx.fillRect(px + 2 + ex2 * 2, ey2 ? py + 1 : py + TS - 3, 3, 2);
    }
  };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = G.grid[y][x], px = x * TS, py = y * TS;
    if (c === '.') {
      const sx = (x % T.span) * TS * 2, sy = (y % T.span) * TS * 2;
      ctx.drawImage(T.dirt, sx, sy, TS * 2, TS * 2, px, py, TS, TS);
    } else if (c === 'W') ctx.drawImage(T.brick, px, py, TS, TS);
    else if (c === 'S') ctx.drawImage(T.steel, px, py, TS, TS);
    else if (c === 'r') {
      pocket(px, py, x, y);
      const falling = G.fall[y][x];
      const aboutToFall = !falling && cellAt(x, y + 1) === ' ';
      const spr = T.boulders[hash(x, y * 7) & 3];
      const flip = (hash(x * 3, y) & 4) ? -1 : 1;
      const m = MV.get(y * CW + x);
      ctx.save();
      ctx.translate(px + TS / 2 + (m ? m.dx * TS * (1 - lerp) : 0), py + TS / 2 + (m ? m.dy * TS * (1 - lerp) : 0));
      if (m && m.dx) ctx.rotate(m.dx * (1 - lerp) * 1.1); // rolling stone turns as it rolls (right roll = clockwise)
      ctx.scale(flip, 1);
      if (falling) {
        // the loudest sprite on screen: hot smear, speed lines, hard stretch
        let ly2 = y + 1;
        while (ly2 < CH && cellAt(x, ly2) === ' ') ly2++;
        const dist = Math.max(1, ly2 - y);
        ctx.fillStyle = `rgba(0,0,0,${clamp(0.7 - dist * 0.08, 0.22, 0.62).toFixed(2)})`;
        ctx.beginPath(); ctx.ellipse(0, dist * TS - TS / 2 - 2, 9 + 16 / dist, 4.2, 0, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.58;
        ctx.drawImage(spr, -TS / 2, -TS / 2 - 14, TS, TS);
        ctx.globalAlpha = 0.36;
        ctx.drawImage(spr, -TS / 2, -TS / 2 - 26, TS, TS);
        ctx.globalAlpha = 0.18;
        ctx.drawImage(spr, -TS / 2, -TS / 2 - 40, TS, TS);
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-9, -TS / 2 - 34); ctx.lineTo(-9, -4);
        ctx.moveTo(8, -TS / 2 - 26); ctx.lineTo(8, -8);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.scale(0.88, 1.18);
        ctx.drawImage(spr, -TS / 2, -TS / 2, TS, TS);
        // white-hot leading edge: this thing is arriving
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,235,200,0.28)';
        ctx.beginPath(); ctx.ellipse(0, 11, 9, 3.5, 0, 0, 7); ctx.fill();
        ctx.restore();
      } else if (aboutToFall) {
        // poised over a drop: hot underglow + grit trickling off the edge
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const wa = 0.3 + 0.22 * Math.sin(G.time * 7 + x * 1.7);
        const ug = ctx.createRadialGradient(0, TS / 2 + 3, 0, 0, TS / 2 + 3, 24);
        ug.addColorStop(0, hexA('#ff8c42', wa)); ug.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ug;
        ctx.beginPath(); ctx.arc(0, TS / 2 + 3, 24, 0, 7); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(214,192,160,0.75)';
        for (let k2 = 0; k2 < 3; k2++) {
          const fy2 = (G.time * 42 + k2 * 11 + ((x * 13) % 17)) % 24;
          ctx.fillRect(-7 + k2 * 7, TS / 2 + fy2, 2, 2);
        }
        ctx.rotate(Math.sin(G.time * 18 + x) * 0.09);
        ctx.drawImage(spr, -TS / 2, -TS / 2, TS, TS);
      } else {
        // grounded tonnage: shadow pools where stone meets floor
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath(); ctx.ellipse(0, TS / 2 - 2, 13, 4, 0, 0, 7); ctx.fill();
        ctx.drawImage(spr, -TS / 2, -TS / 2, TS, TS);
      }
      ctx.restore();
    }
    else if (c === 'd') {
      pocket(px, py, x, y);
      const mg = MV.get(y * CW + x);
      drawGem(px + (mg ? mg.dx * TS * (1 - lerp) : 0), py + (mg ? mg.dy * TS * (1 - lerp) : 0), spec);
    }
    else if (c === 'M') drawMagicWall(px, py);
    else if (c === 'X') drawExit(px, py, spec);
    else if (c === 'e') { /* blast handled by particles */ }
    if (c === ' ') {
      // tunnel residue: crumbs left where earth was carved
      const h2 = hash(x, y);
      ctx.fillStyle = 'rgba(128,108,86,0.22)';
      for (let k2 = 0; k2 < 3; k2++) {
        const hx = (h2 >> (k2 * 5)) & 31, hy = (h2 >> (k2 * 5 + 8)) & 31;
        ctx.fillRect(px + (hx % 28) + 2, py + (hy % 26) + 4, 2, 2);
      }
    }
  }
  // carved-earth rim light where dirt faces tunnel
  ctx.save();
  ctx.strokeStyle = hexA(spec.rim, 0.32);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (G.grid[y][x] !== '.') continue;
    const px = x * TS, py = y * TS;
    if (!solidLike(x, y - 1)) { ctx.moveTo(px + 1, py + 1); ctx.lineTo(px + TS - 1, py + 1); }
    if (!solidLike(x, y + 1)) { ctx.moveTo(px + 1, py + TS - 1); ctx.lineTo(px + TS - 1, py + TS - 1); }
    if (!solidLike(x - 1, y)) { ctx.moveTo(px + 1, py + 1); ctx.lineTo(px + 1, py + TS - 1); }
    if (!solidLike(x + 1, y)) { ctx.moveTo(px + TS - 1, py + 1); ctx.lineTo(px + TS - 1, py + TS - 1); }
  }
  ctx.stroke();
  ctx.restore();
  // enemies
  for (const e of G.enemies) drawEnemy(e);
  // Otto
  if (p.alive || G.dyingT < 0.15) drawOtto(plx, ply, p);
  drawParticles();
  drawPops();
  // cave air: dust motes drifting through the lamplight
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#d8ecff';
  for (let i = 0; i < 24; i++) {
    const mx = (i * 211.7 + G.time * (3 + (i % 5) * 1.6) + Math.sin(G.time * 0.6 + i) * 9) % VW;
    const my = (i * 137.3 + G.time * (2 + (i % 3))) % VH;
    ctx.globalAlpha = 0.04 + 0.06 * (0.5 + 0.5 * Math.sin(G.time * 1.4 + i * 1.9));
    const sz = i % 5 === 0 ? 2 : 1.4;
    ctx.fillRect(G.cam.x + mx, G.cam.y + my, sz, sz);
  }
  ctx.restore();
  ctx.restore();

  drawLighting(spec, plx, ply);
  if (G.mode === 'play' && G.caveTime < 15) {
    const pa = 0.22 + 0.12 * Math.sin(G.time * 6);
    const pg2 = ctx.createRadialGradient(VW / 2, MQ + VH / 2, VH * 0.38, VW / 2, MQ + VH / 2, VH * 0.85);
    pg2.addColorStop(0, 'rgba(0,0,0,0)'); pg2.addColorStop(1, `rgba(185,32,20,${pa.toFixed(3)})`);
    ctx.fillStyle = pg2;
    ctx.fillRect(0, MQ, VW, VH);
  }
  drawMarquee(spec);
  drawHUD(spec);
  drawExitArrow(spec);

  if (G.mode === 'clear') banner(`${spec.name} CLEAR`, spec.rim, `TIME BONUS +${G.clearBonus}`);
  if (G.mode === 'respawn') banner('OTTO DOWN', '#ff3b5c', `${Math.max(0, G.lives)} LIVES REMAIN`);
  if (G.mode === 'over') banner('GAME OVER', '#ff3b5c', `FINAL SCORE ${G.score.toLocaleString('en-US')} — ${START_KEY} TO RETRY`);
  if (G.mode === 'win') banner('ALL CAVES CLEAR', '#ffd12a', `OTTO ESCAPES WITH ${G.score.toLocaleString('en-US')} — ${START_KEY} TO PLAY AGAIN`);

  if (G.flash !== 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
    ctx.fillStyle = G.flash > 0 ? `rgba(255,37,69,${Math.min(G.flash, 0.45)})` : `rgba(255,255,255,${Math.min(-G.flash, 0.5)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  ctx.restore();
  ctx.drawImage(VIGNETTE, 0, 0, W, H);
}
function starGlint(x2, y2, r, a) {
  // a four-point lens star with a diagonal cross — the facet caught the lamp
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x2 - r, y2); ctx.lineTo(x2 + r, y2);
  ctx.moveTo(x2, y2 - r); ctx.lineTo(x2, y2 + r);
  ctx.stroke();
  const d = r * 0.42;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x2 - d, y2 - d); ctx.lineTo(x2 + d, y2 + d);
  ctx.moveTo(x2 + d, y2 - d); ctx.lineTo(x2 - d, y2 + d);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x2, y2, 1.4, 0, 7); ctx.fill();
  ctx.restore();
}
function drawGem(px, py, spec) {
  const cx = px + TS / 2, cy = py + TS / 2;
  const hh = ((px * 73856093) ^ (py * 19349663)) >>> 0;
  const ph = (hh % 977) / 977 * Math.PI * 2;
  const pulse = 0.72 + Math.sin(G.time * 4.2 + ph) * 0.28;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
  g.addColorStop(0, hexA(spec.rim, 0.28 * pulse)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 7); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(G.time * 2 + ph) * 0.13);
  ctx.drawImage(tiles(G.cave).gem, -TS / 2, -TS / 2, TS, TS);
  // facet fire: sparkle points take turns catching the lamp
  const ANCH = [[-7, -10], [7, -10], [-12, -2], [12, -2], [0, 12], [-3, -7]];
  for (let s = 0; s < 2; s++) {
    const gk = Math.sin(G.time * (2.7 + s * 1.4) + ph + s * 2.1);
    if (gk > 0.45) {
      const pk = (gk - 0.45) / 0.55;
      const [ax, ay] = ANCH[(hh + s * 3 + ((G.time * 0.7 + ph) | 0)) % ANCH.length];
      starGlint(ax, ay + 1, (3 + 4.5 * pk) * (s ? 0.7 : 1), Math.min(1, pk * 1.4));
    }
  }
  ctx.restore();
}
function drawMagicWall(px, py) {
  ctx.drawImage(tiles(G.cave).brick, px, py, TS, TS);
  const active = G.mwState === 1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const ph = active ? (G.time * 3) % 1 : (G.time * 0.5) % 1;
  const g = ctx.createLinearGradient(px, py, px, py + TS);
  g.addColorStop(clamp(ph - 0.2, 0, 1), 'rgba(180,140,255,0)');
  g.addColorStop(ph, `rgba(180,140,255,${active ? 0.8 : G.mwState === 2 ? 0.08 : 0.5})`);
  g.addColorStop(clamp(ph + 0.2, 0, 1), 'rgba(180,140,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4);
  ctx.strokeStyle = 'rgba(180,140,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(px + 3, py + 3, TS - 6, TS - 6);
  ctx.setLineDash([]);
  ctx.restore();
}
function drawExit(px, py, spec) {
  // canon: a steel cell that FLASHES whole when the quota is met
  const open = G.exitOpen;
  const flash = open && Math.sin(G.time * 9) > 0;
  ctx.drawImage(tiles(G.cave).steel, px, py, TS, TS);
  ctx.save();
  if (open) {
    // a brass-framed doorway breathing warm light into the cave
    const dg = ctx.createLinearGradient(px, py + 2, px, py + TS - 2);
    dg.addColorStop(0, flash ? '#fff6dd' : '#ffd97a'); dg.addColorStop(1, flash ? '#ffe9b8' : '#c98d34');
    ctx.fillStyle = dg;
    ctx.fillRect(px + 4, py + 3, TS - 8, TS - 5);
    ctx.fillStyle = 'rgba(20,12,4,0.5)';
    ctx.fillRect(px + 4, py + 3, TS - 8, 5);
    ctx.strokeStyle = '#b08d4a'; ctx.lineWidth = 3;
    ctx.strokeRect(px + 3, py + 2.5, TS - 6, TS - 4);
    ctx.fillStyle = `rgba(255,215,106,${(0.24 + 0.12 * Math.sin(G.time * 3)).toFixed(3)})`;
    ctx.beginPath(); ctx.ellipse(px + TS / 2, py + TS + 4, 38, 9, 0, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(px + TS / 2, py + TS / 2, 0, px + TS / 2, py + TS / 2, 116);
    g.addColorStop(0, hexA('#ffd76a', flash ? 0.9 : 0.5 + 0.18 * Math.sin(G.time * 3))); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 116, 0, 7); ctx.fill();
    // beacon rays
    ctx.strokeStyle = hexA('#ffe9b8', 0.7);
    ctx.lineWidth = 4;
    ctx.translate(px + TS / 2, py + TS / 2);
    ctx.rotate(G.time * 2);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(46, 0); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(201,163,92,0.45)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(px + 4, py + 4, TS - 8, TS - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(px + 7, py + 7, TS - 14, TS - 14);
  }
  ctx.restore();
}
function drawExitArrow(spec) {
  // when the exit is open but offscreen, point at it from the playfield edge
  if (!G.exitOpen || G.mode !== 'play') return;
  const [ex, ey] = CAVES[G.cave].exit;
  const wx = ex * TS + TS / 2 - G.cam.x, wy = ey * TS + TS / 2 - G.cam.y + MQ;
  if (wx > 30 && wx < VW - 30 && wy > MQ + 30 && wy < MQ + VH - 30) return;
  const cx = clamp(wx, 40, VW - 40), cy = clamp(wy, MQ + 40, MQ + VH - 40);
  const a = Math.atan2(wy - cy, wx - cx);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  const pulse = 0.6 + Math.sin(G.time * 6) * 0.4;
  ctx.shadowColor = spec.rim; ctx.shadowBlur = 12;
  ctx.fillStyle = hexA(spec.rim, pulse);
  ctx.beginPath();
  ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawEnemy(e) {
  // kill colors are reserved: firefly red, butterfly rose — no cave uses them
  const lp = clamp(G.tickAcc / TICK, 0, 1);
  const bx2 = e.px === undefined ? e.x : e.px + (e.x - e.px) * lp;
  const by2 = e.py === undefined ? e.y : e.py + (e.y - e.py) * lp;
  const ex = bx2 * TS + TS / 2, ey = by2 * TS + TS / 2;
  const KILLF = '#ff4545', KILLB = '#ff3d8f';
  ctx.save();
  ctx.translate(ex, ey);
  if (e.type === 'f') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    g.addColorStop(0, hexA(KILLF, 0.5)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
    ctx.rotate(G.time * 6);
    ctx.strokeStyle = KILLF; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.shadowColor = KILLF; ctx.shadowBlur = 14;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(15, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, -3); ctx.lineTo(15, 0); ctx.lineTo(11, 3); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff2d0';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
    ctx.restore();
  } else {
    const flap = Math.sin(G.time * 14) * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    g.addColorStop(0, hexA(KILLB, 0.45)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
    ctx.restore();
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(s, 1);
      ctx.rotate(flap);
      const wg = ctx.createLinearGradient(0, 0, 20, 0);
      wg.addColorStop(0, KILLB); wg.addColorStop(1, hexA(KILLB, 0.12));
      ctx.fillStyle = wg;
      ctx.shadowColor = KILLB; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(3, 0); ctx.quadraticCurveTo(20, -15, 19, -3); ctx.quadraticCurveTo(19, 8, 3, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffd0f0';
    ctx.fillRect(-2, -9, 4, 18);
    ctx.restore();
  }
  ctx.restore();
  // patrol trail
  if (((G.time * 10) | 0) % 2 === 0)
    G.parts.push({ kind: 'spark', x: ex + rng(-6, 6), y: ey + rng(-6, 6), vx: rng(-20, 20), vy: rng(-20, 20), color: e.type === 'f' ? KILLF : KILLB, life: 0.3, t: 0 });
}
function drawOtto(px, py, p) {
  const key = p.pushT > 0 ? 'push' : p.moving ? ['walk1', 'push', 'walk2', 'stand'][p.anim % 4] : 'stand';
  const spr = SPR[p.dir < 0 ? key + 'L' : key];
  ctx.save();
  // helmet lamp
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(px + TS / 2, py + 10, 0, px + TS / 2 + p.dir * 26, py + 12, 52);
  lg.addColorStop(0, `rgba(255,240,180,${(0.21 + 0.045 * Math.sin(G.time * 13)).toFixed(3)})`); lg.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = lg;
  ctx.beginPath(); ctx.arc(px + TS / 2 + p.dir * 22, py + 12, 50, 0, 7); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // lean into motion, fill the cell
  ctx.translate(px + TS / 2 + (p.pushT > 0 ? p.dir * 5 : 0), py + TS + (!p.moving && p.pushT <= 0 ? Math.sin(G.time * 2.4) * 1.2 : 0));
  // boots on the ground: a contact shadow keeps Otto out of mid-air
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, -1.5, 11, 3.5, 0, 0, 7); ctx.fill();
  if (p.pushT > 0) ctx.rotate(p.dir * 0.22);
  else if (p.moving) ctx.rotate(p.dir * 0.08);
  ctx.shadowColor = 'rgba(255,214,150,0.5)'; ctx.shadowBlur = 8;
  ctx.drawImage(spr, -16, -41, 32, 42);
  ctx.restore();
}
function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of G.parts) {
    const k = 1 - pt.t / pt.life;
    if (pt.kind === 'shard') {
      ctx.save();
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
      ctx.globalAlpha = k;
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.w, -pt.h / 2, pt.w * 2, pt.h);
      ctx.restore();
    } else if (pt.kind === 'spark') {
      ctx.globalAlpha = k;
      ctx.strokeStyle = pt.color; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x - pt.vx * 0.03, pt.y - pt.vy * 0.03); ctx.stroke();
    } else if (pt.kind === 'blast') {
      const bx = pt.x + pt.w / 2, byy = pt.y + pt.h / 2;
      // the lethal footprint is cell-quantized and must read that way
      for (let cyy = 0; cyy < 3; cyy++) for (let cxx = 0; cxx < 3; cxx++) {
        const heat = (cxx === 1 && cyy === 1) ? 0.9 : 0.55;
        ctx.globalAlpha = k * heat;
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x + cxx * TS + 2, pt.y + cyy * TS + 2, TS - 4, TS - 4);
      }
      ctx.globalAlpha = k * 0.5;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      for (let l2 = 1; l2 < 3; l2++) {
        ctx.beginPath(); ctx.moveTo(pt.x + l2 * TS, pt.y); ctx.lineTo(pt.x + l2 * TS, pt.y + pt.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y + l2 * TS); ctx.lineTo(pt.x + pt.w, pt.y + l2 * TS); ctx.stroke();
      }
      const bg2 = ctx.createRadialGradient(bx, byy, 0, bx, byy, pt.w * 0.72);
      bg2.addColorStop(0, pt.color); bg2.addColorStop(0.55, hexA('#ffffff', 0.25)); bg2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k * 0.9;
      ctx.fillStyle = bg2;
      ctx.beginPath(); ctx.roundRect(pt.x, pt.y, pt.w, pt.h, 14); ctx.fill();
      ctx.globalAlpha = k * 0.7;
      ctx.strokeStyle = pt.color; ctx.lineWidth = 2.5;
      for (let rr2 = 0; rr2 < 4; rr2++) {
        const an = rr2 * Math.PI / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(an) * pt.w * 0.5, byy + Math.sin(an) * pt.h * 0.5);
        ctx.lineTo(bx + Math.cos(an) * pt.w * 0.78, byy + Math.sin(an) * pt.h * 0.78);
        ctx.stroke();
      }
    } else if (pt.kind === 'fire') {
      const rr = pt.r * (0.5 + (pt.t / pt.life) * 0.9);
      const fg = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, rr);
      fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.3, '#ffe9b0'); fg.addColorStop(0.65, pt.color); fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k;
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, rr, 0, 7); ctx.fill();
    } else if (pt.kind === 'flash') {
      const gl = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pt.r);
      gl.addColorStop(0, pt.color); gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k * 0.9;
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill();
    } else if (pt.kind === 'ring') {
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = pt.color; ctx.lineWidth = 7 * k + 1.5;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
  // dust is matte, over the additive pass
  for (const pt of G.parts) {
    if (pt.kind !== 'dust') continue;
    const k = 1 - pt.t / pt.life;
    ctx.globalAlpha = k * 0.7;
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawPops() {
  for (const o of G.pops) {
    const k = o.t < o.life * 0.6 ? 1 : 1 - (o.t - o.life * 0.6) / (o.life * 0.4);
    const punch = 1 + 0.4 * Math.max(0, 1 - o.t / 0.14);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(punch, punch);
    ctx.globalAlpha = k;
    ctx.font = `900 15px ${MONO}`;
    ctx.textAlign = 'center';
    const tw2 = ctx.measureText(o.txt).width + 14;
    ctx.fillStyle = 'rgba(22,15,8,0.72)';
    ctx.beginPath(); ctx.roundRect(-tw2 / 2, -14, tw2, 19, 5); ctx.fill();
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(22,15,8,0.95)';
    ctx.strokeText(o.txt, 0, 0);
    ctx.shadowColor = o.color; ctx.shadowBlur = 8;
    ctx.fillStyle = o.color;
    ctx.fillText(o.txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawMarquee(spec) {
  ctx.fillStyle = '#171008';
  ctx.fillRect(0, 0, W, MQ);
  ctx.fillStyle = 'rgba(201,163,92,0.55)';
  ctx.fillRect(0, MQ - 2, W, 2);
  ctx.textAlign = 'center';
  ctx.font = '800 17px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillStyle = '#e8c987';
  ctx.save();
  ctx.shadowColor = 'rgba(255,190,90,0.5)'; ctx.shadowBlur = 8;
  ctx.fillText(spec.name, W / 2, 27);
  ctx.restore();
  // objective status is a state machine: it never contradicts a banner
  if (G.mode === 'play' && G.p.alive) {
    ctx.font = '700 13px Verdana, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    if (G.exitOpen) {
      ctx.fillStyle = Math.sin(G.time * 6) > 0 ? '#ffd76a' : shade('#ffd76a', 0.35);
      ctx.fillText('EXIT OPEN', 24, 27);
    } else {
      ctx.drawImage(tiles(G.cave).gem, 18, 8, 20, 20);
      ctx.fillStyle = 'rgba(240,228,205,1)';
      ctx.fillText(`QUOTA ${Math.max(0, G.quota - G.diamonds)} MORE`, 44, 27);
    }
    ctx.letterSpacing = '0px';
  }
  if (G.hintT > 0 && !G.attract && G.mode === 'play') {
    ctx.save();
    ctx.globalAlpha = clamp(G.hintT, 0, 1);
    ctx.textAlign = 'right';
    ctx.font = '600 11px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(226,208,178,0.9)';
    ctx.fillText(MOVE_HINT, W - 24, 27);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }
}
function drawHUD(spec) {
  const HY = H - HUD_H;
  const LB = HY + 34, VB = HY + 74;
  ctx.fillStyle = '#161009';
  ctx.fillRect(0, HY, W, HUD_H);
  ctx.save();
  ctx.shadowColor = 'rgba(255,190,90,0.4)'; ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(201,163,92,0.85)';
  ctx.fillRect(0, HY, W, 2);
  ctx.restore();
  ctx.fillStyle = 'rgba(201,173,120,0.22)';
  for (const zx of [420, 700, 940, 1120]) ctx.fillRect(zx, HY + 16, 1, 72);
  function label(txt, x) {
    ctx.font = '700 12px Verdana, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(214,192,156,1)';
    ctx.fillText(txt, x, LB);
    ctx.letterSpacing = '0px';
  }
  // zone 1: diamonds
  label('DIAMONDS', 32);
  const quota = G.quota;
  const pk = clamp(1 - (G.time - G.lastGemAt) / 0.3, 0, 1);
  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = G.exitOpen ? '#ffd76a' : '#ffffff';
  ctx.save();
  ctx.shadowColor = spec.rim; ctx.shadowBlur = 10 + 14 * pk;
  ctx.translate(196, LB + 2);
  ctx.scale(1 + 0.3 * pk * pk, 1 + 0.3 * pk * pk);
  ctx.fillText(`${G.diamonds}/${quota}`, 0, 0);
  ctx.restore();
  // gem icon sits clear of the label — the real jewel, glinting on payday
  ctx.save();
  ctx.shadowColor = spec.rim; ctx.shadowBlur = 8;
  ctx.drawImage(tiles(G.cave).gem, 158, LB - 21, 26, 26);
  ctx.restore();
  const hudGk = Math.sin(G.time * 2.6);
  if (hudGk > 0.35) starGlint(166, LB - 14, 3 + 3 * (hudGk - 0.35) / 0.65, (hudGk - 0.35) / 0.65);
  ctx.font = '700 11px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillStyle = 'rgba(214,192,156,0.85)';
  ctx.fillText('VALUE', 32, VB);
  ctx.letterSpacing = '0px';
  ctx.font = `800 15px ${MONO}`;
  ctx.fillStyle = G.exitOpen ? '#ffd76a' : '#f5edd8';
  ctx.fillText(G.exitOpen ? '15' : '10', 100, VB + 1);
  if (G.exitOpen) {
    ctx.fillStyle = 'rgba(176,141,74,0.92)';
    ctx.strokeStyle = 'rgba(243,231,200,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect(132, VB - 12, 58, 17, 4); ctx.fill(); ctx.stroke();
    ctx.font = '700 9px Verdana, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillStyle = '#1a1206';
    ctx.fillText('BONUS', 142, VB);
    ctx.letterSpacing = '0px';
  }
  // zone 2: score
  label('SCORE', 450);
  ctx.font = `800 26px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f5edd8';
  ctx.save();
  ctx.shadowColor = 'rgba(255,200,120,0.4)'; ctx.shadowBlur = 8;
  ctx.fillText(G.score.toLocaleString('en-US'), 672, LB + 2);
  ctx.restore();
  ctx.font = '700 12px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(200,180,145,0.7)';
  ctx.fillText('HIGH', 450, VB);
  ctx.letterSpacing = '0px';
  ctx.font = `800 18px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a89878';
  ctx.fillText(G.hiScore.toLocaleString('en-US'), 672, VB + 1);
  // zone 3: time
  label('TIME', 730);
  const tfrac = clamp(G.caveTime / CAVES[G.cave].time, 0, 1);
  const tcol = G.caveTime < 15 ? '#ff6b5e' : G.caveTime < 35 ? '#ffb020' : '#e8b45c';
  ctx.font = `800 26px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = tcol;
  if (G.caveTime < 15 && Math.sin(G.time * 8) > 0) ctx.globalAlpha = 0.55;
  ctx.fillText(String(Math.max(0, Math.ceil(G.caveTime))), 905, LB + 2);
  ctx.globalAlpha = 1;
  const bx = 730, bw = 175, by = HY + 62, bh = 12;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeStyle = 'rgba(201,173,120,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx - 3, by - 3, bw + 6, bh + 6, 5); ctx.fill(); ctx.stroke();
  ctx.save();
  ctx.shadowColor = tcol; ctx.shadowBlur = 6;
  ctx.fillStyle = tcol;
  ctx.fillRect(bx, by, bw * tfrac, bh);
  ctx.restore();
  // zone 4: lives
  label('LIVES', 970);
  for (let i = 0; i < Math.max(G.lives, 0); i++)
    ctx.drawImage(SPR.stand, 970 + i * 32, HY + 44, 24, 32);
  // zone 5: caves
  label('CAVES', 1150);
  CAVES.forEach((cv, i) => {
    const dx = 1150 + i * 24, dy = HY + 62;
    const done = i < G.cave || (i === G.cave && G.mode === 'win');
    const current = i === G.cave && !done;
    ctx.fillStyle = done ? '#b08d4a' : current ? '#f3e7c8' : 'rgba(176,141,74,0.25)';
    if (done || current) { ctx.save(); ctx.shadowColor = 'rgba(255,200,110,0.8)'; ctx.shadowBlur = 7; }
    ctx.beginPath(); ctx.roundRect(dx - 8, dy - 7, 17, 14, 4); ctx.fill();
    if (current) { ctx.strokeStyle = '#b08d4a'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (done || current) ctx.restore();
    ctx.font = `700 9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = done || current ? '#1a1206' : 'rgba(214,192,156,0.55)';
    ctx.fillText(String(i + 1), dx + 0.5, dy + 3);
  });
}
function banner(title, color, sub) {
  ctx.save();
  const bt = clamp((G.modeT || 1) / 0.32, 0, 1);
  const beas = 1 - Math.pow(1 - bt, 3);
  ctx.globalAlpha = beas;
  ctx.translate(0, (1 - beas) * -36);
  const by = H / 2 - 78, bh = 140;
  ctx.fillStyle = '#120c06';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillRect(0, by, W, 2);
  ctx.fillRect(0, by + bh - 2, W, 2);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = '900 40px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.shadowColor = color; ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(title, W / 2, by + 58);
  ctx.shadowBlur = 0;
  ctx.font = '600 15px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(240,226,200,0.92)';
  ctx.fillText(sub, W / 2, by + 100);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function drawTitle(spec) {
  ctx.save();
  ctx.fillStyle = '#0a0705';
  ctx.fillRect(0, 0, W, H);
  // the promise of the game: a cave cross-section along the bottom third
  const T = tiles(0), groundY = 520;
  for (let y = groundY; y < H; y += TS) for (let x = 0; x < W; x += TS) {
    const sx = ((x / TS) % T.span) * TS * 2, sy = (((y - groundY) / TS) % T.span) * TS * 2;
    ctx.drawImage(T.dirt, sx, sy, TS * 2, TS * 2, x, y, TS, TS);
  }
  // carved pocket where Otto stands
  ctx.save();
  ctx.translate(W / 2, groundY + 46);
  ctx.scale(2.4, 1);
  const pg = ctx.createRadialGradient(0, 0, 8, 0, 0, 92);
  pg.addColorStop(0, 'rgba(9,6,3,0.85)'); pg.addColorStop(0.6, 'rgba(9,6,3,0.6)'); pg.addColorStop(1, 'rgba(9,6,3,0)');
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.arc(0, 0, 92, 0, 7); ctx.fill();
  ctx.restore();
  // buried gems glinting in the dirt — the real jewels, catching fire in turn
  srand(31337);
  for (let i = 0; i < 8; i++) {
    const gx = rng(60, W - 60), gy = rng(groundY + 8, H - 40);
    if (Math.abs(gx - W / 2) < 190 && gy < groundY + TS * 2 + 8) continue;
    ctx.save();
    ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 10 + Math.sin(G.time * 4 + i) * 4;
    ctx.drawImage(T.gem, gx - 12, gy - 12, 24, 24);
    ctx.restore();
    const tgk = Math.sin(G.time * 3 + i * 2.3);
    if (tgk > 0.55) starGlint(gx - 3, gy - 6, 3 + 4 * (tgk - 0.55) / 0.45, (tgk - 0.55) / 0.45);
  }
  // a boulder mid-fall over the pocket, its shadow rushing up to meet it
  const bobY = 445 + ((G.time * 130) % 85);
  const prox = ((G.time * 130) % 90) / 90;
  ctx.fillStyle = `rgba(0,0,0,${0.16 + 0.3 * prox})`;
  ctx.beginPath(); ctx.ellipse(150 + TS * 0.7, groundY + TS * 2 - 4, 14 + 9 * prox, 4.5, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.drawImage(T.boulders[1], 150, bobY - 16, TS * 1.4, TS * 1.4);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(T.boulders[1], 150, bobY - 30, TS * 1.4, TS * 1.4);
  ctx.globalAlpha = 1;
  ctx.drawImage(T.boulders[1], 150, bobY, TS * 1.4, TS * 1.4);
  // Otto, hero-size, headlamp on
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(W / 2 - 20, groundY + 30, 0, W / 2 + 50, groundY + 34, 150);
  lg.addColorStop(0, 'rgba(255,240,180,0.28)'); lg.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = lg;
  ctx.beginPath(); ctx.arc(W / 2 + 40, groundY + 34, 150, 0, 7); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(W / 2, groundY + 108, 34, 8, 0, 0, 7); ctx.fill();
  ctx.drawImage(SPR.walk1, W / 2 - 48, groundY - 16 + Math.sin(G.time * 2.2) * 1.6, 96, 128);
  // dust motes drifting through the lantern pool
  for (let i = 0; i < 6; i++) {
    const mph = i * 1.9;
    const mx = W / 2 + Math.sin(G.time * 0.35 + mph) * (70 + i * 22);
    const my = groundY + 26 - ((G.time * (7 + i * 2.4) + i * 37) % 70);
    ctx.fillStyle = `rgba(255,226,170,${(0.16 + 0.1 * Math.sin(G.time * 2 + mph)).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(mx, my, 1.4 + (i % 3) * 0.5, 0, 7); ctx.fill();
  }
  // lockup band
  const by2 = 120, bh = 290;
  ctx.fillStyle = 'rgba(18,12,6,0.93)';
  ctx.fillRect(0, by2, W, bh);
  ctx.save();
  ctx.shadowColor = 'rgba(255,190,90,0.55)'; ctx.shadowBlur = 9;
  ctx.fillStyle = 'rgba(201,163,92,0.7)';
  ctx.fillRect(0, by2, W, 1.5);
  ctx.fillRect(0, by2 + bh - 1.5, W, 1.5);
  ctx.restore();
  ctx.textAlign = 'center';
  const ly = 246;
  ctx.font = '900 96px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '10px';
  // neon done right: tight halo, then a hot gradient core cooling toward the cave
  ctx.save();
  // engraved gold under lantern light: deep relief, warm halo, hot crown
  ctx.shadowColor = 'rgba(255,176,60,0.55)'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#3a2812'; ctx.fillText('NEON DASH', W / 2, ly + 4);
  ctx.shadowBlur = 0;
  const wm = ctx.createLinearGradient(0, ly - 74, 0, ly + 8);
  wm.addColorStop(0, '#fff3d0'); wm.addColorStop(0.45, '#ffd97a');
  wm.addColorStop(0.75, '#c98d34'); wm.addColorStop(1, '#8a5c22');
  ctx.fillStyle = wm; ctx.fillText('NEON DASH', W / 2, ly);
  ctx.strokeStyle = 'rgba(58,40,18,0.8)'; ctx.lineWidth = 1.5;
  ctx.strokeText('NEON DASH', W / 2, ly);
  ctx.restore();
  ctx.letterSpacing = '5px';
  ctx.font = '600 17px Verdana, sans-serif';
  ctx.fillStyle = '#c8b08a';
  ctx.fillText('A TRIBUTE TO BOULDER DASH', W / 2, ly + 50);
  // the subtitle wears the currency: faceted gems set at each end
  for (const gs of [-1, 1]) {
    ctx.save();
    ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 10;
    ctx.drawImage(T.gem, W / 2 + gs * 296 - 14, ly + 34, 28, 28);
    ctx.restore();
    const wgk = Math.sin(G.time * 2.4 + (gs + 1) * 1.3);
    if (wgk > 0.3) starGlint(W / 2 + gs * 296 - 3, ly + 38, 3.5 + 4 * (wgk - 0.3) / 0.7, (wgk - 0.3) / 0.7);
  }
  const a = (Math.sin(G.time * 4) + 1) / 2 * 0.45 + 0.55;
  ctx.globalAlpha = a;
  ctx.font = '900 24px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = '#f3e7c8';
  ctx.shadowColor = 'rgba(255,200,110,0.8)'; ctx.shadowBlur = 12;
  ctx.fillText(IS_TOUCH ? 'TAP TO START' : 'PRESS SPACE TO START', W / 2, ly + 118);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.font = '600 13px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(10,7,4,0.68)';
  ctx.fillRect(0, 430, W, 64);
  ctx.fillStyle = 'rgba(222,204,172,0.95)';
  ctx.fillText('OTTO RETURNS — DIG THE CAVES, DODGE THE BOULDERS, TAKE EVERY DIAMOND', W / 2, 452);
  ctx.font = '600 11px Verdana, sans-serif';
  ctx.fillStyle = 'rgba(198,180,150,0.8)';
  ctx.fillText(MOVE_HINT, W / 2, 480);
  if (IS_TOUCH && window.innerHeight > window.innerWidth) {
    ctx.fillStyle = '#ffd12a';
    ctx.fillText('BEST IN LANDSCAPE — ROTATE YOUR PHONE', W / 2, ly + 150);
  }
  ctx.letterSpacing = '0px';
  ctx.restore();
  ctx.drawImage(VIGNETTE, 0, 0, W, H);
}

// ---------- input ----------
window.addEventListener('keydown', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!keys[k]) keyEdge[k] = true;
  keys[k] = true;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  audio();
  if (G.showTitle && (e.key === ' ' || e.key === 'Enter')) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); }
  else if ((G.mode === 'over' || G.mode === 'win') && e.key === ' ' && G.modeT > 0.8) newGame((Math.random() * 1e9) >>> 0, false);
});
window.addEventListener('keyup', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = false;
});
function tapStart() {
  audio();
  if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); return; }
  if ((G.mode === 'over' || G.mode === 'win') && G.modeT > 0.8) newGame((Math.random() * 1e9) >>> 0, false);
}
canvas.addEventListener('mousedown', tapStart);
// touch: drag anywhere on the canvas is a virtual joystick — hold to keep
// moving, feeding the same keys the keyboard path reads
const TOUCH_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
let touchId = null, tAnchorX = 0, tAnchorY = 0;
function clearTouchKeys() { for (const k of TOUCH_KEYS) keys[k] = false; }
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  tapStart();
  if (touchId !== null) return;
  const t = e.changedTouches[0];
  touchId = t.identifier; tAnchorX = t.clientX; tAnchorY = t.clientY;
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== touchId) continue;
    const dx = t.clientX - tAnchorX, dy = t.clientY - tAnchorY;
    const DEAD = 14, REACH = 32;
    clearTouchKeys();
    if (Math.abs(dx) >= DEAD || Math.abs(dy) >= DEAD)
      keys[Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'ArrowLeft' : 'ArrowRight') : (dy < 0 ? 'ArrowUp' : 'ArrowDown')] = true;
    // the anchor trails the finger so reversing direction is immediate
    const m = Math.hypot(dx, dy);
    if (m > REACH) { tAnchorX = t.clientX - dx / m * REACH; tAnchorY = t.clientY - dy / m * REACH; }
  }
}, { passive: false });
function touchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === touchId) { touchId = null; clearTouchKeys(); }
}
canvas.addEventListener('touchend', touchEnd, { passive: false });
canvas.addEventListener('touchcancel', touchEnd, { passive: false });

// ---------- main loop ----------
let last = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 1 / 20);
  last = t;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 12) { sim(STEP); acc -= STEP; n++; }
  draw();
}

// ---------- harnesses ----------
function stepFor(s) { const n = Math.round(s / STEP); for (let i = 0; i < n; i++) sim(STEP); }
function stepUntil(cond, cap) { let n = 0; while (!cond() && n < cap) { sim(STEP); n++; } }
function snapCam() {
  G.cam.x = clamp(G.p.x * TS - VW / 2, 0, WORLD_W - VW);
  G.cam.y = clamp(G.p.y * TS - VH / 2, 0, WORLD_H - VH);
}
function teleportP(x, y) {
  G.p.x = x; G.p.y = y; G.p.px = x; G.p.py = y;
  if (G.grid[y][x] !== 'S') G.grid[y][x] = 'P';
}
function runShot(name, f) {
  AUDIO_ON = false;
  newGame(13579, false);
  G.hintT = 0;
  if (name === 'title') {
    G.showTitle = true;
    stepFor(1.8);
  } else if (name === 'cave1') {
    G.hintT = 6;
    stepFor(0.4);
  } else if (name === 'dig') {
    G.bot = true;
    stepFor(2.2);
    G.bot = false;
  } else if (name === 'collect') {
    G.bot = true;
    G.caveTime = 71;
    stepUntil(() => G.diamonds >= 1, 120 * 40);
    stepFor(0.06);
    G.bot = false;
  } else if (name === 'falling') {
    // deterministic physics strip through impact AND settle: identical setup
    // every frame, exactly f pure cell-ticks, no wall-clock drift
    const g = G.grid;
    for (let y = 8; y <= 14; y++) for (let x = 18; x <= 26; x++) g[y][x] = ' ';
    g[14][22] = 'r';                     // resting boulder on the shelf
    g[10][22] = 'r'; G.fall[10][22] = 1; // dropping boulder, 3 cells above
    g[15][21] = 'S'; g[15][22] = 'S'; g[15][23] = 'S';
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(19, 14);
    snapCam();
    G.tickAcc = 0;
    for (let i = 0; i < (f | 0); i++) tick();
  } else if (name === 'anim') {
    // quarter-tick motion strips: &s=fall|enemy|collect|exit, &f=N sub-frames
    const sc = q.get('s') || 'fall';
    if (sc === 'fall') {
      const g = G.grid;
      for (let y = 8; y <= 14; y++) for (let x = 18; x <= 26; x++) g[y][x] = ' ';
      g[14][22] = 'r';
      g[10][22] = 'r'; G.fall[10][22] = 1;
      g[15][21] = 'S'; g[15][22] = 'S'; g[15][23] = 'S';
      G.grid[G.p.y][G.p.x] = ' ';
      teleportP(19, 14);
    } else if (sc === 'enemy') {
      buildCave(1);
      G.grid[G.p.y][G.p.x] = ' ';
      teleportP(16, 7);
    } else if (sc === 'collect') {
      G.bot = true;
      stepUntil(() => G.diamonds >= 1, 120 * 40);
      G.bot = false;
    } else if (sc === 'exit') {
      const [exX2, exY2] = CAVES[0].exit;
      const g2 = G.grid;
      for (let xx = exX2 - 4; xx < exX2; xx++) g2[exY2][xx] = ' ';
      G.grid[G.p.y][G.p.x] = ' ';
      teleportP(exX2 - 4, exY2);
      G.diamonds = G.quota - 1;
      collectGem(exX2 - 2, exY2);
    }
    snapCam();
    G.tickAcc = 0;
    for (let i = 0; i < (f | 0); i++) sim(0.03125);
  } else if (name === 'crushkill') {
    // a boulder crushes a firefly: the 3x3 blast in full
    buildCave(1);
    G.score = 730;
    G.caveTime = 49;
    const e = G.enemies[0];
    const g = G.grid;
    for (let yy = e.y - 3; yy < e.y; yy++) g[yy][e.x] = ' ';
    g[e.y - 3][e.x] = 'r'; G.fall[e.y - 3][e.x] = 1;
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(e.x - 3, e.y);
    snapCam();
    G.tickAcc = 0;
    let n2 = 0;
    while (G.expl.size === 0 && n2++ < 10) tick();
    draw(); document.title = 'shot-ready'; return;
  } else if (name === 'bloom') {
    // butterfly crushed → nine diamonds, two ticks later
    buildCave(2);
    G.score = 1355;
    G.caveTime = 74;
    const e = G.enemies[0];
    const g = G.grid;
    for (let yy = e.y - 3; yy < e.y; yy++) g[yy][e.x] = ' ';
    g[e.y - 3][e.x] = 'r'; G.fall[e.y - 3][e.x] = 1;
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(e.x - 4, e.y);
    snapCam();
    G.tickAcc = 0;
    let n3 = 0;
    while (G.expl.size === 0 && n3++ < 10) tick();
    tick(); // explosion resolves: the diamond grid is born
    stepFor(0.35);
  } else if (name === 'magicwall') {
    // three-frame strip: boulder in → milled → diamond out below
    buildCave(3);
    G.score = 2660;
    G.caveTime = 66;
    const g = G.grid;
    for (let yy = 11; yy <= 15; yy++) for (let xx = 29; xx <= 31; xx++) g[yy][xx] = ' ';
    g[12][30] = 'r'; G.fall[12][30] = 1;
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(27, 15);
    snapCam();
    G.tickAcc = 0;
    for (let i = 0; i < (f | 0); i++) tick();
  } else if (name === 'vaultfarm') {
    // the farm loop: released battery boulder drops through the roof hole onto a butterfly
    buildCave(2);
    G.score = 1420;
    G.caveTime = 70;
    const g = G.grid;
    const e = G.enemies[0];
    e.x = 21; e.y = 9;                    // butterfly under the roof hole
    g[9][21] = 'b';
    g[7][21] = ' ';                       // the dirt under the battery has been dug
    G.fall[6][21] = 1;
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(18, 7);
    snapCam();
    G.tickAcc = 0;
    let n4 = 0;
    while (G.expl.size === 0 && n4++ < 12) tick();
    tick();
    stepFor(0.3);
  } else if (name === 'timelow') {
    G.bot = true;
    G.score = 260;
    G.caveTime = 12;
    stepFor(1.1);
    G.bot = false;
  } else if (name === 'push') {
    const g = G.grid;
    for (let x = 2; x <= 8; x++) g[3][x] = ' ';
    g[3][4] = 'r';
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(3, 3); G.p.dir = 1; G.p.pushT = 1;
    snapCam();
    keys.d = true;
    stepFor(0.28);
    keys.d = false;
  } else if (name === 'firefly') {
    buildCave(1);
    G.grid[G.p.y][G.p.x] = ' ';
    G.p.x = 13; G.p.y = 9; G.grid[9][13] = 'P';
    snapCam();
    stepFor(1.1);
  } else if (name === 'vault') {
    buildCave(2);
    G.score = 1240;
    G.caveTime = 80;
    stepFor(1.2);
  } else if (name === 'maze') {
    buildCave(3);
    G.score = 2660;
    G.caveTime = 61;
    stepFor(0.9);
  } else if (name === 'crush') {
    // the shot named after the threat: boulders caught mid-fall beside Otto
    buildCave(4);
    G.score = 4105;
    G.caveTime = 73;
    const g = G.grid;
    for (let yy = 4; yy <= 12; yy++) for (let xx = 19; xx <= 24; xx++) if (g[yy][xx] !== 'S') g[yy][xx] = ' ';
    g[13][20] = '.'; g[13][22] = '.';
    g[6][20] = 'r'; G.fall[6][20] = 1;
    g[8][22] = 'r'; G.fall[8][22] = 1;
    g[12][24] = 'r';                       // about-to-fall wobbler
    g[13][24] = '.';
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(20, 13);
    snapCam();
  } else if (name === 'explosion') {
    buildCave(2);
    G.score = 1355;
    // drop a boulder onto a butterfly: diamonds bloom
    const e = G.enemies[0];
    const g = G.grid;
    g[e.y - 2][e.x] = 'r'; G.fall[e.y - 2][e.x] = 1;
    g[e.y - 1][e.x] = ' ';
    G.grid[G.p.y][G.p.x] = ' ';
    teleportP(e.x - 4, e.y);
    snapCam();
    stepUntil(() => G.expl.size > 0 || G.parts.length > 6, 120 * 4);
    stepFor(0.1);
  } else if (name === 'exitopen') {
    G.score = 320;
    G.caveTime = 44;
    G.diamonds = G.quota - 1;
    const spec = CAVES[0];
    // teleport next to the exit and collect the last gem
    const g = G.grid;
    const [ex, ey] = spec.exit;
    G.grid[G.p.y][G.p.x] = ' ';
    G.p.x = ex - 3; G.p.y = ey; g[ey][ex - 3] = 'P';
    g[ey][ex - 2] = 'd';
    snapCam();
    keys.d = true;
    stepUntil(() => G.exitOpen, 120 * 6);
    keys.d = false;
    stepFor(0.4);
  } else if (name === 'clear') {
    G.score = 480;
    G.caveTime = 52.4;
    G.diamonds = G.quota;
    G.exitOpen = true;
    caveClear();
    stepFor(0.15);
  } else if (name === 'death') {
    G.score = 205;
    G.caveTime = 58;
    const g = G.grid;
    g[G.p.y - 2][G.p.x] = 'r'; G.fall[G.p.y - 2][G.p.x] = 1;
    g[G.p.y - 1][G.p.x] = ' ';
    snapCam();
    stepUntil(() => !G.p.alive, 120 * 4);
    stepFor(0.2);
  } else if (name === 'deathbanner') {
    G.score = 205;
    G.caveTime = 58;
    const g = G.grid;
    g[G.p.y - 2][G.p.x] = 'r'; G.fall[G.p.y - 2][G.p.x] = 1;
    g[G.p.y - 1][G.p.x] = ' ';
    snapCam();
    stepUntil(() => G.mode === 'respawn', 120 * 6);
    stepFor(0.2);
  } else {
    stepFor(1);
  }
  draw();
  document.title = 'shot-ready';
}
let G0_MODE = 'careful';
function runAutoplay(caveIdx, budget) {
  AUDIO_ON = false;
  newGame(13579, false);
  if (caveIdx > 0) buildCave(caveIdx);
  G.bot = true;
  G.botMode = G0_MODE;
  let simTime = 0;
  const targetCave = G.cave;
  while (simTime < budget && G.mode !== 'over' && G.mode !== 'win' && G.cave === targetCave && !(G.mode === 'clear')) {
    sim(STEP);
    simTime += STEP;
    if ((G.botStuck || 0) > 40) break;
  }
  const cleared = G.mode === 'clear' || G.mode === 'win' || G.cave !== targetCave;
  const report = {
    mode: G0_MODE,
    cave: targetCave + 1,
    outcome: cleared ? 'CLEARED' : G.mode === 'over' ? 'DIED_OUT' : (G.botStuck || 0) > 40 ? 'STUCK' : 'TIMEOUT',
    diamonds: G.diamonds, quota: G.quota,
    deaths: G.deaths, timeLeft: Math.max(0, G.caveTime) | 0,
    score: G.score,
  };
  document.title = 'AUTOPLAY:' + JSON.stringify(report);
  const el = document.createElement('pre');
  el.id = 'autoplay-report';
  el.textContent = document.title;
  document.body.appendChild(el);
  draw();
}

const q = new URLSearchParams(location.search);
const shotName = q.get('shot');
const autoCave = q.get('autoplay');
if (shotName) runShot(shotName, Number(q.get('f') || 0));
else if (autoCave !== null) { G0_MODE = q.get('mode') || 'careful'; runAutoplay(Number(autoCave || 0), Number(q.get('budget') || 240)); }
else { newGame(24680, true); requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); }
