// Live checks for /input-ideas/. They run on test inputs in a panel at the
// bottom of the window, never on the fields in the page. Nothing here takes
// focus: the pickers are opened with show() and pressed with click() or with
// synthetic pointer events.
import { runTests, checkBench, stillDrawn, inkFraction, supported } from '/shared/support.js';
import { DialRange, DateRangePicker, ColourWheel, WeekYearPicker, GhostText, hsvOf, unwrap, pixelOf } from '/lib/input-ideas.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
/** The pixel of a canvas at a point given in its CSS px. */
const pixel = (canvas, x, y) => { const k = canvas.width / canvas.clientWidth; return [...pixelOf(canvas, Math.round(x * k), Math.round(y * k))]; };
const far = (a, b) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));
const events = (input) => { const seen = []; for (const type of ['input', 'change']) input.addEventListener(type, () => seen.push(type)); return seen; };
const press = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse' }));

function build(bench) {
  bench.innerHTML = `
    <style>
      #fixtures { --picker-accent: #d2491f; }
      #fixtures input:not([type="range"]) { font: 14px system-ui; }
      #fixtures canvas.probe { display: block; width: 120px; height: 44px; outline: 1px dashed #8888; }
      #fixtures #fxDial { width: 180px; height: 140px; }
      #fixtures #fxGhost { width: 200px; height: 40px; }
      #fixtures #fxGhost input { height: 34px; padding: 4px 8px; border: 1px solid #888; border-radius: 6px; background: #fff; color: #000; }
    </style>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:start">
      <canvas id="fxDial" content="drawable" layoutsubtree>
        <input id="fxLevel" type="range" min="0" max="100" value="50" list="fxTicks" drawable>
        <datalist id="fxTicks"><option value="0"><option value="100"></datalist>
      </canvas>
      <canvas class="probe" id="fxProbe" content="drawable" layoutsubtree>
        <button id="fxHalves" drawable style="display:block;width:60px;height:20px;border:0;padding:0;margin:0;background:linear-gradient(90deg,#f00 0 50%,#00f 50% 100%)"></button>
      </canvas>
      <span id="fxStay" style="display:flex;gap:4px"><input id="fxFrom" type="date" value="2026-11-03"><input id="fxTo" type="date" value="2026-11-04"></span>
      <input id="fxColour" type="color" value="#808080" list="fxColours">
      <datalist id="fxColours"><option value="#ff0000"><option value="#00ff00"><option value="#8080ff"><option value="#ffff80"><option value="#ffffff"></datalist>
      <input id="fxWeek" type="week" value="2026-W10">
      <canvas id="fxGhost" content="drawable" layoutsubtree>
        <input id="fxText" list="fxWords" drawable>
        <datalist id="fxWords"><option>Leeds</option><option>Leicester</option><option>York</option></datalist>
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

/** One paint of a canvas. */
function paintOnce(canvas, draw) {
  return new Promise((resolve, reject) => {
    canvas.addEventListener('paint', () => { try { resolve(draw(canvas.getContext('2d'))); } catch (err) { reject(err); } }, { once: true });
    canvas.requestPaint();
  });
}

let dial, range, wheel, week, ghost;
/** A point of the window on the test dial's arc, at a fraction of the way along it. */
const onArc = (f, radius = dial.radius) => {
  const r = dial.canvas.getBoundingClientRect(), c = dial.centre, a = dial.a0 + f * dial.sweep;
  return [r.left + c.x + Math.cos(a) * radius, r.top + c.y + Math.sin(a) * radius];
};
const arcInk = (f, from, to) => {
  const r = dial.canvas.getBoundingClientRect();
  let ink = 0;
  for (let radius = from; radius <= to; radius += 0.5) { const [x, y] = onArc(f, radius); if (pixel(dial.canvas, x - r.left, y - r.top)[3] > 40) ink++; }
  return ink;
};

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. Every field is an ordinary input.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'drawElementImage() with a source rectangle draws part of an element, and a drawImage() copy reads it back',
    why: 'A button that is red on the left and blue on the right. Only the right half is drawn, then pixels are copied to a second canvas with drawImage() and read there, and toDataURL() is called.',
    run: async () => {
      const probe = $('fxProbe'), el = $('fxHalves');
      probe.width = probe.clientWidth; probe.height = probe.clientHeight;
      const got = await paintOnce(probe, (ctx) => {
        ctx.reset();
        ctx.drawElementImage(el, 30, 0, 30, 20, 50, 10, 30, 20);
        return { drawn: [...pixelOf(probe, 65, 20)], left: [...pixelOf(probe, 35, 20)], url: probe.toDataURL().length };
      });
      await frames(2);
      const r = probe.getBoundingClientRect();
      const hitDrawn = document.elementFromPoint(r.left + 65, r.top + 20) === el;
      const hitRest = document.elementFromPoint(r.left + 35, r.top + 20) === el;
      if (got.drawn[2] < 200 || got.drawn[0] > 50 || got.left[3] !== 0) throw new Error(`drawn pixel ${got.drawn}, pixel where the left half would be ${got.left}`);
      if (!hitDrawn) throw new Error('the drawn half is not hit tested where it was drawn');
      return `read rgba(${got.drawn}) from the drawn half, toDataURL() gave ${got.url} characters, nothing threw. The half that was not drawn is ${hitRest ? '' : 'not '}hit tested`;
    },
  },
  {
    name: 'Dial: the range input is drawn round the arc, and the tick marks of its datalist bend with it',
    why: 'Pixels are read along the arc. With the list attribute removed the tick pixels go away.',
    run: async () => {
      dial = new DialRange($('fxDial'), { radius: 60 });
      await wait(300);
      if (!(dial.frames > 0)) throw new Error(dial.note || 'the dial drew no frame');
      const c = dial.centre;
      const track = [0.1, 0.3, 0.7, 0.9].map((f) => arcInk(f, 58, 62));
      const middle = pixel(dial.canvas, c.x, c.y)[3];
      const at0 = dial.constructor.THUMB / 2 / $('fxLevel').offsetWidth; // the tick for the minimum is half a thumb in from the end
      const tick = arcInk(at0, 46, 53), between = arcInk(0.2, 46, 53);
      // The same picture by the other route: a clip and the five-argument form.
      dial.sourceRect = false;
      dial.canvas.requestPaint();
      await wait(200);
      const clipped = [0.1, 0.3, 0.7, 0.9].map((f) => arcInk(f, 58, 62)), clippedTick = arcInk(at0, 46, 53);
      dial.sourceRect = true;
      if (clipped.join() !== track.join() || clippedTick !== tick) throw new Error(`with a clip in place of the source rectangle: track ${clipped} against ${track}, tick ${clippedTick} against ${tick}`);
      $('fxLevel').removeAttribute('list');
      await wait(200);
      const without = arcInk(at0, 46, 53);
      $('fxLevel').setAttribute('list', 'fxTicks');
      if (track.some((n) => !n) || middle) throw new Error(`track pixels at four points of the arc: ${track}, alpha at the centre ${middle}`);
      if (!tick || between || without) throw new Error(`tick pixels at the minimum ${tick}, between ticks ${between}, with no list ${without}`);
      return `${Math.ceil($('fxLevel').offsetWidth / dial.slice)} slices a frame. Track found at four points of the arc. Tick pixels inside the arc at the minimum: ${tick} with the datalist, ${without} without. A clip with the five-argument form gave the same pixel counts`;
    },
  },
  {
    name: 'Dial: a press on the arc sets the value from its angle and fires input and change',
    why: 'Synthetic pointer events at the place of the thumb for value 25. The input itself takes no pointer events.',
    run: async () => {
      const input = $('fxLevel'), seen = events(input);
      // The thumb's centre for value 25 is a quarter of the way along its travel, which is a thumb shorter than the input.
      const w = input.offsetWidth, thumb = dial.constructor.THUMB;
      const [x, y] = onArc((thumb / 2 + 0.25 * (w - thumb)) / w);
      const under = document.elementFromPoint(x, y);
      press(dial.canvas, 'pointerdown', x, y);
      press(dial.canvas, 'pointerup', x, y);
      await frames(3);
      const box = input.getBoundingClientRect();
      if (input.value !== '25' || seen.join() !== 'input,change') throw new Error(`value ${input.value}, events ${seen}`);
      if (under !== dial.canvas) throw new Error(`the element under the arc is ${under?.tagName}`);
      return `value 25, events: ${seen.join(', ')}. The input's box after the last draw is ${Math.round(box.width)} by ${Math.round(box.height)} px, over the dial`;
    },
  },
  {
    name: 'Dial: the hit box of the sliced input follows the arc',
    why: 'Expected to fail. An element has one rectangular hit box and each slice moves it. Tested at three points of the arc with the input taking pointer events and without the last invisible draw.',
    expect: 'fail',
    run: async () => {
      const input = $('fxLevel');
      dial.box = false;
      input.style.pointerEvents = 'auto';
      input.toggleAttribute('data-moved');
      dial.canvas.requestPaint();
      await frames(4);
      const hits = [0.1, 0.5, 0.995].map((f) => document.elementFromPoint(...onArc(f)) === input);
      const box = input.getBoundingClientRect();
      dial.box = true;
      input.style.pointerEvents = '';
      dial.canvas.requestPaint();
      await frames(2);
      if (!hits.every(Boolean)) throw new Error(`hit at 10% of the arc: ${hits[0]}, at 50%: ${hits[1]}, at the end: ${hits[2]}. The input's one box is where the last slice put it: the whole input turned to the angle of the end of the arc, with bounds of ${Math.round(box.width)} by ${Math.round(box.height)} px`);
      return 'the input is hit at all three points';
    },
  },
  {
    name: 'Date range: two presses write both inputs, and the canvas draws the band between the two days',
    why: 'Days are pressed as a keyboard would, with click(). A pixel of a day inside the range is compared with one outside it.',
    run: async () => {
      const from = $('fxFrom'), to = $('fxTo'), seenFrom = events(from), seenTo = events(to);
      range = await open(new DateRangePicker(from, to, { anchor: $('fxStay') }));
      const day = (d) => range.days.find((b) => b.dataset.date === `2026-11-${d}`);
      const corner = (d) => { const i = range.days.indexOf(day(d)); return pixel(range.pop.canvas, 14 + (i % 7) * 40 + 5, 86 + Math.floor(i / 7) * 40 + 20); };
      const hit = document.elementFromPoint(...mid(day('10'))) === day('10');
      day('10').click();
      const open1 = [from.value, to.value];
      day('14').click();
      await wait(600);
      const inside = corner('12'), outside = corner('20');
      if (!hit) throw new Error('the button for the 10th is not hit where it is drawn');
      if (open1.join() !== '2026-11-10,' || from.value !== '2026-11-10' || to.value !== '2026-11-14') throw new Error(`after one press ${open1}, after two ${from.value} to ${to.value}`);
      if (far(inside, outside) < 12) throw new Error(`pixel in the 12th rgba(${inside}), in the 20th rgba(${outside})`);
      return `${from.value} to ${to.value}. Events on the first input: ${seenFrom.join(', ')}. On the second: ${seenTo.join(', ')}. Band pixel rgba(${inside}), outside rgba(${outside}). "${range.status.textContent}"`;
    },
  },
  {
    name: 'Date range: the band follows a preview, and an earlier second day swaps the two',
    run: async () => {
      const from = $('fxFrom'), to = $('fxTo');
      const day = (d) => range.days.find((b) => b.dataset.date === `2026-11-${d}`);
      const corner = (d) => { const i = range.days.indexOf(day(d)); return pixel(range.pop.canvas, 14 + (i % 7) * 40 + 5, 86 + Math.floor(i / 7) * 40 + 20); };
      day('20').click();
      range.preview('2026-11-17');
      await wait(600);
      const previewed = corner('18'), outside = corner('24'), during = to.value;
      day('05').click();
      await frames(2);
      if (far(previewed, outside) < 12 || during !== '') throw new Error(`previewed pixel rgba(${previewed}), outside rgba(${outside}), end value during the preview "${during}"`);
      if (from.value !== '2026-11-05' || to.value !== '2026-11-20') throw new Error(`${from.value} to ${to.value}`);
      return `the band reached the previewed day while the second input was empty. Then ${from.value} to ${to.value}`;
    },
  },
  {
    name: 'Date range: after a change of month the old days cannot be hit',
    run: async () => {
      range.turn(1);
      await wait(700);
      const days = [...range.pop.canvas.querySelectorAll('.day')];
      const r = range.pop.canvas.getBoundingClientRect();
      const inside = days.filter((b) => { const [x, y] = mid(b); return x > r.left && x < r.right && y > r.top && y < r.bottom; });
      const wrong = inside.filter((b) => document.elementFromPoint(...mid(b)) !== b).length;
      const title = range.title.textContent;
      range.hide();
      if (inside.length !== 42 || wrong) throw new Error(`${inside.length} day buttons in the canvas, ${wrong} not hit`);
      return `${title}: 42 day buttons in the canvas, 42 moved away`;
    },
  },
  {
    name: 'Colour wheel: the pixel read at each swatch\'s place is that swatch\'s colour',
    why: 'The read is a 1 by 1 drawImage() copy of the popover canvas, which draws the swatch buttons with drawElementImage() every frame. Five colours at full brightness.',
    run: async () => {
      const input = $('fxColour');
      wheel = await open(new ColourWheel(input));
      wheel.slider.value = 100;
      wheel.slider.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(3);
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      let worst = 0;
      const got = [];
      for (const b of wheel.buttons) {
        const at = wheel.spot(hsvOf(rgb(b.dataset.value)));
        wheel.pickAt(at.x, at.y);
        await frames(3);
        got.push(input.value);
        worst = Math.max(worst, far(rgb(input.value), rgb(b.dataset.value)));
      }
      if (wheel.readError) throw new Error(`the read threw ${wheel.readError}`);
      if (wheel.reads < 5 || worst > 10) throw new Error(`${wheel.reads} reads, read ${got.join(' ')}, furthest channel off by ${worst}`);
      return `${wheel.reads} reads, none threw. Read ${got.join(' ')}. The furthest channel is off by ${worst} of 255`;
    },
  },
  {
    name: 'Colour wheel: a swatch button is hit where it is drawn, and the brightness slider changes the colour that is read',
    run: async () => {
      const input = $('fxColour'), seen = events(input);
      const red = wheel.buttons[0];
      const hit = document.elementFromPoint(...mid(red)) === red;
      red.click();
      await frames(3);
      const picked = input.value;
      wheel.slider.value = 50;
      wheel.slider.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(3);
      const dark = input.value;
      wheel.hide();
      if (!hit || picked !== '#ff0000') throw new Error(`hit ${hit}, value ${picked}`);
      if (!/^#(7f|80|81)0000$/.test(dark)) throw new Error(`at half brightness the value is ${dark}`);
      return `the swatch gave ${picked}, half brightness gave ${dark}. Events: ${seen.join(', ')}`;
    },
  },
  {
    name: 'Week picker: 53 buttons for 2026 and 52 for 2027, and the week under the pointer is drawn larger',
    why: 'A synthetic pointer move over week 21. The 53rd button of a 52 week year is moved away.',
    run: async () => {
      week = await open(new WeekYearPicker($('fxWeek')));
      const r = week.pop.canvas.getBoundingClientRect();
      const in2026 = week.count, last = week.weeks[52];
      const lastHit = document.elementFromPoint(...mid(last)) === last;
      week.turn(1);
      await wait(500);
      const in2027 = week.count, gone = last.getBoundingClientRect().left;
      week.turn(-1);
      const at = week.base(20, week.pop.s);
      week.pop.host.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + at.x, clientY: r.top + at.y, bubbles: true, pointerType: 'mouse' }));
      await wait(600);
      const big = week.weeks[20].getBoundingClientRect().width, small = week.weeks[0].getBoundingClientRect().width;
      const hit = document.elementFromPoint(...mid(week.weeks[20])) === week.weeks[20];
      if (in2026 !== 53 || in2027 !== 52 || !lastHit || gone > -1000) throw new Error(`${in2026} weeks in 2026 (week 53 hit: ${lastHit}), ${in2027} in 2027 (week 53 at ${Math.round(gone)})`);
      if (!(big > small * 1.6) || !hit) throw new Error(`week 21 is ${big.toFixed(1)} px wide, week 1 is ${small.toFixed(1)} px, week 21 hit: ${hit}`);
      return `2026: 53, 2027: 52. Week 21 is ${big.toFixed(0)} px wide under the pointer, week 1 is ${small.toFixed(0)} px. "${week.info.textContent}"`;
    },
  },
  {
    name: 'Week picker: choosing a week writes YYYY-Www and fires input and change',
    run: async () => {
      const input = $('fxWeek'), seen = events(input);
      const label = week.weeks[46].ariaLabel;
      week.weeks[46].click();
      await frames(2);
      if (input.value !== '2026-W47' || week.open) throw new Error(`value ${input.value}, open ${week.open}`);
      return `value ${input.value}, accessible name "${label}", events: ${seen.join(', ')}, picker closed`;
    },
  },
  {
    name: 'Ghost text: the rest of the matching option is drawn after the typed letters and is hit tested there',
    why: 'The test input does not have focus, so the suggestion is forced on. "le" is typed by setting the value.',
    run: async () => {
      const input = $('fxText');
      ghost = new GhostText($('fxGhost'));
      ghost.always = true;
      await wait(250);
      const r = ghost.canvas.getBoundingClientRect();
      const blank = pixel(ghost.canvas, 150, 20);
      input.value = 'le';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(250);
      const g = ghost.last;
      if (!g) throw new Error(ghost.note || 'no suggestion was drawn');
      let ink = 0;
      for (let x = g.caret + 1; x < g.caret + g.width; x += 1) for (let y = g.top + 2; y < g.top + g.height - 2; y += 1) if (far(pixel(ghost.canvas, x, y), blank) > 30) ink++;
      const hitGhost = document.elementFromPoint(r.left + g.caret + g.width / 2, r.top + g.top + g.height / 2);
      const hitTyped = document.elementFromPoint(r.left + g.caret - 6, r.top + g.top + g.height / 2);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = getComputedStyle(input).font;
      const measured = ctx.measureText('Leeds').width, laid = g.option.getBoundingClientRect().width;
      if (g.option.value !== 'Leeds' || !ink) throw new Error(`option ${g.option.value}, ${ink} pixels of ghost text`);
      if (hitGhost !== g.option || hitTyped !== input) throw new Error(`under the ghost text: ${hitGhost?.tagName}, under the typed text: ${hitTyped?.tagName}`);
      if (Math.abs(measured - laid) > 1) throw new Error(`measureText() gives ${measured.toFixed(2)} px for "Leeds", the option is ${laid.toFixed(2)} px wide`);
      return `"eds" drawn ${g.caret.toFixed(1)} px in, ${ink} pixels. The option is hit on the ghost text and the input on the typed text. measureText() ${measured.toFixed(2)} px, option box ${laid.toFixed(2)} px`;
    },
  },
  {
    name: 'Ghost text: accepting writes the option\'s value and fires input and change',
    run: async () => {
      const input = $('fxText'), seen = events(input);
      const took = ghost.accept();
      await wait(200);
      if (!took || input.value !== 'Leeds' || seen.join() !== 'input,change') throw new Error(`accepted ${took}, value ${input.value}, events ${seen}`);
      if (ghost.last) throw new Error('a suggestion is still drawn');
      return `value ${input.value}, events: ${seen.join(', ')}, no suggestion left`;
    },
  },
  stillDrawn(() => ['dialCanvas', 'ghostCanvas'].map((id) => ({
    name: id === 'dialCanvas' ? 'dial' : 'ghost text input',
    note: 'off screen',
    ink: () => {
      const canvas = $(id), r = canvas.getBoundingClientRect();
      if (canvas.hidden || r.bottom < 0 || r.top > innerHeight) return null; // a canvas that is not on screen is not painted
      // Read a copy, not the drawable canvas itself.
      const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
      copy.drawImage(canvas, 0, 0);
      return inkFraction(copy);
    },
    rescue: () => {
      unwrap($(id));
      $(id === 'dialCanvas' ? 'dialNote' : 'ghostNote').textContent = 'This canvas was blank, so the input is shown as an ordinary input.';
    },
  }))),
];

if (supported) {
  const bench = checkBench();
  build(bench);
  runTests($('results'), tests).then(() => { for (const p of [range, wheel, week]) p?.hide(); bench.done(); });
} else {
  runTests($('results'), tests.slice(0, 1));
}
