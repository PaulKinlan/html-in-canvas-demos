import { mount, put, place } from './kit.js';

export default function start() {
  const canvas = document.getElementById('selfCanvas');
  const out = document.getElementById('selfOut');
  let script = document.getElementById('selfScript');
  const original = script.textContent;
  let runs = 1, error = '', shown = '';
  const line = () => {
    const text = error
      ? `The script stopped: ${error}`
      : `The script element has run ${runs} time${runs === 1 ? '' : 's'}. It is ${script.offsetWidth} by ${script.offsetHeight} CSS pixels and holds ${script.textContent.length} characters.`;
    if (text !== shown) { shown = text; out.textContent = text; }
  };

  // #region self-draw
  const stage = mount(canvas, (ctx, w, h, t) => {
    const cw = script.offsetWidth, ch = script.offsetHeight, wide = w >= 800;
    // The wheel goes beside the code on a wide canvas and under it on a phone.
    const radius = wide ? Math.min(h / 2 - 16, (w - cw - 60) / 2) : Math.min(w / 2 - 14, (h - ch - 48) / 2);
    const x = wide ? cw + 24 + (w - cw - 24) / 2 : w / 2, y = wide ? h / 2 : ch + 24 + (h - ch - 24) / 2;
    ctx.fillStyle = '#10131c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a2030'; ctx.beginPath(); ctx.roundRect(12, 12, cw, ch, 8); ctx.fill();
    put(ctx, script, 12, 12);                  // the code block is the script element itself

    if (script.draw && !error) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, radius, 0, 7); ctx.fillStyle = '#1a2030'; ctx.fill();
      const base = ctx.getTransform();
      try { script.draw(ctx, x, y, radius, t / 1000); }
      catch (e) { error = String(e?.message ?? e); ctx.setTransform(base); }
      ctx.restore();
    }
    line();
    // The wheel drew the script element many times. Input goes back to the code block.
    place(ctx, script, 12, 12);
    return !!script.draw && !error;
  }, { fallback: () => [script] });
  // #endregion self-draw

  // #region self-run
  // A script element runs once. To run the edited text, make a new element with that text and put it in
  // the old one's place. A classic inline script runs during replaceWith(), so `draw` is there afterwards.
  // The script declares nothing at the top level: a second `const` of the same name would be an error.
  const run = (text) => {
    error = '';
    // Parse the text first, so that a syntax error is shown in the line under the demo and the old
    // script keeps drawing its text.
    try { new Function(text); } catch (e) { error = String(e.message); line(); stage.request(); return; }
    const next = document.createElement('script');
    for (const { name, value } of script.attributes) next.setAttribute(name, value);
    next.textContent = text;
    script.replaceWith(next);
    script = next;
    runs++;
    if (typeof script.draw !== 'function') error = 'the edited text did not set document.currentScript.draw';
    line();
    stage.request();
  };
  document.getElementById('selfRun').addEventListener('click', () => run(script.textContent));
  document.getElementById('selfReset').addEventListener('click', () => run(original));
  // #endregion self-run
  line();
  return { stage };
}
