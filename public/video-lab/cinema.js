// cinema.js: the cinema scene of /video-lab/. A <video controls> on a screen in
// a 3D room, a seat map (HTML buttons) on the floor, and the video's sound
// through a PannerNode placed at the screen. The listener sits in the chosen seat.

import { mat, hitMatrix, place } from './gl.js';

// The room, in metres. x to the right, y up, the screen at the far end (negative z).
export const SCREEN = { centre: [0, 3.5, -7], w: 9.6, h: 5.4 };
export const FLOOR = { x0: -3.5, z0: -5.5, size: 7 };
const EAR = 1.15;

// #region panner
/** The audio graph: the element, a PannerNode at the screen, then the speakers. Two analysers measure left and right. */
export function screenSound(video) {
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(video);
  const panner = new PannerNode(ctx, {
    panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2, rolloffFactor: 1.2,
    positionX: SCREEN.centre[0], positionY: SCREEN.centre[1], positionZ: SCREEN.centre[2],
  });
  const split = ctx.createChannelSplitter(2);
  const meters = [0, 1].map((ch) => { const a = new AnalyserNode(ctx, { fftSize: 1024 }); split.connect(a, ch); return a; });
  source.connect(panner).connect(ctx.destination);
  panner.connect(split);
  const buf = new Float32Array(1024);
  return {
    ctx, panner,
    /** Put the listener at `pos`, looking along `forward`. */
    listen(pos, forward) { setListener(ctx.listener, pos, forward); },
    /** Root mean square of each ear's signal now. */
    levels: () => meters.map((a) => { a.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); }),
  };
}
function setListener(l, pos, forward) {
  if (l.positionX) {
    l.positionX.value = pos[0]; l.positionY.value = pos[1]; l.positionZ.value = pos[2];
    l.forwardX.value = forward[0]; l.forwardY.value = forward[1]; l.forwardZ.value = forward[2];
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(...pos);
    l.setOrientation(...forward, 0, 1, 0);
  }
}
// #endregion panner

/** What a listener at `pos` facing `forward` hears of a 440 Hz tone at the screen: energy per ear. Rendered offline, for the live checks. */
export async function hearAt(pos, forward, model = 'equalpower') {
  const ctx = new OfflineAudioContext(2, 9600, 48000);
  const osc = new OscillatorNode(ctx, { frequency: 440 });
  const panner = new PannerNode(ctx, {
    panningModel: model, distanceModel: 'inverse', refDistance: 2, rolloffFactor: 1.2,
    positionX: SCREEN.centre[0], positionY: SCREEN.centre[1], positionZ: SCREEN.centre[2],
  });
  setListener(ctx.listener, pos, forward);
  osc.connect(panner).connect(ctx.destination);
  osc.start();
  const out = await ctx.startRendering();
  return [0, 1].map((ch) => { const d = out.getChannelData(ch); let s = 0; for (let i = 2400; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / (d.length - 2400)); });
}

