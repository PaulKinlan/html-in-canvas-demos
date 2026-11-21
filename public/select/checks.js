// Live checks for /select/. They run on small test selects in a panel at the
// bottom of the window, never on the selects in the page.
//
// A picker has to be open for most of these. showPicker() needs a tap and uses
// it up, so one tap opens one picker. The checks therefore share one test
// select: the first check that needs it opens it, measures everything, and
// the other rows report from those measurements.
import { runTests, checkBench, stillDrawn, inkFraction, supported } from '/shared/support.js';
import { SelectPicker, layouts, renderers, supported as pickerSupported } from '/lib/select-picker.js';

const $ = (id) => document.getElementById(id);
const frames = (n = 3) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const short = (message) => String(message).replace(/^Failed to execute '\w+' on '\w+': /, '');

// A layout only these checks use: three options in a row, each rotated 10 degrees.
layouts.checkRow = {
  size: () => [300, 84],
  place: (i) => ({ m: new DOMMatrix().translate(16 + i * 92, 18).rotate(10), alpha: 1, order: i }),
};

async function openPicker(select) {
  try { select.showPicker(); } catch (err) { return `showPicker() was refused: ${err.message}`; }
  for (let i = 0; i < 20 && !select.matches(':open'); i++) await frames(1);
  if (!select.matches(':open')) return 'showPicker() did not open the picker';
  await frames(4);
  return '';
}

// One test select holds everything, because only one picker can be opened per
// tap. It is a drawable child of an outer canvas. Its picker (red background)
// contains three canvases with options in them, and two options that each
// contain a canvas.
function build(bench) {
  bench.innerHTML = `
    <style>
      #fx { appearance: base-select; font: 14px system-ui; min-height: 30px; }
      #fx::picker(select) { appearance: base-select; background: rgb(255, 0, 0); border: 0; padding: 3px; margin: 2px 0; width: 310px; max-width: calc(100vw - 8px); box-sizing: border-box; }
      #fx:open::picker(select) { display: flex; flex-wrap: wrap; gap: 3px; }
      #fx > canvas { box-shadow: none; border-radius: 0; border: 0; background: #fff; color: #000; }
      #fx option { background: rgb(255, 204, 0); color: #000; padding: 0 4px; }
      #fx #row option { width: 80px; height: 34px; }
      #fx #gl option { width: 70px; height: 80px; }
      #fx #gpu option { width: 60px; height: 50px; }
      #fx option > canvas { width: 60px; height: 24px; display: block; }
      #fixtures canvas.outer { display: block; width: 240px; height: 64px; outline: 1px dashed #8888; }
    </style>
    <canvas class="outer" id="fc" content="drawable" layoutsubtree>
      <select id="fx" drawable>
        <button><selectedcontent></selectedcontent></button>
        <canvas id="row"><option>one</option><option>two</option><option>three</option></canvas>
        <canvas id="gl"><option>a</option><option>b</option><option>c</option><option>d</option><option>e</option></canvas>
        <canvas id="gpu" content="drawable" layoutsubtree style="width:140px;height:60px"><option drawable>g1</option><option drawable>g2</option></canvas>
        <option selected><canvas width="120" height="48" content="drawable" layoutsubtree><b drawable style="background:rgb(0,160,0);color:#fff;padding:2px 6px">live</b></canvas></option>
        <option drawable><canvas width="120" height="48" content="drawable" layoutsubtree><b drawable style="background:rgb(0,0,200);color:#fff;padding:2px 6px">two</b></canvas></option>
      </select>
    </canvas>`;
}

