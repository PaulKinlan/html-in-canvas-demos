// Moving focus through the controls of a panel that a canvas draws.
//
//   const pad = focusPad(panel, { onlog });
//   pad.move('right')        // focus the nearest control in that direction
//   pad.press()              // click the focused control
//   pad.read(gamepad)        // feed one controller state (a Gamepad or a plain object)
//   pad.watchControllers()   // listen for controllers: events when there are any, polling otherwise
//
// The panel's controls are ordinary buttons. Nothing here knows about the
// canvas: focus() moves focus, a focusin listener tells the shader where it is
// (four CSS custom properties, see effect.js), and click() presses.

export const support = {
  focusgroup: 'focusgroup' in HTMLElement.prototype || 'focusGroup' in HTMLElement.prototype,
  // focus() reads the members of its options that it knows. A getter sees that.
  focusVisible: (() => { let read = false; try { document.createElement('button').focus({ get focusVisible() { read = true; return false; } }); } catch {} return read; })(),
  readingFlow: CSS.supports('reading-flow', 'grid-rows'),
  gamepad: 'getGamepads' in navigator,
  gamepadEvents: 'onrawgamepadinputchange' in globalThis,
  vibrate: 'vibrate' in navigator,
  haptics: 'haptics' in navigator,
};

const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function focusPad(panel, { onlog = () => {}, onmove = () => {} } = {}) {
  const controls = () => [...panel.querySelectorAll('button, [tabindex="0"], input, select')].filter((el) => !el.disabled && el.offsetWidth > 0);
  let last = null;

  // #region where
  // The box of a control inside the panel, from layout (offsetLeft, offsetTop).
  // getBoundingClientRect() would report the box as drawn, after the lean.
  // The panel is position: relative, so it is the offsetParent.
  function box(el) {
    let x = 0, y = 0;
    for (let n = el; n && n !== panel; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight, cx: x + el.offsetWidth / 2, cy: y + el.offsetHeight / 2 };
  }
  // Tell the shader where focus is. CSS transitions on these properties (in
  // the page's styles) carry the lit area from the old control to the new one.
  function follow(el) {
    if (!el || !panel.contains(el) || el === panel) {
      panel.style.setProperty('--fx-x', '0');
      return;
    }
    const b = box(el);
    panel.style.setProperty('--fx-progress', (b.cx / panel.offsetWidth).toFixed(4));
    panel.style.setProperty('--fx-amount', (b.cy / panel.offsetHeight).toFixed(4));
    panel.style.setProperty('--fx-y', (Math.hypot(b.w, b.h) / 2 / panel.offsetWidth).toFixed(4));
    panel.style.setProperty('--fx-x', '1');
    last = el;
  }
  panel.addEventListener('focusin', (e) => follow(e.target));
  panel.addEventListener('focusout', (e) => { if (!panel.contains(e.relatedTarget)) follow(null); });
  // #endregion where

  // #region spatial
  // The nearest control in a direction. Distance along the direction counts
  // once and distance across it three times, so "down" prefers the control
  // below over a nearer one off to the side.
  function next(from, dir) {
    const [dx, dy] = DIRS[dir];
    const a = box(from);
    let best = null, cost = Infinity;
    for (const el of controls()) {
      if (el === from) continue;
      const b = box(el);
      const along = (b.cx - a.cx) * dx + (b.cy - a.cy) * dy;
      const across = Math.abs((b.cx - a.cx) * dy) + Math.abs((b.cy - a.cy) * dx);
      if (along < 6 || across > along * 2.5 + (dx ? a.h : a.w) / 2) continue;
      const c = along + across * 3;
      if (c < cost) { cost = c; best = el; }
    }
    return best;
  }
  // #endregion spatial

  // #region move
  const current = () => (panel.contains(document.activeElement) && document.activeElement !== panel ? document.activeElement : null);
  function focus(el) {
    // focusVisible: true makes :focus-visible match, as it would after a key
    // press. Without it, focus moved by a controller would show no ring.
    el.focus({ preventScroll: true, focusVisible: true });
  }
  function move(dir, { source = 'script', device = null } = {}) {
    const from = current();
    const to = from ? next(from, dir) : (last?.isConnected && last.offsetWidth ? last : controls()[0]);
    if (!to) { tick(device, 'edge'); onlog(`${source}: ${dir}, nothing that way`); return null; }
    focus(to);
    tick(device, 'move');
    onlog(`${source}: ${from ? `${dir} from "${name(from)}" to` : 'focus on'} "${name(to)}"`);
    onmove(to, { from, dir, source });
    return to;
  }
  function press({ source = 'script', device = null } = {}) {
    const el = current();
    if (!el) return move('right', { source, device });
    el.click();
    tick(device, 'press');
    onlog(`${source}: pressed "${name(el)}"`);
    return el;
  }
  // #endregion move

  // #region haptics
  // A short pulse for each move. A controller has vibrationActuator; a phone
  // has navigator.vibrate(), which needs a tap on the page first.
  const felt = { controller: 0, phone: 0, refused: '' };
  function tick(device, kind) {
    const ms = kind === 'press' ? 28 : kind === 'edge' ? 60 : 12;
    const actuator = device?.vibrationActuator;
    if (actuator?.playEffect) {
      actuator.playEffect(actuator.effects?.includes('dual-rumble') === false ? actuator.effects[0] : 'dual-rumble', { duration: ms + 20, strongMagnitude: kind === 'move' ? 0.2 : 0.7, weakMagnitude: 0.6 })
        .then(() => felt.controller++, (err) => (felt.refused = err.message));
    } else if (!device && navigator.vibrate) {
      try { if (navigator.vibrate(ms)) felt.phone++; } catch (err) { felt.refused = err.message; }
    }
  }
  // #endregion haptics

  // #region controller
  // One controller state in, focus moves out. With mapping "standard",
  // buttons 12 to 15 are the direction pad, button 0 is the lower face button
  // and axes 0 and 1 are the left stick. Other mappings are read the same way
  // for the stick and button 0 only.
  const held = new Map(); // controller index -> { dir, since, repeats, press }
  function read(pad, now = performance.now()) {
    if (!pad) return;
    const h = held.get(pad.index) ?? { dir: '', since: 0, repeats: 0, press: false };
    held.set(pad.index, h);
    const b = (i) => !!pad.buttons?.[i]?.pressed;
    const [ax = 0, ay = 0] = pad.axes ?? [];
    const std = pad.mapping === 'standard';
    let dir = '';
    if (std && b(14)) dir = 'left'; else if (std && b(15)) dir = 'right'; else if (std && b(12)) dir = 'up'; else if (std && b(13)) dir = 'down';
    else if (Math.abs(ax) > 0.55 || Math.abs(ay) > 0.55) dir = Math.abs(ax) > Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : (ay < 0 ? 'up' : 'down');
    const source = `controller ${pad.index}`;
    if (dir !== h.dir) { h.dir = dir; h.since = now; h.repeats = 0; if (dir) move(dir, { source, device: pad }); }
    // Held: repeat after 420 ms, then every 160 ms.
    else if (dir && now - h.since > 420 + h.repeats * 160) { h.repeats++; move(dir, { source, device: pad }); }
    const down = b(0);
    if (down && !h.press) press({ source, device: pad });
    h.press = down;
  }

  // Controllers reach the page in two ways. rawgamepadinputchange (an origin
  // trial) fires when a button or axis changes. Without it, getGamepads() is
  // read once per frame, and only while a controller is connected.
  const seen = { how: '', pads: new Map(), events: 0, polls: 0 };
  function watchControllers(onchange = () => {}) {
    let raf = 0;
    const poll = () => {
      raf = 0;
      const pads = [...navigator.getGamepads()].filter(Boolean);
      for (const pad of pads) { seen.polls++; read(pad); }
      // A held direction repeats on a timer, so events alone are not enough while one is held.
      if (pads.length && (!support.gamepadEvents || [...held.values()].some((h) => h.dir))) raf = requestAnimationFrame(poll);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(poll); };
    const note = (pad) => {
      seen.pads.set(pad.index, { id: pad.id, mapping: pad.mapping || 'none', buttons: pad.buttons.length, axes: pad.axes.length, effects: pad.vibrationActuator?.effects ?? (pad.vibrationActuator ? ['dual-rumble'] : []) });
      onchange(seen);
    };
    const on = {
      gamepadconnected: (e) => { note(e.gamepad); seen.how ||= support.gamepadEvents ? 'rawgamepadinputchange events' : 'getGamepads() once per frame'; start(); onchange(seen); },
      gamepaddisconnected: (e) => { seen.pads.delete(e.gamepad.index); held.delete(e.gamepad.index); onchange(seen); },
      rawgamepadinputchange: (e) => { seen.events++; seen.how = 'rawgamepadinputchange events'; read(e.gamepadSnapshot ?? e.gamepad ?? navigator.getGamepads()[e.gamepadIndex ?? 0]); start(); },
    };
    if (!support.gamepad) return () => {};
    for (const [type, fn] of Object.entries(on)) addEventListener(type, fn);
    return () => { cancelAnimationFrame(raf); for (const [type, fn] of Object.entries(on)) removeEventListener(type, fn); };
  }
  // #endregion controller

  return { move, press, read, next, box, follow, controls, current, watchControllers, seen, felt };
}

export const name = (el) => (el.getAttribute('aria-label') || el.textContent).trim().replace(/\s+/g, ' ');
