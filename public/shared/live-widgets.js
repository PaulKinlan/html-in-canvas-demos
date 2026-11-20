// Behaviour for the widgets in live-widgets.css. Ordinary DOM code: nothing
// here knows the widgets may be painted through a canvas or driven remotely.
export function wireWidgets(root = document) {
  for (const el of root.querySelectorAll('.lw-timer:not([data-wired])')) timer(el);
  for (const el of root.querySelectorAll('.lw-notes:not([data-wired])')) notes(el);
  for (const el of root.querySelectorAll('.lw-mixer:not([data-wired])')) mixer(el);
}

function timer(el) {
  el.dataset.wired = '';
  const out = el.querySelector('output');
  const toggle = el.querySelector('[data-act=toggle]');
  let left = 25 * 60;
  let handle = 0;
  const show = () => (out.value = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`);
  const stop = () => {
    clearInterval(handle);
    handle = 0;
    delete el.dataset.running;
    toggle.textContent = 'Start';
  };
  toggle.onclick = () => {
    if (handle) return stop();
    el.dataset.running = '';
    toggle.textContent = 'Pause';
    handle = setInterval(() => {
      left = Math.max(0, left - 1);
      show();
      if (!left) stop();
    }, 1000);
  };
  el.querySelector('[data-act=reset]').onclick = () => {
    stop();
    left = 25 * 60;
    show();
  };
  el.querySelector('[data-act=plus]').onclick = () => {
    left += 60;
    show();
  };
  show();
}

function notes(el) {
  el.dataset.wired = '';
  const input = el.querySelector('input');
  const list = el.querySelector('ul');
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const li = document.createElement('li');
    li.textContent = input.value;
    list.prepend(li);
    while (list.children.length > 3) list.lastElementChild.remove();
    input.value = '';
  });
}

function mixer(el) {
  el.dataset.wired = '';
  const range = el.querySelector('input[type=range]');
  const out = el.querySelector('output');
  const mute = el.querySelector('input[type=checkbox]');
  const preset = el.querySelector('select');
  const bars = [...el.querySelectorAll('.lw-bars i')];
  const shapes = { Flat: () => 1, 'Bass boost': (i, n) => 1.5 - i / n, Podcast: (i, n) => 1 - Math.abs(i / n - 0.5) * 1.6 };
  const draw = () => {
    out.value = range.value;
    el.toggleAttribute('data-muted', mute.checked);
    const shape = shapes[preset.value] ?? shapes.Flat;
    bars.forEach((b, i) => (b.style.height = (mute.checked ? 6 : Math.max(6, Math.min(100, range.value * shape(i, bars.length)))) + '%'));
  };
  range.addEventListener('input', draw);
  mute.addEventListener('change', draw);
  preset.addEventListener('change', draw);
  draw();
}

export const WIDGETS = {
  timer: `<div class="lw lw-timer"><h3>Focus timer</h3><output>25:00</output>
    <button type="button" data-act="toggle" data-media="play">Start</button>
    <button type="button" data-act="plus" data-media="nexttrack">+1 min</button>
    <button type="button" data-act="reset" data-media="previoustrack">Reset</button></div>`,
  notes: `<form class="lw lw-notes"><h3>Notes</h3><input name="note" placeholder="Add a note, press Enter" aria-label="New note" autocomplete="off"><ul></ul></form>`,
  mixer: `<div class="lw lw-mixer"><h3>Mixer</h3>
    <label>Volume <input type="range" min="0" max="100" value="40" aria-label="Volume"><output>40</output></label>
    <label><input type="checkbox"> Mute</label>
    <label>Preset <select aria-label="Preset"><option>Flat</option><option>Bass boost</option><option>Podcast</option></select></label>
    <div class="lw-bars" aria-hidden="true">${'<i></i>'.repeat(12)}</div></div>`,
};
