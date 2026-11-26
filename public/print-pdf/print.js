import { banner, runTests, testStage, nextPaint, inkFraction, stillDrawn, supported } from '/shared/support.js';
import { connectionLog } from '/lib/live-log.js';

banner();

const $ = (id) => document.getElementById(id);
const rawCanvas = $('raw-canvas');
const rawCard = $('raw-card');
const rawFallback = $('raw-fallback');
const handoffCanvas = $('handoff-canvas');
const handoffCard = $('handoff-card');
const handoffSlot = $('handoff-slot');
const printHost = $('print-host');
const handoffStateEl = $('handoff-state');
const handoffTagEl = $('handoff-tag');
const demoStatus = $('demo-status');
const btnPrint = $('btn-print');
const btnSimulate = $('btn-simulate');
const btnSync = $('btn-sync');

const eventLog = connectionLog($('event-log'), { title: 'Handoff event log', open: true });

// A small plain offscreen tile for the paper-grain overlay (not drawable, never read back).
function makeGrainTile() {
  const tile = document.createElement('canvas');
  tile.width = 96;
  tile.height = 96;
  const g = tile.getContext('2d');
  if (!g) return tile;
  let seed = 4122026;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < 96; y += 2) {
    for (let x = 0; x < 96; x += 2) {
      const v = rand();
      g.fillStyle = v > 0.5 ? 'rgba(90, 74, 52, 0.08)' : 'rgba(255, 252, 244, 0.1)';
      g.fillRect(x, y, 2, 2);
    }
  }
  return tile;
}
const grainTile = makeGrainTile();

// #region paint
function syncCanvasSize(canvas, entry) {
  const zoom = canvas.currentCSSZoom || 1;
  let w, h;
  if (entry?.devicePixelContentBoxSize?.[0]) {
    const box = entry.devicePixelContentBoxSize[0];
    w = Math.round(box.inlineSize);
    h = Math.round(box.blockSize);
  } else {
    w = Math.round(canvas.clientWidth * devicePixelRatio * zoom);
    h = Math.round(canvas.clientHeight * devicePixelRatio * zoom);
  }
  if (w > 0 && canvas.width !== w) canvas.width = w;
  if (h > 0 && canvas.height !== h) canvas.height = h;
}

function drawCropMarks(ctx, x, y, w, h) {
  const len = 8;
  const gap = 3;
  ctx.strokeStyle = 'rgba(72, 64, 52, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
  ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
  // Top-right
  ctx.moveTo(x + w + gap, y); ctx.lineTo(x + w + gap + len, y);
  ctx.moveTo(x + w, y - gap - len); ctx.lineTo(x + w, y - gap);
  // Bottom-left
  ctx.moveTo(x - gap - len, y + h); ctx.lineTo(x - gap, y + h);
  ctx.moveTo(x, y + h + gap); ctx.lineTo(x, y + h + gap + len);
  // Bottom-right
  ctx.moveTo(x + w + gap, y + h); ctx.lineTo(x + w + gap + len, y + h);
  ctx.moveTo(x + w, y + h + gap); ctx.lineTo(x + w, y + h + gap + len);
  ctx.stroke();
}

function drawRubberStamp(ctx, cx, cy, label) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.22);
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = '#b83a16';
  ctx.fillStyle = '#b83a16';
  ctx.lineWidth = 2;
  ctx.strokeRect(-54, -18, 108, 36);
  ctx.lineWidth = 0.75;
  ctx.strokeRect(-50, -14, 100, 28);
  ctx.font = '700 10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CANVAS 2D', 0, -5);
  ctx.font = '600 8.5px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(label, 0, 7);
  ctx.restore();
}

