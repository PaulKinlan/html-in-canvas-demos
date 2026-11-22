// belt.js: an endless list as a conveyor belt. A small pool of real elements is reused for whichever
// rows are on the belt, and the canvas draws them curved round a roller at each end.
import { mount, put, park, colors, clamp } from '/form-state/kit.js';

export const PITCH = 76;        // belt length one row takes, with the gap after it
export const ROW_W = 320, ROW_H = 64;
const R = 62;                   // radius of both rollers
const ARC = (Math.PI / 2) * R;  // belt length from the flat face to the crest of a roller
const EYE = 420;                // distance of the viewer, for the narrowing round a roller

// #region map
// Where a point of the belt is on the screen. s is the distance along the belt from the top of the
// flat face (0) to its bottom (flat). Past either end the belt turns round a roller: the screen
// position follows the sine of the angle, so a row gets shorter and shorter until it goes over the
// crest, and it moves away from the viewer by R * (1 - cos).
export function mapBelt(s, top, flat) {
  if (s < 0) { const a = Math.min(Math.PI / 2, -s / R); return { y: top - R * Math.sin(a), z: R * (1 - Math.cos(a)), a }; }
  if (s > flat) { const a = Math.min(Math.PI / 2, (s - flat) / R); return { y: top + flat + R * Math.sin(a), z: R * (1 - Math.cos(a)), a }; }
  return { y: top + s, z: 0, a: 0 };
}
// #endregion map

const mod = (n, m) => ((n % m) + m) % m;

