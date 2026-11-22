import { createBelt, PITCH } from './belt.js';

const PLACES = ['Oban', 'Mallaig', 'Portree', 'Tobermory', 'Tarbert', 'Ullapool', 'Stornoway', 'Port Ellen', 'Lochaline', 'Crinan', 'Kyle', 'Armadale'];
const GOODS = ['Rope, 40 m', 'Sail cloth', 'Lamp oil', 'Chart case', 'Anchor chain', 'Tinned fruit', 'Oilskins', 'Brass fittings', 'Net floats', 'Tar, 5 l'];
const pick = (list, i, salt) => list[(((i * 2654435761 + salt * 40503) >>> 0) % 9973) % list.length];

export default function start() {
  const canvas = document.getElementById('beltCanvas'), out = document.getElementById('beltOut');
  const scanned = new Set();
  let opened = 'none';
  // #region rows
  // Ten elements are made once from a template and become drawable children of the canvas. fill()
  // writes row i of the list into one of them. The list has no end in either direction: a row is
  // computed from its number. What the reader did to a row (the tick) is kept by number, not in the
  // element, because the element will show another row soon.
  const template = document.getElementById('beltRow');
  for (let n = 0; n < 10; n++) canvas.append(template.content.firstElementChild.cloneNode(true));
  const fill = (row, i) => {
    row.dataset.row = i;
    row.setAttribute('aria-posinset', i + 1);
    row.querySelector('.no').textContent = `#${i}`;
    row.querySelector('.what').textContent = pick(GOODS, i, 1);
    row.querySelector('.where').textContent = `to ${pick(PLACES, i, 2)}, ${(0.5 + ((((i * 2246822519) >>> 0) % 9871) % 245) / 10).toFixed(1)} kg`;
    row.querySelector('input').checked = scanned.has(i);
    row.style.setProperty('--hue', (((i * 47) % 360) + 360) % 360);
  };
  // #endregion rows
  const belt = createBelt(canvas, {
    fill,
    onChange: (s) => {
      out.textContent = `Elements in the document: ${belt?.rows.length ?? 10}. Rows on the belt: ${s.onBelt}, starting at #${s.first}. Ticked: ${scanned.size}. Last opened: ${opened}. Element pictures copied to the atlas: ${s.copies}. Frames drawn: ${s.frames}.`;
    },
  });
  canvas.addEventListener('change', (e) => {
    const row = e.target.closest('[data-row]'); if (!row) return;
    const i = Number(row.dataset.row);
    if (e.target.checked) scanned.add(i); else scanned.delete(i);
    belt.touch(row);
  });
  canvas.addEventListener('click', (e) => {
    const b = e.target.closest('button'), row = e.target.closest('[data-row]');
    if (b && row) { opened = `#${row.dataset.row}`; belt.request(); }
  });
  const motor = document.getElementById('beltMotor'), speed = document.getElementById('beltSpeed');
  const run = () => belt.motor(motor.getAttribute('aria-pressed') === 'true' ? Number(speed.value) : 0);
  motor.addEventListener('click', () => { const on = motor.getAttribute('aria-pressed') !== 'true'; motor.setAttribute('aria-pressed', on); motor.textContent = on ? 'Stop the motor' : 'Start the motor'; run(); });
  speed.addEventListener('input', run);
  document.getElementById('beltGo').addEventListener('click', () => belt.to(Math.round(Number(document.getElementById('beltTo').value) || 0)));
  document.getElementById('beltUp').addEventListener('click', () => belt.by(-1));
  document.getElementById('beltDown').addEventListener('click', () => belt.by(1));
  // The belt starts with row 0 at the top of its flat face, then runs two rows on so that the
  // movement is seen once.
  belt.to(0, true); belt.to(2);
  window.__belt = belt;
  return belt;
}