function attachCardPainter(canvas, card, { stampLabel, fallbackHost, name }) {
  const ctx = canvas.getContext('2d');
  const pattern = ctx ? ctx.createPattern(grainTile, 'repeat') : null;
  let queued = 0;
  let tries = 0;
  let lost = false;

  const again = () => {
    if (!queued && !lost) {
      queued = requestAnimationFrame(() => {
        queued = 0;
        canvas.requestPaint?.();
      });
    }
  };

  function paint() {
    if (lost || !ctx || !canvas.clientWidth || card.parentElement !== canvas) return;
    syncCanvasSize(canvas);
    const k = canvas.width / canvas.clientWidth || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const ew = card.offsetWidth;
    const eh = card.offsetHeight;
    if (!ew || !eh) {
      if (tries++ < 60) again();
      return;
    }

    ctx.reset();
    ctx.scale(k, k);

    // Drafting-desk mat background.
    ctx.fillStyle = '#ece6d8';
    ctx.fillRect(0, 0, cw, ch);
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    const ox = Math.max(10, Math.round((cw - ew) / 2));
    const oy = Math.max(10, Math.round((ch - eh) / 2));
    drawCropMarks(ctx, ox, oy, ew, eh);

    // Subtle paper tilt + contact shadow, then live element drawn with explicit size.
    ctx.save();
    ctx.translate(ox + ew / 2, oy + eh / 2);
    ctx.rotate(-0.011);

    ctx.fillStyle = 'rgba(29, 28, 26, 0.14)';
    ctx.fillRect(-ew / 2 + 3, -eh / 2 + 5, ew, eh);

    try {
      ctx.drawElementImage(card, -ew / 2, -eh / 2, ew, eh);
    } catch {
      ctx.restore();
      if (tries++ < 60) again();
      return;
    }

    // Subtle curved-sheet highlight and paper grain over the drawn card.
    const sheen = ctx.createLinearGradient(-ew / 2, 0, ew / 2, 0);
    sheen.addColorStop(0, 'rgba(255, 250, 235, 0.08)');
    sheen.addColorStop(0.35, 'rgba(255, 255, 255, 0.0)');
    sheen.addColorStop(0.78, 'rgba(60, 48, 30, 0.05)');
    sheen.addColorStop(1, 'rgba(40, 32, 20, 0.12)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-ew / 2, -eh / 2, ew, eh);

    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = pattern;
      ctx.fillRect(-ew / 2, -eh / 2, ew, eh);
      ctx.restore();
    }

    // Angled rubber stamp in the upper-right corner so canvas output is unmistakable.
    drawRubberStamp(ctx, ew / 2 - 64, -eh / 2 + 44, stampLabel);
    ctx.restore();
  }

  canvas.addEventListener('paint', paint);
  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    lost = true;
    eventLog.add(`${name}: contextlost; falling back to plain HTML`, 'bad');
    if (fallbackHost && card.parentElement === canvas) {
      fallbackHost.hidden = false;
      fallbackHost.classList.add('active');
      moveElement(fallbackHost, card);
      card.removeAttribute('drawable');
      canvas.hidden = true;
    }
    demoStatus.textContent = `${name} lost its 2D context and fell back to plain HTML.`;
  });
  canvas.addEventListener('contextrestored', () => {
    lost = false;
    eventLog.add(`${name}: contextrestored`, 'good');
    canvas.requestPaint?.();
  });

  const ro = new ResizeObserver((entries) => {
    syncCanvasSize(canvas, entries[0]);
    if (card.parentElement === canvas) canvas.requestPaint?.();
  });
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(canvas);
  }

  syncCanvasSize(canvas);
  canvas.requestPaint?.();
  return { paint, ro };
}
// #endregion paint

// #region handoff
const hasMoveBefore = typeof Element.prototype.moveBefore === 'function';
let handoffLocation = 'canvas';
let printing = false;
let simulated = false;

function moveElement(targetParent, node) {
  if (typeof targetParent.moveBefore === 'function') {
    try {
      targetParent.moveBefore(node, null);
      return 'moveBefore()';
    } catch {
      // Fall through to appendChild() if the browser rejects the atomic move.
    }
  }
  targetParent.appendChild(node);
  return 'appendChild() fallback';
}

function snapshotCardState(card) {
  const input = card.querySelector('input[type="text"]');
  const check = card.querySelector('input[type="checkbox"]');
  const active = document.activeElement;
  const hasFocus = active && card.contains(active) ? active : null;
  return {
    value: input ? input.value : '',
    selStart: input ? input.selectionStart : null,
    selEnd: input ? input.selectionEnd : null,
    checked: check ? check.checked : false,
    activeEl: hasFocus,
    activeTag: hasFocus ? `${hasFocus.localName}#${hasFocus.id}` : 'none',
  };
}

function updateHandoffUi() {
  const inDom = handoffLocation === 'dom';
  handoffStateEl.textContent = inDom ? 'Right card: in plain DOM (#print-host)' : 'Right card: in <canvas>';
  handoffStateEl.classList.toggle('is-dom', inDom);
  handoffTagEl.textContent = inDom ? 'In DOM via moveBefore()' : 'In <canvas> on screen';
  handoffTagEl.classList.toggle('is-dom', inDom);
  btnSimulate.setAttribute('aria-pressed', String(simulated));
  btnSimulate.textContent = simulated ? 'Return to canvas (afterprint)' : 'Simulate print handoff';
}

