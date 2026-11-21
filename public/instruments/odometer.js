import { mount, put, colors, clamp } from './kit.js';

export default function start() {
  const canvas = document.getElementById('odoCanvas');
  const form = document.getElementById('odoForm');
  const input = document.getElementById('odoInput');
  const out = document.getElementById('odoOut');
  const DIGITS = 6, CW = 42, CH = 66, TOP = 10 ** DIGITS;

  // #region odometer-fit
  // The input's text is transparent and the canvas draws the digits. Letter spacing makes each character
  // of the input as wide as one wheel, so the caret and the selection, which the input still draws, line up.
  const style = getComputedStyle(input);
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const probe = new OffscreenCanvas(8, 8).getContext('2d');
  probe.font = font;
  const spacing = CW - probe.measureText('0').width;
  // #endregion odometer-fit

  // #region odometer
  const read = () => (Number.isFinite(input.valueAsNumber) ? clamp(Math.round(input.valueAsNumber), 0, TOP - 1) : null);
  let target = read() ?? 0, shown = target, last = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    target = read() ?? target;
    const before = shown;
    shown += (target - shown) * (1 - Math.exp(-dt * 5));
    if (Math.abs(target - shown) < 0.004) shown = target;
    const rate = dt ? Math.abs(shown - before) / dt : 0;

    const k = Math.min(1, (w - 16) / (DIGITS * CW + 40));
    ctx.translate(w / 2, h / 2); ctx.scale(k, k); ctx.translate(-DIGITS * CW / 2, -CH / 2);
    // The case. Its outline is the focus ring: an outline on the input is outside its picture.
    ctx.fillStyle = '#0c0e13'; ctx.strokeStyle = input.matches(':focus-visible') ? c.accent : '#3a3f4b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-14, -14, DIGITS * CW + 28, CH + 28, 12); ctx.fill(); ctx.stroke();

    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = 0; d < DIGITS; d++) {
      const place = DIGITS - 1 - d, unit = 10 ** place;
      // A wheel stands still until the wheels to its right are within one step of rolling over, then turns with them.
      const p = shown / unit, whole = Math.floor(p), part = p - whole;
      const position = whole + (place ? Math.max(0, (part - (1 - 1 / unit)) * unit) : part);
      const speed = rate / unit;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(d * CW + 2, 0, CW - 4, CH, 5); ctx.clip();
      ctx.fillStyle = '#1b1e26'; ctx.fillRect(d * CW, 0, CW, CH);
      const leading = unit > Math.max(shown, 1);
      for (let j = Math.floor(position) - 1; j <= Math.floor(position) + 2; j++) {
        const a = (j - position) * 1.0;
        if (Math.abs(a) >= Math.PI / 2) continue;
        ctx.save();
        ctx.translate(d * CW + CW / 2, CH / 2 - Math.sin(a) * CH * 0.66);
        // Fast wheels are drawn stretched and faint, as a blur.
        const blur = clamp((speed - 12) / 40);
        ctx.scale(1, Math.cos(a) * (1 + blur * 1.6));
        ctx.globalAlpha = Math.cos(a) ** 1.5 * (leading ? 0.3 : 1) * (1 - blur * 0.6);
        ctx.fillStyle = '#f4f1e6';
        ctx.fillText(String(((j % 10) + 10) % 10), 0, 2);
        ctx.restore();
      }
      const shade = ctx.createLinearGradient(0, 0, 0, CH);
      shade.addColorStop(0, '#000c'); shade.addColorStop(0.3, '#0000'); shade.addColorStop(0.7, '#0000'); shade.addColorStop(1, '#000c');
      ctx.fillStyle = shade; ctx.fillRect(d * CW, 0, CW, CH);
      ctx.restore();
    }
    // The input itself, on top of the wheels. Its text is transparent: it adds the caret and the selection,
    // and its hit region is over the wheels, so a tap puts the caret between two wheels.
    put(ctx, input, spacing / 2, 0);
    return shown !== target;
  });
  if (!stage.plain) input.style.letterSpacing = `${spacing}px`;
  // #endregion odometer

  const report = () => {
    const value = new FormData(form).get('miles');
    out.textContent = `Form value: miles=${value}${input.validity.valid ? '' : ` (${input.validationMessage})`}`;
    stage.request();
  };
  input.addEventListener('input', report);
  // stepUp() and stepDown() change the value and raise no input event, so the page reports after calling them.
  const step = (n) => {
    const now = read() ?? 0;
    input.value = String(((now + n) % TOP + TOP) % TOP);
    report();
  };
  for (const button of document.querySelectorAll('[data-odo]')) button.addEventListener('click', () => step(+button.dataset.odo));
  const drive = document.getElementById('odoDrive');
  let timer = 0;
  drive.addEventListener('click', () => {
    const on = drive.getAttribute('aria-pressed') !== 'true';
    drive.setAttribute('aria-pressed', on);
    drive.textContent = on ? 'Stop' : 'Drive';
    clearInterval(timer);
    if (on) timer = setInterval(() => step(3), 120);
  });
  report();
  return { stage };
}
