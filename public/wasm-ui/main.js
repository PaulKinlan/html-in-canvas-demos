// The page script for /wasm-ui/.
import { banner, runTests } from '/shared/support.js';
import { hasJSPI, startToolkit } from '/wasm-ui/ui.js';
import { grab, wasmEdges, webnnEdges } from '/wasm-ui/edges.js';

banner();
const $ = (id) => document.getElementById(id);
const canvas = $('app'), msg = $('msg'), loop = $('loop');
const say = (text) => { msg.textContent = text; msg.hidden = !text; };

// ---------------------------------------------------------------- the program
let ui = null;
let afterFrame = () => {};
function onReport(s) {
  loop.textContent = `run() was called once and has not returned. It has drawn ${s.frames} frames and is suspended in wait_event() `
    + (s.inDialog ? 'inside ask(), two C calls deep.' : 'in its main loop.') + ` The canvas has had ${s.paints} paint events.`;
  afterFrame();
}
startToolkit(canvas, { onReport, onStop: (why) => say(`The program stopped: ${why}`) }).then((handle) => {
  ui = handle;
  say('');
}, (err) => {
  say(hasJSPI ? `The program did not start: ${err.message}` : 'This browser has no JavaScript Promise Integration (WebAssembly.Suspending), so the C loop cannot wait. Chrome has it from version 137.');
});
// A canvas that loses its drawing context is blank until the browser gives it back.
canvas.addEventListener('contextlost', () => say('The canvas lost its drawing context. The program is still waiting and draws again when the browser restores it.'));
canvas.addEventListener('contextrestored', () => say(''));

// ---------------------------------------------------------------- the edge filter
// #region edge-stage
const out = $('edge-out'), edgeState = $('edge-state');
let busy = false;
async function runEdges() {
  if (busy || !ui) return;
  busy = true;
  try {
    const image = grab(ui, 'notes');
    const wasm = wasmEdges(ui, image);
    let shown = wasm, text = `${image.width}×${image.height} pixels. WebAssembly: ${wasm.ms.toFixed(1)} ms. `;
    if (navigator.ml) {
      try {
        const nn = await webnnEdges(image);
        shown = nn;
        text += `WebNN: ${nn.ms.toFixed(1)} ms${nn.buildMs ? ` after ${nn.buildMs.toFixed(0)} ms to build the graph` : ''}. `
          + `The picture is the WebNN output. Pixels over the threshold: ${nn.lit} from WebNN, ${wasm.lit} from WebAssembly.`;
      } catch (err) {
        text += `WebNN failed (${err.name}: ${err.message}), so the picture is the WebAssembly output.`;
      }
    } else {
      text += 'navigator.ml is missing in this browser, so the WebNN graph did not run and the picture is the WebAssembly output.';
    }
    if (out.width !== image.width) out.width = image.width;
    if (out.height !== image.height) out.height = image.height;
    out.style.width = `${image.width / ui.scale()}px`;
    out.getContext('2d').putImageData(shown.image, 0, 0);
    out.hidden = false;
    edgeState.textContent = text;
  } catch (err) {
    edgeState.textContent = `The filter did not run: ${err.message}`;
  } finally {
    busy = false;
  }
}
$('edge-run').addEventListener('click', () => {
  afterFrame = runEdges; // from now on, after every frame the program draws
  runEdges();
});
// #endregion edge-stage

// ---------------------------------------------------------------- live checks
let frame = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture() {
  if (frame) return frame;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;width:340px;height:400px;overflow:hidden;pointer-events:none';
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:340px;height:400px';
  f.src = '/wasm-ui/fixture.html';
  holder.append(f);
  document.body.append(holder);
  await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('frame did not load')); });
  for (let i = 0; i < 50 && !f.contentWindow.__ui && !f.contentWindow.__error; i++) await sleep(100);
  if (!f.contentWindow.__ui) throw new Error(f.contentWindow.__error ?? 'the program did not start');
  for (let i = 0; i < 30 && !f.contentWindow.__ui.stats().frames; i++) await sleep(100);
  frame = { holder, win: f.contentWindow, doc: f.contentDocument, ui: f.contentWindow.__ui };
  return frame;
}
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };
const until = async (test, ms = 2500) => { for (let t = 0; t < ms; t += 50) { if (test()) return true; await sleep(50); } return false; };
// A press and release on a widget the program draws itself, as pointer events on the canvas.
async function press(name) {
  const { win, doc, ui } = await fixture();
  const c = doc.getElementById('app'), box = c.getBoundingClientRect(), r = ui.rect(name);
  const at = { bubbles: true, clientX: box.x + r.x + r.w / 2, clientY: box.y + r.y + r.h / 2, pointerId: 7, pointerType: 'touch' };
  c.dispatchEvent(new win.PointerEvent('pointerdown', at));
  c.dispatchEvent(new win.PointerEvent('pointerup', at));
}

