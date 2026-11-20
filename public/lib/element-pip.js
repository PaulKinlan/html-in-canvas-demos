// element-pip.js: picture-in-picture for any element.
//
//   import { pipElement } from '/lib/element-pip.js';
//   button.onclick = () => pipElement(document.querySelector('#scoreboard'));
//
// Three ways to float an element above every other window, and one call that
// picks between them:
//
//   mode 'move'    Document Picture-in-Picture, real DOM. The element itself
//                  is moved into the floating window and moved back on close.
//                  Fully interactive, keeps running while the tab is hidden.
//   mode 'stream'  Document Picture-in-Picture, pixels. The element stays in
//                  the page; the window shows a live picture of it and sends
//                  clicks and typing back. The page's layout is untouched.
//   mode 'video'   Classic video Picture-in-Picture of a captureStream() of
//                  the element. View only, but works where Document PiP does
//                  not, and media keys can be mapped to its buttons.
//
// 'stream' and 'video' need HTML-in-canvas (that is where the pixels come
// from). 'move' needs only Document Picture-in-Picture.
//
// Must be called from a click or key press: browsers only open
// picture-in-picture windows for a user gesture.
import { attachSurface, serve, supported } from './live-surface.js';
import { directLinkPair } from './live-view.js';

export const pipSupport = () => ({
  move: 'documentPictureInPicture' in window,
  stream: 'documentPictureInPicture' in window && supported,
  video: supported && typeof HTMLVideoElement !== 'undefined' && 'requestPictureInPicture' in HTMLVideoElement.prototype && document.pictureInPictureEnabled !== false,
});

/**
 * A live surface for any element. Elements that can take a shadow root are
 * converted in place. The rest (buttons, inputs, images, tables, elements
 * that already have a shadow root) are wrapped in a <live-region> that copies
 * their outer display, so the page lays out the same.
 * Returns { surface, release() }.
 */
export function surfaceFor(el) {
  if (el.surface) return { surface: el.surface, wrapped: false, release() {} };
  if (el.parentElement?.localName === 'live-region' && el.parentElement.surface && el.parentElement.childElementCount === 1) return { surface: el.parentElement.surface, wrapped: false, release() {} };
  try {
    return { surface: attachSurface(el), wrapped: false, release() {} };
  } catch {}
  if (el.matches('tr, td, th, tbody, thead, tfoot, caption, col, colgroup, option, optgroup, html, body')) throw new Error(`a <${el.localName}> cannot be wrapped; use its table, list or container`);
  const cs = getComputedStyle(el);
  const wrap = document.createElement('live-region');
  const inline = cs.display.startsWith('inline') || cs.display === 'contents';
  const r = el.getBoundingClientRect();
  wrap.style.cssText = `display:${inline ? 'inline-block' : 'block'};vertical-align:${inline ? cs.verticalAlign : 'baseline'};float:${cs.float};`;
  // A canvas has no content width of its own, so the wrapper is given the element's.
  if (inline || cs.float !== 'none' || cs.position === 'absolute' || cs.position === 'fixed') wrap.style.width = r.width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight) + 'px';
  // An inline-block holding a canvas sits on the line by its bottom edge,
  // not by the text baseline the element had. Find how far the element
  // hangs below the baseline (an empty inline-block marks it) and lower the
  // wrapper by the same amount, so the line is exactly as it was.
  if (inline && cs.verticalAlign === 'baseline') {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;';
    el.before(probe);
    const hang = r.bottom + parseFloat(cs.marginBottom) - probe.getBoundingClientRect().bottom;
    probe.remove();
    if (Math.abs(hang) > 0.05) wrap.style.verticalAlign = `${-hang}px`;
  }
  el.before(wrap);
  wrap.append(el);
  return {
    surface: wrap.surface,
    wrapped: true,
    release() {
      wrap.surface?.destroy?.();
      if (wrap.isConnected) wrap.replaceWith(el);
    },
  };
}

function copyStyles(from, to) {
  for (const node of from.querySelectorAll('link[rel=stylesheet], style')) to.head.append(to.importNode(node, true));
  const sheets = [...from.adoptedStyleSheets];
  if (sheets.length) {
    const style = to.createElement('style');
    style.textContent = sheets.flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n');
    to.head.append(style);
  }
  to.documentElement.className = from.documentElement.className;
  to.documentElement.lang = from.documentElement.lang;
  for (const { name, value } of from.documentElement.attributes) if (name.startsWith('data-')) to.documentElement.setAttribute(name, value);
  to.documentElement.style.cssText = from.documentElement.style.cssText;
  to.body.className = from.body.className;
}

/**
 * Float `el` above other windows.
 *   mode      'auto' (default) | 'move' | 'stream' | 'video'
 *   width, height   size of the window (defaults to the element's size)
 *   media     { play: '#toggle', nexttrack: fn, … } Media Session actions for 'video':
 *             a selector inside the element to click, or a function
 *   placeholder   text left where a moved element was
 * Resolves to { mode, window | video, close(), closed } once it is showing.
 */