let measured = null;
/** Open the test select once and record what happened. */
function measure() {
  measured ??= (async () => {
    const m = { toggles: 0 };
    const fx = $('fx'), fc = $('fc'), gpuCanvas = $('gpu');
    for (const type of ['toggle', 'beforetoggle']) fx.addEventListener(type, () => m.toggles++);
    const row = new SelectPicker(fx, { layout: 'checkRow', canvas: $('row') });
    const gl = new SelectPicker(fx, { layout: 'carousel', backend: 'webgl', canvas: $('gl') });
    await gl.ready;
    m.rowOptions = row.options.length;
    m.allOptions = fx.options.length;

    // The outer canvas draws the select rotated.
    const angle = 0.12, ctx = fc.getContext('2d');
    fc.width = fc.clientWidth;
    fc.height = fc.clientHeight;
    fc.onpaint = () => {
      ctx.reset();
      ctx.translate(40, 14);
      ctx.rotate(angle);
      try { ctx.drawElementImage(fx, 0, 0, fx.offsetWidth, fx.offsetHeight); } catch {}
    };
    fc.requestPaint();
    await frames(4);
    {
      const r = fc.getBoundingClientRect();
      // A point 20 px along and 12 px down the rotated button.
      const x = r.left + 40 + 20 * Math.cos(angle) - 12 * Math.sin(angle), y = r.top + 14 + 20 * Math.sin(angle) + 12 * Math.cos(angle);
      m.outerHit = document.elementFromPoint(x, y)?.closest('select') === fx;
      m.outerInk = inkFraction(ctx);
    }

    // A canvas inside an option, before the picker has ever opened.
    const inner = fx.querySelector(':scope > option canvas');
    const drawInner = (c) => {
      const g = c.getContext('2d');
      g.reset();
      g.drawElementImage(c.firstElementChild, 4, 4, c.firstElementChild.offsetWidth, c.firstElementChild.offsetHeight);
      return inkFraction(g);
    };
    try { drawInner(inner); m.innerClosed = ''; } catch (err) { m.innerClosed = short(err.message); }
    const clone = fx.querySelector('selectedcontent canvas');
    m.clone = !!clone;
    m.cloneChild = clone?.firstElementChild?.localName ?? 'nothing';
    m.cloneInk = clone ? inkFraction(clone.getContext('2d')) : 0;

    // WebGPU: prepare a renderer that draws to a texture.
    let gpu = null, renderer = null, gpuDrew = 0;
    const gpuProblems = [];
    try {
      const { webgpu } = await import('/shared/backend.js');
      const util = await import('/lib/gpu-util.js');
      if (!util.supportedGPU) throw new Error('this browser has no WebGPU element upload');
      gpu = await webgpu({ force: true });
      if (!gpu) throw new Error(webgpu.reason || 'no WebGPU device');
      gpuCanvas.width = 140;
      gpuCanvas.height = 60;
      renderer = new renderers.GPURenderer(gpuCanvas, gpu, util, (why) => gpuProblems.push(why), { present: false });
      gpuCanvas.onpaint = () => {
        if (!fx.matches(':open')) return;
        const shown = [...gpuCanvas.children].map((option, i) => ({ option, size: { w: 60, h: 50 }, m: new DOMMatrix().translate(6 + i * 66, 5), alpha: 1, shade: 1 }));
        try { renderer.draw({ w: 140, h: 60 }, shown); gpuDrew++; } catch (err) { gpuProblems.push(short(err.message)); }
      };
    } catch (err) { m.gpu = err.message; }

    m.open = await openPicker(fx);
    if (m.open) return m;
    await frames(24); // let the opening animations finish

    // The outer canvas while the picker is open.
    {
      const data = ctx.getImageData(0, 0, fc.width, fc.height).data;
      let red = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] > 200) red++;
      m.redInCanvas = red;
      const p = row.canvas.getBoundingClientRect(), b = fx.getBoundingClientRect();
      m.pickerAt = `its first canvas is at ${Math.round(p.left)},${Math.round(p.top)}; the drawn button's box is ${Math.round(b.left)},${Math.round(b.top)} to ${Math.round(b.right)},${Math.round(b.bottom)}`;
      const option = fx.querySelector(':scope > option[drawable]'); // an option that is not inside a picker canvas
      try { ctx.drawElementImage(option, 0, 0, 40, 20); m.outerOption = ''; } catch (err) { m.outerOption = short(err.message); }
    }

    // The 2D picker canvas.
    {
      const box = row.canvas.getBoundingClientRect();
      m.rowHits = row.options.map((option, i) => {
        const at = new DOMMatrix().translate(16 + i * 92, 18).rotate(10).transformPoint(new DOMPoint(option.offsetWidth / 2, option.offsetHeight / 2));
        return document.elementFromPoint(box.left + at.x, box.top + at.y) === option;
      });
      m.rowFrames = row.frames;
      m.rowInk = inkFraction(row.canvas.getContext('2d'));
    }

    // The WebGL carousel.
    {
      m.glBackend = gl.backend;
      m.glNote = gl.note;
      const copy = new OffscreenCanvas(gl.canvas.width, gl.canvas.height).getContext('2d');
      copy.drawImage(gl.canvas, 0, 0);
      m.glInk = inkFraction(copy);
      const [first, side] = gl.options; // the carousel opens on its first option
      m.glCentre = document.elementFromPoint(...mid(first)) === first;
      m.glSide = `${Math.round(side.getBoundingClientRect().width)} px wide on screen, ${side.offsetWidth} px in layout`;
      m.glTurned = side.getBoundingClientRect().width < side.offsetWidth * 0.9;
    }

    // WebGPU.
    if (renderer) {
      try {
        gpuCanvas.requestPaint();
        await frames(4);
        await gpu.device.queue.onSubmittedWorkDone();
        if (!gpuDrew) throw new Error(gpuProblems[0] || 'the canvas got no paint event');
        m.gpuInk = inkFraction(await renderer.surface.read());
        m.gpuDetail = `${gpu.software ? 'software' : 'hardware'} adapter, ${gpuDrew} frame(s)` + (gpuProblems.length ? `, problem: ${gpuProblems[0]}` : '');
      } catch (err) { m.gpu = err.message; }
      renderer.destroy();
    }

    // The canvases inside options.
    try { m.innerInk = drawInner(inner); } catch (err) { m.innerError = short(err.message); }
    // <selectedcontent> may have replaced its clone since it was first looked at, so find it again.
    const cloneNow = fx.querySelector('selectedcontent canvas');
    m.cloneReplaced = cloneNow !== clone;
    try { m.cloneDraw = drawInner(cloneNow); } catch (err) { m.cloneError = short(err.message); }

    // choose() and close(), last.
    {
      const events = [];
      const note = (e) => events.push(e.type);
      fx.addEventListener('input', note);
      fx.addEventListener('change', note);
      row.choose(2);
      m.value = fx.value;
      m.events = events.join(', ');
      row.close();
      await frames(2);
      m.closed = !fx.matches(':open');
    }
    document.activeElement?.blur?.();
    return m;
  })();
  return measured;
}

