// check-fixture.js: the fixture the live checks of /view-source/ and /view-dom/ build on the test stage.
// The checks never peel or change the page itself.

import { supported, testStage } from '/shared/support.js';
import { pagePeel } from '/lib/page-peel.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const need = () => { if (!supported) throw new Error('HTML-in-canvas is not available'); };
export const W = 300, H = 180;

/** A small desk on the test stage: a layer with one button under a sheet with tall content. */
export async function fixture({ drawn = true, extra = '' } = {}) {
  const desk = document.createElement('div');
  desk.dataset.peelDesk = '';
  desk.style.cssText = `position:relative;flex:none;width:${W}px;height:${H}px;overflow:clip;background:#103050`;
  desk.innerHTML = `<div class="u" style="position:absolute;inset:0"><button type="button" class="ub" style="position:absolute;right:6px;top:6px;width:90px;height:44px">under</button></div>
    <div class="s" ${drawn ? 'fx="page-peel" fx-backend="shared"' : ''} style="height:${H}px;overflow-y:auto;scrollbar-width:none;background:#fff;color:#000;font:14px system-ui">
      <button type="button" class="top" style="position:absolute;right:6px;top:6px;width:90px;height:44px">sheet</button>
      <p style="margin:0;padding:120px 10px 0">Flat part</p>${extra}
      <button type="button" class="low" style="display:block;margin:110px 0 300px 10px;width:120px;height:40px">lower</button>
    </div>`;
  testStage().append(desk);
  const sheet = desk.querySelector('.s');
  const peel = pagePeel(sheet, { under: desk.querySelector('.u') });
  let s = null;
  if (drawn) {
    for (let i = 0; i < 200; i++) { s = sheet.closest('fx-surface'); if (s?.ready && s.frames) break; await sleep(25); }
    if (!s?.ready) throw new Error('the fixture was never drawn');
  } else await sleep(100);
  const at = (x, y) => { const r = desk.getBoundingClientRect(); return document.elementFromPoint(r.left + x, r.top + y); };
  const set = async (x, y) => { peel.set(x, y); await sleep(120); };
  // Pixels of the surface, read once from a copy, addressed in CSS pixels.
  const pixels = async () => {
    const image = await s.readback();
    const k = image.width / W;
    return (x, y) => { const i = (Math.round(y * k) * image.width + Math.round(x * k)) * 4; return [...image.data.slice(i, i + 4)]; };
  };
  return { desk, sheet, peel, surface: s, at, set, pixels };
}
export const centre = (poly) => [poly.reduce((sum, p) => sum + p[0], 0) / poly.length, poly.reduce((sum, p) => sum + p[1], 0) / poly.length];