export async function pipElement(el, { mode = 'auto', width, height, media = {}, placeholder = 'Playing in picture-in-picture' } = {}) {
  const can = pipSupport();
  if (mode === 'auto') mode = can.move ? 'move' : can.video ? 'video' : null;
  if (!mode || !can[mode]) throw new Error(mode ? `Picture-in-picture mode "${mode}" is not available in this browser` : 'Picture-in-picture is not available in this browser');
  if (el.__pip) el.__pip.close();
  const rect = el.getBoundingClientRect();
  const w = Math.round(width ?? rect.width + 16);
  const h = Math.round(height ?? rect.height + 16);
  let finish;
  const closed = new Promise((r) => (finish = r));
  const done = (session) => {
    el.__pip = session;
    el.dispatchEvent(new CustomEvent('enterpip', { bubbles: true, detail: session }));
    closed.then(() => {
      if (el.__pip === session) el.__pip = null;
      el.dispatchEvent(new CustomEvent('leavepip', { bubbles: true, detail: session }));
    });
    return session;
  };

  if (mode === 'move') {
    const win = await documentPictureInPicture.requestWindow({ width: w, height: h });
    copyStyles(document, win.document);
    win.document.title = el.getAttribute('aria-label') ?? document.title;
    win.document.body.style.cssText = 'margin:0;padding:8px;min-height:0;';
    // Keep the page from collapsing where the element was.
    const hole = document.createElement(getComputedStyle(el).display.startsWith('inline') ? 'span' : 'div');
    hole.className = 'pip-placeholder';
    hole.textContent = placeholder;
    hole.style.cssText = `display:${getComputedStyle(el).display.startsWith('inline') ? 'inline-flex' : 'flex'};align-items:center;justify-content:center;box-sizing:border-box;width:${rect.width}px;height:${rect.height}px;border:1px dashed color-mix(in srgb, currentColor 40%, transparent);border-radius:10px;font:13px system-ui;opacity:.7;text-align:center;`;
    el.replaceWith(hole);
    win.document.body.append(el); // adopts the node: same element, new document
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      if (hole.isConnected) hole.replaceWith(el);
      else document.body.append(el);
      win.close();
      finish();
    };
    win.addEventListener('pagehide', close);
    return done({ mode, window: win, close, closed });
  }

  const held = surfaceFor(el);
  const surface = held.surface;
  if (!surface) throw new Error('could not make a surface for this element');

  if (mode === 'stream') {
    const win = await documentPictureInPicture.requestWindow({ width: w, height: h });
    win.document.title = el.getAttribute('aria-label') ?? document.title;
    win.document.body.style.cssText = `margin:0;padding:8px;background:${getComputedStyle(document.body).backgroundColor};`;
    win.document.body.innerHTML = '<live-view fit></live-view>';
    const script = win.document.createElement('script');
    script.type = 'module';
    script.src = new URL('./live-view.js', import.meta.url).href;
    win.document.head.append(script);
    await win.customElements.whenDefined('live-view');
    const [here, there] = directLinkPair();
    const stop = serve(surface, here, { title: win.document.title, peer: 'picture-in-picture' });
    win.document.querySelector('live-view').connect(there, { frames: 'bitmap' });
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      stop();
      held.release();
      win.close();
      finish();
    };
    win.addEventListener('pagehide', close);
    return done({ mode, window: win, surface, close, closed });
  }

  // mode === 'video'
  if (!surface.frames) {
    // A fresh surface has not painted yet, and a stream with no frame has no size.
    await new Promise((resolve) => {
      surface.addEventListener('frame', resolve, { once: true });
      surface.requestPaint();
      setTimeout(resolve, 1500);
    });
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  video.srcObject = surface.stream(30);
  document.body.append(video);
  const ready = new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    setTimeout(() => reject(new Error('the stream produced no frame')), 3000);
  });
  video.play().catch(() => {});
  const nudge = setInterval(() => surface.requestPaint(), 100);
  try {
    if (video.readyState < 1) await ready;
    await video.requestPictureInPicture();
  } catch (err) {
    clearInterval(nudge);
    for (const t of video.srcObject.getTracks()) t.stop();
    video.remove();
    held.release();
    throw err;
  }
  clearInterval(nudge);
  // The only controls a video PiP window has are Media Session actions.
  const actions = [];
  for (const [action, target] of Object.entries(media)) {
    try {
      navigator.mediaSession.setActionHandler(action, () => (typeof target === 'function' ? target(el) : el.querySelector(target)?.click()));
      actions.push(action);
    } catch {}
  }
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    for (const a of actions) navigator.mediaSession.setActionHandler(a, null);
    if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
    for (const t of video.srcObject.getTracks()) t.stop();
    video.remove();
    held.release();
    finish();
  };
  video.addEventListener('leavepictureinpicture', close, { once: true });
  return done({ mode, video, surface, actions, close, closed });
}
