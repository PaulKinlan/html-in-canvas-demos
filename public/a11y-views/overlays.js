// Two views drawn over a form by the canvas that draws the form: the size of each touch
// target, and a line from each label to its control. Positions come from
// getBoundingClientRect() and Range.getBoundingClientRect(), which report where the content
// was last drawn. A form drawn smaller has smaller targets, and the numbers show it.
import { inCanvas, plate, hatch } from '/lib/devtools/stage.js';

const INK = { good: '#12b76a', small: '#f5a524', bad: '#e5484d', label: '#2f6bff', aria: '#9b5de5' };
export const SMALL = 24;   // CSS px. Below this on either side: WCAG 2.2 "Target Size (Minimum)" is not met by size alone.
export const GOOD = 48;    // CSS px. Android's guidance for a touch target is 48 by 48 dp.

// #region targets
const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Every control under `root` with the box it was drawn in, in CSS pixels of the canvas. */
export function measureTargets(canvas, root = canvas) {
  const origin = canvas.getBoundingClientRect();
  return [...root.querySelectorAll(CONTROLS)]
    .filter((el) => !el.matches(':disabled') && !el.closest('[inert]') && el.checkVisibility({ visibilityProperty: true }))
    .map((el) => {
      const r = inCanvas(canvas, el.getBoundingClientRect(), origin);
      const least = Math.min(r.width, r.height);
      return { el, ...r, least, grade: least < SMALL - 0.5 ? 'bad' : least < GOOD - 0.5 ? 'small' : 'good' };
    });
}

export function drawTargets(ctx, targets, { width }) {
  ctx.save();
  for (const t of targets) {
    const colour = INK[t.grade];
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = colour;
    ctx.fillRect(t.x, t.y, t.width, t.height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(t.x, t.y, t.width, t.height);
    if (t.grade === 'bad') {
      // The 24 by 24 square the target would need, centred on it.
      const cx = t.x + t.width / 2, cy = t.y + t.height / 2;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(cx - SMALL / 2, cy - SMALL / 2, SMALL, SMALL);
      ctx.setLineDash([]);
    }
  }
  for (const t of targets) {
    if (t.grade === 'good') continue;
    plate(ctx, `${Math.round(t.width)}×${Math.round(t.height)}`, t.x + t.width - 4, t.y - 9, { fill: INK[t.grade], color: t.grade === 'small' ? '#1d1c1a' : '#fff', maxX: width - 2, height: 16, pad: 4, font: '600 10px ui-monospace, Menlo, Consolas, monospace' });
  }
  ctx.restore();
  const count = (g) => targets.filter((t) => t.grade === g).length;
  return { total: targets.length, bad: count('bad'), small: count('small'), good: count('good') };
}
// #endregion targets

// #region labels
/**
 * For every form control under `root`: where its name comes from.
 *   label        a <label> (wrapping, or for=)         → `from` is the label's text
 *   labelledby   aria-labelledby                       → `from` is that element
 *   aria         aria-label                            → no visible text
 *   placeholder  only a placeholder or a title
 *   none         nothing
 * Also returns labels whose for= matches no control.
 */
export function readLabels(root) {
  const controls = [...root.querySelectorAll('input:not([type="hidden"], [type="submit"], [type="button"], [type="reset"]), select, textarea, meter, progress')]
    .map((el) => {
      const labels = [...(el.labels ?? [])];
      const by = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => id && root.querySelector('#' + CSS.escape(id))).filter(Boolean);
      const kind = labels.length ? 'label' : by.length ? 'labelledby' : el.getAttribute('aria-label')?.trim() ? 'aria' : (el.placeholder || el.title) ? 'placeholder' : 'none';
      const name = kind === 'label' ? labels.map(text).join(' ') : kind === 'labelledby' ? by.map(text).join(' ') : kind === 'aria' ? el.getAttribute('aria-label').trim() : kind === 'placeholder' ? (el.placeholder || el.title) : '';
      return { el, kind, name, sources: kind === 'label' ? labels : by };
    });
  const orphans = [...root.querySelectorAll('label')].filter((l) => !l.control);
  return { controls, orphans };
}

/** The label's own words, without the text of a control inside it. */
function text(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.data;
    else if (node.nodeType === Node.ELEMENT_NODE && !node.matches('input, select, textarea, button')) out += text(node);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** The box of the label's words, from a Range over its first text node that has any. */
export function textBox(canvas, el, origin = canvas.getBoundingClientRect()) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim() || node.parentElement.closest('select, textarea')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width) return inCanvas(canvas, r, origin);
  }
  return inCanvas(canvas, el.getBoundingClientRect(), origin);
}

export function drawLabels(ctx, canvas, report, { width }) {
  const origin = canvas.getBoundingClientRect();
  const count = { label: 0, labelledby: 0, aria: 0, placeholder: 0, none: 0, orphans: report.orphans.length };
  ctx.save();
  ctx.lineCap = 'round';
  for (const c of report.controls) {
    count[c.kind]++;
    const r = inCanvas(canvas, c.el.getBoundingClientRect(), origin);
    if (c.kind === 'label' || c.kind === 'labelledby') {
      for (const source of c.sources) {
        const s = textBox(canvas, source, origin);
        // The shortest line between the box of the words and the box of the control.
        const near = (box, px, py) => ({ x: Math.max(box.x, Math.min(px, box.x + box.width)), y: Math.max(box.y, Math.min(py, box.y + box.height)) });
        const b = near(r, s.x + s.width / 2, s.y + s.height / 2), a = near(s, b.x, b.y);
        ctx.strokeStyle = ctx.fillStyle = INK.label;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 2, s.y - 1, s.width + 4, s.height + 2);
        ctx.strokeRect(r.x, r.y, r.width, r.height);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (c.kind === 'aria') {
      ctx.strokeStyle = INK.aria;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.setLineDash([]);
      plate(ctx, `aria-label: ${c.name}`, r.x + r.width, r.y + 3, { fill: INK.aria, maxX: r.x + r.width - 3, height: 16, pad: 4, font: '600 10px ui-monospace, Menlo, Consolas, monospace' });
    } else {
      const colour = c.kind === 'none' ? INK.bad : INK.small;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.clip();
      hatch(ctx, r, colour, 7);
      ctx.restore();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      plate(ctx, c.kind === 'none' ? 'no label' : 'placeholder only', r.x + r.width, r.y + 3, { fill: colour, color: c.kind === 'none' ? '#fff' : '#1d1c1a', maxX: r.x + r.width - 3, height: 16, pad: 4, font: '600 10px ui-monospace, Menlo, Consolas, monospace' });
    }
  }
  for (const label of report.orphans) {
    const s = textBox(canvas, label, origin);
    ctx.strokeStyle = INK.bad;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(s.x - 2, s.y - 1, s.width + 4, s.height + 2);
    ctx.setLineDash([]);
    plate(ctx, label.htmlFor ? `for="${label.htmlFor}" matches nothing` : 'label with no control', s.x + s.width + 8, s.y - 1, { fill: INK.bad, maxX: width - 2, height: 16, pad: 4, font: '600 10px ui-monospace, Menlo, Consolas, monospace' });
  }
  ctx.restore();
  return count;
}
// #endregion labels