const need = (problem) => { if (problem) throw new Error(problem); };

const tests = [
  {
    name: 'appearance: base-select and HTML-in-canvas are both available',
    why: 'Without either, <select picker> stays a plain select.',
    run: async () => {
      if (!pickerSupported) throw new Error(`base-select: ${CSS.supports('appearance', 'base-select')}, drawElementImage: ${supported}`);
      return 'both available';
    },
  },
  {
    name: 'A select drawn rotated in a canvas is hit tested where it is drawn',
    why: 'elementFromPoint() at a point inside the rotated button.',
    timeout: 30000,
    run: async () => {
      const m = await measure();
      if (!m.outerHit) throw new Error('the point inside the drawn button did not find the select');
      return `found the select; ${(m.outerInk * 100).toFixed(1)}% of the canvas has pixels`;
    },
  },
  {
    name: 'The open picker is part of the picture the canvas draws for that select',
    expect: 'fail',
    why: 'The test picker has a red background. Count red pixels in the outer canvas while it is open.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (m.redInCanvas > 0) return `${m.redInCanvas} red pixels`;
      throw new Error(`0 red pixels in the canvas. The browser paints the picker in the top layer: ${m.pickerAt}`);
    },
  },
  {
    name: 'The outer canvas draws an option of the open picker',
    expect: 'fail',
    why: 'drawElementImage(option) on the canvas that contains the select. The option is marked drawable.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (m.outerOption) throw new Error(m.outerOption);
      return 'drawn';
    },
  },
  {
    name: 'The select fires toggle or beforetoggle when its picker opens',
    expect: 'fail',
    why: 'Listeners on the select while it was opened and closed.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (!m.toggles) throw new Error('no event. The first paint event on the picker canvas is the earliest signal');
      return `${m.toggles} events`;
    },
  },
  {
    name: 'Options inside canvases inside the select are still its options',
    why: 'select.options for a select whose options are spread over three canvases and two plain options.',
    run: async () => {
      const m = await measure();
      if (m.allOptions !== 12 || m.rowOptions !== 3) throw new Error(`select.options.length is ${m.allOptions}; the first canvas holds ${m.rowOptions}`);
      return 'select.options.length is 12: 3 + 5 + 2 in canvases and 2 outside';
    },
  },
  {
    name: 'Each option is hit tested where the picker canvas drew it, and the select is itself in a canvas',
    why: 'Three options, each drawn translated and rotated 10° by a 2D canvas in the picker. elementFromPoint() at the centre of each. Two drawable canvases are nested here: the outer one draws the button, the inner one is in the top layer.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (!m.rowHits.every(Boolean) || !(m.rowInk > 0.01)) throw new Error(`found: ${m.rowHits.join(', ')}; ${(m.rowInk * 100).toFixed(1)}% of the canvas drawn`);
      return `all three found, ${m.rowFrames} frames drawn`;
    },
  },
  {
    name: 'WebGL: options as textures on a carousel, with a perspective hit box',
    why: 'texElementSubImage2D() per option, then updateElementGeometry() with the shader\'s matrix.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (m.glBackend !== 'webgl') throw new Error(`backend is ${m.glBackend} (${m.glNote})`);
      if (m.glInk < 0.02) throw new Error(`the canvas is blank (${(m.glInk * 100).toFixed(2)}% drawn)`);
      if (!m.glCentre || !m.glTurned) throw new Error(`centre card found: ${m.glCentre}; side card ${m.glSide}`);
      return `${(m.glInk * 100).toFixed(0)}% of the canvas drawn; centre card found under its middle; a side card is ${m.glSide}`;
    },
  },
  {
    name: 'WebGPU: the same quads drawn to a texture and read back',
    why: 'drawElementImageToTexture() per option. Drawn off screen, because a software WebGPU adapter loses its device when it shows a canvas.',
    run: async () => {
      const m = await measure();
      need(m.gpu || m.open);
      if (!(m.gpuInk > 0.3)) throw new Error(`${((m.gpuInk ?? 0) * 100).toFixed(1)}% of the texture drawn (${m.gpuDetail})`);
      return `${(m.gpuInk * 100).toFixed(0)}% of the texture drawn (${m.gpuDetail})`;
    },
  },
  {
    name: 'A canvas inside an option draws its own drawable child',
    why: 'Tried before the picker has opened, then while it is open.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (!(m.innerInk > 0.01)) throw new Error(m.innerError || 'nothing drawn while open');
      return `open: drawn (${(m.innerInk * 100).toFixed(0)}% of the canvas). Before opening: ${m.innerClosed || 'drawn too'}`;
    },
  },
  {
    name: 'The canvas that <selectedcontent> clones arrives with the option\'s pixels',
    expect: 'fail',
    why: 'The clone in the button is a new canvas element.',
    run: async () => {
      const m = await measure();
      if (!m.clone) throw new Error('no canvas in <selectedcontent>');
      if (m.cloneInk > 0) return 'it has pixels';
      const after = m.cloneDraw > 0.01 ? 'The page can draw its cloned child into it' : `Drawing its cloned child: ${m.cloneError || 'nothing drawn'}`;
      throw new Error(`the clone is blank and has no paint handler. It contains a cloned <${m.cloneChild}>. ${after}${m.cloneReplaced ? '. The clone was replaced by a new one between page load and the picker opening' : ''}`);
    },
  },
  {
    name: 'choose() sets the value and close() closes the picker',
    why: 'There is no hidePicker(). close() shows an empty popover="auto" element, which closes the picker as a tap outside would.',
    run: async () => {
      const m = await measure();
      need(m.open);
      if (m.value !== 'three' || !m.closed) throw new Error(`value ${m.value}, closed ${m.closed}`);
      return `value "three", events: ${m.events}, picker closed`;
    },
  },
  stillDrawn(() => ['live', 'tilt'].map((id) => ({
    name: id === 'live' ? 'filtered card' : 'rotated select',
    note: 'off screen',
    ink: () => {
      const canvas = $(id), r = canvas.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return null; // a canvas that is not on screen is not painted
      return inkFraction(canvas.getContext('2d'));
    },
  }))),
];

if (supported) {
  const bench = checkBench();
  build(bench);
  // Not started on load: the test picker needs a tap, and it opens in the top layer.
  runTests($('results'), tests).then(() => bench.done());
} else {
  runTests($('results'), tests.slice(0, 1));
}
