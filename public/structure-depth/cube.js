import { mount, put, hitOnly, park, columns, colors, interactive } from './kit.js';

export default function start() {
  const canvas = document.getElementById('cubeCanvas');
  const nav = document.getElementById('cubeNav');
  const links = [...nav.querySelectorAll('a')];
  const faces = [...canvas.querySelectorAll('section')];
  const out = document.getElementById('cubeOut');
  const QUARTER = Math.PI / 2, STRIPS = 26, FOCAL = 640;

  // #region cube
  // `turn` is the cube's angle. Face i looks at the reader when turn is i quarter turns.
  let front = 0, turn = 0, goal = 0, drag = null, last = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    if (!drag) turn += (goal - turn) * (1 - Math.exp(-dt * 8));
    const settled = !drag && Math.abs(goal - turn) < 0.002;
    if (settled) turn = goal;

    // The nav is drawn flat under the cube. Its links turn the cube.
    put(ctx, nav, (w - nav.offsetWidth) / 2, h - nav.offsetHeight - 8);

    const W = faces[0].offsetWidth, H = faces[0].offsetHeight, half = W / 2;
    const k = Math.min(1, (w - 8) / (W * 1.5));
    ctx.translate(w / 2, (h - nav.offsetHeight - 8) / 2);
    ctx.scale(k, k);
    ctx.fillStyle = '#0002';
    ctx.beginPath(); ctx.ellipse(0, H / 2 + 10, W * 0.62, 8, 0, 0, 7); ctx.fill();

    // The faces that look towards the reader, the one that is turned furthest away first.
    const drawn = faces.map((face, i) => ({ face, a: i * QUARTER - turn }))
      .filter((f) => Math.cos(f.a) > 0.02)
      .sort((p, q) => Math.cos(p.a) - Math.cos(q.a));
    for (const face of faces) if (!drawn.some((d) => d.face === face)) park(canvas, face);

    for (const { face, a } of drawn) {
      if (settled) { put(ctx, face, -half, -H / 2); continue; }
      // A column x of the face, turned by a about the middle of the cube and seen in perspective.
      const project = (x) => {
        const u = x - half;
        const X = u * Math.cos(a) + half * Math.sin(a), Z = -u * Math.sin(a) + half * Math.cos(a);
        const s = FOCAL / (FOCAL + half - Z);
        return [X * s, s];
      };
      columns(ctx, face, W, H, STRIPS, project);
      // A face that is turned away is darker: one fill over its outline.
      const [left, sl] = project(0), [right, sr] = project(W);
      ctx.fillStyle = `rgb(0 0 0 / ${0.55 * (1 - Math.cos(a))})`;
      ctx.beginPath(); ctx.moveTo(left, -H / 2 * sl); ctx.lineTo(right, -H / 2 * sr); ctx.lineTo(right, H / 2 * sr); ctx.lineTo(left, H / 2 * sl); ctx.fill();
      ctx.strokeStyle = c.line; ctx.stroke();
    }
    // While the cube turns, the face that is most towards the reader takes input at its flat place.
    // The other visible face is parked, or its last strip would be its hit region.
    if (!settled) drawn.forEach(({ face }, i) => { if (i === drawn.length - 1) hitOnly(ctx, face, -half, -H / 2); else park(canvas, face); });
    return !settled;
  });
  // #endregion cube

  // #region cube-turn
  const say = () => {
    const face = faces[front];
    links.forEach((a, i) => { if (i === front) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    out.textContent = `Front face: <section aria-labelledby="${face.getAttribute('aria-labelledby')}">, heading "${face.querySelector('h3').textContent}". All four sections and the nav are in the document.`;
  };
  const show = (i) => {
    i = ((i % 4) + 4) % 4;
    let step = i - front;
    if (step > 2) step -= 4;
    if (step < -2) step += 4;
    goal += step * QUARTER;
    front = i;
    say();
    stage.request();
  };
  // The nav links point at the sections by id. The page turns the cube and stops the jump.
  nav.addEventListener('click', (e) => {
    const i = links.indexOf(e.target.closest('a'));
    if (i < 0) return;
    e.preventDefault();
    show(i);
  });
  // Tab moves into a section on a face that is turned away: turn that face to the front.
  canvas.addEventListener('focusin', (e) => {
    const i = faces.findIndex((face) => face.contains(e.target));
    if (i >= 0 && i !== front) show(i);
  });
  // A sideways drag on a face turns the cube by hand. It snaps to the nearest face on release.
  canvas.addEventListener('pointerdown', (e) => {
    if (stage.plain || interactive(e.target) || !faces.some((f) => f.contains(e.target))) return;
    drag = { x: e.clientX, turn, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    turn = drag.turn - (e.clientX - drag.x) / faces[0].offsetWidth * QUARTER * 1.15;
    stage.request();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    const nearest = Math.round(turn / QUARTER);
    goal = nearest * QUARTER;
    front = ((nearest % 4) + 4) % 4;
    say();
    stage.request();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  document.getElementById('cubePrev').addEventListener('click', () => show(front - 1));
  document.getElementById('cubeNext').addEventListener('click', () => show(front + 1));
  // #endregion cube-turn

  let count = 0;
  document.getElementById('cubeCount').addEventListener('click', (e) => { e.target.textContent = `Pressed ${++count}`; });
  document.getElementById('cubeSize').addEventListener('input', (e) => { document.getElementById('cubeSizeOut').textContent = `${e.target.value} px`; });
  say();
  return { stage, show, get front() { return front; } };
}
