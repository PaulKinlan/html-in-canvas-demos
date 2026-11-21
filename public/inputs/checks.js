// Live checks for /inputs/. They run on test inputs in a panel at the bottom
// of the window, never on the fields in the page. Nothing here takes focus:
// the pickers are opened with show() and pressed with click().
import { runTests, checkBench, stillDrawn, inkFraction, supported } from '/shared/support.js';
import { ClockPicker, CalendarPicker, SwatchPicker } from '/lib/input-pickers.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

function build(bench) {
  bench.innerHTML = `
    <style>
      #fixtures input { font: 14px system-ui; }
      #fixtures canvas.probe { display: block; width: 320px; height: 84px; outline: 1px dashed #8888; }
    </style>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:start">
      <input id="fxTime" type="time" value="09:30">
      <input id="fxDate" type="date" value="2026-11-21">
      <input id="fxColor" type="color" value="#000000" list="fxPalette">
      <datalist id="fxPalette"><option value="#ff0000"><option value="#00ff00"><option value="#0000ff"></datalist>
      <canvas class="probe" id="probe" content="drawable" layoutsubtree>
        <span id="probeBox" drawable style="display:flex;gap:6px;padding:4px;width:max-content">
          <input id="pDate" type="date" value="2026-11-21"><input id="pRange" type="range" value="0" style="width:70px"><input id="pCheck" type="checkbox">
        </span>
      </canvas>
    </div>`;
}

/** Open a picker without a tap and wait for its opening animation. */
async function open(picker) {
  picker.show();
  await wait(450);
  if (!(picker.pop.frames > 0)) throw new Error(picker.pop.note || 'the picker canvas drew no frame');
  return picker;
}
const events = (input) => { const seen = []; for (const type of ['input', 'change']) input.addEventListener(type, () => seen.push(type)); return seen; };

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. The fields use the browser\'s own pickers.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'Built-in date, range and checkbox inputs drawn rotated are hit tested where they are drawn',
    why: 'elementFromPoint() at the centre of each drawn control, then a click on the checkbox.',
    run: async () => {
      const probe = $('probe'), box = $('probeBox');
      probe.width = probe.clientWidth; probe.height = probe.clientHeight;
      await new Promise((resolve) => {
        probe.addEventListener('paint', () => {
          const ctx = probe.getContext('2d');
          ctx.reset();
          ctx.translate(14, 4);
          ctx.rotate(0.12);
          ctx.drawElementImage(box, 0, 0, box.offsetWidth, box.offsetHeight);
          resolve();
        }, { once: true });
        probe.requestPaint();
      });
      await frames(3);
      const hits = ['pDate', 'pRange', 'pCheck'].map((id) => document.elementFromPoint(...mid($(id))) === $(id));
      $('pCheck').click();
      const ink = inkFraction(probe.getContext('2d'));
      if (!hits.every(Boolean) || !(ink > 0.01)) throw new Error(`date ${hits[0]}, range ${hits[1]}, checkbox ${hits[2]}, ${(ink * 100).toFixed(1)}% of pixels`);
      const r = $('pDate').getBoundingClientRect();
      return `all three. The date input's bounding box is ${Math.round(r.height)} px tall on screen and ${$('pDate').offsetHeight} px in layout`;
    },
  },
  {
    name: 'Clock: the hour buttons are hit where they are drawn, and the minute buttons are not while hidden',
    run: async () => {
      const p = await open(new ClockPicker($('fxTime')));
      const hour = p.hours[3], minute = p.minutes[3];
      const hit = document.elementFromPoint(...mid(hour)) === hour;
      const m = minute.getBoundingClientRect();
      if (!hit) throw new Error('the 3 o\'clock button is not hit at its drawn position');
      if (m.left > -1000) throw new Error(`the hidden "15 minutes" button is at ${Math.round(m.left)}, ${Math.round(m.top)}`);
      return `"3" is hit. The hidden "15" button's box is at ${Math.round(m.left)}, ${Math.round(m.top)}`;
    },
  },
  {
    name: 'Clock: choosing an hour and a minute writes the value and fires input and change',
    why: 'The buttons are activated as a keyboard would, with click().',
    run: async () => {
      const input = $('fxTime'), seen = events(input);
      const p = ClockPicker.for(input);
      p.hours[14].click();
      await wait(450); // the hours fold away and the minutes come out
      const minute = p.minutes[9];
      const hit = document.elementFromPoint(...mid(minute)) === minute;
      minute.click();
      await frames(2);
      if (input.value !== '14:45') throw new Error(`value ${input.value}`);
      if (!hit) throw new Error('the "45" button was not hit where it is drawn after the change of ring');
      if (p.open) throw new Error('the picker stayed open');
      return `value 14:45, events: ${seen.join(', ')}, picker closed`;
    },
  },
  {
    name: 'Calendar: a day button is hit where it is drawn, and choosing it writes the value',
    run: async () => {
      const input = $('fxDate'), seen = events(input);
      const p = await open(new CalendarPicker(input));
      const day = [...p.pop.canvas.querySelectorAll('.day')].find((b) => b.dataset.date === '2026-11-05' && b.getBoundingClientRect().left > 0);
      if (!day) throw new Error('no button for 5 November 2026');
      const hit = document.elementFromPoint(...mid(day)) === day;
      const label = day.ariaLabel;
      day.click();
      await frames(2);
      if (!hit || input.value !== '2026-11-05') throw new Error(`hit ${hit}, value ${input.value}`);
      return `value 2026-11-05, accessible name "${label}", events: ${seen.join(', ')}`;
    },
  },
  {
    name: 'Calendar: after a change of month the old days cannot be hit',
    why: 'The picker has two sets of 42 day buttons. The set that slid out must not take clicks.',
    run: async () => {
      const p = await open(CalendarPicker.for($('fxDate')));
      p.turn(1);
      await wait(700);
      const days = [...p.pop.canvas.querySelectorAll('.day')];
      const r = p.pop.canvas.getBoundingClientRect();
      const inside = days.filter((b) => { const [x, y] = mid(b); return x > r.left && x < r.right && y > r.top && y < r.bottom; });
      const wrong = inside.filter((b) => document.elementFromPoint(...mid(b)) !== b).length;
      const title = p.title.textContent;
      p.hide();
      if (inside.length !== 42 || wrong) throw new Error(`${inside.length} day buttons in the canvas, ${wrong} not hit`);
      return `${title}: 42 day buttons in the canvas, 42 moved away`;
    },
  },
  {
    name: 'Swatches: one button per datalist option, and a click sets the colour',
    run: async () => {
      const input = $('fxColor'), seen = events(input);
      const p = await open(new SwatchPicker(input));
      const blue = p.buttons[2];
      const hit = document.elementFromPoint(...mid(blue)) === blue;
      blue.click();
      await frames(2);
      if (p.buttons.length !== 3 || !hit || input.value !== '#0000ff') throw new Error(`${p.buttons.length} buttons, hit ${hit}, value ${input.value}`);
      return `3 buttons, value #0000ff, events: ${seen.join(', ')}`;
    },
  },
  stillDrawn(() => [{
    name: 'form of built-in controls',
    note: 'off screen',
    ink: () => {
      const canvas = $('sheet'), r = canvas.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return null; // a canvas that is not on screen is not painted
      return inkFraction(canvas.getContext('2d'));
    },
  }]),
];

if (supported) {
  const bench = checkBench();
  build(bench);
  runTests($('results'), tests).then(() => { for (const id of ['fxTime', 'fxDate', 'fxColor']) ClockPicker.for($(id))?.hide(); bench.done(); });
} else {
  runTests($('results'), tests.slice(0, 1));
}
