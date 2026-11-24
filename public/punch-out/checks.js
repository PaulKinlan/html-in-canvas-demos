// Live checks for /punch-out/. They run on one test select in a panel at the
// bottom of the window, never on the selects in the page.
//
// showPicker() needs a tap and uses it up, so the test select is opened once
// and every check measures that one open picker. The last check closes it.
import { runTests, checkBench, supported } from '/shared/support.js';
import { punchOut, PUNCH, supported as pickerSupported } from '/lib/punch-out.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
const name = (el) => (el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') : 'nothing');

let bench = null, state = null;
function build() {
  bench = checkBench(); // made here, on the first check, because the panel shows as soon as it exists
  bench.innerHTML = `
    <style>
      #fxRow { height: 36px; }
      #fx { appearance: base-select; display: block; font: 14px system-ui; width: 110px; height: 36px; padding: 4px 10px; border-radius: 10px; border: 1px solid #8886; --picker-bg: rgb(255, 255, 255); --picker-ink: #000; }
      #fx option { width: 84px; height: 30px; padding: 0; border-radius: 15px; background: rgb(0, 120, 200); color: #fff; font: 12px system-ui; justify-content: center; }
      #fx.through > canvas { pointer-events: none; }
      #fx.through option { pointer-events: auto; }
    </style>
    <div id="fxRow"><select id="fx">
      <button><selectedcontent></selectedcontent></button>
      ${Array.from({ length: 8 }, (_, i) => `<option value="o${i}">o${i}</option>`).join('')}
    </select></div>`;
}
/** Open the test select once. */
function opened() {
  state ??= (async () => {
    build();
    const fx = $('fx'), picker = punchOut(fx);
    try { fx.showPicker(); } catch (err) { return { problem: `showPicker() was refused: ${err.message}` }; }
    for (let i = 0; i < 20 && !fx.matches(':open'); i++) await frames(1);
    if (!fx.matches(':open')) return { problem: 'showPicker() did not open the picker' };
    await wait(700); // the menu takes about 0.4 s to open
    return { fx, picker };
  })();
  return state;
}
const need = (p) => { if (p.problem) throw new Error(p.problem); return p; };
/** Draw again and wait. Toggling an attribute clears Chromium's remembered hit-test answers. */
async function redraw(picker) {
  picker.canvas.toggleAttribute('data-n');
  picker.canvas.requestPaint();
  await frames(4);
}
/** The menu's rectangle on screen: the canvas without the margin kept for the shadow. */
function menuRect(picker) {
  const c = picker.canvas.getBoundingClientRect(), g = picker.s.punch, M = PUNCH.margin;
  return new DOMRect(c.left + M, c.top + g.top, g.w, g.h);
}
/** One canvas pixel, read from a 1 by 1 drawImage() copy. */
function alphaAt(picker, x, y) {
  const c = picker.canvas, r = c.getBoundingClientRect();
  const copy = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
  const ctx = copy.getContext('2d');
  ctx.drawImage(c, Math.round((x - r.left) * (c.width / r.width)), Math.round((y - r.top) * (c.height / r.height)), 1, 1, 0, 0, 1, 1);
  return ctx.getImageData(0, 0, 1, 1).data[3];
}

const tests = [
  {
    name: 'appearance: base-select and HTML-in-canvas are both available',
    why: 'Without either, the selects on this page are plain selects.',
    run: async () => {
      if (!pickerSupported) throw new Error(`base-select: ${CSS.supports('appearance', 'base-select')}, drawElementImage: ${supported}`);
      return 'both available';
    },
  },
  {
    name: 'anchor() places the picker over its own button',
    why: `The menu's corner should be ${PUNCH.gap} px outside the button's corner, on whichever sides the @position-try rules chose.`,
    timeout: 30000,
    run: async () => {
      const { fx, picker } = need(await opened());
      const b = fx.getBoundingClientRect(), m = menuRect(picker), g = picker.s.punch;
      const dx = g.flipX ? m.right - b.right : b.left - m.left, dy = g.flipY ? m.bottom - b.bottom : b.top - m.top;
      if (Math.abs(dx - PUNCH.gap) > 1 || Math.abs(dy - PUNCH.gap) > 1) throw new Error(`the menu's corner is ${dx.toFixed(1)}, ${dy.toFixed(1)} px from the button's`);
      if (m.width < b.width + 60 || m.height < b.height + 20) throw new Error(`menu ${m.width.toFixed(0)} by ${m.height.toFixed(0)} px`);
      return `the menu is ${m.width.toFixed(0)} by ${m.height.toFixed(0)} px and covers the button, which is in its ${g.flipY ? 'bottom' : 'top'} ${g.flipX ? 'right' : 'left'} corner, ${dx.toFixed(1)} px in`;
    },
  },
  {
    name: 'The options flow round the button',
    why: 'No option may overlap the button. At least one line is level with it, and at least one line runs past it on the far side.',
    run: async () => {
      const { fx, picker } = need(await opened());
      const b = fx.getBoundingClientRect(), rects = picker.options.map((o) => o.getBoundingClientRect());
      const over = rects.filter((r) => overlap(r, b)).length;
      const level = rects.filter((r) => r.top < b.bottom && r.bottom > b.top).length;
      const past = rects.filter((r) => (r.top >= b.bottom || r.bottom <= b.top) && r.left < b.right && r.right > b.left).length;
      if (over) throw new Error(`${over} options overlap the button`);
      if (!level || !past) throw new Error(`${level} options level with the button, ${past} above or below it`);
      const inside = rects.every((r) => { const m = menuRect(picker); return r.left >= m.left && r.right <= m.right + 0.5 && r.top >= m.top && r.bottom <= m.bottom + 0.5; });
      if (!inside) throw new Error('an option is outside the menu');
      return `${rects.length} options in ${picker.s.punch.lines} lines: ${level} level with the button, ${past} directly ${picker.s.punch.flipY ? 'above' : 'below'} it, none over it`;
    },
  },
  {
    name: 'Every option is hit where it is drawn',
    run: async () => {
      const { picker } = need(await opened());
      const missed = picker.options.filter((o) => document.elementFromPoint(...mid(o)) !== o).map((o) => o.value);
      if (missed.length) throw new Error(`not hit: ${missed.join(', ')}`);
      return `elementFromPoint() returned each of the ${picker.options.length} options at its centre`;
    },
  },
  {
    name: 'The canvas has no pixels where the button is',
    why: 'Read from a 1 by 1 drawImage() copy: one pixel at the button\'s centre and one in the menu beside an option.',
    run: async () => {
      const { fx, picker } = need(await opened());
      const m = menuRect(picker), g = picker.s.punch;
      const hole = alphaAt(picker, ...mid(fx));
      const menu = alphaAt(picker, g.flipX ? m.left + 4 : m.right - 4, g.flipY ? m.top + 4 + PUNCH.radius : m.bottom - 4 - PUNCH.radius);
      if (hole !== 0 || menu < 250) throw new Error(`alpha ${hole} at the button, ${menu} in the menu`);
      return `alpha ${hole} at the button's centre, ${menu} in the menu`;
    },
  },
  {
    name: 'A canvas lets a press through where it has no pixels',
    expect: 'fail',
    why: 'With no clip-path, elementFromPoint() at the button\'s centre. The picture has a hole there, the canvas\'s box doesn\'t.',
    run: async () => {
      const { fx, picker } = need(await opened());
      picker.clip = false;
      await redraw(picker);
      const hit = document.elementFromPoint(...mid(fx));
      picker.clip = true;
      await redraw(picker);
      if (hit !== fx) throw new Error(`the point at the button's centre is on ${name(hit)}`);
      return 'the select';
    },
  },
  {
    name: 'With the corner cut from the canvas by clip-path, the button is under the pointer',
    why: 'elementFromPoint() at the button\'s centre while the menu is open. A real press is the full test: use the first select on the page and read the list under it.',
    run: async () => {
      const { fx, picker } = need(await opened());
      const hit = document.elementFromPoint(...mid(fx));
      if (hit !== fx) throw new Error(`the point at the button's centre is on ${name(hit)}`);
      const stillHit = picker.options.every((o) => document.elementFromPoint(...mid(o)) === o);
      if (!stillHit) throw new Error('an option is no longer hit');
      return `the select is at the button's centre, and the options are still hit. clip-path: ${picker.canvas.style.clipPath.slice(0, 40)}…`;
    },
  },
  {
    name: 'pointer-events: none on the canvas, auto on its options, is a second route to the button',
    why: 'No clip-path. The same three points: the button, an option, and the menu between two options.',
    run: async () => {
      const { fx, picker } = need(await opened());
      picker.clip = false;
      fx.classList.add('through');
      await redraw(picker);
      const first = picker.options[0].getBoundingClientRect(), g = picker.s.punch, m = menuRect(picker);
      const button = document.elementFromPoint(...mid(fx));
      const option = document.elementFromPoint(...mid(picker.options[0]));
      const between = document.elementFromPoint(g.flipX ? m.left + 4 : m.right - 4, g.flipY ? m.top + 4 + PUNCH.radius : m.bottom - 4 - PUNCH.radius);
      fx.classList.remove('through');
      picker.clip = true;
      await redraw(picker);
      if (button !== fx || option !== picker.options[0]) throw new Error(`button point: ${name(button)}, option point: ${name(option)} (${first.width.toFixed(0)} px wide)`);
      return `the button and the option are both hit. The menu between options is not: that point is on ${name(between)}, so a press there goes to whatever is behind the menu`;
    },
  },
  {
    name: 'The cut follows the button when the button moves to the other side',
    why: 'The test select is moved to the right end of its row while its picker is open.',
    run: async () => {
      const { fx, picker } = need(await opened());
      const before = picker.s.punch.flipX;
      fx.style.marginLeft = `${fx.parentNode.clientWidth - fx.offsetWidth}px`;
      await frames(3);
      await redraw(picker);
      const g = picker.s.punch, b = fx.getBoundingClientRect(), m = menuRect(picker);
      const over = picker.options.filter((o) => overlap(o.getBoundingClientRect(), b)).length;
      const hit = document.elementFromPoint(...mid(fx)), options = picker.options.every((o) => document.elementFromPoint(...mid(o)) === o);
      const result = { flipX: g.flipX, dx: m.right - b.right };
      fx.style.marginLeft = '';
      await frames(3);
      await redraw(picker);
      if (before || !result.flipX) throw new Error(`the cut was on the ${before ? 'right' : 'left'} and is on the ${result.flipX ? 'right' : 'left'} after the move`);
      if (over || hit !== fx || !options) throw new Error(`${over} options over the button, button point on ${name(hit)}, options hit: ${options}`);
      return `the cut moved from the left corner to the right corner, ${result.dx.toFixed(1)} px in. No option is over the button, and the button and options are hit`;
    },
  },
  {
    name: 'Choosing an option sets the value, fires input and change, and closes the picker',
    why: 'Run last, because it closes the test picker.',
    run: async () => {
      const { fx, picker } = need(await opened());
      const seen = [];
      for (const type of ['input', 'change']) fx.addEventListener(type, () => seen.push(type), { once: true });
      picker.choose(5, { close: true });
      await frames(4);
      if (fx.value !== 'o5' || seen.join() !== 'input,change' || fx.matches(':open')) throw new Error(`value ${fx.value}, events: ${seen.join(', ') || 'none'}, open: ${fx.matches(':open')}`);
      return `value ${fx.value}, events: ${seen.join(', ')}, closed`;
    },
  },
];

// Not started on load: the test picker needs a tap, and it opens in the top layer.
runTests($('results'), supported ? tests : tests.slice(0, 1)).then(() => bench?.done());
