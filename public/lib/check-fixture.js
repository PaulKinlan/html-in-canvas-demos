// Live checks that leave the visible demo alone.
//
// Checks on these pages move the camera, focus fields and scroll things into view. Doing that
// to the demo someone is looking at (on a phone, mid-tap) is hostile. So the page loads a
// second, invisible copy of itself with ?fixture=1, the copy runs the checks against its own
// scene, and this page only mirrors the results into its table.

const params = new URLSearchParams(location.search);
export const isFixture = params.has('fixture');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Checks that focus a field pull focus out of the parent page for a moment. If someone is
// typing there (a phone keyboard is up), the copy waits for them to finish first.
function someoneIsTyping() {
  try {
    const a = parent.document.activeElement;
    return !!a && (a.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]), textarea, select') || a.isContentEditable);
  } catch {
    return false;
  }
}

/** Fixture side: wrap the tests so each result is published to the parent as it lands. */
export function publish(tests) {
  const done = {};
  window.__checks = { list: tests.map(({ name, why }) => ({ name, why })), done };
  return tests.map((t) => ({
    ...t,
    timeout: 3_600_000, // the wait below is open-ended; the check itself keeps its own limit
    run: async () => {
      while (parent !== window && someoneIsTyping()) await sleep(300);
      const ms = t.timeout ?? 4000;
      try {
        const detail = await Promise.race([t.run(), sleep(ms).then(() => { throw new Error(`timed out after ${ms}ms`); })]);
        done[t.name] = { ok: true, detail };
        return detail;
      } catch (err) {
        done[t.name] = { ok: false, name: err?.name ?? 'Error', message: err?.message ?? String(err) };
        throw err;
      }
    },
  }));
}

/**
 * Parent side: run the checks in a hidden copy of this page and show them in `tbody`.
 * `extra` are tests that run here, on the visible demo, and must not disturb it.
 */
export async function mirror(tbody, runTests, { extra = [], query = '', width = 1000, height = 800 } = {}) {
  const frame = document.createElement('iframe');
  frame.src = `${location.pathname}?fixture=1${query}`;
  frame.title = 'Hidden copy of this page that runs the live checks';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // On screen (so it paints and hit tests) but invisible, behind the page and out of reach.
  frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;z-index:-1;`;

  // Focus checks inside the copy would pull focus out of this page, and with it a phone's
  // keyboard. Hand focus straight back to whatever had it.
  let held = document.activeElement;
  const remember = () => { if (document.activeElement !== frame) held = document.activeElement; };
  const giveBack = () => setTimeout(() => {
    if (document.activeElement !== frame) return;
    if (held && held !== document.body && held.isConnected) held.focus({ preventScroll: true });
    else frame.blur();
  }, 0);
  // A field the user left on purpose is not handed focus again.
  const forget = () => setTimeout(() => { if (document.activeElement === document.body) held = null; }, 0);
  document.addEventListener('focusin', remember, true);
  document.addEventListener('focusout', forget, true);
  window.addEventListener('blur', giveBack);

  const note = document.createElement('tr');
  note.innerHTML = '<td class="status pending">…</td><td colspan="2" class="note">Running on a hidden copy of this page, so the demo above is left alone.</td>';
  tbody.append(note);
  document.body.append(frame);

  let checks = null;
  for (let t = 0; t < 40000 && !checks; t += 100) {
    await sleep(100);
    try {
      checks = frame.contentWindow?.__checks ?? null;
    } catch { /* not ready */ }
  }
  note.remove();
  const stubs = checks
    ? checks.list.map((t) => ({
        name: t.name,
        why: t.why,
        timeout: 3_600_000,
        run: async () => {
          while (!checks.done[t.name]) {
            if (!frame.contentWindow) throw new Error('the hidden copy went away');
            await sleep(100);
          }
          const r = checks.done[t.name];
          if (r.ok) return r.detail;
          const err = new Error(r.message);
          err.name = r.name;
          throw err;
        },
      }))
    : [{ name: 'Live checks', why: 'They run in a hidden copy of this page.', run: async () => { throw new Error('the hidden copy did not start'); } }];
  const results = await runTests(tbody, [...stubs, ...extra]);
  document.removeEventListener('focusin', remember, true);
  document.removeEventListener('focusout', forget, true);
  window.removeEventListener('blur', giveBack);
  frame.remove();
  return results;
}

/** How many different colours a coarse grid of the WebGL drawing buffer has. Call right after a render. */
export function sampleGL(gl) {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4), seen = new Set();
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    gl.readPixels(Math.floor((w * i) / 8), Math.floor((h * j) / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    seen.add(px.join(','));
  }
  return seen.size;
}

/** The same for a 2D canvas. */
export function sample2D(ctx) {
  const { width: w, height: h } = ctx.canvas, seen = new Set();
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    seen.add(ctx.getImageData(Math.floor((w * i) / 8), Math.floor((h * j) / 8), 1, 1).data.join(','));
  }
  return seen.size;
}

/**
 * A lost graphics context leaves a blank box. Say so instead, over the stage, with a way out.
 * Returns { lost() } so a check can ask.
 */
export function watchContext(canvas, stage, { onRestore } = {}) {
  let lost = false, box = null;
  const show = () => {
    lost = true;
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;padding:24px;text-align:center;background:#10131af2;color:#e8ebf2;font:15px/1.4 system-ui,sans-serif;';
      box.innerHTML = '<strong>The browser took this canvas’s graphics context away.</strong><span>This happens when the GPU is busy or memory is short. It may come back by itself.</span>';
      const b = document.createElement('button');
      b.textContent = 'Reload the page';
      b.style.cssText = 'font:inherit;padding:8px 16px;border-radius:8px;border:0;background:#d2491f;color:#fff;cursor:pointer;';
      b.addEventListener('click', () => location.reload());
      box.append(b);
      stage.append(box);
    }
    box.hidden = false;
    box.style.display = 'flex';
  };
  const hide = () => {
    lost = false;
    if (box) box.style.display = 'none';
    onRestore?.();
  };
  // WebGL must cancel the event to be allowed a restore; a 2D canvas restores by default.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); show(); });
  canvas.addEventListener('webglcontextrestored', hide);
  canvas.addEventListener('contextlost', show);
  canvas.addEventListener('contextrestored', hide);
  return { lost: () => lost };
}