export function createCinema(canvas, { onState = () => {} } = {}) {
  const screen = document.createElement('div');
  screen.className = 'cin-screen';
  screen.setAttribute('drawable', '');
  screen.innerHTML = '<video controls playsinline loop preload="metadata"></video>';
  const video = screen.firstChild;
  video.dataset.src = '/media/clip.webm';

  // #region seats
  // The floor is one HTML element: a grid of buttons. Each button's place in the grid is its place in the room.
  const floor = document.createElement('div');
  floor.className = 'cin-floor';
  floor.setAttribute('drawable', '');
  const ROWS = 4, COLS = 5;
  floor.innerHTML = '<p>Screen this way</p><div class="seats" role="group" aria-label="Seats">' +
    Array.from({ length: ROWS * COLS }, (_, i) => `<button type="button" aria-pressed="false" aria-label="Row ${Math.floor(i / COLS) + 1}, seat ${(i % COLS) + 1}"><span>▲</span></button>`).join('') + '</div>';
  const seats = [...floor.querySelectorAll('button')];
  /** A seat's position in the room, from where its button is inside the floor element. */
  const seatPos = (button) => {
    const cx = (button.offsetLeft + button.offsetWidth / 2) / floor.offsetWidth, cz = (button.offsetTop + button.offsetHeight / 2) / floor.offsetHeight;
    return [FLOOR.x0 + cx * FLOOR.size, EAR, FLOOR.z0 + cz * FLOOR.size];
  };
  // #endregion seats
  canvas.append(screen, floor);

  let seat = seats[2 * COLS + 2], head = 0, sound = null, near = false;
  let eye = null, eyeTo = null, look = null, lookTo = null;
  const state = { pos: [0, EAR, 0], forward: [0, 0, -1], distance: 0, gain: 0, levels: [0, 0], sound: 'not started' };

  function aim() {
    const pos = seatPos(seat);
    const to = [SCREEN.centre[0] - pos[0], 0, SCREEN.centre[2] - pos[2]];
    const len = Math.hypot(to[0], to[2]) || 1;
    // A seat faces the far wall, not the centre of the screen, so a seat at the side hears the screen from one side.
    const yaw = (head * Math.PI) / 180;
    state.pos = pos;
    state.forward = [Math.sin(yaw), 0, -Math.cos(yaw)];
    state.distance = Math.hypot(SCREEN.centre[0] - pos[0], SCREEN.centre[1] - pos[1], SCREEN.centre[2] - pos[2]);
    state.gain = 2 / (2 + 1.2 * (Math.max(state.distance, 2) - 2)); // the inverse distance model with these settings
    sound?.listen(state.pos, state.forward);
    // The camera stays behind the last row and above it, and moves a little with the listener.
    eyeTo = [pos[0] * 0.7, 4.7, 6.3 + pos[2] * 0.3];
    lookTo = [pos[0] * 0.25, 1.9, -4];
    if (!eye) { eye = eyeTo.slice(); look = lookTo.slice(); }
    for (const b of seats) {
      b.setAttribute('aria-pressed', String(b === seat));
      b.style.setProperty('--turn', `${b === seat ? head : 0}deg`);
    }
    onState(state);
    canvas.requestPaint();
  }
  for (const b of seats) b.addEventListener('click', () => { seat = b; aim(); });

  function startSound() {
    if (sound) { sound.ctx.resume(); return; }
    try {
      sound = screenSound(video);
      sound.listen(state.pos, state.forward);
      state.sound = 'PannerNode, HRTF';
    } catch (err) {
      state.sound = `no Web Audio graph: ${err.message}`;
    }
    onState(state);
  }
  video.addEventListener('play', startSound);

  // #region cinema-matrices
  function matrices() {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    // The field of view is vertical. A narrower canvas gets a wider one, so the floor still fits.
    const vp = mat.mul(mat.perspective(((aspect < 1.5 ? 50 : 52) * Math.PI) / 180, aspect, 0.1, 60), mat.lookAt(eye, look));
    const { centre: c, w, h } = SCREEN;
    return {
      // Each plane takes the unit square, y down, into the room.
      screen: mat.mul(vp, mat.plane([c[0] - w / 2, c[1] + h / 2, c[2]], [w, 0, 0], [0, -h, 0])),
      mirror: mat.mul(vp, mat.plane([c[0] - w / 2, -(c[1] + h / 2), c[2]], [w, 0, 0], [0, h, 0])),
      floor: mat.mul(vp, mat.plane([FLOOR.x0, 0, FLOOR.z0], [FLOOR.size, 0, 0], [0, 0, FLOOR.size])),
    };
  }
  // #endregion cinema-matrices

  const scene = {
    video, screen, floor, seats, state,
    elements: () => [screen, floor],
    near() { near = true; if (!video.src) video.src = video.dataset.src; },
    away() { if (!video.paused) video.pause(); },
    leave() { if (!video.paused) video.pause(); },
    enter() { requestAnimationFrame(aim); },
    animated() {
      let moving = false;
      if (eye && eyeTo) {
        for (let i = 0; i < 3; i++) {
          const de = eyeTo[i] - eye[i], dl = lookTo[i] - look[i];
          if (Math.abs(de) > 0.002 || Math.abs(dl) > 0.002) moving = true;
          eye[i] += de * 0.12; look[i] += dl * 0.12;
        }
      }
      if (sound && !video.paused) { state.levels = sound.levels(); onState(state); }
      return moving || !video.paused;
    },
    // #region cinema-paint
    paint(view) {
      if (!eye) { aim(); if (!eye) return; }
      const m = matrices();
      const haveScreen = view.upload(screen), haveFloor = view.upload(floor);
      if (haveFloor) view.quad(floor, m.floor, { mode: 4, second: haveScreen ? screen : null });
      if (haveScreen) {
        view.quad(screen, m.mirror, { mode: 3, alpha: 0.3 });
        view.quad(screen, m.screen, { mode: 3 });
      }
      // The same matrices, with the perspective divide, are the elements' hit boxes:
      // the native controls on the screen and the buttons on the floor take taps where they are drawn.
      place(canvas, screen, hitMatrix(canvas, screen, m.screen));
      place(canvas, floor, hitMatrix(canvas, floor, m.floor));
    },
    // #endregion cinema-paint
    sit(index) { seat = seats[index]; aim(); },
    turn(degrees) { head = degrees; aim(); },
    settle() { if (eyeTo) { eye = eyeTo.slice(); look = lookTo.slice(); } canvas.requestPaint(); },
    matrices,
    get sound() { return sound; },
  };
  return scene;
}
