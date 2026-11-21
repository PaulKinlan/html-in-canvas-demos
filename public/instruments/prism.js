import { mount, put, park, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('prismCanvas');
  const form = document.getElementById('prismForm');
  const out = document.getElementById('prismOut');
  const faces = [...form.querySelectorAll('fieldset')];
  const summary = document.getElementById('prismSummary');
  const THIRD = Math.PI * 2 / 3;

  // #region prism
  // `turn` is the prism's angle. Face i looks at the reader when turn is i thirds of a full turn.
  let front = 0, turn = 0, goal = 0, shake = 0, last = 0;
  const STRIPS = 28, FOCAL = 720;

  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    turn += (goal - turn) * (1 - Math.exp(-dt * 7));
    shake *= Math.exp(-dt * 6);
    const settled = Math.abs(goal - turn) < 0.002 && Math.abs(shake) < 0.002;
    if (settled) { turn = goal; shake = 0; }
    const W = faces[0].offsetWidth, H = faces[0].offsetHeight;
    const k = Math.min(1, (w - 20) / (W + 30)), cx = w / 2, cy = h / 2;
    const apothem = W / (2 * Math.tan(Math.PI / 3));
    ctx.translate(cx, cy); ctx.scale(k, k);

    ctx.fillStyle = '#0003';
    ctx.beginPath(); ctx.ellipse(0, H / 2 + 14, W * 0.5, 9, 0, 0, 7); ctx.fill();

    const drawn = faces.map((face, i) => ({ face, a: i * THIRD - turn + Math.sin(t / 28) * shake }))
      .filter((f) => Math.cos(f.a) > 0.02)
      .sort((p, q) => Math.cos(p.a) - Math.cos(q.a));
    for (const face of faces) if (!drawn.some((d) => d.face === face)) park(canvas, face);

    for (const { face, a } of drawn) {
      if (settled) { put(ctx, face, -W / 2, -H / 2); continue; }
      // A 2D canvas has no perspective transform. The face is drawn as 28 vertical strips, each with its own
      // width and height, which is an affine transform per strip.
      const project = (x) => {
        const X = x * Math.cos(a) + apothem * Math.sin(a), Z = -x * Math.sin(a) + apothem * Math.cos(a);
        const s = FOCAL / (FOCAL + apothem - Z);
        return [X * s, s];
      };
      for (let i = 0; i < STRIPS; i++) {
        const x0 = -W / 2 + W * i / STRIPS, x1 = x0 + W / STRIPS;
        const [sx0, s0] = project(x0), [sx1, s1] = project(x1);
        if (sx1 - sx0 < 0.05) continue;
        const sx = (sx1 - sx0) / (x1 - x0), sy = (s0 + s1) / 2, ex = x0 + W / 2;
        ctx.save();
        ctx.transform(sx, 0, 0, sy, sx0 - ex * sx, -H / 2 * sy);
        ctx.beginPath(); ctx.rect(ex, 0, W / STRIPS + 0.5 / sx, H); ctx.clip();
        put(ctx, face, 0, 0);
        ctx.restore();
      }
      // Faces that are turned away are darker: one fill over the outline of the whole face.
      const [left, sl] = project(-W / 2), [right, sr] = project(W / 2);
      ctx.fillStyle = `rgb(0 0 0 / ${0.6 * (1 - Math.cos(a))})`;
      ctx.beginPath(); ctx.moveTo(left, -H / 2 * sl); ctx.lineTo(right, -H / 2 * sr); ctx.lineTo(right, H / 2 * sr); ctx.lineTo(left, H / 2 * sl); ctx.fill();
    }
    if (settled && wantFocus) { (wantFocus === true ? faces[front].querySelector('input, select, button') : wantFocus)?.focus({ preventScroll: true }); wantFocus = false; }
    return !settled;
  });
  // #endregion prism

  // #region prism-turn
  // show(i, focus): focus is true for the first control of the face, or the control to focus.
  // Only the front face takes input. The other two are inert: their fields keep their values and are still
  // submitted and still validated, but cannot be focused or pressed.
  let wantFocus = false;
  const show = (i, focus = true) => {
    goal += (i - front) * THIRD;
    front = i;
    faces.forEach((face, n) => { face.inert = !stage.plain && n !== i; });
    wantFocus = focus;
    stage.request();
  };
  const fieldsOf = (face) => [...face.elements].filter((el) => el.willValidate);
  form.addEventListener('click', (e) => {
    const step = +e.target.dataset?.turn;
    if (!step) return;
    // Next checks the fields of this face with the browser's own validation.
    const bad = step > 0 && fieldsOf(faces[front]).find((el) => !el.checkValidity());
    if (bad) { faces[front].classList.add('tried'); shake = 0.09; stage.request(); bad.reportValidity(); return; }
    show(front + step);
  });
  // Submitting with an invalid field on another face: the browser raises `invalid` on it and cannot focus it,
  // because it is inert. The page turns the prism to that face.
  // One submit raises `invalid` on every invalid field. The first one, in document order, decides the face.
  let handled = false;
  form.addEventListener('invalid', (e) => {
    const i = faces.findIndex((face) => face.contains(e.target));
    if (i < 0 || i === front) return;
    e.preventDefault();
    if (handled) return;
    handled = true;
    setTimeout(() => { handled = false; });
    faces[i].classList.add('tried');
    show(i, e.target);
  }, true);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    out.textContent = `Submitted: ${new URLSearchParams(new FormData(form))}`;
    goal += Math.PI * 2; // one full turn, back to the same face
    stage.request();
  });
  // #endregion prism-turn

  form.addEventListener('input', () => {
    const data = new FormData(form);
    summary.textContent = `${data.get('seats') || '?'} ${data.get('ticket') || ''} for ${data.get('name') || '?'}`;
    stage.request();
  });
  // As plain HTML all three fieldsets are shown and none is inert.
  addEventListener('instruments-plain', () => faces.forEach((face) => { face.inert = false; }));
  show(0, false);
  return { stage, show };
}
