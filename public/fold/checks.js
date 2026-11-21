// Live checks for /fold/. They build a second, small fold in a panel at the
// bottom of the window and never touch the one in the page. Nothing here
// scrolls or takes focus.
import { runTests, checkBench, onBench, stillDrawn, inkFraction, nextPaint, supported } from '/shared/support.js';
import { FoldView, readDevice } from '/lib/fold-view.js';

const frames = (n = 2) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const near = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

let bench, view, canvas;

function build() {
  bench.innerHTML = `
    <style>
      #fxFold { display: block; width: 300px; height: 260px; background: #777; }
      #fxContent { background: rgb(255, 220, 0); position: relative; }
      #fxControls { background: rgb(20, 40, 200); }
      #fxFold button { position: absolute; width: 90px; height: 30px; font: 12px system-ui; padding: 0; }
      #fxA { left: 20px; top: 24px; } #fxB2 { left: 150px; top: 120px; } #fxBtn { left: 150px; top: 40px; }
      #fxMark { position: absolute; left: 0; width: 100%; height: 10px; background: rgb(0, 160, 255); }
    </style>
    <canvas id="fxFold" content="drawable" layoutsubtree>
      <div id="fxContent" drawable><button id="fxA">first half</button><div id="fxMark"></div><button id="fxB2">second half</button></div>
      <div id="fxControls" drawable><button id="fxBtn">controls</button></div>
    </canvas>`;
  canvas = bench.querySelector('#fxFold');
  view = new FoldView(canvas, { content: bench.querySelector('#fxContent'), controls: bench.querySelector('#fxControls') });
  view.panes[1].el.style.position = 'absolute';
  return view;
}

async function pose(patch) {
  if (!view) build();
  view.set({ source: 'sim', axis: 'horizontal', angle: 180, hinge: 0, span: false, cut: true, ...patch });
  await frames(2);
  await nextPaint(canvas);
  await new Promise((r) => setTimeout(r, 360)); // a pane that changed place has finished sliding
  $('fxB2').style.top = `${view.model.h0 + 6}px`; // the first rows of the content after the fold
  await nextPaint(canvas);
  return view.model;
}

/** The colour the canvas holds where a surface point is drawn. */
function colourAt(x, y) {
  const p = view.project(x, y), dpr = canvas.width / canvas.clientWidth;
  return Array.from(canvas.getContext('2d').getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data.slice(0, 3));
}

/** Is `el` what the browser finds at the place its centre is drawn? */
function hit(el, pane) {
  const p = view.clientPoint(pane, el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2);
  const found = document.elementFromPoint(p.x, p.y);
  const box = el.getBoundingClientRect();
  const off = Math.hypot(box.left + box.width / 2 - p.x, box.top + box.height / 2 - p.y);
  return { ok: found === el, found: found ? `<${found.localName}${found.id ? '#' + found.id : ''}>` : 'nothing', off, p };
}

