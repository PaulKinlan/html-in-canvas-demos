import { mount, put } from './kit.js';

export default function start() {
  const canvas = document.getElementById('modalCanvas');
  const scene = document.getElementById('mailScene');
  const dialog = document.getElementById('mailDialog');
  const out = document.getElementById('modalOut');
  const open = document.getElementById('mailDelete');
  const count = () => scene.querySelectorAll('li input:checked').length;

  // #region modal
  // showModal() puts the dialog in the top layer, where the page paints it and the canvas cannot. What
  // the canvas can do is the other half: while dialog.open is true it draws its own scene smaller, darker,
  // blurred and without colour, in place of a ::backdrop.
  let depth = 0, last = 0;
  const stage = mount(canvas, (ctx, w, h, t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    const want = dialog.open ? 1 : 0;
    depth += (want - depth) * (1 - Math.exp(-dt * 9));
    const moving = Math.abs(want - depth) > 0.003;
    if (!moving) depth = want;
    const W = scene.offsetWidth, H = scene.offsetHeight;
    const k = Math.min(1, (w - 24) / W), s = k * (1 - 0.16 * depth);
    if (depth > 0) { ctx.fillStyle = `rgb(8 10 16 / ${0.82 * depth})`; ctx.fillRect(0, 0, w, h); }
    ctx.translate(w / 2, h / 2 - 14 * depth); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    if (depth > 0.01) ctx.filter = `blur(${(3.5 * depth).toFixed(2)}px) saturate(${(1 - 0.85 * depth).toFixed(2)}) brightness(${(1 - 0.45 * depth).toFixed(2)})`;
    put(ctx, scene, 0, 0);
    return moving;
  });
  // The dialog tells the canvas when it opens and closes.
  dialog.addEventListener('toggle', () => stage.request());
  dialog.addEventListener('close', () => stage.request());
  // #endregion modal

  // The application: the button opens the dialog, and Delete removes the ticked rows.
  const say = (text) => { out.textContent = text; };
  open.addEventListener('click', () => {
    if (!count()) { say('Tick a message first.'); return; }
    dialog.querySelector('h3').textContent = `Delete ${count()} message${count() === 1 ? '' : 's'}?`;
    if (!dialog.open) dialog.showModal();
    stage.request();
    say(`dialog.open ${dialog.open}. The dialog is in the top layer. The scene is still a child of the canvas, drawn further away.`);
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'delete') for (const box of scene.querySelectorAll('li input:checked')) box.closest('li').remove();
    scene.querySelector('h3 span').textContent = `${scene.querySelectorAll('li').length} new`;
    say(`Closed with "${dialog.returnValue || 'cancel'}". ${scene.querySelectorAll('li').length} messages left.`);
    dialog.returnValue = '';
  });
  say('Tick messages, then press Delete selected.');
  return { stage };
}