export function createBelt(canvas, { fill, onChange } = {}) {
  const rows = [...canvas.querySelectorAll('[data-row]')], P = rows.length;
  const held = new Array(P).fill(null);        // which index of the list each pool element shows
  const dirty = new Set(rows);                 // rows whose picture in the atlas is out of date
  // #region atlas
  // The atlas is a plain 2D canvas with one slot for each pool element. A row is drawn into the
  // drawable canvas with drawElementImage() only when its picture changed. That drawing is copied to
  // the row's slot with drawImage() and wiped. Every frame of movement is then drawn from the atlas,
  // in slices, with no element draw at all.
  const atlas = document.createElement('canvas'), actx = atlas.getContext('2d');
  let dpr = 0;
  function refresh(ctx, w, changed) {
    const now = canvas.width / canvas.clientWidth || 1;
    if (now !== dpr) { dpr = now; atlas.width = Math.ceil(ROW_W * dpr); atlas.height = Math.ceil(ROW_H * dpr) * P; rows.forEach((r) => dirty.add(r)); }
    for (const el of changed ?? []) if (el.dataset?.row !== undefined) dirty.add(el);
    const sh = Math.ceil(ROW_H * dpr), sw = Math.ceil(ROW_W * dpr);
    for (const row of dirty) {
      ctx.clearRect(0, 0, ROW_W + 2, ROW_H + 2);
      if (!put(ctx, row, 0, 0)) continue;       // no picture yet: it stays dirty and the kit asks for another frame
      const j = rows.indexOf(row);
      actx.clearRect(0, j * sh, sw, sh);
      actx.drawImage(canvas, 0, 0, sw, sh, 0, j * sh, sw, sh);
      dirty.delete(row); state.copies++;
    }
    ctx.clearRect(0, 0, w, ROW_H + 4);
  }
  // #endregion atlas

  const state = { scroll: 0, speed: 0, motor: 0, copies: 0, frames: 0, first: 0, onBelt: 0, target: null };
  let last = 0, dragging = false;

  // #region pool
  // Which rows of the endless list are on the belt, and which pool element shows each. Row i uses
  // element i mod P, so an element changes its content only after its old row has gone over the top
  // roller (or under the bottom one), where nobody sees it change.
  function assign(first, count) {
    for (let i = first; i < first + count; i++) {
      const j = mod(i, P);
      if (held[j] === i) continue;
      held[j] = i;
      if (rows[j].contains(document.activeElement)) document.activeElement.blur();
      fill(rows[j], i);
      dirty.add(rows[j]);
    }
  }
  // #endregion pool

  const stage = mount(canvas, (ctx, w, h, t, event) => {
    const c = colors(canvas), dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    // Movement: the motor, a flick that slows down, or an eased run to a row.
    if (state.target !== null) {
      const d = state.target - state.scroll;
      if (Math.abs(d) < 0.5) { state.scroll = state.target; state.target = null; state.speed = 0; }
      else state.scroll += d * Math.min(1, dt * 5) + Math.sign(d) * Math.min(Math.abs(d), 40 * dt);
    } else if (!dragging) {
      state.scroll += (state.speed + state.motor) * dt;
      state.speed *= Math.exp(-dt * 2.2); if (Math.abs(state.speed) < 4) state.speed = 0;
    }
    const k = Math.min(1, (w - 64) / ROW_W), top = 18 + R, flat = h - 2 * (18 + R), x0 = (w - ROW_W * k) / 2;
    // The rows on the belt: every row any part of which is between the two crests.
    const sTop = -ARC, sBot = flat + ARC;
    const first = Math.floor((state.scroll + sTop) / PITCH), count = Math.ceil((sBot - sTop) / PITCH) + 1;
    assign(first, Math.min(count, P));
    refresh(ctx, w, event?.changedElements);
    state.first = first; state.frames++;

    // #region draw
    const sh = Math.ceil(ROW_H * dpr), sw = Math.ceil(ROW_W * dpr);
    const slice = (s0, s1, paint) => {
      const a = mapBelt(s0, top, flat), b = mapBelt(s1, top, flat);
      if (b.y - a.y < 0.05) return;
      const z = (a.z + b.z) / 2, kx = EYE / (EYE + z), dark = 0.78 * (1 - Math.cos((a.a + b.a) / 2));
      paint(a.y, b.y - a.y, kx, dark);
    };
    // The rubber of the belt, a little wider than the rows, with a seam between rows.
    const bw = ROW_W * k + 28;
    for (let s = sTop; s < sBot; s += 4) slice(s, s + 4, (y, hh, kx, dark) => {
      const seam = mod(s + state.scroll + 2, PITCH) < 4;
      const v = Math.round((seam ? 22 : 44) * (1 - dark));
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`; ctx.fillRect(w / 2 - bw * kx / 2, y, bw * kx, hh + 0.6);
    });
    let onBelt = 0;
    for (let i = first; i < first + Math.min(count, P); i++) {
      const j = mod(i, P), row = rows[j], s0 = i * PITCH - state.scroll + (PITCH - ROW_H) / 2, s1 = s0 + ROW_H;
      if (s1 <= sTop || s0 >= sBot || dirty.has(row)) { park(canvas, row); continue; }
      onBelt++;
      // The part on the flat face is one drawImage(). The parts on a roller are slices 3 px of belt long.
      const cuts = [];
      for (let s = s0; s < s1;) {
        const e = s < 0 ? Math.min(s1, 0, s + 3) : s < flat ? Math.min(s1, flat) : Math.min(s1, s + 3);
        cuts.push([s, e]); s = e;
      }
      for (const [a, b] of cuts) slice(Math.max(a, sTop), Math.min(b, sBot), (y, hh, kx, dark) => {
        const wpx = ROW_W * k * kx;
        ctx.drawImage(atlas, 0, j * sh + (Math.max(a, sTop) - s0) * dpr, sw, Math.max(0.5, (Math.min(b, sBot) - Math.max(a, sTop)) * dpr), w / 2 - wpx / 2, y, wpx, hh + 0.5);
        if (dark > 0.01) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(w / 2 - wpx / 2, y, wpx, hh + 0.5); }
      });
      // The hit box goes where the row would be on a flat belt. No draw is needed to move it. A row
      // that is mostly round a roller takes no input.
      const ya = mapBelt(Math.max(s0, sTop), top, flat).y, yb = mapBelt(Math.min(s1, sBot), top, flat).y;
      if (yb - ya < ROW_H * k * 0.45) park(canvas, row);
      else try { canvas.updateElementGeometry(row, { canvasTransform: new DOMMatrix().translate(x0, top + s0).scale(k, k) }); } catch {}
    }
    for (let j = 0; j < P; j++) if (held[j] === null || held[j] < first || held[j] >= first + count) park(canvas, rows[j]);
    state.onBelt = onBelt;
    // #endregion draw

    // The two rollers: an axle end on each side, with marks that turn with the belt.
    const turn = state.scroll / R;
    for (const cy of [top, top + flat]) for (const side of [-1, 1]) {
      const ax = w / 2 + side * (bw / 2 + 2), aw = Math.min(26, (w - bw) / 2 - 2);
      const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
      g.addColorStop(0, '#3f3f46'); g.addColorStop(0.35, '#d4d4d8'); g.addColorStop(0.6, '#a1a1aa'); g.addColorStop(1, '#27272a');
      ctx.fillStyle = g; ctx.fillRect(side < 0 ? ax - aw : ax, cy - R + 5, aw, 2 * R - 10);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      for (let n = 0; n < 6; n++) {
        const a = turn * (cy === top ? 1 : 1) + n * Math.PI / 3, vis = Math.cos(a);
        if (vis <= 0) continue;
        const y = cy - (R - 5) * Math.sin(a);
        ctx.fillRect(side < 0 ? ax - aw : ax, y - 1.5 * vis, aw, 3 * vis);
      }
    }
    // A shadow where the belt leaves each roller, and the frame.
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(w / 2 - bw / 2 - 30.5, top - R - 6.5, bw + 61, flat + 2 * R + 13);
    onChange?.(state);
    return dragging || state.speed !== 0 || state.motor !== 0 || state.target !== null || dirty.size > 0;
  });

  // #region input
  // A drag moves the belt and a flick keeps it moving. A press that does not move is left alone, so it
  // is a tap on whatever real element is under it. After a drag the click that would follow is dropped.
  let down = null, moved = 0, lastY = 0, lastT = 0, vel = 0;
  canvas.addEventListener('pointerdown', (e) => { if (e.button) return; down = e.pointerId; moved = 0; lastY = e.clientY; lastT = e.timeStamp; vel = 0; state.target = null; state.speed = 0; stage.request(); });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== down) return;
    const dy = e.clientY - lastY, dtm = Math.max(1, e.timeStamp - lastT);
    moved += Math.abs(dy);
    if (!dragging && moved > 6) { dragging = true; try { canvas.setPointerCapture(e.pointerId); } catch {} }
    if (dragging) { state.scroll -= dy; vel = 0.7 * vel + 0.3 * (-dy / dtm * 1000); stage.request(); }
    lastY = e.clientY; lastT = e.timeStamp;
  });
  const up = (e) => {
    if (e.pointerId !== down) return;
    down = null;
    if (dragging) { dragging = false; state.speed = e.timeStamp - lastT < 80 ? clamp(vel, -4000, 4000) : 0; stage.request(); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('click', (e) => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.target = null; state.scroll += e.deltaY; stage.request(); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 4, PageUp: -4 }[e.key];
    if (!step || e.target.matches?.('input[type=text], input[type=number], textarea')) return;
    e.preventDefault(); api.by(step);
  });
  // #endregion input

  const api = {
    stage, state, rows, held,
    request: () => stage.request(),
    // Bring row i to the top of the flat face.
    // A long way is not travelled row by row: the belt starts twelve rows short and runs the rest.
    to(i, now = false) {
      const s = i * PITCH - 4, far = 12 * PITCH;
      if (now) { state.scroll = s; state.target = null; }
      else { if (Math.abs(s - state.scroll) > far) state.scroll = s - Math.sign(s - state.scroll) * far; state.target = s; }
      state.speed = 0; stage.request();
    },
    by(n) { api.to(Math.round(((state.target ?? state.scroll) + 4) / PITCH) + n); },
    motor(v) { state.motor = v; last = 0; stage.request(); },
    touch(row) { dirty.add(row); stage.request(); },
  };
  return api;
}
