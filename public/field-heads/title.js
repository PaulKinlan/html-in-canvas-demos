import { mount, put, colors } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('titleCanvas'), input = document.getElementById('titleInput'), out = document.getElementById('titleOut');
  // #region title
  // The page's own <title> element is moved out of the <head> and into the canvas. It is still the first
  // <title> in the document, so it still names the tab, and with display: block it has a box and a
  // picture like any other element. The canvas draws that picture as the heading, and draws a tab above
  // it with document.title as its text. Typing changes the text of the one element.
  const title = document.querySelector('title');
  const original = title.textContent;
  title.setAttribute('drawable', '');
  canvas.append(title);
  let frames = 0;
  const stage = mount(canvas, (ctx, w, h) => {
    const c = colors(canvas), tw = title.offsetWidth, k = Math.min(1, (w - 24) / tw);
    // A browser tab, drawn by the canvas.
    ctx.fillStyle = c.line; ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = c.card; ctx.beginPath(); ctx.roundRect(12, 8, Math.min(w - 60, 250), 40, [10, 10, 0, 0]); ctx.fill();
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(30, 27, 6, 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(44, 8, Math.min(w - 60, 250) - 44, 36); ctx.clip();
    ctx.fillStyle = c.fg; ctx.font = '13px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(document.title, 44, 27);
    ctx.restore();
    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.fillText('document.title, as canvas text', 14, 62);
    // The element itself, with a second, blurred draw of it behind as a shadow.
    ctx.save();
    ctx.translate((w - tw * k) / 2, 84); ctx.scale(k, k);
    ctx.save(); ctx.globalAlpha = 0.3; ctx.filter = 'blur(5px)'; put(ctx, title, 5, 8); ctx.restore();
    put(ctx, title, 0, 0);
    ctx.restore();
    out.textContent = `document.title is "${document.title}". The title element is ${title.offsetWidth} by ${title.offsetHeight} px and its parent is the ${title.parentNode.localName}.`;
    return frames++ < 2;
  });
  input.value = original;
  input.addEventListener('input', () => { title.textContent = input.value || original; frames = 0; stage.request(); });
  // #endregion title
  return { stage };
}
