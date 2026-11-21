import { mount, put, park, snapshot, onPoint, colors, lerp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('cabinetCanvas');
  const drawers = [...canvas.querySelectorAll('details')];
  const out = document.getElementById('cabinetOut');
  const state = new Map(drawers.map((d) => [d, { pull: d.open ? 1 : 0, snap: null, fullH: 0 }]));
  const GAP = 8, TOP = 14, STRIPS = 10, SQUASH = 0.7, GROW = 0.16;

  // Where the open drawer's two parts are drawn, and which of them the pointer was last on.
  let parts = null, mode = 'front', last = 0;

  // #region cabinet
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const W = drawers[0].offsetWidth, SUM = drawers[0].querySelector('summary').offsetHeight;
    const k = Math.min(1, (w - 64) / W);
    const base = new DOMMatrix().translate(w / 2, TOP).scale(k);
    ctx.translate(w / 2, TOP); ctx.scale(k, k);
    const slot = (i) => GAP + i * (SUM + GAP);

    // The carcass.
    ctx.fillStyle = '#5b4632';
    ctx.beginPath(); ctx.roundRect(-W / 2 - 12, 0, W + 24, slot(drawers.length), 8); ctx.fill();
    ctx.fillStyle = '#0006';
    drawers.forEach((d, i) => ctx.fillRect(-W / 2, slot(i), W, SUM));

    let moving = false;
    parts = null;
    drawers.forEach((d, i) => {
      const s = state.get(d), target = d.open ? 1 : 0;
      s.pull += (target - s.pull) * (1 - Math.exp(-dt * 9));
      if (Math.abs(target - s.pull) < 0.004) s.pull = target; else moving = true;
      // Open and at rest: keep a picture. After the drawer closes, the body can only be drawn from it.
      if (d.open && s.pull === 1) { s.fullH = d.offsetHeight; s.snap?.close?.(); s.snap = snapshot(canvas, d); }
    });

    // Closed drawers are one flat draw of the <details>, which is only its summary. Then the ones that
    // are out, the furthest out last.
    const order = drawers.map((d, i) => ({ d, i, s: state.get(d) })).sort((p, q) => p.s.pull - q.s.pull);
    for (const { d, i, s } of order) {
      const y = slot(i);
      if (s.pull === 0) { put(ctx, d, -W / 2, y); continue; }
      const picture = d.open ? d : s.snap;                    // opening: live. Closing: the snapshot.
      const fullH = d.open ? d.offsetHeight : s.fullH, BODY = fullH - SUM;
      const deep = BODY * SQUASH * s.pull, grow = 1 + GROW * s.pull;
      // The inside of the drawer, seen from above: rows of the body, wider towards the reader.
      if (picture && BODY > 0) for (let j = 0; j < STRIPS; j++) {
        const f = (j + 0.5) / STRIPS;
        ctx.save();
        ctx.translate(0, y + deep * j / STRIPS);
        ctx.scale(lerp(1, grow, f), deep / BODY);
        ctx.translate(-W / 2, -(SUM + BODY * j / STRIPS));
        ctx.beginPath(); ctx.rect(0, SUM + BODY * j / STRIPS, W, BODY / STRIPS + 0.8); ctx.clip();
        put(ctx, picture, 0, 0, W, fullH);
        ctx.restore();
      }
      const dark = ctx.createLinearGradient(0, y, 0, y + deep);
      dark.addColorStop(0, 'rgb(0 0 0 / .5)'); dark.addColorStop(0.45, 'rgb(0 0 0 / .08)'); dark.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(-W / 2, y); ctx.lineTo(W / 2, y); ctx.lineTo(W / 2 * grow, y + deep); ctx.lineTo(-W / 2 * grow, y + deep); ctx.fill();
      ctx.fillStyle = '#3d2e20';                              // the two sides of the drawer
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * W / 2, y); ctx.lineTo(side * (W / 2 + 4), y); ctx.lineTo(side * (W / 2 * grow + 1), y + deep); ctx.lineTo(side * (W / 2 * grow - 4), y + deep); ctx.fill(); }
      // The front: the summary, nearer and so larger, under the body.
      ctx.fillStyle = 'rgb(0 0 0 / .3)';
      ctx.fillRect(-W / 2 * grow + 4, y + deep + SUM * grow, W * grow - 8, 9 * s.pull);
      ctx.save();
      ctx.translate(0, y + deep); ctx.scale(grow, grow); ctx.translate(-W / 2, 0);
      ctx.beginPath(); ctx.rect(0, 0, W, SUM); ctx.clip();
      put(ctx, d, 0, 0);
      ctx.restore();
      ctx.strokeStyle = c.line;
      if (d.open) {
        const mid = (1 + grow) / 2;
        parts = {
          d,
          front: { matrix: base.translate(0, y + deep).scale(grow).translate(-W / 2, 0), x: w / 2 - W / 2 * grow * k, y: TOP + (y + deep) * k, w: W * grow * k, h: SUM * grow * k },
          body: { matrix: base.translate(0, y).scale(mid, deep / BODY).translate(-W / 2, -SUM), x: w / 2 - W / 2 * mid * k, y: TOP + y * k, w: W * mid * k, h: deep * k },
        };
      }
    }
    // Hit regions. A closed drawer is hit at its slot. The open one has two parts drawn with different
    // transforms and one hit region, which goes to the part the pointer was last on.
    for (const { d, i } of order) if (!d.open) stage.hit(d, base.translate(-W / 2, slot(i)));
    if (parts) place();
    return moving;
  });

  const place = () => {
    if (mode === 'none') park(canvas, parts.d); else stage.hit(parts.d, parts[mode].matrix);
  };
  // #endregion cabinet

  // #region cabinet-point
  const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  onPoint(canvas, (x, y) => {
    if (!parts || stage.plain) return;
    const next = inside(parts.front, x, y) ? 'front' : inside(parts.body, x, y) ? 'body' : 'none';
    if (next === mode) return;
    mode = next;
    place();
    parts.d.toggleAttribute('data-point');       // clears Chromium's remembered hit-test answer
  });
  // #endregion cabinet-point

  const say = () => {
    const open = drawers.filter((d) => d.open).map((d) => d.querySelector('summary').textContent.trim());
    out.textContent = `Open: ${open.join(', ') || 'none'}. ${new URLSearchParams(new FormData(document.getElementById('cabinetForm')))}`;
  };
  canvas.addEventListener('toggle', () => { mode = 'front'; say(); stage.request(); }, true);
  canvas.addEventListener('input', say);
  let keys = 0;
  document.getElementById('cabinetKey').addEventListener('click', (e) => { e.target.textContent = `Taken ${++keys}`; });
  say();
  return { stage, drawers, get parts() { return parts; }, get mode() { return mode; } };
}
