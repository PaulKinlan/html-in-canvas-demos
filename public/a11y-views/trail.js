// A focus ring drawn by the canvas that travels from the element that lost focus to the
// element that gained it. The canvas hears about focus from `focusin`, takes both positions
// from getBoundingClientRect() (which reports where an element was last drawn) and draws the
// ring, a tail behind it and, optionally, a shade over everything else.
import { inCanvas } from '/lib/devtools/stage.js';
import { clamp, lerp } from '/lib/stage-2d.js';

const INK = { ring: '#2f6bff', halo: '#ffffff', tail: '#ff9f1a', core: '#fff3d6', shade: '8, 10, 20' };
const AFTER = 900;   // ms the path stays visible after the ring arrives
const LIFT = 360;    // ms the focused element is drawn enlarged after the ring arrives
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mid = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t) });

// #region trail-listen
/**
 * Listen for focus moving inside `canvas`. `request()` asks the page for a frame.
 * Returns { state, draw }. Call draw() last in the frame, in CSS pixels.
 */
export function createTrail(canvas, { request, reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  const state = { active: null, fromEl: null, fromRect: null, t0: 0, moves: 0, shade: 0, shadeAt: 0, hole: null, geometry: null };
  const rectOf = (el) => inCanvas(canvas, el.getBoundingClientRect());

  canvas.addEventListener('focusin', (e) => {
    const prev = e.relatedTarget;                       // the element that lost focus, or null
    state.fromEl = prev && canvas.contains(prev) ? prev : null;
    // Focus that arrives from outside the canvas starts at the nearest point on the canvas edge.
    state.fromRect = !prev ? null : state.fromEl ? rectOf(prev) : onEdge(canvas, rectOf(prev));
    state.active = e.target;
    state.t0 = performance.now();
    state.moves++;
    request();
  });
  canvas.addEventListener('focusout', (e) => {
    if (e.relatedTarget && canvas.contains(e.relatedTarget)) return; // focus stays inside: focusin follows
    state.active = null;
    state.t0 = performance.now();
    request();
  });
  // #endregion trail-listen

  // #region trail-draw
  /** Draw the ring and its trail. Returns true while something is still moving. */
  function draw(ctx, W, H, now, { comet = true, spotlight = true, lift = null } = {}) {
    const el = state.active?.isConnected ? state.active : null;
    const still = reduced();
    // The shade fades in when focus enters the canvas and out when it leaves.
    const target = el && spotlight ? 1 : 0;
    const dt = Math.min(64, now - (state.shadeAt || now));
    state.shadeAt = now;
    state.shade = still ? target : clamp(state.shade + Math.sign(target - state.shade) * dt / 220);
    if (!el) {
      if (state.shade > 0 && state.hole) shade(ctx, W, H, state.hole, state.shade);
      state.geometry = null;
      return state.shade > 0;
    }
    const to = rectOf(el);
    const from = state.fromEl?.isConnected ? rectOf(state.fromEl) : state.fromRect;
    const a = from && mid(from), b = mid(to);
    const dist = from ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    const flight = from && !still ? clamp(160 + dist * 0.9, 220, 560) : 0;   // ms, longer for a longer move
    const age = now - state.t0;
    const t = flight ? clamp(age / flight) : 1;
    const p = ease(t);
    const ring = from && t < 1 ? mix(from, to, p) : to;
    state.hole = ring;
    state.geometry = { from, to, distance: dist, flight };

    if (state.shade > 0) shade(ctx, W, H, ring, state.shade);
    const since = age - flight;                     // ms since the ring arrived
    if (lift && !still && since >= 0 && since < LIFT) lift(ctx, el, to, 1 + 0.12 * Math.sin(Math.PI * since / LIFT));
    if (from && comet && dist > 4) {
      if (still) arrow(ctx, a, b);                  // reduced motion: a line with an arrow head, no animation
      else tail(ctx, a, b, dist, p, since);
    }
    const pulse = !still && since >= 0 && since < 420 ? since / 420 : null;
    drawRing(ctx, ring, pulse);
    return t < 1 || (!still && since < AFTER) || state.shade !== target;
  }
  // #endregion trail-draw

  return { state, draw, rectOf };
}

/** A flat rectangle on the edge of the canvas nearest to `r`, a rectangle outside it. */
function onEdge(canvas, r) {
  const W = canvas.clientWidth, H = canvas.clientHeight, c = mid(r);
  const x = clamp(c.x, 12, W - 12), y = clamp(c.y, 0, H);
  return { x: x - 12, y: y - 2, width: 24, height: 4 };
}

// #region trail-shapes
function shade(ctx, W, H, hole, strength) {
  ctx.save();
  ctx.fillStyle = `rgba(${INK.shade}, ${0.5 * strength})`;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.roundRect(hole.x - 8, hole.y - 8, hole.width + 16, hole.height + 16, 10);
  ctx.fill('evenodd');                              // everything except the hole
  ctx.restore();
}

// The path is a quadratic curve that bows to one side, so that a move along a row of
// controls does not hide behind them.
function curve(a, b, dist) {
  const bow = Math.min(54, dist * 0.22), nx = -(b.y - a.y) / dist, ny = (b.x - a.x) / dist;
  const c = { x: (a.x + b.x) / 2 + nx * bow, y: (a.y + b.y) / 2 + ny * bow };
  return (u) => ({ x: (1 - u) ** 2 * a.x + 2 * (1 - u) * u * c.x + u * u * b.x, y: (1 - u) ** 2 * a.y + 2 * (1 - u) * u * c.y + u * u * b.y });
}

function tail(ctx, a, b, dist, p, since) {
  const at = curve(a, b, dist);
  ctx.save();
  ctx.lineCap = 'round';
  if (since > 0) {
    // After arrival: the whole path, thin, fading out.
    ctx.globalAlpha = 0.55 * (1 - since / AFTER) ** 2;
    ctx.strokeStyle = INK.tail;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const q = at(i / 24); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // In flight, and for 180 ms after: a tail that is wide and bright at the head.
  const start = since > 0 ? lerp(Math.max(0, 1 - 0.5), 1, clamp(since / 180)) : Math.max(0, p - 0.5);
  const N = 22;
  ctx.strokeStyle = INK.tail;
  for (let i = 0; i < N && start < p; i++) {
    const u0 = lerp(start, p, i / N), u1 = lerp(start, p, (i + 1) / N), q0 = at(u0), q1 = at(u1), k = (i + 1) / N;
    ctx.globalAlpha = 0.9 * k * k;
    ctx.lineWidth = 1 + 8 * k;
    ctx.beginPath();
    ctx.moveTo(q0.x, q0.y);
    ctx.lineTo(q1.x, q1.y);
    ctx.stroke();
  }
  if (since <= 0) {
    const head = at(p);
    ctx.globalAlpha = 1;
    ctx.shadowColor = INK.tail;
    ctx.shadowBlur = 14;
    ctx.fillStyle = INK.core;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function arrow(ctx, a, b) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = INK.tail;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  ctx.beginPath();
  ctx.moveTo(m.x + Math.cos(angle) * 9, m.y + Math.sin(angle) * 9);
  ctx.lineTo(m.x + Math.cos(angle + 2.5) * 9, m.y + Math.sin(angle + 2.5) * 9);
  ctx.lineTo(m.x + Math.cos(angle - 2.5) * 9, m.y + Math.sin(angle - 2.5) * 9);
  ctx.fill();
  ctx.restore();
}

// Two colours, so the ring shows on a light element and on the dark stage.
function drawRing(ctx, r, pulse) {
  ctx.save();
  if (pulse != null) {
    const grow = 14 * pulse;
    ctx.globalAlpha = 0.7 * (1 - pulse);
    ctx.strokeStyle = INK.tail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(r.x - 4 - grow, r.y - 4 - grow, r.width + 8 + grow * 2, r.height + 8 + grow * 2, 8 + grow);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.roundRect(r.x - 4, r.y - 4, r.width + 8, r.height + 8, 7);
  ctx.strokeStyle = INK.halo;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = INK.ring;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}
// #endregion trail-shapes
