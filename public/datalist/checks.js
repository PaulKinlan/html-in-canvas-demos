// Live checks for /datalist/. They run on test inputs in a panel at the bottom
// of the window, never on the fields in the page. Nothing here takes focus:
// the pickers are opened with show() and keys are sent as synthetic events.
import { runTests, checkBench, stillDrawn, inkFraction, supported } from '/shared/support.js';
import { DatalistPicker, RangeLabels } from '/lib/datalist-picker.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const short = (message) => String(message).replace(/^Failed to execute '\w+' on '\w+': /, '');

function build(bench) {
  bench.innerHTML = `
    <style>
      #fixtures input { font: 14px system-ui; }
      #fixtures canvas.probe { display: block; width: 200px; height: 40px; outline: 1px dashed #8888; }
      #fixtures #probeList { display: block; }
      #fixtures #probeList option { width: 60px; height: 24px; background: rgb(255, 204, 0); color: #000; }
      #rangeBench { width: 260px; }
    </style>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:start">
      <input id="fxInput" list="fxList" picker="list" size="12">
      <datalist id="fxList"><option value="Apple"><option value="Apricot" label="stone fruit"><option value="Banana"><option value="Cherry"></datalist>
      <canvas class="probe" id="probe" content="drawable" layoutsubtree>
        <datalist id="probeList"><option id="bare">bare</option><option id="marked" drawable>marked <b id="child">child</b></option></datalist>
      </canvas>
      <div id="rangeBench"><input id="fxRange" type="range" min="0" max="10" value="0" list="fxTicks"><datalist id="fxTicks"><option value="0">low</option><option value="5">mid</option><option value="10">high</option></datalist></div>
    </div>`;
}

