import { mount, put, colors, clamp } from '/form-state/kit.js';
import { lay } from '/text-marks/lay.js';

export default function start() {
  const canvas = document.getElementById('auditCanvas'), sheet = document.getElementById('auditSheet'), out = document.getElementById('auditOut');
  let t0 = -1e9, ran = false, frames = 0;
  // #region audit
  // Three kinds of element a design system would want to know about. The parser gives an element it does
  // not know the HTMLUnknownElement interface. A name with a hyphen that was never defined is a custom
  // element that is not upgraded. And some old elements are known and obsolete.
  const OBSOLETE = new Set(['center', 'font', 'big', 'tt', 'nobr', 'acronym', 'strike', 'marquee']);
  const kind = (el) => (el instanceof HTMLUnknownElement ? 'unknown' : el.localName.includes('-') && !customElements.get(el.localName) ? 'undefined' : OBSOLETE.has(el.localName) ? 'obsolete' : null);
  const PAINT = { unknown: '#dc2626', undefined: '#d97706', obsolete: '#6b7280' };
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), u = clamp((t - t0) / 1400), counts = { unknown: 0, undefined: 0, obsolete: 0 };
    lay(ctx, canvas, sheet, w, h, ({ W, H, local }) => {
      put(ctx, sheet, 0, 0);
      if (!ran) return;
      const line = u * (H + 10);
      ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.textBaseline = 'bottom';
      for (const el of sheet.querySelectorAll('*')) {
        const what = kind(el), r = el.getClientRects()[0];
        if (!what || !r) continue;
        const b = local(r);
        if (b.y > line) continue;
        counts[what]++;
        ctx.strokeStyle = ctx.fillStyle = PAINT[what]; ctx.lineWidth = 2;
        ctx.setLineDash(what === 'obsolete' ? [4, 3] : []);
        ctx.strokeRect(b.x - 2, b.y - 1, b.w + 4, b.h + 2);
        ctx.setLineDash([]);
        const label = `<${el.localName}>`, lw = ctx.measureText(label).width + 6, lx = Math.min(W - lw, Math.max(0, b.x - 2));
        ctx.fillRect(lx, b.y - 15, lw, 14);
        ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 3, b.y - 1);
      }
      if (u < 1) { ctx.fillStyle = c.accent; ctx.globalAlpha = 0.8; ctx.fillRect(-8, line, W + 16, 2); ctx.globalAlpha = 0.12; ctx.fillRect(-8, line - 26, W + 16, 26); ctx.globalAlpha = 1; }
    });
    out.textContent = ran ? `Found so far: ${counts.unknown} unknown to the parser (red), ${counts.undefined} custom and not defined (amber), ${counts.obsolete} known and obsolete (grey).` : 'Not audited yet.';
    return (ran && u < 1) || frames++ < 3;
  });
  // #endregion audit
  document.getElementById('auditRun').addEventListener('click', () => { ran = true; t0 = performance.now(); stage.request(); });
  document.getElementById('auditClear').addEventListener('click', () => { ran = false; frames = 0; stage.request(); });
  return { stage };
}
