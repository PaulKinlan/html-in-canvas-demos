// Live checks for /select-selection/. They run on test elements in a panel at
// the bottom of the window, never on the demos in the page. The first group
// opens a test picker with showPicker(), which needs the tap that started the
// checks, so it runs first. The test input has inputmode="none", so a phone
// does not open its keyboard when the check gives it the focus.
import { runTests, checkBench, stillDrawn, inkFraction, supported } from '/shared/support.js';
import { MultiSelect, SuggestSelect, TiltedText, TranslateInPlace, SelectionTicks, ControlSelection, textRange, unwrap } from '/lib/select-selection.js';
import { recorded } from '/lib/text-twin.js';
import { SENTENCES } from '/select-selection/sentences.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const events = (el) => { const seen = []; for (const type of ['input', 'change']) el.addEventListener(type, () => seen.push(type)); return seen; };
const press = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', isPrimary: true }));
const hit = (x, y) => document.elementFromPoint(x, y);

let bench;
/** Put one fixture on the bench, in place of the last one. */
async function fixture(html) {
  bench ??= checkBench(); // made by the first check that needs it, so nothing shows before the tap
  for (const canvas of bench.querySelectorAll('canvas')) window.__gfx?.retire?.(canvas);
  getSelection().removeAllRanges();
  bench.innerHTML = `<style>
      #fixtures { --picker-accent: #d2491f; --picker-bg: #fff; --picker-ink: #111; }
      #fixtures canvas.raw { display: block; width: 300px; height: 120px; outline: 1px dashed #8888; }
      #fixtures canvas.multi-select { height: 150px; }
      #fixtures canvas.tilted-text { height: 230px; }
      #fixtures canvas.translate-in-place, #fixtures canvas.selection-ticks { height: 150px; }
      #fixtures canvas.control-selection { height: 190px; }
      #fixtures canvas.control-selection > textarea { height: 76px; }
    </style>${html}`;
  await frames(4);
  return bench;
}
/** One paint of a canvas that has no class from the library. */
function paintOnce(canvas, draw) {
  return new Promise((resolve, reject) => {
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    canvas.addEventListener('paint', () => { try { resolve(draw(canvas.getContext('2d'))); } catch (err) { reject(err); } }, { once: true });
    canvas.requestPaint();
  });
}
const OPTIONS = ['Basil', 'Cumin', 'Dill', 'Fennel', 'Garlic', 'Ginger'].map((v) => `<option drawable>${v}</option>`).join('');
const ARTICLE = `<article drawable><p><span data-s>The lock fills in about four minutes.</span> <span data-s>Keep the boat away from the gates while the water rises.</span></p><p><span data-s>Close both paddles before you leave.</span></p></article>`;
const select = (root, start, end) => { const range = textRange(root, start, end); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); return range; };

