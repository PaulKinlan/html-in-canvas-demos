import { mount, put, park, concertina, scrollRange, clamp, reducedMotion } from './kit.js';

export default function start() {
  const scroller = document.getElementById('headScroll');
  const canvas = document.getElementById('headCanvas');
  const header = document.getElementById('foldHeader');
  const article = document.getElementById('foldArticle');
  const out = document.getElementById('headOut');

  // #region header
  // `folded` is the part of the header that is folded away, from 0 to 1.
  let folded = 0, goal = null, lastTop = 0, last = 0, idle = 0;

  const stage = mount(canvas, (ctx, w, h, t) => {
    const H0 = header.offsetHeight, W = header.offsetWidth, top = scroller.scrollTop;
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    if (goal !== null) {
      folded += (goal - folded) * (reducedMotion() ? 1 : 1 - Math.exp(-dt * 12));
      if (Math.abs(goal - folded) < 0.004) { folded = goal; goal = null; }
    }
    // The article is drawn at minus the scroll position, starting under the open header.
    put(ctx, article, 0, H0 - top);

    const shown = H0 * (1 - folded);
    if (folded <= 0.001) put(ctx, header, 0, 0);                     // flat: one draw, and it takes input
    else {
      park(canvas, header);                                          // folded: its buttons are not there
      if (folded < 0.999) concertina(ctx, header, W, H0, 1 - folded, 4);
    }
    // The folded stack leaves an edge, and the header shades the text under it.
    ctx.fillStyle = getComputedStyle(header).backgroundColor;
    ctx.fillRect(0, shown, w, 5 * folded);
    const shade = ctx.createLinearGradient(0, shown + 5 * folded, 0, shown + 5 * folded + 12);
    shade.addColorStop(0, `rgb(0 0 0 / ${top > 2 ? 0.22 : 0})`); shade.addColorStop(1, 'rgb(0 0 0 / 0)');
    ctx.fillStyle = shade; ctx.fillRect(0, shown + 5 * folded, w, 12);
    return goal !== null;
  });

  // Scrolling down folds the header by the distance scrolled. Scrolling up unfolds it by the same
  // distance, wherever the reader is in the article.
  scroller.addEventListener('scroll', () => {
    const H0 = header.offsetHeight, top = scroller.scrollTop;
    goal = null;
    folded = clamp(folded + (top - lastTop) / H0);
    folded = Math.min(folded, top / H0);                             // never more folded than scrolled
    lastTop = top;
    say();
    stage.request();
    // When the scroll stops with the header half folded, finish the fold either way.
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (folded <= 0 || folded >= 1) return;
      if (top >= H0) goal = folded > 0.5 ? 1 : 0;
      else if (folded < top / H0 - 0.01) goal = 0;
      stage.request();
    }, 160);
  }, { passive: true });
  // #endregion header

  const say = () => { out.textContent = `scrollTop ${Math.round(scroller.scrollTop)} px. Header ${Math.round((1 - folded) * 100)}% open.`; };
  scrollRange(scroller, canvas, article, header.offsetHeight);
  document.getElementById('foldTop').addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
  let marks = 0;
  article.addEventListener('click', (e) => { if (e.target.matches('button.mark')) { e.target.textContent = 'Marked'; e.target.disabled = true; document.getElementById('foldCount').textContent = `${++marks} marked`; } });
  say();
  return { stage, scroller, get folded() { return folded; } };
}