function handoffToDom(trigger) {
  if (!supported) {
    eventLog.add(`${trigger}: HTML-in-canvas unavailable; right card is already in plain DOM.`);
    return;
  }
  if (handoffLocation === 'dom') {
    eventLog.add(`${trigger}: already in #print-host.`);
    return;
  }
  const before = snapshotCardState(handoffCard);

  // Activate #print-host before moving so the destination is rendered and keeps focus.
  printHost.classList.add('active');
  handoffCard.removeAttribute('drawable');
  const method = moveElement(printHost, handoffCard);
  handoffSlot.classList.add('handed-off');
  handoffLocation = 'dom';

  const after = snapshotCardState(handoffCard);
  const valueOk = before.value === after.value;
  const selOk = before.selStart === after.selStart && before.selEnd === after.selEnd;
  const checkOk = before.checked === after.checked;
  const focusNote = before.activeEl
    ? (after.activeEl === before.activeEl ? `kept (${after.activeTag})` : `lost (was ${before.activeTag})`)
    : 'none';

  eventLog.add(
    `${trigger} -> ${method} to #print-host | value="${after.value}" (${valueOk ? 'kept' : 'changed'}), sel=${after.selStart}..${after.selEnd} (${selOk ? 'kept' : 'changed'}), checked=${after.checked} (${checkOk ? 'kept' : 'changed'}), focus=${focusNote}`,
    valueOk && checkOk ? 'good' : 'bad',
  );
  demoStatus.textContent = `Right card moved out of #handoff-canvas with ${method}.`;
  updateHandoffUi();
}

function returnToCanvas(trigger) {
  if (!supported) return;
  if (printing || simulated) {
    eventLog.add(`${trigger}: staying in #print-host (${printing ? 'printing' : 'simulation active'}).`);
    return;
  }
  if (handoffLocation === 'canvas') {
    eventLog.add(`${trigger}: already in #handoff-canvas.`);
    return;
  }
  const before = snapshotCardState(handoffCard);
  const t0 = performance.now();

  // Make #handoff-canvas visible before moving back so keyboard focus stays intact.
  handoffSlot.classList.remove('handed-off');
  handoffCard.setAttribute('drawable', '');
  const method = moveElement(handoffCanvas, handoffCard);
  printHost.classList.remove('active');
  handoffLocation = 'canvas';

  syncCanvasSize(handoffCanvas);
  handoffCanvas.addEventListener('paint', () => {
    const dt = (performance.now() - t0).toFixed(1);
    eventLog.add(`#handoff-canvas repainted ${dt} ms after ${method} return.`, 'good');
  }, { once: true });
  handoffCanvas.requestPaint?.();

  const after = snapshotCardState(handoffCard);
  const valueOk = before.value === after.value;
  const selOk = before.selStart === after.selStart && before.selEnd === after.selEnd;
  const checkOk = before.checked === after.checked;
  const focusNote = before.activeEl
    ? (after.activeEl === before.activeEl ? `kept (${after.activeTag})` : `lost (was ${before.activeTag})`)
    : 'none';

  eventLog.add(
    `${trigger} -> ${method} to #handoff-canvas | value="${after.value}" (${valueOk ? 'kept' : 'changed'}), sel=${after.selStart}..${after.selEnd} (${selOk ? 'kept' : 'changed'}), checked=${after.checked} (${checkOk ? 'kept' : 'changed'}), focus=${focusNote}`,
    valueOk && checkOk ? 'good' : 'bad',
  );
  demoStatus.textContent = `Right card returned to #handoff-canvas with ${method} and requested repaint.`;
  updateHandoffUi();
}

window.addEventListener('beforeprint', () => {
  printing = true;
  handoffToDom('beforeprint');
});

window.addEventListener('afterprint', () => {
  printing = false;
  returnToCanvas('afterprint');
});

const printMql = window.matchMedia('print');
printMql.addEventListener('change', (e) => {
  eventLog.add(`matchMedia('print') change: matches=${e.matches}`);
  if (e.matches) {
    printing = true;
    handoffToDom("matchMedia('print')");
  } else {
    printing = false;
    returnToCanvas("matchMedia('print')");
  }
});
// #endregion handoff

