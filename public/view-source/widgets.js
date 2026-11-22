// widgets.js: the parts of /view-source/ that change the page after it has loaded, so that the DOM under
// the page differs from the HTML the server sent. Each one says in the page which kind of change it makes.

import { mount, put } from '/lib/stage-2d.js';

const $ = (id) => document.getElementById(id);

export function startWidgets(sheet) {
  // #region changes
  // Text and an attribute, once a second.
  const clock = $('clock');
  const tick = () => {
    const now = new Date();
    clock.dateTime = now.toISOString().slice(0, 19) + 'Z';
    clock.textContent = now.toLocaleTimeString('en-GB');
  };
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 1000);

  // An attribute and the text of an <output>.
  $('count').onclick = () => {
    const next = Number($('count').dataset.count) + 1;
    $('count').dataset.count = next;
    $('count-out').value = next;
  };

  // Children added, moved and removed.
  const list = $('list');
  let made = list.children.length;
  $('list-add').onclick = () => {
    const li = document.createElement('li');
    li.textContent = `Row ${++made}, added at ${new Date().toLocaleTimeString('en-GB')}`;
    list.append(li);
  };
  $('list-turn').onclick = () => { for (const li of [...list.children].reverse()) list.append(li); };
  $('list-drop').onclick = () => list.lastElementChild?.remove();

  // One custom property in a style attribute. The colours of the page are computed from it.
  for (const button of document.querySelectorAll('#swatches button')) {
    button.onclick = () => {
      sheet.style.setProperty('--hue', button.dataset.hue);
      for (const other of document.querySelectorAll('#swatches button')) other.setAttribute('aria-pressed', String(other === button));
    };
  }

  // Typing and ticking change properties. The attributes keep what the server sent until this runs.
  $('reflect').onclick = () => {
    $('field').setAttribute('value', $('field').value);
    $('tick').toggleAttribute('checked', $('tick').checked);
  };
  // #endregion changes

  // #region nested
  // A canvas inside the page, which is itself inside the canvas that peels. It draws one block of HTML
  // twice: a faint copy upside down, then the real one, which is drawn last and so takes the input.
  const canvas = $('twice');
  const block = $('twice-block');
  let presses = 0;
  $('twice-press').onclick = () => { $('twice-press').textContent = `Pressed ${++presses} ${presses === 1 ? 'time' : 'times'}`; };
  mount(canvas, (ctx, width, height) => {
    const w = block.offsetWidth, h = block.offsetHeight;
    const x = (width - w) / 2, y = 10;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(0, 2 * (y + h) + 6);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.5;
    put(ctx, block, x, y, w, h);
    ctx.restore();
    // Fade the copy out towards the bottom.
    const fade = ctx.createLinearGradient(0, y + h + 6, 0, height);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.8, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, y + h + 6, width, height);
    ctx.globalCompositeOperation = 'source-over';
    put(ctx, block, x, y, w, h);
    return false;
  });
  // #endregion nested
}

// #region receipt
/** Fill in the "What the server sent" card from readSent()'s result and the parser log. */
export function showReceipt(result, parserLog = []) {
  const n = (value) => Math.round(value).toLocaleString('en');
  const set = (id, text) => { $(id).textContent = text; };
  if (result) {
    set('r-bytes', `${n(result.bytes)} bytes`);
    set('r-lines', `${n(result.lines)} lines`);
    set('r-first', `${result.firstByte.toFixed(0)} ms`);
    set('r-type', `${result.type || 'none'}${result.encoding ? `, ${result.encoding}` : ''}`);
    set('r-same', !result.parsedBytes ? 'not reported by this browser' : result.parsedBytes === result.bytes ? `yes, ${n(result.bytes)} bytes both times` : `no: ${n(result.parsedBytes)} bytes then, ${n(result.bytes)} now`);
    // One bar per chunk, as wide as its share of the bytes.
    $('r-chunks').replaceChildren(...result.chunks.map((chunk, i) => {
      const bar = document.createElement('span');
      bar.style.flex = `${chunk.bytes} 1 0`;
      bar.textContent = `${i + 1}`;
      bar.title = `Chunk ${i + 1}: ${n(chunk.bytes)} bytes at ${chunk.at.toFixed(0)} ms`;
      return bar;
    }));
    set('r-chunk-note', `${result.chunks.length} ${result.chunks.length === 1 ? 'chunk' : 'chunks'} in ${result.ms.toFixed(0)} ms`);
  } else {
    for (const id of ['r-bytes', 'r-lines', 'r-first', 'r-type', 'r-same', 'r-chunk-note']) set(id, 'the fetch failed');
  }
  // One bar per batch of nodes the parser handed over, as tall as the batch.
  const batches = parserLog.filter((batch) => batch.added);
  const most = Math.max(1, ...batches.map((batch) => batch.added));
  $('r-parser').replaceChildren(...batches.slice(0, 60).map((batch) => {
    const bar = document.createElement('span');
    bar.style.height = `${Math.max(8, (batch.added / most) * 100)}%`;
    bar.title = `${batch.added} nodes at ${batch.at.toFixed(0)} ms`;
    return bar;
  }));
  const total = batches.reduce((sum, batch) => sum + batch.added, 0);
  set('r-parser-note', batches.length ? `${n(total)} nodes in ${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}, the last at ${batches[batches.length - 1].at.toFixed(0)} ms` : 'no batches were recorded');
}
// #endregion receipt