const tests = [
  {
    name: 'run() is suspended in wait_event() and has drawn a frame',
    why: 'WebAssembly.promising(run)() returned a promise at the first wait_event(). The C loop has no exit.',
    run: async () => {
      const { win, ui } = await fixture();
      const s = ui.stats();
      if (win.__stopped) throw new Error(`the program stopped: ${win.__stopped}`);
      if (!s.frames) throw new Error(`no frame was drawn. ${s.lastError}`);
      if (!s.waiting) throw new Error('the program is not waiting');
      return `${s.frames} frames drawn after ${s.paints} paint events; a wait_event() promise is pending`;
    },
  },
  {
    name: 'With no events the program draws nothing',
    why: 'The loop does not poll. 30 animation frames pass and the frame count must not change.',
    run: async () => {
      const { win, ui } = await fixture();
      await sleep(300);
      const before = ui.stats().frames;
      for (let i = 0; i < 30; i++) await new Promise((r) => win.requestAnimationFrame(r));
      const drawn = ui.stats().frames - before;
      if (drawn) throw new Error(`${drawn} frames were drawn with nothing happening`);
      return '0 frames drawn during 30 animation frames';
    },
  },
  {
    name: 'A change to a field wakes the loop through the paint event',
    why: 'The browser repaints the textarea, fires paint on the canvas, and the promise that wait_event() is suspended on settles.',
    run: async () => {
      const { win, ui } = await fixture();
      const before = ui.stats();
      const el = ui.element('notes');
      el.value = 'changed by the check';
      if (!await until(() => ui.stats().frames > before.frames)) throw new Error('no frame followed the change');
      await sleep(200);
      const after = ui.stats();
      return `${after.frames - before.frames} frame(s) and ${after.paints - before.paints} paint event(s) after the value changed`;
    },
  },
  {
    name: 'The browser hit tests a field where the C program drew it',
    why: 'drawElementImage() in a 2D canvas sets the element\'s hit box. The program chose the position.',
    run: async () => {
      const { doc, ui } = await fixture();
      const el = ui.element('name'), c = centre(el), want = ui.rect('name');
      const hit = doc.elementFromPoint(c.x, c.y);
      if (hit !== el) throw new Error(`elementFromPoint gave <${hit?.localName}>`);
      if (Math.abs(c.r.x - want.x) > 1 || Math.abs(c.r.y - want.y) > 1) throw new Error(`box at ${c.r.x}, ${c.r.y}; drawn at ${want.x}, ${want.y}`);
      return `drawn at ${want.x}, ${want.y}; getBoundingClientRect() gives ${Math.round(c.r.x)}, ${Math.round(c.r.y)} and the point hits the input`;
    },
  },
  {
    name: 'ask() blocks in a nested loop while its dialog is open',
    why: 'A press on the Delete rectangle makes the main loop call ask(). The dialog is a real element with two real buttons.',
    run: async () => {
      const { doc, ui } = await fixture();
      const before = ui.stats().nested;
      await press('delete-label');
      if (!await until(() => ui.stats().nested > before && ui.rect('dialog'))) throw new Error('the dialog did not open');
      const cancel = ui.element('dialog-cancel'), c = centre(cancel);
      const hit = doc.elementFromPoint(c.x, c.y);
      if (hit !== cancel) throw new Error(`the Cancel button is not hit: <${hit?.localName}>`);
      const field = ui.element('name'), f = centre(field);
      if (!field.inert) throw new Error('the field under the dialog is not inert');
      const under = doc.elementFromPoint(f.x, 12 + f.r.y);
      if (under === field) throw new Error('the field under the dialog still takes the pointer');
      return `suspended inside ask() (${ui.stats().nested} nested waits); Cancel is hit at ${Math.round(c.x)}, ${Math.round(c.y)}; the name field is inert`;
    },
  },
  {
    name: 'A click on a dialog button makes ask() return to its caller',
    why: 'The C stack that was suspended inside ask() continues, and run() gets the return value.',
    run: async () => {
      const { ui } = await fixture();
      if (!ui.rect('dialog')) throw new Error('the dialog is not open (the check before this one failed)');
      ui.element('dialog-ok').click();
      const status = ui.element('status');
      if (!await until(() => /returned 1/.test(status.textContent))) throw new Error(`status reads "${status.textContent}"`);
      if (ui.rect('dialog')) throw new Error('the dialog is still drawn');
      if (ui.element('name').inert) throw new Error('the field is still inert');
      return `the status line, written by C, reads "${status.textContent.trim()}"`;
    },
  },
  {
    name: 'A closed dialog takes no pointer',
    why: 'The program stopped drawing it. Its last hit box was in the middle of the canvas.',
    run: async () => {
      const { doc, ui } = await fixture();
      const dialog = ui.element('dialog');
      const box = doc.getElementById('app').getBoundingClientRect();
      const hit = doc.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (dialog.contains(hit)) throw new Error('the closed dialog is still hit');
      return `the middle of the canvas hits <${hit?.localName}>; the dialog is inert`;
    },
  },
  {
    name: 'A C function runs while run() is suspended',
    why: 'The edge filter is an export of the same module. It is called on the pixels drawn for the notes field.',
    run: async () => {
      const { win, ui } = await fixture();
      const image = grab(ui, 'notes');
      const r = wasmEdges(ui, image);
      if (!r.lit) throw new Error('the filter found no edges, so the pixels read back empty');
      if (!ui.stats().waiting || win.__stopped) throw new Error('run() is no longer suspended');
      return `${image.width}×${image.height} pixels, ${r.lit} over the threshold, ${r.ms.toFixed(1)} ms; run() is still suspended`;
    },
  },
  {
    name: 'The same filter runs as a WebNN graph',
    why: 'navigator.ml with the MLTensor calls: createTensor(), writeTensor(), dispatch(), readTensor().',
    expect: navigator.ml ? 'pass' : 'fail',
    timeout: 15000,
    run: async () => {
      const { ui } = await fixture();
      const image = grab(ui, 'notes');
      const nn = await webnnEdges(image);
      const wasm = wasmEdges(ui, image);
      const ratio = nn.lit / Math.max(1, wasm.lit);
      if (ratio < 0.9 || ratio > 1.1) throw new Error(`WebNN found ${nn.lit} edge pixels, WebAssembly ${wasm.lit}`);
      return `${nn.lit} pixels over the threshold (WebAssembly: ${wasm.lit}), ${nn.ms.toFixed(1)} ms after ${nn.buildMs.toFixed(0)} ms to build`;
    },
  },
];

runTests($('results'), tests).then(() => { frame?.holder.remove(); frame = null; });
