// Live checks for /select-ideas/. They run on one test select in a panel at
// the bottom of the window, never on the selects in the page.
//
// showPicker() needs a tap and uses it up, so one tap opens one picker. The
// test select therefore holds five canvases, one per layout, in a box that
// scrolls. Each check scrolls that box to its canvas and measures there.
import { runTests, checkBench, supported } from '/shared/support.js';
import { ideaPicker, sampleColours, flyToButton, supported as pickerSupported } from '/lib/select-ideas.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const short = (message) => String(message).replace(/^Failed to execute '\w+' on '\w+': /, '');

function build(bench) {
  const options = (n, attrs = () => '') => Array.from({ length: n }, (_, i) => `<option value="o${i}" ${attrs(i)}>o${i}</option>`).join('');
  bench.innerHTML = `
    <style>
      #fx { appearance: base-select; font: 14px system-ui; min-height: 30px; }
      #fx::picker(select) { appearance: base-select; border: 1px solid #8886; padding: 0; margin: 2px 0; background: Canvas; }
      #fxBox { max-height: 340px; width: min(372px, calc(100vw - 16px)); overflow: auto; }
      #fx canvas { box-shadow: none; border-radius: 0; border: 0; }
      #fx #cLens option { width: 122px; height: 26px; }
      #fx #cJelly option { width: 200px; height: 40px; background: rgb(255, 204, 0); color: #000; }
      #fx #cSeats option { width: 22px; height: 20px; padding: 0; background: rgb(0, 120, 200); color: #fff; font-size: 10px; }
      #fx #cSample option { width: 22px; height: 22px; padding: 0; border-radius: 50%; background: #fff; font-size: 0; }
      #fx #cFly option { width: 140px; height: 80px; background: rgb(0, 160, 0); color: #fff; }
    </style>
    <select id="fx">
      <button><selectedcontent></selectedcontent></button>
      <div id="fxBox">
        <canvas id="cLens">${options(30)}</canvas>
        <canvas id="cJelly">${options(3)}</canvas>
        <canvas id="cSeats">${[0, 1, 2].map((row) => [-1, 0, 1].map((at) => `<option value="s${row}${at + 1}" data-row="${row}" data-seat="${at * 0.6}" ${row === 1 && at === 0 ? 'disabled' : ''}>${at + 2}</option>`).join('')).join('')}</canvas>
        <canvas id="cSample"><option value="#ff0000" data-h="0" data-l="50">red</option><option value="#0000ff" data-h="240" data-l="50">blue</option></canvas>
        <canvas id="cFly"><option value="f0">card one</option><option value="f1">card two</option></canvas>
      </div>
    </select>`;
}

let state = null;
/** Open the test select once and make the five pickers. */
function opened() {
  state ??= (async () => {
    const fx = $('fx');
    const p = {
      lens: ideaPicker(fx, 'lens', { canvas: $('cLens') }),
      jelly: ideaPicker(fx, 'jelly', { canvas: $('cJelly') }),
      seats: ideaPicker(fx, 'seats', { canvas: $('cSeats') }),
      sample: sampleColours(fx, { canvas: $('cSample') }),
      fly: flyToButton(fx, { canvas: $('cFly') }),
    };
    try { fx.showPicker(); } catch (err) { return { problem: `showPicker() was refused: ${err.message}` }; }
    for (let i = 0; i < 20 && !fx.matches(':open'); i++) await frames(1);
    if (!fx.matches(':open')) return { problem: 'showPicker() did not open the picker' };
    p.jellyEarly = await (async () => {
      // Read the springs while the options are still falling in.
      await frames(6);
      const o = p.jelly.options[2], a = o.getBoundingClientRect().top;
      await frames(3);
      return { moved: Math.abs(o.getBoundingClientRect().top - a), hit: document.elementFromPoint(...mid(o)) === o };
    })();
    await wait(500);
    return p;
  })();
  return state;
}
/** Bring one canvas of the test select into view inside its box. */
async function see(picker) {
  $('fxBox').scrollTop = picker.canvas.offsetTop - $('fxBox').offsetTop;
  picker.canvas.requestPaint();
  await frames(4);
}
/** Put a pretend pointer at a canvas point and draw. */
async function point(picker, x, y) {
  Object.assign(picker.s, { pointer: true, px: x, py: y });
  picker.canvas.requestPaint();
  await frames(4);
  const r = picker.canvas.getBoundingClientRect();
  return [r.left + x, r.top + y];
}
const need = (p) => { if (p.problem) throw new Error(p.problem); return p; };