let suggest;

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. Every demo is the ordinary element.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'Suggestions: showPicker() opens a select that has no button, and the focus can go back to the input',
    why: 'Run first, while the tap that started the checks still counts as a user activation. The test input has inputmode="none".',
    run: async () => {
      await fixture(`<div style="position:relative;width:300px"><input id="fxInput" inputmode="none" style="width:100%;box-sizing:border-box;font:16px system-ui">
        <select id="fxSuggest"><button></button>
          <option value="LDS" data-name="Leeds" data-n="17"><span><b>Leeds</b><small>West Yorkshire</small></span></option>
          <option value="LEI" data-name="Leicester" data-n="4"><span><b>Leicester</b><small>Leicestershire</small></span></option>
          <option value="YRK" data-name="York" data-n="11"><span><b>York</b><small>North Yorkshire</small></span></option>
        </select></div>`);
      suggest = new SuggestSelect($('fxInput'), $('fxSuggest'));
      const input = $('fxInput');
      input.value = 'le';
      suggest.filter('le');
      if (!suggest.open()) throw new Error(suggest.note);
      const after = document.activeElement;
      await wait(500);
      if (!suggest.picker.open) throw new Error('the picker is not open');
      if (after !== input) throw new Error(`the focus is on ${after?.tagName}`);
      return `picker open, ${suggest.picker.frames} frames drawn, focus in the input, value of the select: "${$('fxSuggest').value}"`;
    },
  },
  {
    name: 'Suggestions: the rows that match are hit where the canvas draws them, and the others cannot be hit',
    run: async () => {
      if (!suggest?.picker?.open) throw new Error('the test picker did not open');
      const [leeds, leicester, york] = suggest.options;
      const mid = (o) => { const r = o.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const at = [leeds, leicester].map((o) => hit(...mid(o))?.closest('option') === o);
      const c = suggest.picker.canvas.getBoundingClientRect(), y = york.getBoundingClientRect();
      const yorkOut = y.right < c.left || y.left > c.right || y.bottom < c.top || y.top > c.bottom;
      if (suggest.order.join() !== '0,1' || !at.every(Boolean) || !yorkOut) throw new Error(`order ${suggest.order}, hit ${at}, York inside the canvas: ${!yorkOut}`);
      return `"le" ranks Leeds, Leicester. Both are hit on their rows, child elements included. York's box is outside the picker`;
    },
  },
  {
    name: 'Suggestions: taking a row sets the select, writes the input and fires change',
    run: async () => {
      if (!suggest?.picker?.open) throw new Error('the test picker did not open');
      const input = $('fxInput'), seen = events(input), seenSelect = events($('fxSuggest'));
      suggest.take(1);
      await wait(250);
      const state = [input.value, $('fxSuggest').value, suggest.picker.open, document.activeElement === input];
      input.blur();
      if (state.join() !== 'Leicester,LEI,false,true') throw new Error(`input "${state[0]}", select "${state[1]}", open ${state[2]}, focus in the input ${state[3]}`);
      return `input "Leicester", select value LEI, picker closed, focus in the input. Events on the select: ${seenSelect.join(', ')}. On the input: ${seen.join(', ')}`;
    },
  },
  {
    name: 'A canvas inside a select multiple is laid out and can draw the options',
    expect: 'fail',
    why: 'This is the arrangement that works for a customisable select with one value. For a list box it does not, so the demo puts the select inside the canvas.',
    run: async () => {
      suggest = null;
      await fixture(`<select multiple id="fxIn" style="width:300px;height:120px"><canvas class="raw" content="drawable" layoutsubtree>${OPTIONS}</canvas></select>`);
      const canvas = bench.querySelector('canvas'), option = canvas.querySelector('option');
      const size = `${canvas.clientWidth} by ${canvas.clientHeight} px`;
      canvas.width = 300; canvas.height = 120;
      const ctx = canvas.getContext('2d');
      const painted = await Promise.race([new Promise((resolve) => { canvas.addEventListener('paint', () => resolve(true), { once: true }); canvas.requestPaint(); }), wait(600).then(() => false)]);
      let error = '';
      try { ctx.drawElementImage(option, 0, 0, 80, 30); } catch (err) { error = err.message; }
      if (!canvas.clientWidth || error) throw new Error(`the canvas is ${size}, paint event: ${painted}, drawElementImage(option): ${error || 'no error'}`);
      return `the canvas is ${size}`;
    },
  },
  {
    name: 'Multiple select: every option of a list box in a canvas is drawn on its own and hit where it is drawn',
    run: async () => {
      await fixture(`<canvas id="fxMulti" content="drawable" layoutsubtree><select multiple drawable>${OPTIONS}</select></canvas>`);
      const multi = (window.__fxMulti = new MultiSelect($('fxMulti')));
      multi.lasso = true;
      await wait(300);
      if (multi.route !== 'options') throw new Error(multi.note);
      const r = multi.canvas.getBoundingClientRect();
      const missed = multi.options.filter((o, i) => { const s = multi.spots[i]; return hit(r.left + s.x + s.w / 2, r.top + s.y + s.h / 2) !== o; }).map((o) => o.label);
      const rows = new Set(multi.spots.map((s) => s.y)).size;
      if (missed.length) throw new Error(`not hit: ${missed.join(', ')}`);
      return `${multi.options.length} options in ${rows} rows of chips, each hit at its chip. ${multi.frames} frames`;
    },
  },
  {
    name: 'Multiple select: a lasso drawn with the pointer chooses the options inside it and fires input and change',
    run: async () => {
      const multi = window.__fxMulti, r = multi.canvas.getBoundingClientRect(), seen = events(multi.select);
      const [a, b] = multi.spots;
      const loop = [[a.x - 6, a.y - 6], [b.x + b.w + 5, b.y - 6], [b.x + b.w + 5, b.y + b.h + 5], [a.x - 6, a.y + a.h + 5], [a.x - 6, a.y - 4]];
      press(multi.canvas, 'pointerdown', r.left + loop[0][0], r.top + loop[0][1]);
      for (const [x, y] of loop.slice(1)) press(multi.canvas, 'pointermove', r.left + x, r.top + y);
      const drawing = multi.loop?.length;
      press(multi.canvas, 'pointerup', r.left + loop[4][0], r.top + loop[4][1]);
      await frames(3);
      const values = [...multi.select.selectedOptions].map((o) => o.label).join(', ');
      if (values !== 'Basil, Cumin' || seen.join() !== 'input,change') throw new Error(`selected: ${values || 'nothing'}, events: ${seen}, loop points: ${drawing}`);
      return `selected ${values}. Events: ${seen.join(', ')}. FormData would hold ${multi.select.selectedOptions.length} entries`;
    },
  },
  {
    name: 'Multiple select: with no option pictures the labels are drawn as text and a tap still toggles an option',
    why: 'On Android a select multiple is a button that opens a dialog, so its options may have no boxes. This route is forced here to test it.',
    run: async () => {
      await fixture(`<canvas id="fxMulti" content="drawable" layoutsubtree><select multiple drawable>${OPTIONS}</select></canvas>`);
      const multi = new MultiSelect($('fxMulti'), { route: 'text' });
      await wait(300);
      const r = multi.canvas.getBoundingClientRect(), s = multi.spots[3], seen = events(multi.select);
      press(multi.canvas, 'pointerdown', r.left + s.x + 10, r.top + s.y + 10);
      press(multi.canvas, 'pointerup', r.left + s.x + 10, r.top + s.y + 10);
      await frames(2);
      const values = [...multi.select.selectedOptions].map((o) => o.label).join(', ');
      if (values !== 'Fennel' || seen.join() !== 'input,change' || !multi.frames) throw new Error(`selected: ${values || 'nothing'}, events: ${seen}, frames: ${multi.frames}`);
      return `selected ${values} from a tap at its chip, events: ${seen.join(', ')}, ${multi.frames} frames`;
    },
  },
  {
    name: 'Selection in 3D: the caret under a point of the leaning plane is the letter drawn there',
    why: 'The picture is 2 px strips. The hit box is one matrix with a perspective row, given to updateElementGeometry() on a 2D canvas.',
    run: async () => {
      await fixture(`<canvas id="fxTilt" content="drawable" layoutsubtree>${ARTICLE}</canvas>`);
      const tilt = (window.__fxTilt = new TiltedText($('fxTilt'), { angle: 48 }));
      await wait(300);
      const r = tilt.canvas.getBoundingClientRect(), base = tilt.twin.getBoundingClientRect(), text = tilt.el.textContent;
      const results = [];
      for (const word of ['lock', 'gates', 'paddles']) {
        const at = text.indexOf(word);
        // Where the word is in the copy that has no transform, then where the plane puts that point.
        const q = textRange(tilt.twin, at, at + word.length).getBoundingClientRect();
        const [x, y] = tilt.project(tilt.matrix(), q.left - base.left + q.width / 2, q.top - base.top + q.height / 2);
        const caret = document.caretPositionFromPoint(r.left + x, r.top + y);
        const inArticle = caret && tilt.el.contains(caret.offsetNode);
        const before = new Range();
        if (inArticle) { before.selectNodeContents(tilt.el); before.setEnd(caret.offsetNode, caret.offset); }
        const offset = inArticle ? before.toString().length : -1;
        results.push({ word, ok: offset >= at && offset <= at + word.length, offset, at });
      }
      const bad = results.filter((x) => !x.ok);
      if (bad.length) throw new Error(bad.map((x) => `"${x.word}" starts at ${x.at}, the caret is at ${x.offset}`).join('. '));
      return `${tilt.draws} strips a frame at 48 degrees. The caret lands inside "lock", "gates" and "paddles" at the points where they are drawn`;
    },
  },
  {
    name: 'Selection in 3D: the selected lines are drawn again on the lifted slab',
    run: async () => {
      const tilt = window.__fxTilt, before = tilt.draws, text = tilt.el.textContent, at = text.indexOf('Keep');
      select(tilt.el, at, at + 40);
      await wait(450);
      const under = (() => {
        const p = tilt.el.querySelector('span'), a = p.getBoundingClientRect(), b = tilt.twin.querySelector('span').getBoundingClientRect();
        return `a sentence's rectangle is ${a.width.toFixed(0)} by ${a.height.toFixed(0)} px on the plane and ${b.width.toFixed(0)} by ${b.height.toFixed(0)} px in the copy`;
      })();
      const state = { rects: tilt.rects.length, draws: tilt.draws };
      getSelection().removeAllRanges();
      if (!state.rects || state.draws <= before) throw new Error(`${state.rects} selected lines, ${state.draws} strips against ${before} with no selection`);
      return `${state.rects} selected lines, ${state.draws - before} more strips. Measured on the copy because ${under}`;
    },
  },
  {
    name: 'After a draw with a source rectangle, updateElementGeometry() makes the whole element hit testable',
    expect: 'fail',
    why: 'The source rectangle of the last draw stays as a cut on the hit box. A matrix moves the cut box and does not undo it, so the demo draws the whole article once more at no opacity first.',
    run: async () => {
      await fixture(`<canvas class="raw" content="drawable" layoutsubtree><div drawable id="fxBlock" style="width:200px;height:100px;background:#8ac"></div></canvas>`);
      const canvas = bench.querySelector('canvas'), block = $('fxBlock');
      await paintOnce(canvas, (ctx) => {
        ctx.reset();
        ctx.drawElementImage(block, 0, 0, 200, 100);
        ctx.drawElementImage(block, 0, 0, 200, 10, 0, 0, 200, 10); // the top 10 px again
        canvas.updateElementGeometry(block, { canvasTransform: new DOMMatrix() });
      });
      block.toggleAttribute('data-moved');
      await frames(2);
      const r = canvas.getBoundingClientRect();
      const top = hit(r.left + 100, r.top + 5) === block, lower = hit(r.left + 100, r.top + 60) === block;
      if (!top) throw new Error('the strip that was drawn last is not hit either');
      if (!lower) throw new Error('hit in the top 10 px, which was the last source rectangle. Not hit 60 px down, where the element is also drawn');
      return 'the whole element is hit';
    },
  },
  {
    name: 'Translate in place: the translation is written into the lines of the sentence and the text is unchanged',
    run: async () => {
      await fixture(`<canvas id="fxTr" content="drawable" layoutsubtree>${ARTICLE}</canvas>`);
      const tr = new TranslateInPlace($('fxTr'));
      await wait(250);
      const original = tr.el.textContent, at = original.indexOf('boat');
      select(tr.el, at, at + 4);
      const picked = tr.picked().length;
      const n = await tr.translate(recorded(SENTENCES, 'fr'));
      await wait(700);
      const wrote = tr.last[0];
      const copied = String(getSelection());
      getSelection().removeAllRanges();
      if (picked !== 1 || n !== 1 || !wrote) throw new Error(`${picked} sentences picked, ${n} translated, ${tr.last.length} drawn. ${tr.note}`);
      if (wrote.lines.join(' ') !== SENTENCES['Keep the boat away from the gates while the water rises.'].fr || wrote.left) throw new Error(`wrote "${wrote.lines.join(' | ')}", ${wrote.left} words left over`);
      if (tr.el.textContent !== original || copied !== 'boat') throw new Error(`the text changed, or the selection is "${copied}"`);
      return `a selection of "boat" picked one sentence. Its French went into ${wrote.lines.length} lines at ${Math.round(wrote.scale * 100)}% width. The article's text and the selection ("${copied}") are unchanged`;
    },
  },
  {
    name: 'Haptics: one pulse for each word and each sentence that enters the selection',
    why: `vibrate() is not called in this check. navigator.vibrate ${'vibrate' in navigator ? 'exists' : 'is missing'} in this browser.`,
    run: async () => {
      await fixture(`<canvas id="fxTicks" content="drawable" layoutsubtree>${ARTICLE}</canvas>`);
      const ticks = new SelectionTicks($('fxTicks'));
      ticks.vibrate = false;
      await wait(250);
      const text = ticks.el.textContent;
      // Extend the selection a word at a time across the first sentence and into the second.
      for (const end of ['The', 'The lock', 'The lock fills', 'The lock fills in about four minutes.', 'The lock fills in about four minutes. Keep'].map((s) => s.length)) {
        select(ticks.el, 0, end);
        await wait(60);
      }
      const kinds = ticks.ticks.map((t) => t.kind).join(', ');
      const placed = ticks.ticks.every((t) => t.x > 0 && t.y > 0);
      getSelection().removeAllRanges();
      if (kinds !== 'word, word, word, sentence, word' || !placed) throw new Error(`pulses: ${kinds || 'none'}. Each has a place: ${placed}. Text starts "${text.slice(0, 12)}"`);
      return `five steps gave: ${kinds}. Each pulse has the place of the selection's moving end`;
    },
  },
  {
    name: 'Form controls: the selected letters of an input and a textarea are measured, drawn again and the control is still hit',
    why: 'A Range cannot enter a control. The input is measured with measureText(), the textarea with a hidden block of the same font and width.',
    run: async () => {
      await fixture(`<canvas id="fxControls" content="drawable" layoutsubtree><input id="fxBoat" value="Narrowboat Kingfisher" inputmode="none" drawable><textarea id="fxNote" inputmode="none" drawable>Moored above the top lock until Friday. Water at the next wharf.</textarea></canvas>`);
      const controls = new ControlSelection($('fxControls'));
      controls.always = true;
      const input = $('fxBoat'), area = $('fxNote');
      input.setSelectionRange(0, 10);
      area.setSelectionRange(7, 50);
      controls.again();
      await wait(300);
      const [a, b] = controls.last;
      if (!a || !b) throw new Error(`drew ${controls.last.length} of 2 controls. ${controls.note}`);
      const style = getComputedStyle(input);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = style.font;
      const width = ctx.measureText('Narrowboat').width, drawn = a.last.x + a.last.w - a.first.x;
      const lines = new Set(controls.letters(area).map((l) => Math.round(l.y))).size;
      const r = controls.canvas.getBoundingClientRect(), q = input.getBoundingClientRect();
      const whole = hit(q.right - 6, q.top + q.height / 2) === input && hit(r.left + 12 + 6, q.top + q.height / 2) === input;
      if (a.letters !== 10 || Math.abs(width - drawn) > 1 || lines < 2 || !whole) throw new Error(`input: ${a.letters} letters over ${drawn.toFixed(1)} px, measureText() says ${width.toFixed(1)} px. Textarea: ${b.letters} letters on ${lines} lines. Input hit at both ends: ${whole}`);
      return `input: 10 letters over ${drawn.toFixed(1)} px. Textarea: ${b.letters} letters on ${lines} lines. After the slices the input is hit at both ends`;
    },
  },
  stillDrawn(() => Object.entries(window.demos ?? {}).filter(([, d]) => d.canvas && d.ctx).map(([name, d]) => ({
    name,
    note: 'off screen',
    ink: () => {
      const canvas = d.canvas, r = canvas.getBoundingClientRect();
      if (canvas.hidden || r.bottom < 0 || r.top > innerHeight) return null; // a canvas that is not on screen is not painted
      // Read a copy, not the drawable canvas itself.
      const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
      copy.drawImage(canvas, 0, 0);
      return inkFraction(copy);
    },
    rescue: () => {
      unwrap(d.canvas);
      const note = $(`${name}Note`);
      if (note) note.textContent = 'This canvas was blank, so its content is shown as ordinary HTML.';
    },
  }))),
];

if (supported) {
  runTests($('results'), tests).then(() => {
    for (const canvas of bench?.querySelectorAll('canvas') ?? []) window.__gfx?.retire?.(canvas);
    getSelection().removeAllRanges();
    bench?.done();
  });
} else {
  runTests($('results'), tests.slice(0, 1));
}
