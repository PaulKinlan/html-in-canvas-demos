import { mount, put, colors } from './kit.js';

const ROWS = [['Kick', 'x...x...'], ['Snare', '..x...x.'], ['Hat', 'xxxxxxxx'], ['Tone', 'x..x..x.']];

export default function start() {
  const canvas = document.getElementById('seqCanvas');
  const form = document.getElementById('seqForm');
  const play = document.getElementById('seqPlay');
  const out = document.getElementById('seqOut');
  // One fieldset per sound, eight checkboxes in each.
  form.prepend(...ROWS.map(([name, pattern]) => {
    const set = document.createElement('fieldset');
    set.innerHTML = `<legend>${name}</legend>` + [...pattern].map((ch, i) =>
      `<input type="checkbox" name="${name.toLowerCase()}" value="${i}" aria-label="${name}, step ${i + 1}"${ch === 'x' ? ' checked' : ''}>`).join('');
    return set;
  }));
  const boxes = (row) => [...form.elements[ROWS[row][0].toLowerCase()]];
  let step = -1, timer = 0, audio = null, pulse = 0;

  // #region sequencer
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas);
    const x0 = Math.round((w - form.offsetWidth) / 2), y0 = 10;
    if (step >= 0) {
      // The column that is playing, drawn behind the form.
      const box = boxes(0)[step], last = boxes(ROWS.length - 1)[step];
      const fx = box.offsetLeft, top = box.offsetTop, bottom = last.offsetTop + last.offsetHeight;
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.roundRect(x0 + fx - 4, y0 + top - 4, box.offsetWidth + 8, bottom - top + 8, 8); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // The whole form is one picture. Each checkbox in it takes taps where it is drawn.
    put(ctx, form, x0, y0);
    const age = (t - pulse) / 260;
    if (step >= 0 && age < 1) {
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.globalAlpha = 1 - age;
      ROWS.forEach((_, r) => {
        const box = boxes(r)[step];
        if (!box.checked) return;
        ctx.beginPath(); ctx.arc(x0 + box.offsetLeft + box.offsetWidth / 2, y0 + box.offsetTop + box.offsetHeight / 2, 14 + age * 14, 0, 7); ctx.stroke();
      });
      return true;
    }
    return false;
  });
  // #endregion sequencer

  function blip(row) {
    const t = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
    const [type, from, to, len] = [['sine', 150, 40, 0.18], ['square', 260, 120, 0.08], ['square', 6000, 5000, 0.03], ['triangle', 440, 440, 0.14]][row];
    osc.type = type; osc.frequency.setValueAtTime(from, t); osc.frequency.exponentialRampToValueAtTime(to, t + len);
    gain.gain.setValueAtTime(row === 2 ? 0.03 : 0.12, t); gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + len);
  }
  function tick() {
    step = (step + 1) % 8; pulse = performance.now();
    ROWS.forEach((_, r) => { if (boxes(r)[step].checked) blip(r); });
    stage.request();
  }
  play.addEventListener('click', () => {
    audio ??= new AudioContext();
    if (timer) { clearInterval(timer); timer = 0; step = -1; } else { audio.resume(); tick(); timer = setInterval(tick, 160); }
    play.textContent = timer ? 'Stop' : 'Play';
    stage.request();
  });
  const report = () => {
    out.textContent = ROWS.map(([name], r) => name + ' ' + boxes(r).map((b) => (b.checked ? 'x' : '.')).join('')).join('   ');
  };
  form.addEventListener('change', report);
  form.addEventListener('reset', () => setTimeout(() => { report(); stage.request(); }));
  report();
}