const tests = [
  {
    name: 'appearance: base-select and HTML-in-canvas are both available',
    why: 'Without either, the five selects on this page are plain selects.',
    run: async () => {
      if (!pickerSupported) throw new Error(`base-select: ${CSS.supports('appearance', 'base-select')}, drawElementImage: ${supported}`);
      return 'both available';
    },
  },
  {
    name: 'Lens: an option drawn twice in one frame is hit where it was drawn last',
    why: 'Every option is drawn small, then the ones near the pointer are drawn again enlarged. elementFromPoint() at the pointer should return the enlarged option.',
    timeout: 30000,
    run: async () => {
      const { lens } = need(await opened());
      await see(lens);
      const at = await point(lens, 60, 90);
      const hit = document.elementFromPoint(...at)?.closest('option');
      lens.s.pointer = false;
      if (!hit || !lens.options.includes(hit)) throw new Error(`hit ${hit?.tagName ?? document.elementFromPoint(...at)?.tagName}`);
      const r = hit.getBoundingClientRect(), small = 26 * lens.s.lens.k;
      if (!(r.height > small * 2)) throw new Error(`the option at the pointer is ${r.height.toFixed(1)} px tall, the small copy is ${small.toFixed(1)} px`);
      return `"${hit.value}" is hit at ${r.height.toFixed(0)} px tall. Its small copy is ${small.toFixed(0)} px tall`;
    },
  },
  {
    name: 'Springs: an option is hit tested where it is drawn while it is moving',
    why: 'Measured a few frames after the picker opens, while the options fall in with a skew and a squash.',
    run: async () => {
      const p = need(await opened());
      if (!p.jellyEarly.hit) throw new Error('elementFromPoint() at the moving option did not return it');
      await see(p.jelly);
      const still = p.jelly.options.every((o) => document.elementFromPoint(...mid(o)) === o);
      if (!still) throw new Error('an option at rest is not hit at its drawn position');
      return `hit while moving (${p.jellyEarly.moved.toFixed(1)} px in 3 frames) and at rest`;
    },
  },
  {
    name: 'Seat plan: a rotated seat is hit where it is drawn, and a disabled seat is not chosen',
    run: async () => {
      const { seats } = need(await opened());
      await see(seats);
      const corner = seats.options[0], taken = seats.options.findIndex((o) => o.disabled);
      const hit = document.elementFromPoint(...mid(corner)) === corner;
      const r = corner.getBoundingClientRect();
      const before = $('fx').value;
      seats.choose(taken);
      if (!hit) throw new Error('the first seat is not hit at its drawn position');
      if ($('fx').value !== before) throw new Error(`the disabled seat became the value: ${$('fx').value}`);
      return `the seat's box is ${r.width.toFixed(0)} by ${r.height.toFixed(0)} px on screen for a 22 by 20 px option, so it is rotated. The disabled seat was refused`;
    },
  },
  {
    name: 'Colour field: getImageData() reads the picker canvas after options were drawn into it',
    why: 'A canvas that has had elements drawn into it might refuse to be read. If it does, the field\'s own canvas is read instead.',
    run: async () => {
      const { sample } = need(await opened());
      await see(sample);
      const got = sample.read(sample.s.w * 0.4, 80);
      if (!/^the picker canvas/.test(got.from)) throw new Error(`read from ${got.from}`);
      return `read rgb(${got.rgb.join(', ')}) from ${got.from}`;
    },
  },
  {
    name: 'Colour field: the colour at a point becomes a new option and the value',
    run: async () => {
      const { sample } = need(await opened());
      await see(sample);
      const n = sample.options.length, seen = [];
      for (const type of ['input', 'change']) $('fx').addEventListener(type, () => seen.push(type), { once: true });
      const got = sample.addAt(sample.s.w * 0.4, 80, { close: false });
      await frames(4);
      const hit = document.elementFromPoint(...mid(got.option)) === got.option;
      if (sample.options.length !== n + 1 || $('fx').value !== got.hex) throw new Error(`${sample.options.length} options, value ${$('fx').value}`);
      if (!hit) throw new Error('the new option is not hit where it is drawn');
      return `added ${got.hex}, value ${$('fx').value}, events: ${seen.join(', ')}, the new option is drawn and hit`;
    },
  },
  {
    name: 'Option into the button: the chosen option\'s pixels can be copied out of the picker canvas',
    why: 'drawImage() from the picker canvas into a second canvas, which then moves to the button.',
    run: async () => {
      const { fly } = need(await opened());
      await see(fly);
      $('fx').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // the library notes where the options are on a press
      const flight = fly.fly(1);
      if (!flight) throw new Error('no flight started');
      if (!(flight.ink > 0.5)) throw new Error(`${flight.drawn}; pixels: ${flight.ink}`);
      return `${flight.drawn}, ${(flight.ink * 100).toFixed(0)}% of its pixels are painted, from ${flight.from.slice(0, 2).join(', ')} to ${flight.to.join(', ')}`;
    },
  },
  {
    name: 'An option can still be drawn in the frame after the picker closes',
    expect: 'fail',
    why: 'Run last, because it closes the test picker. This is why the flight above uses a copy of the pixels.',
    run: async () => {
      const { fly } = need(await opened());
      fly.close();
      await frames(3);
      const option = fly.options[0];
      try {
        fly.canvas.getContext('2d').drawElementImage(option, 0, 0, option.offsetWidth || 140, option.offsetHeight || 80);
      } catch (err) { throw new Error(short(err.message)); }
      return 'drawn';
    },
  },
];

if (supported) {
  const bench = checkBench();
  build(bench);
  // Not started on load: the test picker needs a tap, and it opens in the top layer.
  runTests($('results'), tests).then(() => bench.done());
} else {
  runTests($('results'), tests.slice(0, 1));
}