const pointerTo = (p, type = 'pointermove') => dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true, pointerType: 'mouse' }));
const $ = (id) => document.getElementById(id);

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. The panes are shown as plain HTML.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'This browser has the Device Posture API and viewport.segments',
    why: 'Both are read with no permission prompt. On a flat screen they report "continuous" and one segment.',
    run: () => {
      const dev = readDevice();
      if (dev.posture === null) throw new Error('navigator.devicePosture is missing');
      if (!dev.from) throw new Error('viewport.segments and visualViewport.segments are both missing');
      return `devicePosture.type is "${dev.posture}", ${dev.from} has ${dev.segments.length} segment${dev.segments.length === 1 ? '' : 's'}`;
    },
  },
  {
    name: 'The posture chooses the layout of both panes',
    why: 'At 180° the posture is continuous: the content covers the screen and the controls are a bar. At 100° it is folded: one pane on each half.',
    run: async () => {
      await pose({ angle: 180 });
      const flat = [$('fxContent').dataset.mode, $('fxControls').dataset.mode, $('fxControls').offsetHeight];
      const m = await pose({ angle: 100 });
      const folded = [$('fxContent').dataset.mode, $('fxControls').dataset.mode, $('fxControls').offsetHeight];
      if (flat[0] !== 'span' || flat[1] !== 'bar' || folded[0] !== 'half' || folded[1] !== 'full') throw new Error(`flat ${flat}, folded ${folded}`);
      if (folded[2] !== Math.round(m.L - m.h1)) throw new Error(`controls are ${folded[2]}px tall, the second segment is ${m.L - m.h1}px`);
      return `flat: ${flat[0]} and a ${flat[2]}px ${flat[1]}. Folded: ${folded[0]} and ${folded[1]}, ${folded[2]}px tall`;
    },
  },
  {
    name: 'Each half shows its pane at 100°',
    why: 'Reads one pixel from the middle of each half of the folded picture.',
    run: async () => {
      const m = await pose({ angle: 100 });
      const a = colourAt(m.W - 30, m.h0 / 2), b = colourAt(30, m.h1 + (m.L - m.h1) / 2);
      // The first half is shaded, so its yellow is darker than the element's own.
      if (!(a[0] > 120 && a[1] > 100 && a[2] < 60)) throw new Error(`first half is rgb(${a}), expected a shade of yellow`);
      if (!(b[2] > 150 && b[0] < 90)) throw new Error(`second half is rgb(${b}), expected blue`);
      return `first half rgb(${a}) (yellow, shaded), second half rgb(${b}), ${m.strips.length} strips`;
    },
  },
  {
    name: 'A button on a tilted half is found where it is drawn, with a horizontal fold',
    why: 'The hit box is set with a perspective matrix. elementFromPoint() is asked at the drawn centre of the button.',
    run: async () => {
      await pose({ angle: 100 });
      const r = hit($('fxBtn'), $('fxControls'));
      if (!r.ok) throw new Error(`found ${r.found} at the drawn centre. The box centre is ${r.off.toFixed(1)}px away`);
      if (r.off > 3) throw new Error(`getBoundingClientRect() centre is ${r.off.toFixed(1)}px from the drawn centre`);
      return `found the button. Its box centre is ${r.off.toFixed(2)}px from the drawn centre`;
    },
  },
  {
    name: 'The same with a vertical fold at 90° and a 24px hinge',
    run: async () => {
      await pose({ axis: 'vertical', angle: 90, hinge: 24 });
      $('fxBtn').style.left = '20px';
      await nextPaint(canvas);
      const r = hit($('fxBtn'), $('fxControls'));
      $('fxBtn').style.left = '';
      if (!r.ok) throw new Error(`found ${r.found} at the drawn centre. The box centre is ${r.off.toFixed(1)}px away`);
      if (r.off > 3) throw new Error(`box centre is ${r.off.toFixed(1)}px from the drawn centre`);
      return `found the button. Its box centre is ${r.off.toFixed(2)}px from the drawn centre`;
    },
  },
  {
    name: 'An element across both halves is hit on the half under the pointer',
    why: 'One element, two planes, one hit box. A pointermove on each half moves the hit box to that half.',
    run: async () => {
      await pose({ angle: 110, span: true });
      const out = [];
      for (const id of ['fxA', 'fxB2', 'fxA']) {
        const el = $(id);
        const p = view.clientPoint($('fxContent'), el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2);
        pointerTo(p);
        const r = hit(el, $('fxContent'));
        if (!r.ok) throw new Error(`with the pointer over ${id}, found ${r.found}. Box centre ${r.off.toFixed(1)}px away`);
        out.push(`${id} ${r.off.toFixed(1)}px`);
      }
      return `found each button after a pointermove on its half (${out.join(', ')})`;
    },
  },
  {
    name: 'With a 30px hinge and the pointer on the first half, a button after the hinge is found where it is drawn',
    why: 'The limit of one hit box: the box is on the first half, and there the picture is not shifted past the hinge. A touch has no pointermove before it, so a first tap after the hinge meets this state.',
    expect: 'fail',
    run: async () => {
      await pose({ angle: 110, span: true, hinge: 30 });
      const a = $('fxA');
      pointerTo(view.clientPoint($('fxContent'), a.offsetLeft + 10, a.offsetTop + 10));
      const r = hit($('fxB2'), $('fxContent'));
      if (!r.ok || r.off > 6) throw new Error(`found ${r.found} at the drawn centre of the button. Its hit box is ${r.off.toFixed(0)}px away`);
      return 'found the button';
    },
  },
  {
    name: 'With "cut" on, the row after the hinge is drawn after the hinge',
    why: 'A blue bar is the first 10px of the content after the fold. With a 30px hinge it must be drawn just past the hinge, not under it.',
    run: async () => {
      let m = await pose({ angle: 180, hinge: 30, cut: true });
      $('fxMark').style.top = `${m.h0}px`;
      await nextPaint(canvas);
      const cut = colourAt(m.W / 2, m.h1 + 5);
      m = await pose({ angle: 180, hinge: 30, cut: false });
      const hidden = colourAt(m.W / 2, m.h1 + 5);
      if (!near(cut, [0, 160, 255])) throw new Error(`with cut on, the pixel after the hinge is rgb(${cut}), expected the blue bar`);
      if (near(hidden, [0, 160, 255])) throw new Error('with cut off the bar is still visible, so the hinge hides nothing');
      return `cut on: rgb(${cut}) (the bar). Cut off: rgb(${hidden}), the bar is under the hinge`;
    },
  },
];

if (supported) {
  tests.push(stillDrawn(() => [{
    name: 'the fold',
    ink: () => { const c = document.getElementById('fold'); return c ? inkFraction(c.getContext('2d')) : null; },
  }]));
}

bench = checkBench();
runTests(document.getElementById('results'), tests).then(() => bench.done());
