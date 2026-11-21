import { put, smooth, lerp, reducedMotion } from '/lib/stage-2d.js';
import { scene, query } from './scene.js';

export default function start() {
  const canvas = document.getElementById('explodedCanvas');
  const form = document.getElementById('explodedForm');
  const out = document.getElementById('explodedOut');
  const slider = document.getElementById('explodedAmount');
  const toggle = document.getElementById('explodedToggle');
  const W = 380, H = 440;

  // #region exploded-draw
  // A label and its field are two drawable elements. label.control is the field the browser focuses.
  const rows = [...form.querySelectorAll('label')].map((label) => ({ label, field: label.control }));
  const button = form.querySelector('button');
  const SHEAR = -0.22, SMALL = 0.85, FIELD_X = 164;
  let amount = 1, target = 1, last = 0;

  // Where a row goes. e is 0 for the assembled form and 1 for the exploded diagram.
  function place(i, row, e) {
    const box = row.field.type === 'checkbox';
    const y = 44 + i * 80;
    const flat = box
      ? { lx: 104, ly: y + 8, fx: 70, fy: y + 8 + (row.label.offsetHeight - row.field.offsetHeight) / 2 }
      : { lx: 70, ly: y, fx: 70, fy: y + 32 };
    const apart = { lx: 8, ly: 44 + i * 84, fx: FIELD_X, fy: 66 + i * 84 };
    const p = {};
    for (const key in flat) p[key] = lerp(flat[key], apart[key], e);
    return p;
  }

  // One field, sheared and lifted off a plate that the canvas draws under it.
  function layer(ctx, el, x, y, e, c) {
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, SHEAR * e, 0, 1, 0, 0);
    ctx.scale(lerp(1, SMALL, e), lerp(1, SMALL, e));
    if (e > 0) {
      ctx.globalAlpha = e;
      ctx.fillStyle = c.line;
      ctx.fillRect(0, 12 * e, el.offsetWidth, el.offsetHeight);
      ctx.globalAlpha = 1;
    }
    put(ctx, el, 0, 0);            // the hit region of the field follows the shear
    ctx.restore();
  }

  const stage = scene(canvas, W, H, (ctx, t, c) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    if (amount !== target) {
      const step = reducedMotion() ? 1 : dt / 0.7;
      amount = amount < target ? Math.min(target, amount + step) : Math.max(target, amount - step);
      slider.value = Math.round(amount * 100);
    }
    const e = smooth(amount);
    const active = document.activeElement;

    // The axis of the explosion: two dashed lines through the corners of every layer.
    if (e > 0) {
      const right = FIELD_X + 240 * SMALL;
      ctx.save();
      ctx.globalAlpha = e * 0.8; ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(FIELD_X, 52); ctx.lineTo(FIELD_X, H - 8);
      ctx.moveTo(right, 52 + 240 * SMALL * SHEAR); ctx.lineTo(right, H - 8 + 240 * SMALL * SHEAR);
      ctx.stroke();
      ctx.restore();
    }

    rows.forEach((row, i) => {
      const { label, field } = row;
      const p = place(i, row, e);
      layer(ctx, field, p.fx, p.fy, e, c);
      put(ctx, label, p.lx, p.ly);
      if (e <= 0) return;

      // The leader line from the call-out to the left end of its field.
      const bad = !field.validity.valid;
      const on = active === field;
      const from = [p.lx + label.offsetWidth, p.ly + label.offsetHeight / 2];
      const to = [p.fx - 2, p.fy + field.offsetHeight * SMALL / 2];
      ctx.save();
      ctx.globalAlpha = e;
      ctx.strokeStyle = ctx.fillStyle = on ? c.accent : bad ? c.bad : c.muted;
      ctx.lineWidth = on ? 2.5 : 1.25;
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0] - 12, from[1]); ctx.lineTo(to[0], to[1]);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(to[0], to[1], on ? 5 : 3.5, 0, 7); ctx.fill();
      // Under the call-out: what the element says about itself.
      ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = c.muted;
      ctx.fillText(`${field.type}${field.required ? ', required' : ''}`, p.lx + 2, p.ly + label.offsetHeight + 4);
      ctx.fillStyle = bad ? c.bad : c.ok;
      ctx.fillText(bad ? failing(field) : 'valid', p.lx + 2, p.ly + label.offsetHeight + 17);
      ctx.restore();
    });
    layer(ctx, button, lerp(70, FIELD_X, e), lerp(44 + rows.length * 80 - 22, 66 + rows.length * 84 - 6, e), e, c);
    return amount !== target;
  });
  // #endregion exploded-draw

  // The first failing key of the field's ValidityState, for example "valueMissing".
  function failing(field) {
    for (const key in field.validity) if (key !== 'valid' && field.validity[key]) return key;
    return 'invalid';
  }

  // #region exploded-events
  // Nothing here moves focus. A tap on a drawn label focuses its field because the label is a real <label for>.
  let viaLabel = null, invalidAt = 0, lastEvent = 'Tap a call-out.';
  const report = () => { out.textContent = `${lastEvent}\nForm value: ${query(form)}`; stage.request(); };
  form.addEventListener('click', (e) => { viaLabel = e.target.closest('label'); setTimeout(() => { viaLabel = null; }, 0); });
  form.addEventListener('focusin', (e) => {
    // After a failed submit the browser focuses the first invalid field. Keep the line about the failure.
    if (performance.now() - invalidAt < 200) return report();
    lastEvent = viaLabel?.control === e.target
      ? `A tap on the call-out "${viaLabel.textContent.trim()}" focused the field "${e.target.name}".`
      : `Focus is in the field "${e.target.name || e.target.textContent.trim()}".`;
    report();
  });
  form.addEventListener('focusout', () => stage.request());
  form.addEventListener('input', report);
  form.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') lastEvent = `The checkbox "${e.target.name}" is ${e.target.checked ? 'checked' : 'not checked'}${viaLabel ? ', from a tap on its call-out' : ''}.`;
    report();
  });
  form.addEventListener('invalid', (e) => { if (performance.now() - invalidAt < 200) return; invalidAt = performance.now(); form.classList.add('tried'); lastEvent = `The browser reports "${e.target.name}" as invalid: ${failing(e.target)}.`; report(); }, true);
  form.addEventListener('submit', (e) => { e.preventDefault(); lastEvent = 'The form was submitted.'; report(); });
  // #endregion exploded-events

  slider.addEventListener('input', () => { amount = target = slider.value / 100; label(); stage.request(); });
  toggle.addEventListener('click', () => { target = target > 0.5 ? 0 : 1; label(); stage.request(); });
  const label = () => { toggle.textContent = target > 0.5 ? 'Assemble' : 'Explode'; };
  label();
  report();
  return { stage };
}
