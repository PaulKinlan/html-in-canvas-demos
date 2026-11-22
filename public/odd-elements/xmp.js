import { mount, put, colors } from '/form-state/kit.js';

// Markup typed by the reader is parsed in a separate document first. Elements that load or run things,
// on* attributes and javascript: links are taken out before the rest is moved into the page.
function safeHTML(target, text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  for (const el of doc.body.querySelectorAll('script, iframe, object, embed, link, meta, style, base, form')) el.remove();
  for (const el of doc.body.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
  target.replaceChildren(...doc.body.childNodes);
}

export default function start() {
  const canvas = document.getElementById('xmpCanvas'), source = document.getElementById('xmpSource'), result = document.getElementById('xmpResult'), out = document.getElementById('xmpOut');
  let frames = 0, tags = 0;
  const render = () => { safeHTML(result, source.textContent); frames = 0; stage.request(); };
  // #region xmp
  // An <xmp> shows its content as text, tags and all, and cannot have child elements. So the colour
  // behind each tag is not markup: the canvas finds the tags in the text with a regular expression, asks
  // a Range for the rectangles of each one, and paints them before it draws the element.
  function tagRects() {
    const nodes = [], walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, from: text.length }); text += n.data; }
    const at = (i) => { const hit = nodes.findLast((x) => x.from <= i) ?? nodes[0]; return [hit.n, Math.min(hit.n.length, i - hit.from)]; };
    const list = [];
    if (!nodes.length) return list;
    for (const m of text.matchAll(/<\/?[a-zA-Z][^<>]*>/g)) {
      const r = document.createRange();
      r.setStart(...at(m.index)); r.setEnd(...at(m.index + m[0].length));
      list.push({ closing: m[0][1] === '/', rects: [...r.getClientRects()] });
    }
    return list;
  }
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), W = source.offsetWidth, k = Math.min(1, (w - 16) / W), x = (w - W * k) / 2, y = 12, box = canvas.getBoundingClientRect();
    const sh = source.offsetHeight, ry = sh + 40;
    ctx.save();
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = '#10151f'; ctx.beginPath(); ctx.roundRect(0, 0, W, sh, 8); ctx.fill();
    const found = tagRects(); tags = found.length;
    for (const tag of found) {
      ctx.fillStyle = tag.closing ? 'rgba(244,114,182,.38)' : 'rgba(56,189,248,.38)';
      // Client rectangles are reported at the place where the element was last drawn.
      for (const r of tag.rects) { ctx.beginPath(); ctx.roundRect((r.x - box.x - x) / k - 1, (r.y - box.y - y) / k, r.width / k + 2, r.height / k, 3); ctx.fill(); }
    }
    put(ctx, source, 0, 0);
    // An arrow from the text to what it makes.
    ctx.strokeStyle = c.muted; ctx.fillStyle = c.muted; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, sh + 6); ctx.lineTo(W / 2, sh + 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 - 7, sh + 24); ctx.lineTo(W / 2 + 7, sh + 24); ctx.lineTo(W / 2, sh + 34); ctx.fill();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(0.5, ry + 0.5, W - 1, result.offsetHeight - 1, 8); ctx.stroke();
    put(ctx, result, 0, ry);
    ctx.restore();
    out.textContent = `${tags} tags coloured in the xmp text. The xmp has ${source.children.length} child elements and ${source.textContent.length} characters. The copy below it has ${result.querySelectorAll('*').length} elements.`;
    // The rectangles follow the draw before, so the first frames after a change are drawn twice.
    return frames++ < 3;
  });
  // #endregion xmp
  source.addEventListener('input', render);
  render();
  return { stage };
}
