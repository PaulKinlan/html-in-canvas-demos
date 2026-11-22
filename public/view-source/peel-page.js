// peel-page.js: what /view-source/ and /view-dom/ do alike. Each page calls startPage() and then puts its
// own kind of source in the layer under the page.
//
//   const { peel, surface } = await startPage({ onState: (state) => {} });

import { supported } from '/shared/support.js';
import { loadFx } from '/shared/fx-route.js';
import { pagePeel } from '/lib/page-peel.js';
import { startWidgets } from '/view-source/widgets.js';

const $ = (id) => document.getElementById(id);

export async function startPage({ onState = () => {} } = {}) {
  const sheet = $('sheet');

  // #region start
  // The fx library moves #sheet into a canvas: WebGPU when it works here, otherwise a 2D canvas drawn through
  // one WebGL context. Without HTML-in-canvas the page stays plain HTML and the corner is cut, not rolled.
  await loadFx({ targets: () => [sheet], mount: supported ? $('route') : null });
  if (!supported) $('route').textContent = 'HTML-in-canvas is not available here, so this page is plain HTML and its corner is cut along a straight line.';
  const surface = () => sheet.closest('fx-surface');

  const words = {
    rest: 'The page is flat. Its top right corner is turned over.',
    open: (amount) => `${Math.round(amount * 100)}% of the page is peeled back. Drag the paper further, or press it to put the page back.`,
    away: 'The page is rolled up in the bottom left corner. Press the roll to put the page back.',
  };
  let moving = null;
  const peel = pagePeel(sheet, {
    under: $('under'),
    label: 'Peel the page back to show its source',
    onChange({ state, amount }) {
      // While the corner is held nothing in the page is changed: a change would make the canvas take a new picture of the page on every frame.
      if (state === 'held') return void (moving ??= { at: performance.now(), frames: surface()?.frames ?? 0 });
      if (moving) measured('paper', moving);
      moving = null;
      const text = typeof words[state] === 'function' ? words[state](amount) : words[state];
      if ($('peel-status').textContent !== text) $('peel-status').textContent = text;
      $('do-open').textContent = state === 'rest' ? 'Peel the page' : 'Put the page back';
      $('under').dataset.state = state;
      onState(state);
    },
  });
  $('do-open').onclick = () => (peel.state === 'rest' ? peel.open() : peel.close());
  $('do-away').onclick = () => peel.away();
  // A canvas is cleared when its size changes, and the library draws it again on the next frame. For one
  // frame the source text would show through the whole page, so draw at once, in the same frame as the resize.
  const drawn = surface();
  if (drawn) drawn.resized = () => {
    try { drawn.render(performance.now()); } catch (err) { if (!/paint record/i.test(err?.message ?? '')) throw err; }
  };
  // #endregion start

  // #region measure
  // How fast the canvas keeps up on this device, written under "Findings" after each movement of the paper
  // and each scroll of the page. `frames` is the fx library's count of frames it drew.
  const rates = {};
  function measured(what, from) {
    const frames = (surface()?.frames ?? 0) - from.frames, seconds = (performance.now() - from.at) / 1000;
    if (!surface() || frames < 2 || seconds < 0.1) return;
    rates[what] = `${frames} frames in ${seconds.toFixed(2)} s, ${Math.round(frames / seconds)} a second`;
    $('measured').textContent = `On this device, drawn with ${{ webgpu: 'WebGPU', direct: 'WebGL', shared: 'a 2D canvas and one WebGL context' }[surface().backend] ?? 'no canvas'}. ` +
      `Last movement of the paper: ${rates.paper ?? 'none yet'}. Last scroll of the page: ${rates.scroll ?? 'none yet'}.`;
  }
  let scrolling = null;
  sheet.addEventListener('scroll', () => { scrolling ??= { at: performance.now(), frames: surface()?.frames ?? 0 }; }, { passive: true });
  sheet.addEventListener('scrollend', () => { if (scrolling) measured('scroll', scrolling); scrolling = null; });
  // #endregion measure

  startWidgets(sheet);
  return { sheet, peel, surface };
}