let picker, hadList, settled;
/** Open the test picker once. */
function opened() {
  settled ??= (async () => {
    const input = $('fxInput');
    hadList = input.list === $('fxList');
    picker = new DatalistPicker(input);
    picker.show();
    await wait(500); // the open animation and the first paint
    return picker;
  })();
  return settled;
}

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. The fields use the browser\'s own datalist popup.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'An option in a datalist in a canvas can be drawn when it has the drawable attribute',
    why: 'The datalist is display: block and a child of the canvas. The options are its grandchildren.',
    run: async () => {
      const probe = $('probe');
      const got = await new Promise((resolve) => {
        probe.addEventListener('paint', () => {
          const ctx = probe.getContext('2d'), out = {};
          for (const id of ['bare', 'marked']) {
            // gfx-allow: draw-size the probe canvas has a new, unscaled context and a backing size equal to its CSS size
            try { ctx.drawElementImage($(id), id === 'bare' ? 4 : 80, 6); out[id] = 'drawn'; } catch (err) { out[id] = short(err.message); }
          }
          out.ink = inkFraction(ctx);
          resolve(out);
        }, { once: true });
        probe.requestPaint();
      });
      if (got.marked !== 'drawn' || !(got.ink > 0.01)) throw new Error(`with drawable: ${got.marked}, ${(got.ink * 100).toFixed(1)}% of pixels`);
      return `with drawable: drawn. Without: ${got.bare}`;
    },
  },
  {
    name: 'An element inside a datalist option is rendered',
    expect: 'fail',
    why: 'The option contains <b>child</b>. Options in a customisable select render their children.',
    run: async () => {
      const child = $('child'), r = child.getBoundingClientRect();
      if (r.width > 0 && child.checkVisibility()) return `${Math.round(r.width)} px wide`;
      throw new Error(`the <b> has no box (checkVisibility() is ${child.checkVisibility()}). The option shows the text "${$('marked').innerText}". Computed display of the option: ${getComputedStyle($('marked')).display}`);
    },
  },
  {
    name: 'Taking the datalist over: the input has no list, the options stay in the datalist',
    why: 'The list attribute is removed so the browser shows no popup. The datalist element is moved into the popover canvas.',
    run: async () => {
      const p = await opened(), input = $('fxInput');
      if (!hadList) throw new Error('the input had no list before');
      if (input.list) throw new Error('input.list is still set');
      if (p.datalist.options.length !== 4 || !p.pop.canvas.contains(p.datalist)) throw new Error(`${p.datalist.options.length} options, in canvas: ${p.pop.canvas.contains(p.datalist)}`);
      if (!(p.pop.frames > 0)) throw new Error(p.pop.note || 'the popover canvas drew no frame');
      return `4 options in the canvas, ${p.pop.frames} frames drawn, role ${input.role}, aria-expanded ${input.ariaExpanded}`;
    },
  },
  {
    name: 'elementFromPoint() at a drawn suggestion returns its <option>',
    run: async () => {
      const p = await opened();
      const hits = p.options.map((option) => document.elementFromPoint(...mid(option)) === option);
      if (!hits.every(Boolean)) throw new Error(`hit: ${hits.join(', ')}`);
      return 'all 4 options';
    },
  },
  {
    name: 'Typing filters, and an option that no longer matches cannot be hit',
    why: 'The value is set to "ap" and an input event is dispatched. Banana and Cherry fade out and their hit boxes are moved away.',
    run: async () => {
      const p = await opened(), input = $('fxInput');
      const banana = p.options[2], where = mid(banana);
      input.value = 'ap';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(700);
      const at = document.elementFromPoint(...where);
      if (p.order.length !== 2) throw new Error(`${p.order.length} matches`);
      if (at === banana) throw new Error('Banana is still hit where it was drawn');
      const b = banana.getBoundingClientRect();
      return `2 matches. Banana's box is now at ${Math.round(b.left)}, ${Math.round(b.top)}`;
    },
  },
  {
    name: 'Arrow down and Enter choose a suggestion and fire input and change',
    why: 'Synthetic key events on the input. Focus stays where it was.',
    run: async () => {
      const p = await opened(), input = $('fxInput');
      const seen = [], before = document.activeElement;
      for (const type of ['input', 'change']) input.addEventListener(type, () => seen.push(type));
      const key = (k) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      key('ArrowDown'); key('ArrowDown');
      const active = input.getAttribute('aria-activedescendant');
      await frames(3);
      key('Enter');
      await frames(2);
      if (input.value !== 'Apricot') throw new Error(`value "${input.value}", active ${active}`);
      if (p.open) throw new Error('the popover stayed open');
      if (document.activeElement !== before) throw new Error('focus moved');
      return `value "Apricot", aria-activedescendant was ${active}, events: ${seen.join(', ')}, popover closed`;
    },
  },
  {
    name: 'A datalist option drawn under a range input is hit tested, and a click on it sets the value',
    run: async () => {
      const labels = new RangeLabels($('fxRange'));
      await wait(300);
      if (!(labels.frames > 0)) throw new Error(labels.note || 'no frame drawn');
      const high = $('fxTicks').options[2];
      const hit = document.elementFromPoint(...mid(high)) === high;
      high.click();
      await frames(2);
      if (!hit || $('fxRange').value !== '10') throw new Error(`hit ${hit}, value ${$('fxRange').value}`);
      const r = high.getBoundingClientRect(), c = labels.canvas.getBoundingClientRect();
      return `value 10. The "high" label is drawn ${Math.round(c.right - r.right)} px from the right edge`;
    },
  },
  stillDrawn(() => [['tilt', 'rotated input'], ['zoom', 'range labels']].map(([id, name]) => ({
    name,
    note: 'off screen',
    ink: () => {
      const canvas = id === 'tilt' ? $('tilt') : $('zoom').closest('canvas'), r = canvas.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return null; // a canvas that is not on screen is not painted
      return inkFraction(canvas.getContext('2d'));
    },
  }))),
];

if (supported) {
  const bench = checkBench();
  build(bench);
  runTests($('results'), tests).then(() => { picker?.hide(); bench.done(); });
} else {
  runTests($('results'), tests.slice(0, 1));
}
