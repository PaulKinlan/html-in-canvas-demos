import { mount, put, place, park, fresh, ease } from './kit.js';

export default function start() {
  const canvas = document.getElementById('puzzleCanvas');
  const frame = document.getElementById('puzzleFrame');
  const out = document.getElementById('puzzleOut');
  const N = 3, T = 108, S = N * T;      // the iframe is 324 px square and a tile is 108 px
  const GAP = N * N - 1;                // the tile that is left out until the puzzle is solved

  // cellOf[tile] is the cell a tile is in. The gap is a tile like the others, only not drawn.
  let cellOf = [...Array(N * N).keys()];
  const xy = (cell) => ({ x: (cell % N) * T, y: Math.floor(cell / N) * T });
  const at = cellOf.map((c) => xy(c));  // where each tile is drawn now, eased towards its cell
  const solved = () => cellOf.every((c, i) => c === i);
  let active = -1, moves = 0, forwarded = 0, inFrame = 0, last = 0, join = 1, k = 1, ox = 0, oy = 0;

  // One transparent element for each cell. A shield takes the pointer on every cell but the active one.
  const shields = cellOf.map((cell) => {
    const s = document.createElement('div');
    s.className = 'shield'; s.setAttribute('drawable', ''); s.setAttribute('aria-hidden', 'true'); s.dataset.cell = cell;
    canvas.append(s);
    return s;
  });

  const line = () => {
    out.textContent = `${solved() ? 'Solved: the page is whole and every part of it takes input.' : `Tile ${active < 0 ? 'none' : active + 1} takes input.`} ` +
      `Moves: ${moves}. Clicks that went into the frame itself: ${inFrame}. Taps the page passed on to the frame: ${forwarded}.`;
  };

  // #region puzzle-draw
  // Each tile is the whole iframe drawn through a clip of one square, moved so that the tile's part of
  // the frame lands in the tile's place. Nine draws of one element: only the last one says where input goes.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    k = Math.min(1, w / S, h / S); ox = (w - S * k) / 2; oy = (h - S * k) / 2;
    ctx.translate(ox, oy); ctx.scale(k, k);
    const done = solved();
    join = ease(join, done ? 1 : 0, dt, 8);
    let moving = Math.abs(join - (done ? 1 : 0)) > 0.01;
    const inset = 3 * (1 - join);
    for (let tile = 0; tile < N * N; tile++) {
      const to = xy(cellOf[tile]), p = at[tile];
      p.x = ease(p.x, to.x, dt, 18); p.y = ease(p.y, to.y, dt, 18);
      if (Math.abs(p.x - to.x) + Math.abs(p.y - to.y) > 0.3) moving = true; else { p.x = to.x; p.y = to.y; }
      if (tile === GAP && join < 0.02) continue;
      const src = xy(tile);
      ctx.save();
      ctx.globalAlpha = tile === GAP ? join : 1;
      ctx.beginPath(); ctx.roundRect(p.x + inset, p.y + inset, T - inset * 2, T - inset * 2, 7 * (1 - join)); ctx.clip();
      put(ctx, frame, p.x - src.x, p.y - src.y, S, S);
      if (tile === active && !done) { ctx.strokeStyle = 'rgb(255 209 102 / 0.95)'; ctx.lineWidth = 6; ctx.stroke(); }
      ctx.restore();
    }
    // #endregion puzzle-draw
    // #region puzzle-input
    // Where input goes. The iframe has one hit region, the size of the whole frame. It is placed so
    // that the active tile's part of the frame is under the active tile. The shields are placed after
    // it, and the element placed last is on top, so the rest of the frame's region is covered.
    if (done) {
      place(ctx, frame, 0, 0);
      for (const s of shields) park(canvas, s);
    } else {
      const a = active >= 0 ? active : 0, src = xy(a);
      if (active >= 0) place(ctx, frame, at[a].x - src.x, at[a].y - src.y); else park(canvas, frame);
      for (const s of shields) {
        const cell = Number(s.dataset.cell);
        if (active >= 0 && cellOf[active] === cell) park(canvas, s); else { const c = xy(cell); place(ctx, s, c.x, c.y); }
      }
    }
    return moving;
  });
  // #endregion puzzle-input

  // After a lost context the frame is shown as a plain iframe, and the shields are not needed.
  const unshield = () => shields.forEach((s) => s.remove());
  if (stage.plain) { unshield(); return { stage }; }
  addEventListener('play-plain', unshield);

  const tileIn = (cell) => cellOf.indexOf(cell);
  const activate = (tile) => {
    if (tile === active || tile === GAP || tile < 0) return;
    active = tile;
    stage.now();                         // move the hit regions in this task, before the browser resolves the tap
    fresh(frame, ...shields);
    line();
  };
  // Slide a tile into the gap if it is next to it.
  const slide = (tile) => {
    const a = cellOf[tile], g = cellOf[GAP];
    const near = Math.abs((a % N) - (g % N)) + Math.abs(Math.floor(a / N) - Math.floor(g / N)) === 1;
    if (!near || solved()) return false;
    cellOf[tile] = g; cellOf[GAP] = a;
    moves++;
    stage.request(); fresh(frame, ...shields); line();
    return true;
  };

  // #region puzzle-tap
  // A tap on a link, a button or a field of the frame is the frame's. A tap on anything else slides the tile.
  const CONTROL = 'a, button, input, select, textarea, label, summary';
  // Mouse: the tile under the pointer becomes the active one before any button is pressed, so the
  // press goes into the frame itself. This listener is on the frame's own document.
  const wire = () => {
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc || doc.puzzleWired) return;
    doc.puzzleWired = true;
    doc.addEventListener('click', (e) => {
      if (solved() || !e.isTrusted) return;
      clearTimeout(passOn);              // the browser delivered this tap itself
      inFrame++;
      if (!e.target.closest?.(CONTROL)) slide(Math.floor(e.clientY / T) * N + Math.floor(e.clientX / T));
      line();
    });
    stage.request();
  };
  frame.addEventListener('load', wire);
  wire();

  // Touch: there is no hover, so the first touch on a tile lands on its shield. The shield makes the
  // tile active in pointerdown. If the touch ends as a tap, the page finds what is at that point of the
  // frame with the frame document's elementFromPoint() and clicks it, or slides the tile.
  // In the test browser the tap that made a tile active was then delivered to the frame by the browser as
  // well. So the page waits 120 ms for the frame's own click before it passes the tap on.
  let down = null, passOn = 0;
  for (const s of shields) {
    s.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) activate(tileIn(Number(s.dataset.cell))); });
    s.addEventListener('pointerdown', (e) => {
      const tile = tileIn(Number(s.dataset.cell));
      down = { id: e.pointerId, tile, x: e.clientX, y: e.clientY };
      s.setPointerCapture(e.pointerId);
      activate(tile);
    });
    s.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const { tile, x, y } = down;
      down = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) > 10 || tile === GAP) return;
      // The point in the frame's own coordinates: undo the canvas layout, then the tile's move.
      const r = canvas.getBoundingClientRect(), src = xy(tile);
      const fx = (x - r.left - ox) / k - at[tile].x + src.x, fy = (y - r.top - oy) / k - at[tile].y + src.y;
      clearTimeout(passOn);
      passOn = setTimeout(() => {
        const hit = frame.contentDocument?.elementFromPoint(fx, fy)?.closest(CONTROL);
        forwarded++;
        if (!hit) slide(tile);
        else { if (hit.matches('input:not([type=checkbox]), textarea')) hit.focus({ preventScroll: true }); hit.click(); }
        line();
      }, 120);
    });
    s.addEventListener('pointercancel', () => { down = null; });
  }
  // #endregion puzzle-tap

  const shuffle = (n = 40) => {
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const g = cellOf[GAP], gx = g % N, gy = Math.floor(g / N);
      const options = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].filter(([x, y]) => x >= 0 && x < N && y >= 0 && y < N).map(([x, y]) => y * N + x).filter((c) => c !== prev);
      const c = options[Math.floor(Math.random() * options.length)];
      cellOf[tileIn(c)] = g; cellOf[GAP] = c; prev = g;
    }
    if (solved()) return shuffle(n);
    moves = 0; active = -1;
    stage.request(); fresh(frame, ...shields); line();
  };
  document.getElementById('puzzleShuffle').addEventListener('click', () => shuffle());
  document.getElementById('puzzleSolve').addEventListener('click', () => { cellOf = [...Array(N * N).keys()]; active = -1; stage.request(); fresh(frame, ...shields); line(); });
  shuffle(12);
  return { stage, state: () => ({ cellOf: [...cellOf], active, moves, solved: solved() }) };
}