// User controls. window.print() is ONLY ever called on this button click.
btnPrint.addEventListener('click', () => {
  eventLog.add('Print button pressed: calling window.print()');
  window.print();
});

btnSimulate.addEventListener('click', () => {
  simulated = !simulated;
  if (simulated) {
    handoffToDom('simulate');
  } else {
    returnToCanvas('simulate off');
  }
});

btnSync.addEventListener('click', () => {
  const leftName = $('raw-recipient');
  const leftCheck = $('raw-verified');
  const rightName = $('handoff-recipient');
  const rightCheck = $('handoff-verified');
  if (leftName && rightName) rightName.value = leftName.value;
  if (leftCheck && rightCheck) rightCheck.checked = leftCheck.checked;
  if (supported && handoffLocation === 'canvas') handoffCanvas.requestPaint?.();
  eventLog.add(`Synced inputs from left card to right card ("${rightName?.value ?? ''}", checked=${rightCheck?.checked}).`);
});

if (supported) {
  attachCardPainter(rawCanvas, rawCard, { stampLabel: 'STAYS CANVAS', fallbackHost: rawFallback, name: '#raw-canvas' });
  attachCardPainter(handoffCanvas, handoffCard, { stampLabel: 'HANDS OFF', fallbackHost: printHost, name: '#handoff-canvas' });
  eventLog.add(`Ready. moveBefore() ${hasMoveBefore ? 'available' : 'not available (will use appendChild fallback)'}.`);
  demoStatus.textContent = 'Both cards are drawn inside 2D canvases. Press Print or Simulate print handoff to compare.';
} else {
  // Without HTML-in-canvas, a canvas hides its children, so move both cards into plain HTML.
  rawFallback.hidden = false;
  rawFallback.append(rawCard);
  rawCanvas.hidden = true;
  printHost.classList.add('active');
  printHost.append(handoffCard);
  handoffSlot.classList.add('handed-off');
  handoffLocation = 'dom';
  updateHandoffUi();
  eventLog.add('HTML-in-canvas is not available here; moved both cards out to plain HTML.');
  demoStatus.textContent = 'This browser has no drawElementImage(), so both cards are shown as plain HTML.';
}

// ---------------------------------------------------------------- live checks (isolated fixtures)
const need = (ok, text) => {
  if (!ok) throw new Error(text);
  return text;
};

// Never call getImageData() directly on a drawable canvas: copy to a small plain canvas first.
function readCopyInk(canvas) {
  if (!canvas.width || !canvas.height) return 0;
  const copy = document.createElement('canvas');
  copy.width = Math.min(canvas.width, 240);
  copy.height = Math.min(canvas.height, 240);
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, copy.width, copy.height);
  const fraction = inkFraction(cc);
  copy.width = copy.height = 0;
  return fraction;
}

function makeFixture() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:240px';

  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = 240;
  canvas.height = 100;
  canvas.style.cssText = 'display:block;width:240px;height:100px';

  const card = document.createElement('div');
  card.setAttribute('drawable', '');
  card.style.cssText = 'box-sizing:border-box;width:240px;height:100px;padding:8px;background:#1d4ed8;color:#fff;font:13px system-ui';
  card.innerHTML = '<input type="text" value="Initial" style="width:140px"><input type="checkbox" checked>';
  canvas.append(card);

  const host = document.createElement('div');
  host.style.cssText = 'width:240px;min-height:10px';

  wrap.append(canvas, host);
  testStage().append(wrap);

  const ctx = canvas.getContext('2d');
  canvas.addEventListener('paint', () => {
    if (!ctx || card.parentElement !== canvas) return;
    ctx.reset();
    try {
      ctx.drawElementImage(card, 0, 0, card.offsetWidth || 240, card.offsetHeight || 100);
    } catch {}
  });

  return {
    wrap,
    canvas,
    ctx,
    card,
    host,
    input: card.querySelector('input[type="text"]'),
    checkbox: card.querySelector('input[type="checkbox"]'),
  };
}

