import { mount, put, place, clamp } from './kit.js';

export default function start() {
  const scene = document.getElementById('widgetCanvas');
  const dial = document.getElementById('dialCanvas'), pad = document.getElementById('padCanvas');
  const dialCard = document.getElementById('dialCard'), padCard = document.getElementById('padCard');
  const range = document.getElementById('dialRange'), count = document.getElementById('padCount');
  const out = document.getElementById('widgetOut');
  const IW = 200, IH = 240, PADX = 20, PADY = 20;   // an inner canvas in CSS pixels, and where the card sits in it
  const seen = { scene: 0, dial: 0, pad: 0, by: 'nothing yet' };
  const line = () => { out.textContent = `Paint events: scene ${seen.scene}, lamp canvas ${seen.dial}, counter canvas ${seen.pad}. The last scene paint was raised by: ${seen.by}.`; };

  // #region widget-inner
  // An inner canvas is a drawable canvas and also a `drawable` child of the scene canvas. It has its own
  // paint handler, which draws the widget with the widget's effect. The scene never draws the card.
  function inner(canvas, name, draw) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { request() {} };
    let queued = 0;
    const k = Math.min(3, devicePixelRatio || 1);
    canvas.width = Math.round(IW * k); canvas.height = Math.round(IH * k);
    canvas.addEventListener('paint', () => {
      if (ctx.isContextLost?.()) return;
      seen[name]++;
      ctx.reset();
      ctx.scale(canvas.width / IW, canvas.height / IH);
      const again = draw(ctx, performance.now());
      if (again && !queued) queued = requestAnimationFrame(() => { queued = 0; canvas.requestPaint(); });
    });
    // kit.js stops every demo on the page when one canvas reports a lost context.
    canvas.addEventListener('contextlost', () => scene.dispatchEvent(new Event('contextlost')));
    return { request: () => canvas.requestPaint() };
  }

  // The lamp's own effect is bloom: the card is drawn blurred and brightened behind itself, and the amount
  // follows the range input. `level` is eased towards the input's value, read in the paint handler.
  let level = range.value / 100, lastDial = 0;
  inner(dial, 'dial', (ctx, t) => {
    const dt = Math.min(0.05, (t - lastDial) / 1000 || 0); lastDial = t;
    const target = range.value / 100;
    level += (target - level) * (1 - Math.exp(-dt * 9));
    const still = Math.abs(target - level) < 0.004;
    if (still) level = target;
    ctx.filter = `blur(${5 + 9 * level}px) brightness(${1 + 1.2 * level}) saturate(${1 + 2 * level})`;
    ctx.globalAlpha = level;
    const ok = put(ctx, dialCard, PADX, PADY);
    ctx.globalAlpha = 1;
    ctx.filter = `brightness(${0.45 + 0.65 * level})`;
    put(ctx, dialCard, PADX, PADY);
    return !ok || !still;
  });

  // The counter's own effect is a colour split: for half a second after a press the card is drawn three
  // times, once through each of three SVG filters that keep one colour channel, a few pixels apart.
  let hit = 0, lastPad = 0;
  const padStage = inner(pad, 'pad', (ctx, t) => {
    const dt = Math.min(0.05, (t - lastPad) / 1000 || 0); lastPad = t;
    hit = Math.max(0, hit - dt * 2.2);
    if (hit < 0.01) { hit = 0; return !put(ctx, padCard, PADX, PADY); }
    const d = hit * hit * 14, shake = Math.sin(t / 18) * hit * 3;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(PADX, PADY + shake, padCard.offsetWidth, padCard.offsetHeight, 14); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'url(#nfRed)'; put(ctx, padCard, PADX - d, PADY + shake);
    ctx.filter = 'url(#nfGreen)'; put(ctx, padCard, PADX, PADY - shake);
    ctx.filter = 'url(#nfBlue)'; put(ctx, padCard, PADX + d, PADY + shake);
    ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    place(ctx, padCard, PADX, PADY);          // the buttons stay where the flat card is
    return true;
  });
  // #endregion widget-inner

  // #region widget-scene
  // The scene draws each inner canvas as one element. Its own effect is the room: the two canvases are
  // sheared like the pages of an open book, mirrored in the floor, and lit by the lamp's level.
  let lean = 0, leanTo = 0, lastScene = 0;
  const stage = mount(scene, (ctx, w, h, t, event) => {
    seen.scene++;
    const changed = [...(event?.changedElements ?? [])].map((el) => (el.id ? `#${el.id}` : `<${el.localName}>`));
    seen.by = changed.length ? `${changed.join(', ')} in changedElements` : 'requestPaint() or a resize';
    line();
    const dt = Math.min(0.05, (t - lastScene) / 1000 || 0); lastScene = t;
    lean += (leanTo - lean) * (1 - Math.exp(-dt * 7));
    const moving = Math.abs(leanTo - lean) > 0.002;

    const k = Math.min(1, (w - 12) / (IW * 2 + 4)), floor = Math.min(h - 96, 26 + (PADY + 200) * k);
    const wall = ctx.createLinearGradient(0, 0, 0, floor);
    wall.addColorStop(0, '#141826'); wall.addColorStop(1, '#27304a');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, w, floor);
    ctx.fillStyle = '#0c0e15'; ctx.fillRect(0, floor, w, h - floor);

    const panel = (canvas, x, shear, mirror) => {
      ctx.save();
      ctx.transform(1, shear, 0, 1, x, floor);
      ctx.scale(k, mirror ? -k : k);
      ctx.globalAlpha = mirror ? 0.42 : 1;
      put(ctx, canvas, 0, -(PADY + 200), IW, IH);
      ctx.restore();
    };
    const leftX = w / 2 - (IW + 2) * k, rightX = w / 2 + 2 * k;
    const leftShear = -0.1 - lean * 0.07, rightShear = 0.1 - lean * 0.07;
    // The mirror images first, faded by the floor. The upright draw is the last one, so it takes the input.
    panel(dial, leftX, leftShear, true); panel(pad, rightX, rightShear, true);
    const fade = ctx.createLinearGradient(0, floor, 0, h);
    fade.addColorStop(0, 'rgb(12 14 21 / 0.2)'); fade.addColorStop(0.8, 'rgb(12 14 21 / 1)');
    ctx.fillStyle = fade; ctx.fillRect(0, floor - 30, w, h - floor + 30);
    ctx.fillStyle = wall; ctx.fillRect(0, floor - 30, w, 30);
    panel(dial, leftX, leftShear, false); panel(pad, rightX, rightShear, false);

    // The lamp lights the room: the scene reads the same input the inner canvas reads.
    const v = range.value / 100, lx = leftX + IW * k / 2, ly = floor - 120 * k;
    ctx.globalCompositeOperation = 'lighter';
    const light = ctx.createRadialGradient(lx, ly, 10, lx, ly, 150 + 260 * v);
    light.addColorStop(0, `rgb(255 196 110 / ${0.5 * v})`); light.addColorStop(1, 'rgb(255 196 110 / 0)');
    ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    return moving;
  }, { fallback: () => [dialCard, padCard] });
  // #endregion widget-scene

  // The scene leans towards the pointer or the finger.
  scene.addEventListener('pointermove', (e) => {
    const r = scene.getBoundingClientRect();
    leanTo = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
    stage.request();
  });

  // The widgets' own jobs. These are the application, not the effects.
  const value = document.getElementById('dialValue');
  range.addEventListener('input', () => { value.value = `${range.value}%`; });
  document.getElementById('dialOff').addEventListener('click', () => { range.value = range.value > 0 ? 0 : 60; value.value = `${range.value}%`; });
  // A press starts the colour split. pointerdown is used because a touch press does not set :active on a
  // button drawn in a canvas (see /form-state/).
  padCard.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) { hit = 1; padStage.request(); } });
  padCard.addEventListener('click', (e) => {
    const step = Number(e.target.closest('button')?.dataset.step);
    if (!step) return;
    count.value = String(Number(count.value) + step);
    hit = 1; padStage.request();
  });
  line();
  return { stage };
}
