// Probes: does a recent web platform feature work on an element that a canvas
// draws? Each probe builds a small fixture in the rig, draws it with
// drawElementImage() and reads pixels, hit tests or state back.
//
// A probe returns { status, detail }:
//   works        the feature takes effect in the drawn picture or on the drawn element
//   fails        the browser has the feature, and it does not carry into the canvas
//   unsupported  this browser does not have the feature
//   manual       the probe needs a real key press or pointer; run it by hand
//   info         a measurement with no pass or fail
//
// `features` are chromestatus.com feature ids, so the plan page can show a
// probe's result beside the feature it measures.

const W = 300, H = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const supports = (prop, value) => { try { return CSS.supports(prop, value); } catch { return false; } };

// #region fixture
// One canvas with one drawable child that fills it. draw() paints the child at
// an offset and resolves when the paint event has run.
function fixture(rig, html, css = '', ctxOptions) {
  rig.innerHTML =
    `<style>${css}</style>` +
    `<canvas content="drawable" layoutsubtree width="${W}" height="${H}" style="width:${W}px;height:${H}px;display:block">` +
    `<div drawable class="t" style="width:${W}px;height:${H}px;overflow:hidden">${html}</div></canvas><div class="outside"></div>`;
  const canvas = rig.querySelector('canvas');
  const el = canvas.firstElementChild;
  const ctx = canvas.getContext('2d', ctxOptions);
  let paints = 0, at = [0, 0];
  canvas.addEventListener('paint', () => {
    paints++;
    ctx.reset();
    ctx.drawElementImage(el, at[0], at[1], W, H);
  });
  const draw = async (dx = 0, dy = 0) => {
    at = [dx, dy];
    const before = paints;
    canvas.requestPaint();
    for (let i = 0; i < 60 && paints === before; i++) await sleep(16);
    await sleep(30);
  };
  // Wait for a paint event the browser raises by itself (no requestPaint()).
  const ownPaint = async (ms = 600) => {
    const before = paints;
    for (let t = 0; t < ms && paints === before; t += 16) await sleep(16);
    const fired = paints !== before;
    if (!fired) await draw(...at);
    return fired;
  };
  const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  // Count pixels that match a predicate, and return the first match.
  const count = (test) => {
    const d = ctx.getImageData(0, 0, W, H).data;
    let n = 0, first = null;
    for (let i = 0; i < d.length; i += 4) {
      if (test(d[i], d[i + 1], d[i + 2], d[i + 3])) { n++; first ??= [(i / 4) % W, Math.floor(i / 4 / W)]; }
    }
    return { n, first };
  };
  // Viewport point of a canvas pixel, for elementFromPoint().
  const client = (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + x, r.top + y]; };
  return { canvas, el, ctx, draw, ownPaint, px, count, client, outside: rig.querySelector('.outside'), paints: () => paints };
}
// #endregion fixture

const isRed = (r, g, b, a) => r > 200 && g < 60 && b < 60 && a > 200;
const isBlue = (r, g, b, a) => r < 60 && g < 60 && b > 200 && a > 200;
const isGreen = (r, g, b, a) => r < 60 && g > 200 && b < 60 && a > 200;

