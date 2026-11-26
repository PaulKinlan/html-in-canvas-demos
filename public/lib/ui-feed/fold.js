// ui-feed/fold.js: shared animated <details> helper (Fold, wire), focusRing and static picture cache
// used by standalone ui-feed custom elements.

import { smooth, rr, reduced } from './kit.js';

// #region fold
// A <details> that the canvas opens and closes over time.
//
// A closed <details> has no content in its picture, so a close cannot be drawn after the element has
// closed. The click on the <summary> is cancelled, the canvas draws less and less of the picture, and the
// `open` attribute is removed when nothing of the content is left. An open sets the attribute at once.
export class Fold {
  constructor(ctrl, details, seconds = 0.36) {
    this.ctrl = ctrl; this.d = details; this.seconds = seconds;
    this.t = this.want = details.open ? 1 : 0;      // how far open it is drawn, and where it is going
    this.h = 0;                                      // the height of the content, measured while it is open
    this.dom = details.open;                         // the state this object last gave the element
    // Opened or closed by something else: find in page, a script, or the plain fallback.
    details.addEventListener('toggle', () => {
      if (details.open === this.dom) return;
      this.dom = details.open; this.t = this.want = details.open ? 1 : 0;
      if (details.open) ctrl.opened?.(this);
      ctrl.sync?.(); ctrl.request();
    });
  }
  get open() { return this.want === 1; }
  set(open) {
    if (open && !this.d.open) this.d.open = this.dom = true;
    this.want = open ? 1 : 0;
    this.ctrl.request();
  }
  // Called once a frame. True while it is still moving.
  step(dt) {
    if (this.t !== this.want) {
      const by = reduced() ? 1 : dt / this.seconds;
      this.t = this.want ? Math.min(1, this.t + by) : Math.max(0, this.t - by);
    }
    if (this.t === 0 && this.dom) this.d.open = this.dom = false;     // not when something else has just opened it
    if (this.d.open) this.h = this.d.offsetHeight - this.d.firstElementChild.offsetHeight;
    return this.t !== this.want;
  }
  get e() { return smooth(this.t); }
}
// The summary of each fold calls pick(i) instead of toggling its <details>.
export function wire(ctrl, folds) {
  folds.forEach((f, i) => f.d.firstElementChild.addEventListener('click', (e) => {
    if (ctrl.plain) return;                           // as plain HTML the element toggles itself
    e.preventDefault(); ctrl.pick(i);
  }));
}
// #endregion fold

export function focusRing(ctx, x, y, w, h, colour = '#fff') {
  ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, x, y, w, h, 4); ctx.stroke(); ctx.restore();
}

// A picture that does not change, drawn once on a plain canvas at the control's own scale.
export function cached(ctrl, key, w, h, draw) {
  const store = ctrl.pictures ??= new Map(), px = ctrl.px;
  let c = store.get(key);
  if (!c || c.px !== px) {
    c = { px, canvas: c?.canvas ?? document.createElement('canvas') };
    c.canvas.width = Math.ceil(w * px); c.canvas.height = Math.ceil(h * px);
    const g = c.canvas.getContext('2d');
    g.scale(px, px); draw(g, w, h);
    store.set(key, c);
  }
  return c.canvas;
}
