import { mount, put, colors } from './kit.js';

export default function start() {
  const canvas = document.getElementById('deskCanvas');
  const faders = [...canvas.querySelectorAll('input[type=range]')];
  const button = document.getElementById('deskSound');
  let audio = null, gains = [];

  // #region desk
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const length = faders[0].offsetWidth, thick = faders[0].offsetHeight;
    const gap = Math.min(70, (w - 24) / faders.length);
    const left = (w - gap * faders.length) / 2, bottom = h - 44;
    ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    faders.forEach((fader, i) => {
      const x = left + gap * (i + 0.5);
      ctx.fillStyle = c.card; ctx.strokeStyle = c.line;
      ctx.beginPath(); ctx.roundRect(x - gap / 2 + 3, 8, gap - 6, h - 16, 8); ctx.fill(); ctx.stroke();
      // The input is laid out horizontally and drawn turned a quarter turn. Dragging up raises its value.
      ctx.save();
      ctx.translate(x - thick / 2 - 8, bottom);
      ctx.rotate(-Math.PI / 2);
      put(ctx, fader, 0, 0);
      ctx.restore();
      // A level meter beside it, drawn by the canvas from the input's value.
      const level = fader.value / 100 * (audio?.state === 'running' ? 0.75 + 0.25 * Math.sin(t / 90 + i * 2) : 1);
      for (let k = 0; k < 12; k++) {
        ctx.fillStyle = k / 12 < level ? (k > 9 ? c.bad : k > 7 ? '#d9a400' : c.ok) : c.line;
        ctx.fillRect(x + 10, bottom - 8 - k * (length - 8) / 12 - 9, 8, 9);
      }
      ctx.fillStyle = c.fg; ctx.fillText(fader.dataset.name, x, h - 26);
      ctx.fillStyle = c.muted; ctx.fillText(fader.value, x, h - 12);
    });
    return audio?.state === 'running';
  });
  // #endregion desk

  // #region desk-touch
  // Mouse drags are mapped through the rotation by the browser. Touch drags are not: Chrome decides from the
  // direction of the drag on screen whether it belongs to a horizontal slider, and a vertical drag does not.
  // So for touch and pen the page sets the value from where the finger is on the drawn fader.
  for (const fader of faders) {
    fader.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      const box = fader.getBoundingClientRect(), thumb = box.width / 2;
      const part = 1 - (e.clientY - box.top - thumb) / (box.height - 2 * thumb);
      fader.value = +fader.min + Math.min(1, Math.max(0, part)) * (fader.max - fader.min);
      fader.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  // #endregion desk-touch

  faders.forEach((fader, i) => fader.addEventListener('input', () => {
    if (gains[i]) gains[i].gain.value = fader.value / 100 * 0.06;
    stage.request();
  }));
  button.addEventListener('click', async () => {
    if (!audio) {
      audio = new AudioContext();
      gains = faders.map((fader) => {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.frequency.value = +fader.dataset.hz; osc.type = 'triangle';
        gain.gain.value = fader.value / 100 * 0.06;
        osc.connect(gain).connect(audio.destination); osc.start();
        return gain;
      });
    } else if (audio.state === 'running') await audio.suspend(); else await audio.resume();
    button.textContent = audio.state === 'running' ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-pressed', audio.state === 'running');
    stage.request();
  });
}
