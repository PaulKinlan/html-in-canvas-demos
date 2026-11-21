import { mount, put, smooth, tween } from './kit.js';

// #region mail-messages
// Three messages. Each is a whole HTML document, given to the iframe as srcdoc.
const CSS = `
  html { color-scheme: light; --bg: #f3f1ec; --card: #fff; --fg: #1d1d1f; --muted: #6b6b70; --line: #e2dfd8; }
  html.dark { color-scheme: dark; --bg: #121316; --card: #1d1f24; --fg: #f1f1f3; --muted: #a0a0a8; --line: #33363d; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  .head { padding: 14px 14px 12px; color: #fff; }
  .head small { display: block; opacity: .85; font-size: 11px; }
  .head b { display: block; font-size: 18px; line-height: 1.2; margin-top: 4px; }
  .body { padding: 12px 14px 20px; display: grid; gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  .card h2 { margin: 0 0 4px; font-size: 15px; }
  .card p { margin: 0 0 8px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 5px 0; border-bottom: 1px solid var(--line); } td:last-child { text-align: right; }
  a.btn, button.btn { display: block; box-sizing: border-box; width: 100%; padding: 11px 12px; border: 0; border-radius: 8px; color: #fff; font: 600 14px system-ui, sans-serif; text-align: center; text-decoration: none; }
  a { color: inherit; } .foot { font-size: 11px; color: var(--muted); text-align: center; }
  .code { font: 700 26px ui-monospace, monospace; letter-spacing: 4px; text-align: center; padding: 10px; border: 1px dashed var(--line); border-radius: 8px; }
  .hero { height: 86px; border-radius: 10px; }
  /* A message for a phone held sideways: the cards sit in two columns. */
  @media (min-width: 380px) { .body { grid-template-columns: 1fr 1fr; } .wide { grid-column: 1 / -1; } }
`;
const page = (color, from, subject, body) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <div class="head" style="background:${color}"><small>${from}</small><b>${subject}</b></div><div class="body">${body}
  <p class="foot wide"><a href="#browser">View in a browser</a> · <a href="#unsubscribe" data-done="Unsubscribed">Unsubscribe</a></p></div>`;
export const MESSAGES = {
  order: page('#0f766e', 'Fern &amp; Bolt · orders', 'Your order is on its way', `
    <div class="card wide"><h2>Order 20418</h2><table><tr><td>Brass hinge, pair</td><td>£14.00</td></tr><tr><td>Linseed oil, 500 ml</td><td>£9.50</td></tr><tr><td>Delivery</td><td>£3.95</td></tr><tr><td><b>Total</b></td><td><b>£27.45</b></td></tr></table></div>
    <div class="card"><h2>Arriving Thursday</h2><p>The parcel left the workshop this morning.</p><a class="btn" style="background:#0f766e" href="#track" data-done="Tracking opened">Track the parcel</a></div>
    <div class="card"><h2>Something wrong?</h2><p>Returns are free for 30 days.</p><a class="btn" style="background:#44403c" href="#return" data-done="Return started">Start a return</a></div>
    <div class="card wide"><h2>Care notes</h2><p>Oil the hinge once a year. Wipe off the extra oil after ten minutes, and leave the cloth flat to dry.</p></div>`),
  news: page('#7c3aed', 'Canvas weekly · issue 31', 'Three things that drew this week', `
    <div class="hero wide" style="background:linear-gradient(120deg,#7c3aed,#ec4899 55%,#f59e0b)"></div>
    <div class="card"><h2>Frames in frames</h2><p>A message drawn on a phone that is drawn by a canvas.</p><a href="#one" data-done="Opened: Frames in frames">Read the note</a></div>
    <div class="card"><h2>Buttons in diagrams</h2><p>A flow chart whose nodes are form controls.</p><a href="#two" data-done="Opened: Buttons in diagrams">Read the note</a></div>
    <div class="card"><h2>A script on show</h2><p>Source text as a block in the scene it draws.</p><a href="#three" data-done="Opened: A script on show">Read the note</a></div>
    <div class="card"><h2>From the archive</h2><p>Twelve earlier issues, in the order they were sent.</p><a href="#archive" data-done="Opened: the archive">Open the archive</a></div>
    <div class="card wide"><h2>Reply to this message</h2><p>Replies reach a person. Say what you would like drawn next.</p></div>`),
  reset: page('#b91c1c', 'Accounts', 'Reset your password', `
    <div class="card wide"><h2>Someone asked for a new password</h2><p>If that was you, enter this code on the sign-in page. It works for ten minutes.</p><div class="code">482 913</div></div>
    <div class="card wide"><button class="btn" style="background:#b91c1c" data-done="Code copied">Copy the code</button></div>
    <div class="card"><h2>Not you?</h2><p>Nothing has changed yet. You can ignore this message.</p><a href="#lock" data-done="Account locked">Lock the account</a></div>
    <div class="card"><h2>Where from</h2><p>Chrome on Android, near Liverpool, at 20:09.</p></div>
    <div class="card wide"><h2>Why you got this</h2><p>This address is the sign-in name of an account. We send a message like this each time a reset is asked for, and never ask for the old password.</p></div>`),
};
// #endregion mail-messages

export default function start() {
  const canvas = document.getElementById('mailCanvas');
  const frame = document.getElementById('mailFrame');
  const out = document.getElementById('mailOut');
  const SHORT = 236, LONG = 420, BW = SHORT + 24, BH = LONG + 48;   // the screen and the phone's body, CSS pixels
  let land = false, angle = 0, flip = 0, dark = false, said = 'none yet', paints = 0, by = '', current = 'order';

  // #region mail-frame
  // The message is an ordinary same-origin document. The page listens inside it once it has loaded.
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    doc.documentElement.classList.toggle('dark', dark);
    doc.addEventListener('click', (e) => {
      const link = e.target.closest('a, button');
      if (!link) return;
      e.preventDefault();
      said = link.dataset.done ?? link.textContent.trim();
      if (link.dataset.done) link.textContent = link.dataset.done;
    });
    stage.request();
  });
  // #endregion mail-frame

  // #region mail
  const stage = mount(canvas, (ctx, w, h, t, event) => {
    paints++;
    by = [...(event?.changedElements ?? [])].map((el) => `<${el.localName}>`).join(', ') || 'requestPaint()';
    const fw = frame.offsetWidth, fh = frame.offsetHeight;
    let y = 0; try { y = Math.round(frame.contentWindow.scrollY); } catch {}
    out.textContent = `The iframe is ${fw} by ${fh} CSS pixels and scrolled ${y} px. Paint events: ${paints}, the last raised by ${by}. Last link or button pressed in the message: ${said}.`;

    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const k = Math.min(1, (w - 20) / (c * BW + s * BH), (h - 20) / (s * BW + c * BH));
    ctx.translate(w / 2, h / 2);
    ctx.scale(k * Math.max(0.02, Math.abs(Math.cos(flip * Math.PI))), k);   // changing message turns the phone over
    ctx.rotate(-angle);

    // The phone's body is drawn by the canvas.
    ctx.shadowColor = 'rgb(0 0 0 / .45)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#17181c'; ctx.beginPath(); ctx.roundRect(-BW / 2, -BH / 2, BW, BH, 30); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#3a3d46'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#2b2d34'; ctx.beginPath(); ctx.roundRect(-22, -BH / 2 + 9, 44, 6, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-30, BH / 2 - 14, 60, 4, 2); ctx.fill();

    // The screen. The iframe keeps its own upright layout: after the body has turned a quarter turn,
    // the iframe is 420 wide and 236 tall and is drawn a quarter turn back.
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-SHORT / 2, -LONG / 2, SHORT, LONG, 8); ctx.clip();
    ctx.fillStyle = dark ? '#121316' : '#f3f1ec'; ctx.fillRect(-SHORT / 2, -LONG / 2, SHORT, LONG);
    if (land) ctx.rotate(Math.PI / 2);
    put(ctx, frame, -fw / 2, -fh / 2);
    ctx.restore();

    // Light across the glass, moved by the turn.
    const sheen = -1.2 + 2.4 * ((angle / (Math.PI / 2)) * 0.6 + flip * 0.8 + 0.2);
    const glass = ctx.createLinearGradient(-SHORT / 2 + sheen * SHORT, -LONG / 2, SHORT / 2 + sheen * SHORT, LONG / 2);
    glass.addColorStop(0.3, 'rgb(255 255 255 / 0)'); glass.addColorStop(0.5, 'rgb(255 255 255 / .16)'); glass.addColorStop(0.7, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = glass; ctx.beginPath(); ctx.roundRect(-SHORT / 2, -LONG / 2, SHORT, LONG, 8); ctx.fill();
    return false;
  });
  // #endregion mail

  // #region mail-controls
  // Everything that changes the iframe happens here, in event listeners and animation frames, never in
  // the paint handler: changing an iframe during paint crashed the tab in Chromium 157.
  let busy = null;
  const size = () => { frame.style.width = `${land ? LONG : SHORT}px`; frame.style.height = `${land ? SHORT : LONG}px`; };
  document.getElementById('mailTurn').addEventListener('click', () => {
    busy?.();
    land = !land;
    size();                                    // the message reflows at once, to its media query
    const from = land ? 0 : Math.PI / 2, to = land ? Math.PI / 2 : 0;
    busy = tween(700, (p) => { angle = from + (to - from) * smooth(p); stage.request(); });
  });
  for (const button of document.querySelectorAll('[data-mail]')) {
    button.addEventListener('click', () => {
      if (button.dataset.mail === current) return;
      current = button.dataset.mail;
      for (const b of document.querySelectorAll('[data-mail]')) b.setAttribute('aria-pressed', String(b === button));
      let swapped = false;
      tween(520, (p) => {
        flip = p;
        if (p >= 0.5 && !swapped) { swapped = true; frame.srcdoc = MESSAGES[current]; }
        stage.request();
      }, () => { flip = 0; stage.request(); });
    });
  }
  document.getElementById('mailDark').addEventListener('click', (e) => {
    dark = !dark;
    e.currentTarget.setAttribute('aria-pressed', String(dark));
    frame.contentDocument?.documentElement.classList.toggle('dark', dark);
    stage.request();
  });
  // #endregion mail-controls

  frame.srcdoc = MESSAGES[current];
  return { stage };
}
