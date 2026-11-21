// A direction from the phone's tilt, or from the pointer, written to two CSS
// custom properties.
//
//   import { tiltLight } from '/lib/tilt-light.js';
//   const light = tiltLight(stage);            // sets --fx-x and --fx-y on stage, each -1..1
//   button.onclick = () => light.useSensor();  // must be called from a tap
//
// Sources, in order of priority:
//   sensor   deviceorientation events. x follows gamma (left-right tilt) and y
//            follows beta (front-back tilt), both measured from the angle the
//            phone was held at when the sensor started, over `range` degrees.
//   pointer  the pointer's position over the element: its centre is 0,0 and
//            its edges are -1 and 1. A touch counts while the finger is down.
//   idle     after `idleAfter` ms with neither, the direction moves round a
//            slow circle so that the page is not still. Off with idle: false
//            and when the reader asks for reduced motion.
//
// The values are eased towards their target once per frame, and the frame loop
// stops when nothing is changing.
//
//   light.source      'sensor' | 'pointer' | 'idle' | 'rest'
//   light.x, light.y  the current values
//   light.onchange    called with (light) when the values or the source change
//   light.idle        set to false to stop the idle circle, true to allow it again
//   light.useSensor() resolves to '' when events arrive, else to the reason they do not
//   light.stopSensor(), light.recentre(), light.destroy()

const clamp = (v) => Math.max(-1, Math.min(1, v));

export function tiltLight(el, { props = ['--fx-x', '--fx-y'], range = 28, idle = true, idleAfter = 2500, ease = 0.16, rest = [-0.45, -0.6] } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const light = { x: rest[0], y: rest[1], source: 'rest', onchange: null, sensorRate: 0, idle };
  let tx = rest[0], ty = rest[1];
  let raf = 0, lastInput = performance.now(), pointerDown = false, sensorOn = false, origin = null, events = 0, firstEvent = 0;

  const write = () => {
    el.style.setProperty(props[0], light.x.toFixed(3));
    el.style.setProperty(props[1], light.y.toFixed(3));
  };
  const setSource = (name) => {
    if (light.source === name) return;
    light.source = name;
    light.onchange?.(light);
  };
  // #region frame
  function frame(now) {
    raf = 0;
    const quiet = now - lastInput > idleAfter;
    if (!sensorOn && quiet && light.idle && !reduced.matches) {
      setSource('idle');
      const a = now / 2400;
      tx = Math.cos(a) * 0.75;
      ty = Math.sin(a) * 0.75;
    }
    const dx = tx - light.x, dy = ty - light.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.002) {
      light.x += dx * ease;
      light.y += dy * ease;
      write();
      light.onchange?.(light);
    }
    // Keep going while easing or while the idle circle runs. Otherwise stop until the next input.
    if (light.source === 'idle' && !light.idle) setSource('rest');
    if (Math.abs(dx) + Math.abs(dy) > 0.002 || light.source === 'idle') wake();
  }
  let idleTimer = 0, visible = true;
  const wake = () => {
    if (visible) raf ||= requestAnimationFrame(frame);
    // Come back when it is time for the idle circle to start.
    clearTimeout(idleTimer);
    if (light.idle && !sensorOn && light.source !== 'idle') idleTimer = setTimeout(wake, idleAfter + 50);
  };
  // Nothing moves while the element is off screen.
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(el);
  // #endregion frame

  // #region pointer
  function onPointer(e) {
    if (sensorOn && events) return; // the sensor wins while it is delivering
    if (e.type === 'pointerdown') pointerDown = true;
    if (e.pointerType === 'touch' && !pointerDown) return;
    const box = el.getBoundingClientRect();
    tx = clamp(((e.clientX - box.left) / box.width - 0.5) * 2);
    ty = clamp(((e.clientY - box.top) / box.height - 0.5) * 2);
    lastInput = performance.now();
    setSource('pointer');
    wake();
  }
  const onUp = () => { pointerDown = false; };
  el.addEventListener('pointerdown', onPointer);
  el.addEventListener('pointermove', onPointer);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  // #endregion pointer

  // #region sensor
  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    if (!events) firstEvent = now;
    events++;
    if (events > 1) light.sensorRate = Math.round(((events - 1) * 1000) / (now - firstEvent));
    // Portrait: gamma is the left-right tilt and beta the front-back tilt. Landscape swaps them.
    const angle = screen.orientation?.angle ?? 0;
    let lr = e.gamma, fb = e.beta;
    if (angle === 90) [lr, fb] = [e.beta, -e.gamma];
    else if (angle === 270 || angle === -90) [lr, fb] = [-e.beta, e.gamma];
    else if (angle === 180) [lr, fb] = [-e.gamma, -e.beta];
    origin ??= { lr, fb };
    tx = clamp((lr - origin.lr) / range);
    ty = clamp((fb - origin.fb) / range);
    lastInput = now;
    setSource('sensor');
    wake();
  }
  /** Start listening to the orientation sensor. Call from a tap. Resolves to '' or to why no events arrive. */
  light.useSensor = async ({ ask = true } = {}) => {
    if (!('DeviceOrientationEvent' in window)) return 'this browser has no DeviceOrientationEvent';
    try {
      // Safari, and Chromium builds that have it, ask the person first. It must be called from a tap.
      const answer = ask ? await DeviceOrientationEvent.requestPermission?.() : '';
      if (answer && answer !== 'granted') return `permission was ${answer}`;
    } catch (err) {
      return `requestPermission() failed: ${err.message}`;
    }
    events = 0;
    origin = null;
    sensorOn = true;
    addEventListener('deviceorientation', onOrientation);
    // A device with no sensor sends nothing, or one event with null angles.
    await new Promise((r) => setTimeout(r, 1200));
    if (events) return '';
    light.stopSensor();
    return 'no orientation events arrived in 1.2 s, so this device has no sensor or the page may not use it';
  };
  light.stopSensor = () => {
    sensorOn = false;
    events = 0;
    removeEventListener('deviceorientation', onOrientation);
    lastInput = performance.now();
    setSource('rest');
    wake();
  };
  /** Take the phone's current angle as the new centre. */
  light.recentre = () => { origin = null; };
  // #endregion sensor

  light.destroy = () => {
    visible = false;
    cancelAnimationFrame(raf);
    clearTimeout(idleTimer);
    io.disconnect();
    light.stopSensor();
    el.removeEventListener('pointerdown', onPointer);
    el.removeEventListener('pointermove', onPointer);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
  };
  /** Set the direction from script (for tests). */
  light.set = (x, y) => { tx = clamp(x); ty = clamp(y); light.x = tx; light.y = ty; lastInput = performance.now(); write(); setSource('pointer'); light.onchange?.(light); };

  write();
  wake();
  return light;
}