export const PROBES = [
  {
    id: 'corner-shape', title: 'corner-shape: bevel on a drawn element', features: [5357329815699456, 5152215540039680],
    async run(rig) {
      if (!supports('corner-shape', 'bevel')) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b"></div>', '.b{width:100px;height:100px;background:#f00;border-radius:50px;corner-shape:bevel}');
      await f.draw();
      const corner = f.px(18, 18), mid = f.px(50, 50);
      return corner[3] === 0 && isRed(...mid) ? { status: 'works', detail: 'The pixel at 18,18 is transparent (a round corner would cover it) and the centre is red.' } : { status: 'fails', detail: `corner ${corner}, centre ${mid}` };
    },
  },
  {
    id: 'border-shape', title: 'border-shape: circle() on a drawn element', features: [5459864205393920],
    async run(rig) {
      if (!supports('border-shape', 'circle(50%)')) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b"></div>', '.b{width:100px;height:100px;background:#f00;border:4px solid #00f;border-shape:circle(50%)}');
      await f.draw();
      const corner = f.px(6, 6), mid = f.px(50, 50);
      return corner[3] === 0 && mid[3] === 255 ? { status: 'works', detail: `Corner pixel is transparent, centre is ${mid.slice(0, 3)}.` } : { status: 'fails', detail: `corner ${corner}, centre ${mid}` };
    },
  },
  {
    id: 'clip-shape', title: 'clip-path: shape() on a drawn element', features: [5172258539307008],
    async run(rig) {
      const v = 'shape(from 0 0, line to 100px 0, line to 0 100px, close)';
      if (!supports('clip-path', v)) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b"></div>', `.b{width:100px;height:100px;background:#f00;clip-path:${v}}`);
      await f.draw();
      const out = f.px(80, 80), inside = f.px(20, 20);
      return out[3] === 0 && isRed(...inside) ? { status: 'works', detail: 'The triangle is drawn and the clipped half is transparent.' } : { status: 'fails', detail: `outside ${out}, inside ${inside}` };
    },
  },
  {
    id: 'random', title: 'CSS random() keeps one value across paints', features: [5324559251275776],
    async run(rig) {
      if (!supports('width', 'random(1px, 2px)')) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b"></div><div class="b"></div>', '.b{width:random(10px,290px);height:20px;background:#f00;margin:2px}');
      const [a, b] = f.el.querySelectorAll('.b');
      await f.draw();
      const w1 = [a.offsetWidth, b.offsetWidth];
      f.el.style.color = '#123';
      await f.draw();
      const w2 = [a.offsetWidth, b.offsetWidth];
      const stable = w1[0] === w2[0] && w1[1] === w2[1];
      return { status: stable ? 'works' : 'fails', detail: `Widths ${w1.join(' and ')} px on the first paint, ${w2.join(' and ')} px after a style change and a second paint.` };
    },
  },
  {
    id: 'text-fit', title: 'text-fit scales text to the box in the drawn picture', features: [5104141688635392],
    async run(rig) {
      const v = ['grow', 'grow per-line', 'shrink'].find((x) => supports('text-fit', x));
      if (!v) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b">Fit</div>', `.b{width:280px;font:10px sans-serif;color:#f00;text-fit:${v}}`);
      await f.draw();
      const d = f.ctx.getImageData(0, 0, W, H).data;
      let maxX = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) maxX = Math.max(maxX, (i / 4) % W);
      return maxX > 200 ? { status: 'works', detail: `Ink of a 10px word reaches x=${maxX} of 280.` } : { status: 'fails', detail: `Ink only reaches x=${maxX}.` };
    },
  },
  {
    id: 'carousel', title: '::scroll-marker and ::scroll-button() of a scroller in a canvas', features: [5160035463462912, 5093129273999360, 5192332683771904],
    async run(rig, auto) {
      if (!supports('scroll-marker-group', 'after')) return { status: 'unsupported' };
      const f = fixture(rig,
        '<div class="s"><div></div><div></div><div></div></div>',
        `.s{width:280px;height:90px;overflow-x:auto;display:flex;scroll-snap-type:x mandatory;scroll-marker-group:after;scrollbar-width:none}
         .s>div{flex:0 0 280px;height:90px;scroll-snap-align:start;background:#ddd}
         .s>div::scroll-marker{content:'';width:22px;height:22px;background:#00f;display:inline-block;margin:2px}
         .s>div::scroll-marker:target-current{background:#f00}
         .s::scroll-marker-group{display:flex;height:26px}
         .s::scroll-button(inline-end){content:'';background:#0f0;width:30px;height:30px;border:0}`);
      await f.draw();
      const blue = f.count(isBlue), red = f.count(isRed), green = f.count(isGreen);
      const parts = [`${red.n} px of current marker, ${blue.n} px of other markers, ${green.n} px of scroll button are in the picture.`];
      const s = f.el.querySelector('.s');
      let clicked = null;
      if (blue.first && auto) {
        await auto.click(...f.client(blue.first[0] + 8, blue.first[1] + 8));
        await sleep(700);
        clicked = s.scrollLeft > 0;
        parts.push(clicked ? `A real click on a drawn marker scrolled the list to ${Math.round(s.scrollLeft)} px.` : 'A real click on a drawn marker did not scroll the list.');
      } else if (blue.first) parts.push('Tap a blue marker to check that it scrolls.');
      if (!blue.n && !red.n) return { status: 'fails', detail: 'No marker pixels are in the element picture.' };
      return { status: clicked === false ? 'fails' : 'works', detail: parts.join(' ') };
    },
  },
  {
    id: 'scroll-state', title: 'scroll-state(stuck) container query restyles a drawn element', features: [5072263730167808],
    async run(rig) {
      if (!supports('container-type', 'scroll-state')) return { status: 'unsupported' };
      const f = fixture(rig,
        '<div class="sc"><div style="height:40px"></div><div class="hd"><div></div></div><div style="height:600px"></div></div>',
        `.sc{height:150px;overflow:auto;scrollbar-width:none}.hd{position:sticky;top:0;container-type:scroll-state;height:30px}
         .hd>div{height:30px;background:#00f}@container scroll-state(stuck: top){.hd>div{background:#f00}}`);
      await f.draw();
      const before = f.px(10, 50);
      f.el.querySelector('.sc').scrollTop = 120;
      const own = await f.ownPaint();
      await f.draw();
      const after = f.px(10, 10);
      return isBlue(...before) && isRed(...after)
        ? { status: 'works', detail: `The header is blue before scrolling and red when stuck. ${own ? 'The scroll raised a paint event by itself.' : 'No paint event followed the scroll; the page had to call requestPaint().'}` }
        : { status: 'fails', detail: `before ${before}, after ${after}` };
    },
  },
  {
    id: 'scroll-timeline', title: 'Scroll-driven animation inside a drawn element', features: [6522328437620736, 5181996801982464],
    async run(rig) {
      if (!supports('animation-timeline', 'scroll()')) return { status: 'unsupported' };
      const f = fixture(rig,
        '<div class="sc"><div class="bar"></div><div class="dot"></div><div style="height:600px"></div></div>',
        `.sc{height:150px;overflow:auto;scrollbar-width:none}
         .bar{position:sticky;top:0;height:30px;background:#00f;animation:k linear both;animation-timeline:scroll(nearest)}
         .dot{position:sticky;top:40px;width:20px;height:20px;background:#0f0;animation:m linear both;animation-timeline:scroll(nearest)}
         @keyframes k{to{background:#f00}}@keyframes m{to{transform:translateX(200px)}}`);
      await f.draw();
      const sc = f.el.querySelector('.sc');
      sc.scrollTop = sc.scrollHeight;
      const own = await f.ownPaint();
      await f.draw();
      const bar = f.px(10, 10), moved = f.px(210, 50);
      const ok = isRed(...bar) && isGreen(...moved);
      return { status: ok ? 'works' : 'fails', detail: `After scrolling to the end the bar is ${bar.slice(0, 3)} and the transformed square is ${isGreen(...moved) ? 'at its end position' : 'not at its end position'}. ${own ? 'The scroll raised a paint event by itself.' : 'No paint event followed the scroll.'}` };
    },
  },
  {
    id: 'anchor', title: 'An element outside the canvas anchored to a drawn element', features: [5201048700583936, 5094192052436992],
    async run(rig) {
      if (!supports('position-anchor', '--a')) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b"></div>', '.b{width:60px;height:20px;background:#f00;anchor-name:--probe-a}.tip{position:fixed;position-anchor:--probe-a;left:anchor(left);top:anchor(bottom);width:10px;height:10px;background:#00f}');
      f.outside.innerHTML = '<div class="tip"></div>';
      const tip = f.outside.firstElementChild;
      await f.draw(0, 0);
      const c = f.canvas.getBoundingClientRect();
      const r1 = tip.getBoundingClientRect();
      await f.draw(100, 50);
      await sleep(100);
      const r2 = tip.getBoundingClientRect();
      const rel1 = [Math.round(r1.left - c.left), Math.round(r1.top - c.top)], rel2 = [Math.round(r2.left - c.left), Math.round(r2.top - c.top)];
      const anchored = Math.abs(rel1[0]) < 3 && Math.abs(rel1[1] - 20) < 3;
      const follows = Math.abs(rel2[0] - 100) < 3 && Math.abs(rel2[1] - 70) < 3;
      if (!anchored) return { status: 'fails', detail: `The anchored element is at ${rel1} relative to the canvas, not under the drawn element at 0,20.` };
      return { status: follows ? 'works' : 'fails', detail: `Drawn at 0,0 the anchored element sits at ${rel1}. Drawn at 100,50 it sits at ${rel2}${follows ? ', so anchoring follows where the element is drawn.' : ', so anchoring uses the layout box and not the drawn position.'}` };
    },
  },
  {
    id: 'popover', title: 'A popover that is a descendant of a drawn element', features: [5073251081912320],
    async run(rig) {
      const f = fixture(rig, '<div class="b">x</div><div popover="manual" class="p"></div>', '.p{inset:auto;left:20px;top:20px;margin:0;border:0;padding:0;width:60px;height:40px;background:#f00;position:fixed}');
      const p = f.el.querySelector('.p');
      p.showPopover();
      await f.draw();
      const inPicture = f.count(isRed).n;
      const r = p.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 5, r.top + 5) === p;
      p.hidePopover();
      return { status: inPicture ? 'works' : 'fails', detail: `${inPicture} popover pixels are in the element picture. Its box is ${Math.round(r.width)}×${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)} in the viewport and ${hit ? 'it is hit tested there' : 'elementFromPoint() does not return it there'}.` };
    },
  },
  {
    id: 'interestfor', title: 'interestfor on a drawn button opens a hint outside the canvas', features: [4530756656562176],
    async run(rig, auto) {
      if (!('interestForElement' in HTMLButtonElement.prototype)) return { status: 'unsupported' };
      const f = fixture(rig, '<button class="b" interestfor="probe-tip">Hover</button>', '.b{position:absolute;left:0;top:0;width:80px;height:30px;interest-delay:0s}');
      f.outside.innerHTML = '<div popover="hint" id="probe-tip" style="position:fixed;inset:auto;left:0;top:0">tip</div>';
      const tip = f.outside.firstElementChild;
      await f.draw(120, 60);
      if (!auto) return { status: 'manual', detail: 'Hover or long-press the button and check that the hint opens.' };
      await auto.move(...f.client(160, 75));
      await sleep(1200);
      const open = tip.matches(':popover-open');
      await auto.move(1, 1);
      return { status: open ? 'works' : 'fails', detail: open ? 'Hovering the button where it is drawn (120,60) opened the hint.' : 'Hovering the drawn button did not open the hint.' };
    },
  },
  {
    id: 'highlight', title: 'Custom highlights are painted, and highlightsFromPoint() follows the drawn position', features: [5090853643354112, 4552801607483392],
    async run(rig) {
      if (!('highlights' in CSS)) return { status: 'unsupported' };
      const f = fixture(rig, '<p class="b">highlight me</p>', '.b{margin:0;font:20px sans-serif;color:#000}::highlight(probe-k){background-color:#f00;color:#f00}');
      const range = new Range();
      range.selectNodeContents(f.el.querySelector('.b'));
      CSS.highlights.set('probe-k', new Highlight(range));
      await f.draw(60, 40);
      const red = f.count(isRed);
      let from = 'highlightsFromPoint() is not in this browser.';
      if (CSS.highlights.highlightsFromPoint && red.first) {
        const hits = CSS.highlights.highlightsFromPoint(...f.client(red.first[0] + 4, red.first[1] + 4));
        from = hits.length ? 'highlightsFromPoint() at the drawn position returns the highlight.' : 'highlightsFromPoint() at the drawn position returns nothing.';
      }
      CSS.highlights.delete('probe-k');
      return { status: red.n > 50 ? 'works' : 'fails', detail: `${red.n} highlight pixels are in the picture. ${from}` };
    },
  },
  {
    id: 'visited', title: ':visited styling in a picture that script can read', features: [5101991698628608],
    async run(rig, auto) {
      const f = fixture(rig, `<a class="b" href="/start/">visited link text</a>`, '.b{font:bold 24px sans-serif;text-decoration:none}a.b:link{color:#00f}a.b:visited{color:#f00}');
      // The link goes to /start/, which a reader of this site has usually opened from the menu.
      f.outside.innerHTML = '<a class="b" href="/start/">visited link text</a>';
      await f.draw();
      const red = f.count(isRed).n, blue = f.count(isBlue).n;
      let screen = null;
      if (auto?.shot) {
        const r = f.outside.firstElementChild.getBoundingClientRect();
        screen = await auto.shot(r.left, r.top, r.width, r.height);
      }
      if (screen && screen.red < 20) return { status: 'info', detail: `This browser profile does not style the link as visited on screen (${screen.red} red px), so the probe says nothing. Picture: ${red} red, ${blue} blue.` };
      if (red > 20) return { status: 'works', detail: `${red} pixels of the :visited colour are in the picture and readable with getImageData(). That exposes one bit of history per link.` };
      return { status: 'info', detail: `Picture: ${red} px in the :visited colour, ${blue} px in the :link colour.${screen ? ` On screen the same link outside the canvas has ${screen.red} px in the :visited colour, so the canvas gets the link drawn as unvisited and history does not leak.` : ' If the link in the fixture box looks red on screen, the canvas got it drawn as unvisited.'}` };
    },
  },
  {
    id: 'accent', title: 'System colours in a readable picture', features: [5068127364186112, 6207138742534144],
    async run(rig) {
      const f = fixture(rig, '<div class="a"></div><div class="h"></div>', '.a,.h{width:50px;height:50px}.a{background:AccentColor}.h{background:Highlight}');
      await f.draw();
      return { status: 'info', detail: `AccentColor reads back as rgb(${f.px(10, 10).slice(0, 3)}), Highlight as rgb(${f.px(10, 60).slice(0, 3)}). ${supports('color', 'AccentColor') ? '' : 'This browser does not parse AccentColor.'}` };
    },
  },
  {
    id: 'caret', title: 'caret-shape and caret-color in the drawn picture', features: [6106160780017664, 5082469066604544],
    async run(rig) {
      const had = document.activeElement;
      const shapes = supports('caret-shape', 'block');
      const f = fixture(rig, '<input class="i" value="ab"><input class="j" value="ab">', `.i,.j{display:block;font:20px monospace;color:#000;background:#fff;border:0;outline:0;width:200px;caret-color:#f00;caret-animation:manual}.j{caret-shape:block}`);
      const [i, j] = f.el.querySelectorAll('input');
      i.focus({ preventScroll: true }); i.setSelectionRange(1, 1);
      await f.draw(); await sleep(60); await f.draw();
      const bar = f.count(isRed).n;
      j.focus({ preventScroll: true }); j.setSelectionRange(1, 1);
      await f.draw(); await sleep(60); await f.draw();
      const block = f.count(isRed).n;
      j.blur(); had?.focus?.({ preventScroll: true });
      if (!bar) return { status: 'fails', detail: 'No caret pixels are in the picture.' };
      if (!shapes) return { status: 'unsupported', detail: `The bar caret is drawn (${bar} px). caret-shape is not in this browser.` };
      return { status: block > bar * 2 ? 'works' : 'fails', detail: `The bar caret covers ${bar} px and the block caret ${block} px of the picture.` };
    },
  },
  {
    id: 'focusgroup', title: 'focusgroup arrow keys between drawn buttons', features: [5637601087193088],
    async run(rig, auto) {
      if (!('focusgroup' in HTMLElement.prototype) && !('focusGroup' in HTMLElement.prototype)) return { status: 'unsupported' };
      const had = document.activeElement;
      const f = fixture(rig, '<div focusgroup="toolbar"><button id="pf1">One</button><button id="pf2">Two</button><button id="pf3">Three</button></div>');
      await f.draw(40, 40);
      if (!auto) return { status: 'manual', detail: 'Focus the first button and press the right arrow key.' };
      f.el.querySelector('#pf1').focus({ preventScroll: true });
      await auto.press('ArrowRight');
      await sleep(80);
      const id = document.activeElement?.id;
      document.activeElement?.blur?.(); had?.focus?.({ preventScroll: true });
      return { status: id === 'pf2' ? 'works' : 'fails', detail: `After ArrowRight the focused element is ${id || 'none'}.` };
    },
  },
  {
    id: 'opaque-range', title: 'OpaqueRange rects of text inside a drawn input', features: [6297362687066112],
    async run(rig) {
      if (!('OpaqueRange' in self)) return { status: 'unsupported' };
      const f = fixture(rig, '<input class="i" value="hello world">', '.i{font:20px monospace;border:0;padding:0;margin:0;display:block}');
      const input = f.el.querySelector('input');
      const make = ['createValueRange', 'createOpaqueRange'].find((m) => m in input);
      if (!make) return { status: 'unsupported', detail: 'OpaqueRange exists but no factory method was found on the input.' };
      await f.draw(0, 0);
      const range = input[make](6, 11);
      const a = range.getBoundingClientRect();
      await f.draw(80, 60);
      const b = range.getBoundingClientRect();
      const moved = [Math.round(b.left - a.left), Math.round(b.top - a.top)];
      return { status: a.width > 20 ? 'works' : 'fails', detail: `The range for "world" is ${Math.round(a.width)}×${Math.round(a.height)} px. After drawing the input at 80,60 its rect moved by ${moved}.` };
    },
  },
  {
    id: 'pseudo', title: 'Element.pseudo() on a drawn element', features: [5194399398756352],
    async run(rig) {
      if (!('pseudo' in Element.prototype)) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b">x</div>', '.b::before{content:"";display:inline-block;width:40px;height:40px;background:#f00}');
      await f.draw();
      const p = f.el.querySelector('.b').pseudo('::before');
      return { status: p ? 'works' : 'fails', detail: p ? `Returns a ${p.constructor.name}; the ::before box is in the picture (${f.count(isRed).n} px).` : 'Returned null.' };
    },
  },
  {
    id: 'capability', title: 'Capability elements (<geolocation>, <usermedia>) as canvas children', features: [5125006551416832, 4926233538330624, 5153829504024576],
    async run(rig) {
      const names = ['geolocation', 'usermedia', 'camera', 'microphone', 'install'];
      const f = fixture(rig, names.map((n) => `<${n} style="display:block;margin:2px"></${n}>`).join(''));
      await f.draw();
      const out = [];
      let any = false;
      for (const n of names) {
        const e = f.el.querySelector(n);
        if (e instanceof HTMLUnknownElement) { out.push(`<${n}>: not in this browser`); continue; }
        any = true;
        const r = e.getBoundingClientRect();
        const cr = f.canvas.getBoundingClientRect();
        let ink = 0;
        if (r.width && r.height) {
          const d = f.ctx.getImageData(Math.max(0, r.left - cr.left), Math.max(0, r.top - cr.top), Math.min(W, r.width), Math.min(H, r.height)).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
        }
        out.push(`<${n}>: ${Math.round(r.width)}×${Math.round(r.height)} box, ${ink} px drawn${'isValid' in e ? `, isValid ${e.isValid}${e.invalidReason ? ` (${e.invalidReason})` : ''}` : ''}`);
      }
      return { status: any ? 'info' : 'unsupported', detail: out.join('. ') + '.' };
    },
  },
  {
    id: 'wide-gamut', title: 'Display P3 and values above 1.0 in a float16 canvas', features: [5086141338877952, 5146250411769856],
    async run(rig) {
      let f;
      try {
        f = fixture(rig, '<div class="p"></div><div class="h"></div>', '.p,.h{width:50px;height:50px}.p{background:color(display-p3 1 0 0)}.h{background:color(srgb-linear 4 4 4);dynamic-range-limit:no-limit}', { colorSpace: 'display-p3', colorType: 'float16' });
      } catch (e) { return { status: 'unsupported', detail: String(e) }; }
      const attrs = f.ctx.getContextAttributes?.() ?? {};
      if (attrs.colorType !== 'float16') return { status: 'unsupported', detail: `getContextAttributes().colorType is ${attrs.colorType}.` };
      await f.draw();
      let p, h;
      try {
        p = [...f.ctx.getImageData(10, 10, 1, 1, { colorSpace: 'display-p3', pixelFormat: 'rgba-float16' }).data];
        h = [...f.ctx.getImageData(10, 60, 1, 1, { colorSpace: 'display-p3', pixelFormat: 'rgba-float16' }).data];
      } catch (e) { return { status: 'fails', detail: `Float readback failed: ${e.message}` }; }
      const fmt = (a) => a.slice(0, 3).map((v) => +v.toFixed(3)).join(', ');
      const p3 = p[0] > 0.98 && p[1] < 0.02;
      const hdr = h[0] > 1.05;
      return { status: p3 ? 'works' : 'fails', detail: `color(display-p3 1 0 0) reads back as ${fmt(p)}${p3 ? ' (kept)' : ' (clipped to sRGB)'}. color(srgb-linear 4 4 4) reads back as ${fmt(h)}${hdr ? ', above 1.0, so HDR values survive.' : ', clamped to 1.0.'}` };
    },
  },
  {
    id: 'element-timing', title: 'Element Timing and LCP entries for canvas children', features: [5162859838046208, 5110962817073152],
    async run(rig) {
      const seen = [];
      let po;
      try {
        po = new PerformanceObserver((l) => { for (const e of l.getEntries()) seen.push(e); });
        po.observe({ type: 'element' });
      } catch { return { status: 'unsupported' }; }
      const f = fixture(rig, `<p class="b" elementtiming="probe-text">Timed text in a canvas ${Math.random()}</p><img elementtiming="probe-img" width="80" height="40" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='40'%3E%3Crect width='80' height='40' fill='red'/%3E%3C/svg%3E">`, '.b{font:20px sans-serif;margin:0}');
      await f.draw(); await sleep(500); await f.draw(); await sleep(300);
      po.disconnect();
      const ids = seen.map((e) => e.identifier).filter((i) => i?.startsWith('probe-'));
      const e = seen.find((x) => x.identifier?.startsWith('probe-'));
      return { status: ids.length ? 'works' : 'fails', detail: ids.length ? `Entries: ${ids.join(', ')}. renderTime ${Math.round(e.renderTime)} ms${'presentationTime' in e ? `, presentationTime ${e.presentationTime ? Math.round(e.presentationTime) + ' ms' : 'empty'}` : ''}.` : 'No element timing entry was reported for the text or the image inside the canvas.' };
    },
  },
  {
    id: 'inert', title: 'interactivity: inert on a drawn element', features: [5107436833472512],
    async run(rig) {
      if (!supports('interactivity', 'inert')) return { status: 'unsupported' };
      const f = fixture(rig, '<button class="b">Inert</button>', '.b{position:absolute;left:0;top:0;width:100px;height:40px;background:#f00;border:0;interactivity:inert}');
      await f.draw(50, 50);
      const hit = document.elementFromPoint(...f.client(80, 70));
      const drawn = f.count(isRed).n;
      return { status: drawn && hit !== f.el.querySelector('.b') ? 'works' : 'fails', detail: `${drawn} px of the button are drawn. elementFromPoint() on it returns ${hit?.tagName?.toLowerCase() ?? 'nothing'}.` };
    },
  },
  {
    id: 'stream', title: 'Streaming HTML into a drawn element', features: [5054329641893888],
    async run(rig) {
      const names = Object.getOwnPropertyNames(Element.prototype).filter((n) => /^stream/i.test(n));
      if (!names.length) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="b"></div>', '.b{font:14px sans-serif}');
      await f.draw();
      const target = f.el.querySelector('.b');
      const method = names.find((n) => /append/i.test(n)) ?? names[0];
      let before = f.paints(), wrote = 0;
      try {
        const writer = target[method]().getWriter();
        for (const chunk of ['<p>one ', 'two</p>', '<p>three', ' four</p>', '<p>five</p>']) { await writer.write(chunk); wrote++; await sleep(120); }
        await writer.close();
      } catch (e) { return { status: 'fails', detail: `${method}() threw: ${e.message}. Methods found: ${names.join(', ')}.` }; }
      await sleep(200);
      const own = f.paints() - before;
      return { status: target.querySelectorAll('p').length === 3 ? 'works' : 'fails', detail: `${method}() took ${wrote} chunks and built ${target.querySelectorAll('p').length} paragraphs. The canvas got ${own} paint events during the stream without requestPaint(). Methods found: ${names.join(', ')}.` };
    },
  },
  {
    id: 'command', title: 'command and commandfor on a drawn button', features: [5142517058371584],
    async run(rig) {
      if (!('commandForElement' in HTMLButtonElement.prototype)) return { status: 'unsupported' };
      const f = fixture(rig, '<button class="b" commandfor="probe-pop" command="show-popover">Open</button>');
      f.outside.innerHTML = '<div popover id="probe-pop" style="position:fixed;inset:auto;left:0;top:0">panel</div>';
      await f.draw(30, 30);
      f.el.querySelector('.b').click();
      const pop = f.outside.firstElementChild;
      const open = pop.matches(':popover-open');
      if (open) pop.hidePopover();
      return { status: open ? 'works' : 'fails', detail: open ? 'A click on the drawn button opened a popover that lives outside the canvas.' : 'The popover did not open.' };
    },
  },
  {
    id: 'gap-rule', title: 'CSS gap decorations in the drawn picture', features: [5157805733183488],
    async run(rig) {
      if (!supports('row-rule', '4px solid red')) return { status: 'unsupported' };
      const f = fixture(rig, '<div class="g"><div></div><div></div><div></div><div></div></div>', '.g{display:grid;grid-template-columns:100px 100px;gap:20px;column-rule:6px solid #f00;row-rule:6px solid #00f}.g>div{height:40px;background:#ddd}');
      await f.draw();
      const col = f.px(110, 20), row = f.px(50, 50);
      return { status: isRed(...col) && isBlue(...row) ? 'works' : 'fails', detail: `Column gap pixel ${col.slice(0, 3)}, row gap pixel ${row.slice(0, 3)}.` };
    },
  },
  {
    id: 'ai', title: 'Built-in AI and agent APIs in this browser', features: [5134603979063296, 5193953788559360, 5172811302961152, 6494349985841152, 5117755740913664],
    async run() {
      const out = [];
      for (const n of ['LanguageModel', 'Summarizer', 'Translator', 'LanguageDetector', 'Writer', 'Rewriter', 'Proofreader']) {
        if (!(n in self)) { out.push(`${n}: missing`); continue; }
        let a = 'present';
        try { a = await Promise.race([self[n].availability(n === 'Translator' ? { sourceLanguage: 'en', targetLanguage: 'fr' } : undefined), sleep(1500).then(() => 'no answer')]); } catch (e) { a = `error (${e.name})`; }
        out.push(`${n}: ${a}`);
      }
      out.push(`navigator.modelContext (WebMCP): ${'modelContext' in navigator ? 'present' : 'missing'}`);
      out.push(`navigator.ml (WebNN): ${'ml' in navigator ? 'present' : 'missing'}`);
      return { status: 'info', detail: out.join('. ') + '.' };
    },
  },
  {
    id: 'webgpu', title: 'WebGPU adapter, compatibility mode and element upload', features: [6436406437871616, 5172548013916160],
    async run() {
      if (!navigator.gpu) return { status: 'unsupported' };
      const out = [];
      const core = await navigator.gpu.requestAdapter().catch(() => null);
      const compat = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' }).catch(() => null);
      out.push(`Core adapter: ${core ? `${core.info?.vendor || 'unknown vendor'}${core.info?.isFallbackAdapter ? ' (fallback adapter)' : ''}, ${core.features.size} features` : 'none'}`);
      out.push(`Compatibility adapter: ${compat ? 'yes' : 'none'}`);
      out.push(`GPUQueue.drawElementImageToTexture: ${'drawElementImageToTexture' in GPUQueue.prototype ? 'present' : 'missing'}`);
      if (core) out.push(`Optional features of interest: ${['dual-source-blending', 'float32-blendable', 'texture-formats-tier1', 'texture-formats-tier2', 'texture-component-swizzle', 'primitive-index', 'subgroups', 'clip-distances'].filter((x) => core.features.has(x)).join(', ') || 'none'}`);
      out.push(`WGSL language features: ${[...(navigator.gpu.wgslLanguageFeatures ?? [])].join(', ') || 'none listed'}`);
      return { status: 'info', detail: out.join('. ') + '.' };
    },
  },
];