const tests = [
  {
    name: 'Element.prototype.moveBefore is supported',
    expect: 'pass',
    why: "typeof Element.prototype.moveBefore === 'function'",
    run: async () => need(
      typeof Element.prototype.moveBefore === 'function',
      'Element.prototype.moveBefore is a function in this browser.',
    ),
  },
  {
    name: 'Simulated beforeprint -> moveBefore() out -> afterprint -> moveBefore() back preserves input value and checkbox state',
    expect: 'pass',
    why: 'On a fixture canvas, edit the text input, selection range and checkbox, move out to a sibling host, then move back into the canvas.',
    run: async () => {
      if (typeof Element.prototype.moveBefore !== 'function') {
        throw new Error('Element.prototype.moveBefore is not supported.');
      }
      const f = makeFixture();
      f.input.value = 'Grace Hopper';
      f.input.setSelectionRange(0, 5);
      f.checkbox.checked = false;

      // Simulate beforeprint / afterprint lifecycle on an isolated EventTarget.
      const bus = new EventTarget();
      bus.addEventListener('beforeprint', () => {
        f.card.removeAttribute('drawable');
        f.host.moveBefore(f.card, null);
      });
      bus.addEventListener('afterprint', () => {
        f.card.setAttribute('drawable', '');
        f.canvas.moveBefore(f.card, null);
      });

      bus.dispatchEvent(new Event('beforeprint'));
      const outParentOk = f.card.parentElement === f.host;
      const outValueOk = f.input.value === 'Grace Hopper';
      const outCheckOk = f.checkbox.checked === false;

      bus.dispatchEvent(new Event('afterprint'));
      const backParentOk = f.card.parentElement === f.canvas;
      const backValueOk = f.input.value === 'Grace Hopper';
      const backSelOk = f.input.selectionStart === 0 && f.input.selectionEnd === 5;
      const backCheckOk = f.checkbox.checked === false;

      const ok = outParentOk && outValueOk && outCheckOk && backParentOk && backValueOk && backSelOk && backCheckOk;
      return need(
        ok,
        `Out: parent=${f.host.localName}, value="${f.input.value}", checked=${f.checkbox.checked}. Back: parent=${f.card.parentElement?.localName}, value="${f.input.value}", sel=${f.input.selectionStart}..${f.input.selectionEnd}, checked=${f.checkbox.checked}.`,
      );
    },
  },
  {
    name: 'canvas.requestPaint() repaints non-empty pixels after moveBefore() returns the element to the canvas',
    expect: 'pass',
    why: 'Draw fixture, move element out, clear canvas to 0% ink, move element back with moveBefore(), call requestPaint(), then measure ink via a plain copy canvas.',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas drawElementImage() is not available in this browser.');
      if (typeof Element.prototype.moveBefore !== 'function') {
        throw new Error('Element.prototype.moveBefore is not supported.');
      }
      const f = makeFixture();
      await nextPaint(f.canvas);

      f.card.removeAttribute('drawable');
      f.host.moveBefore(f.card, null);
      f.ctx.clearRect(0, 0, f.canvas.width, f.canvas.height);
      const clearedInk = readCopyInk(f.canvas);

      const t0 = performance.now();
      f.card.setAttribute('drawable', '');
      f.canvas.moveBefore(f.card, null);
      await nextPaint(f.canvas);
      const dt = (performance.now() - t0).toFixed(1);
      const repaintedInk = readCopyInk(f.canvas);

      return need(
        clearedInk < 0.002 && repaintedInk > 0.05,
        `Cleared: ${(clearedInk * 100).toFixed(1)}% ink. After moveBefore() + requestPaint(): ${(repaintedInk * 100).toFixed(1)}% ink in ${dt} ms.`,
      );
    },
  },
  {
    name: "window.matchMedia('print') listener registers cleanly",
    expect: 'pass',
    why: "Create window.matchMedia('print'), attach a 'change' listener, and remove it without throwing.",
    run: async () => {
      const mql = window.matchMedia('print');
      const onChange = () => {};
      mql.addEventListener('change', onChange);
      mql.removeEventListener('change', onChange);
      return need(
        typeof mql.matches === 'boolean' && mql.media === 'print',
        `media="${mql.media}", matches=${mql.matches}, change listener added and removed cleanly.`,
      );
    },
  },
];

if (supported) {
  tests.push(
    stillDrawn(() => [
      {
        name: 'Canvas output (#raw-canvas)',
        ink: async () => readCopyInk(rawCanvas),
        rescue: () => {
          rawFallback.hidden = false;
          rawFallback.append(rawCard);
          rawCanvas.hidden = true;
        },
      },
      {
        name: 'Handoff canvas (#handoff-canvas)',
        note: 'handed off to #print-host',
        ink: async () => (handoffLocation === 'canvas' ? readCopyInk(handoffCanvas) : null),
        rescue: () => handoffToDom('rescue'),
      },
    ]),
  );
}

runTests($('tests'), tests);