// Feature detection for the features the plan refers to. Each entry is
// [chromestatus id, label, test]. Shown as a support table for this browser.
const has = (o, k) => { try { return k in o; } catch { return false; } };
export const DETECT = [
  [5172548013916160, 'HTML-in-canvas: drawElementImage()', () => has(CanvasRenderingContext2D.prototype, 'drawElementImage')],
  [5172548013916160, 'HTML-in-canvas: texElementSubImage2D()', () => has(WebGL2RenderingContext.prototype, 'texElementSubImage2D')],
  [5357329815699456, 'corner-shape', () => supports('corner-shape', 'squircle')],
  [5459864205393920, 'border-shape', () => supports('border-shape', 'circle(50%)')],
  [5172258539307008, 'shape()', () => supports('clip-path', 'shape(from 0 0, line to 1px 1px, close)')],
  [5324559251275776, 'random()', () => supports('width', 'random(1px, 2px)')],
  [5104141688635392, 'text-fit', () => supports('text-fit', 'grow')],
  [5174589850648576, 'text-box-trim', () => supports('text-box-trim', 'trim-both')],
  [5160035463462912, '::scroll-marker', () => supports('scroll-marker-group', 'after')],
  [5072263730167808, 'scroll-state() queries', () => supports('container-type', 'scroll-state')],
  [5181996801982464, 'Scroll-triggered animations (timeline-trigger)', () => supports('timeline-trigger-name', '--t') || supports('timeline-trigger', '--t view()')],
  [6313805904347136, 'if()', () => supports('width', 'if(media(width > 1px): 1px; else: 2px)')],
  [5179721933651968, '@function', () => has(self, 'CSSFunctionRule')],
  [6225478530367488, 'sibling-index()', () => supports('width', 'calc(sibling-index() * 1px)')],
  [4680129030651904, 'advanced attr()', () => supports('width', 'attr(data-w type(<length>), 1px)')],
  [4841046007742464, 'contrast-color()', () => supports('color', 'contrast-color(red)')],
  [5157805733183488, 'Gap decorations (row-rule)', () => supports('row-rule', '1px solid red')],
  [6106160780017664, 'caret-shape', () => supports('caret-shape', 'block')],
  [5082469066604544, 'caret-animation', () => supports('caret-animation', 'manual')],
  [5107436833472512, 'interactivity: inert', () => supports('interactivity', 'inert')],
  [5146250411769856, 'dynamic-range-limit', () => supports('dynamic-range-limit', 'no-limit')],
  [5183671737909248, 'Animatable zoom', () => supports('zoom', '2')],
  [5113638848561152, 'reading-flow', () => supports('reading-flow', 'flex-visual')],
  [5109852273377280, 'Element-scoped view transitions', () => has(Element.prototype, 'startViewTransition')],
  [5135990159835136, 'moveBefore()', () => has(Element.prototype, 'moveBefore')],
  [5142517058371584, 'commandfor', () => has(HTMLButtonElement.prototype, 'commandForElement')],
  [4530756656562176, 'interestfor', () => has(HTMLButtonElement.prototype, 'interestForElement')],
  [5637601087193088, 'focusgroup', () => has(HTMLElement.prototype, 'focusgroup') || has(HTMLElement.prototype, 'focusGroup')],
  [6297362687066112, 'OpaqueRange', () => has(self, 'OpaqueRange')],
  [5194399398756352, 'Element.pseudo()', () => has(Element.prototype, 'pseudo')],
  [4552801607483392, 'highlightsFromPoint()', () => !!CSS.highlights?.highlightsFromPoint],
  [5090435261792256, 'Scoped custom element registry', () => { try { new CustomElementRegistry(); return true; } catch { return false; } }],
  [5188237101891584, 'Reference Target', () => has(ShadowRoot.prototype, 'referenceTarget')],
  [5054329641893888, 'Streaming HTML methods', () => Object.getOwnPropertyNames(Element.prototype).some((n) => /^stream/i.test(n))],
  [5154593776599040, 'Observable (element.when())', () => has(EventTarget.prototype, 'when')],
  [5745430754230272, 'ariaNotify()', () => has(Element.prototype, 'ariaNotify')],
  [5125006551416832, '<geolocation>', () => has(self, 'HTMLGeolocationElement')],
  [5086141338877952, 'Canvas float16 colour type', () => { const c = document.createElement('canvas').getContext('2d', { colorType: 'float16' }); return c?.getContextAttributes?.().colorType === 'float16'; }],
  [5075532483657728, 'Enhanced TextMetrics (getSelectionRects)', () => has(TextMetrics.prototype, 'getSelectionRects')],
  [5198989277790208, 'Element Capture (RestrictionTarget)', () => has(self, 'RestrictionTarget')],
  [5092615678066688, 'Captured Surface Control', () => has(self, 'CaptureController') && has(CaptureController.prototype, 'forwardWheel')],
  [5068277495758848, 'Media element pseudo-classes (:playing)', () => { try { document.querySelector(':playing'); return true; } catch { return false; } }],
  [6265472244514816, 'SharedWorker', () => has(self, 'SharedWorker')],
  [5134603979063296, 'Prompt API (LanguageModel)', () => has(self, 'LanguageModel')],
  [5172811302961152, 'Translator', () => has(self, 'Translator')],
  [5193953788559360, 'Summarizer', () => has(self, 'Summarizer')],
  [6494349985841152, 'LanguageDetector', () => has(self, 'LanguageDetector')],
  [5117755740913664, 'WebMCP (navigator.modelContext)', () => has(navigator, 'modelContext')],
  [5176273954144256, 'WebNN (navigator.ml)', () => has(navigator, 'ml')],
  [6090916291674112, 'On-device speech recognition (SpeechRecognition.available)', () => has(self.SpeechRecognition ?? self.webkitSpeechRecognition ?? {}, 'available')],
  [5185813744975872, 'Device Posture', () => has(navigator, 'devicePosture')],
  [5170498990243840, 'Viewport Segments', () => has(visualViewport ?? {}, 'segments')],
  [5167864517623808, 'Web haptics (navigator.haptics)', () => has(navigator, 'haptics')],
  [5189864286978048, 'CPU Performance (navigator.cpuPerformance)', () => has(navigator, 'cpuPerformance')],
  [5164400693215232, 'Float16Array', () => has(self, 'Float16Array')],
  [5668291307634688, 'Temporal', () => has(self, 'Temporal')],
  [6634466544058368, 'WebXR', () => has(navigator, 'xr')],
  [6043992171085824, 'Web Serial', () => has(navigator, 'serial')],
  [5172464636133376, 'WebHID', () => has(navigator, 'hid')],
  [5183481574850560, 'Web Install (navigator.install)', () => has(navigator, 'install')],
  [5183881532932096, 'Document Picture-in-Picture', () => has(self, 'documentPictureInPicture')],
  [5082138340491264, 'Scroll promises (scrollTo() returns a promise)', () => { const d = document.createElement('div'); const r = d.scrollTo(0, 0); return !!r && typeof r.then === 'function'; }],
];

export async function runProbes(rig, { auto = null, onResult = () => {}, only = null } = {}) {
  const results = [];
  for (const p of PROBES) {
    if (only && !only.includes(p.id)) continue;
    let r;
    try {
      r = await Promise.race([p.run(rig, auto), sleep(8000).then(() => ({ status: 'error', detail: 'Timed out after 8 s.' }))]);
    } catch (e) {
      r = { status: 'error', detail: `${e.name}: ${e.message}` };
    }
    r = { id: p.id, title: p.title, features: p.features, status: r.status, detail: r.detail ?? '' };
    results.push(r);
    onResult(r);
    rig.innerHTML = '';
    await sleep(30);
  }
  return results;
}

export function runDetect() {
  return DETECT.map(([feature, label, test]) => {
    let ok = false;
    try { ok = !!test(); } catch { ok = false; }
    return { feature, label, ok };
  });
}
