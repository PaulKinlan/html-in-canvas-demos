// <ledger-menubar>: a menubar with menus, checkboxes, radios and a sliding highlight over a ledger table.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, options, esc, clamp, spring, reduced } from '../kit.js';

const TIMES = "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif";
const MONO = "'Courier New', Courier, 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const changed = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

// Draw an element, then draw it again inside a rectangle with a fill behind it and a filter that turns its
// ink into `ink`. This is how a marker "inverts" the text it passes over with no second copy of the text.
const TO_WHITE = 'brightness(0) invert(1)';
function marker(ctx, el, x, y, r, fill, filter) {
  if (r.w <= 0.5 || r.h <= 0.5) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.filter = filter;
  put(ctx, el, x, y);
  ctx.restore();
}

// Each menu item is [label, shortcut, command], or an object for a submenu, a checkbox or a radio. '-' is a separator.
const MENUS = [
  { label: 'File', items: [['Open books…', '⌘O'], ['Back up now', '⌘B'], '-', ['Import bank statement…', '⇧⌘I'], { label: 'Export', sub: [['As CSV'], ['As PDF'], ['For the accountant']] }, '-', ['Print…', '⌘P']] },
  { label: 'Edit', items: [['Undo', '⌘Z', 'undo'], ['Redo', '⇧⌘Z', 'redo'], '-', ['Cut', '⌘X'], ['Copy', '⌘C'], ['Paste', '⌘V'], '-', ['Find in ledger…', '⌘F']] },
  { label: 'Invoices', items: [['New invoice', '⌘I'], ['Invoice a job card…'], ['Credit note…'], '-', ['Email to customer', '⌘E'], ['Chase late payers'], '-', { check: 'unpaid', label: 'Unpaid only' }] },
  { label: 'Ledger', items: [['Post job card', '⌘J', 'post'], ['Record a payment', '⇧⌘P'], ['Reconcile with bank…', '⌘R'], '-', { check: 'vat', label: 'Show VAT column', checked: true }, { label: 'VAT return', sub: [['Jul to Sep 2026'], ['Oct to Dec 2026']] }] },
  { label: 'Reports', items: [['Profit and loss', '⌘1'], ['Labour and parts', '⌘2'], ['Who owes what', '⌘3'], '-', { radio: 'period', value: 'nov', label: 'November 2026', checked: true }, { radio: 'period', value: 'q4', label: 'Oct to Dec 2026' }, { radio: 'period', value: 'year', label: 'Tax year 2026 to 2027' }] },
  { label: 'Window', items: [['Minimise', '⌘M'], ['Zoom'], ['Enter full screen', '⌃⌘F'], '-', ['Bring all to front']] },
];
// Job cards that "Post job card" adds to the top of the ledger, one at a time.
const JOBS = [['Gear tune and new cable, Mensah', '6.50', '39.00'], ['Wheel build, rear, Doyle', '24.00', '144.00'], ['Brake bleed, front, Ito', '5.50', '33.00'], ['Chain and cassette, Byrne', '17.00', '102.00']];

function menuHtml(items, id, sub = false) {
  const row = (it, j) => {
    if (it === '-') return '<div role="separator"></div>';
    if (Array.isArray(it)) {
      const [label, key, cmd] = it;
      return `<button type="button" role="menuitem" tabindex="-1" data-cmd="${cmd ?? ''}"${key ? ` aria-keyshortcuts="${key.replace('⇧', 'Shift+').replace('⌃', 'Control+').replace('⌘', 'Meta+')}"` : ''}><span>${esc(label)}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    }
    if (it.sub) { const sid = `${id}-${j}`; return `<button type="button" role="menuitem" tabindex="-1" aria-haspopup="menu" aria-expanded="false" aria-controls="m${sid}" data-sub="m${sid}"><span>${esc(it.label)}</span><i aria-hidden="true">${'▸'}</i></button>`; }
    if (it.check) return `<label class="mi"><input type="checkbox" role="menuitemcheckbox" tabindex="-1" name="${it.check}"${it.checked ? ' checked' : ''}><span>${esc(it.label)}</span></label>`;
    return `<label class="mi"><input type="radio" role="menuitemradio" tabindex="-1" name="${it.radio}" value="${it.value}"${it.checked ? ' checked' : ''}><span>${esc(it.label)}</span></label>`;
  };
  return `<div role="menu" id="m${id}" class="${sub ? 'sub' : ''}" hidden>${items.map(row).join('')}</div>`;
}

// #region ledger-menubar
//   <ledger-menubar name="books"><option data-date="20 Nov" data-ref="JC-0419" data-vat="3.00" data-sum="18.00" data-unpaid>Rear wheel trued, Okafor</option>…</ledger-menubar>
// A role="menubar" of buttons. Each opens a role="menu" of buttons, with a checkbox or radios given menu
// roles where an item is on or off. Focus moves with the keys of a menubar; the canvas draws a blue bar
// under the focused item that slides to the next one, and draws the item's text white where the bar is.
export class LedgerMenubar extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static html = `<div role="menubar" aria-label="Workshop books"></div><table class="ledger"><colgroup><col style="width:44px"><col style="width:58px"><col><col class="c-vat"><col style="width:50px"></colgroup>
    <thead><tr><th>Date</th><th>Ref</th><th>Details</th><th class="vat n">VAT</th><th class="n">£</th></tr></thead><tbody></tbody></table>
    <output class="status" role="status"></output>`;
  static css = `
    [role=menubar] { display: flex; gap: 3px; width: 360px; padding: 3px; box-sizing: border-box; }
    [role=menubar] > button { all: unset; flex: auto; height: 32px; text-align: center; color: #000; font: 700 17px/32px ${TIMES}; cursor: default; }
    [role=menubar] > button:focus-visible { text-decoration: underline 2px; text-underline-offset: 3px; }
    [role=menu] { display: block; width: max-content; min-width: 176px; padding: 0; border: 3px solid #000; color: #000; }
    [role=menu][hidden] { display: none; }
    [role=menu] > button, .mi { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 22px; width: 100%; height: 28px; padding: 0 12px 0 14px; font: 400 15px/28px ${TIMES}; cursor: default; }
    [role=menu] > button > span, .mi > span { flex: auto; white-space: nowrap; }
    [role=menu] > button[aria-disabled=true] { color: #9a9a9a; }
    kbd { font: 700 11px/1 ${MONO}; letter-spacing: 0.06em; }
    [role=menu] i { font-style: normal; font-size: 11px; }
    [role=separator] { height: 0; border-top: 3px solid #000; margin: 2px 0; }
    .mi { gap: 9px; padding-left: 12px; }
    .mi input:focus { outline: none; }
    .mi input { appearance: none; flex: none; margin: 0; width: 12px; height: 12px; border: 1.5px solid currentColor; box-sizing: border-box; }
    .mi input[type=checkbox]:checked { background: linear-gradient(45deg, transparent 42%, currentColor 42% 58%, transparent 58%), linear-gradient(-45deg, transparent 42%, currentColor 42% 58%, transparent 58%); }
    .mi input[type=radio] { width: 9px; height: 9px; border: 0; margin: 0 1.5px; }
    .mi input[type=radio]:checked { background: currentColor; }
    table { width: 360px; border-collapse: collapse; table-layout: fixed; background: transparent; color: #000; font: 400 11.5px/1 ${TIMES}; --vw: 42px; }
    col.c-vat { width: var(--vw); }
    th, td { height: 16px; padding: 0 4px; border: 1px solid #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
    th { font-weight: 700; border-bottom-width: 2px; }
    .vat { padding-inline: clamp(0px, calc(var(--vw) / 10), 4px); }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    td.ref { font: 400 9.5px/1 ${MONO}; letter-spacing: 0.04em; }
    table.novat .vat { display: none; }
    table.unpaid-only tbody tr:not([data-unpaid]) { display: none; }
    .status { width: 360px; height: 20px; padding: 0 8px; box-sizing: border-box; background: #000; color: #fff; font: 400 11px/20px ${MONO}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;

  ready() {
    this.bar = this.$('[role=menubar]'); this.table = this.$('table'); this.tbody = this.$('tbody'); this.status = this.$('.status');
    const box = this.canvas ?? this.$('.plain');
    this.bar.innerHTML = MENUS.map((m, i) => `<button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="m${i}" tabindex="${i ? -1 : 0}" data-i="${i}">${m.label}</button>`).join('');
    this.tops = this.$$('[role=menubar] > button');
    // The menus and submenus are children of the canvas, after the table, so they are drawn on top of it.
    const menus = [];
    MENUS.forEach((m, i) => {
      menus.push(menuHtml(m.items, i));
      m.items.forEach((it, j) => { if (Array.isArray(it.sub)) menus.push(menuHtml(it.sub, `${i}-${j}`, true)); });
    });
    for (const html of menus) box.insertBefore(node(html), this.status);
    this.menus = MENUS.map((_, i) => this.$(`#m${i}`));
    for (const o of options(this)) this.tbody.append(this.row(o.data.date, o.data.ref, o.label, o.data.vat, o.data.sum, 'unpaid' in o.data));
    this.open = -1; this.sub = null; this.posted = []; this.undone = []; this.job = 420;
    this.topBar = { x: 0, w: 0, v: 0, vw: 0 }; this.unroll = { x: 0, v: 0 }; this.itemBar = { x: -1, v: 0 }; this.subBar = { x: -1, v: 0 };
    this.flash = null; this.pos = new Map();
    this.vatW = { x: 42, v: 0 };

    this.bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.toggle(+b.dataset.i); });
    this.bar.addEventListener('pointerover', (e) => { const b = e.target.closest('button'); if (b && this.open >= 0 && +b.dataset.i !== this.open) this.show(+b.dataset.i, null); });
    this.shadowRoot.addEventListener('pointerover', (e) => { const it = e.target.closest?.('[role=menu] > button, [role=menu] .mi'); if (it) { const f = this.focusable(it); if (f !== this.shadowRoot.activeElement) this.focusItem(f); } });
    this.shadowRoot.addEventListener('click', (e) => {
      const it = e.target.closest?.('[role=menu] > button');
      if (it) this.activate(it);
    });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.closest?.('[role=menu]')) this.setting(e.target); });
    this.addEventListener('keydown', (e) => this.key(e));
    // A press anywhere but the menus and the menubar closes the open menu, as it does in an app.
    document.addEventListener('pointerdown', (e) => {
      if (this.open < 0) return;
      const path = e.composedPath();
      if (!path.some((n) => n.getAttribute?.('role') === 'menu' || n.getAttribute?.('role') === 'menubar')) this.close(false);
    });
    this.$('[name=vat]').checked || this.table.classList.add('novat');
    this.sync('Ready.');
  }

  row(date, ref, details, vat, sum, unpaid) {
    const tr = document.createElement('tr');
    if (unpaid) tr.dataset.unpaid = '';
    tr.innerHTML = `<td>${esc(date)}</td><td class="ref">${esc(ref)}</td><td>${esc(details)}</td><td class="vat n">${esc(vat ?? '')}</td><td class="n">${esc(sum)}</td>`;
    return tr;
  }
  items(menu) { return [...menu.children].filter((c) => c.getAttribute('role') !== 'separator').map((c) => this.focusable(c)); }
  focusable(el) { return el.matches('.mi') ? el.querySelector('input') : el; }
  rowOf(el) { return el.closest('.mi') ?? el; }
  // Every direct child of a layoutsubtree canvas is laid out at the canvas's corner, whatever its CSS
  // position says (left and top are ignored), so the place of each menu is kept here and used when drawing.
  place(menu, x, y) { this.pos.set(menu, { x: Math.max(0, Math.min(360 - menu.offsetWidth, x)), y }); }
  at(menu) { return this.pos.get(menu) ?? { x: 0, y: 0 }; }
  within(el, menu) { return this.slice(el, menu).top; }

  show(i, focus = 'first') {
    this.closeSub();
    if (this.open >= 0 && this.open !== i) { this.menus[this.open].hidden = true; this.tops[this.open].setAttribute('aria-expanded', 'false'); }
    const fresh = this.open !== i;
    this.open = i;
    const menu = this.menus[i], top = this.tops[i];
    menu.hidden = false;
    top.setAttribute('aria-expanded', 'true');
    this.place(menu, top.offsetLeft - 3, 37);
    this.tops.forEach((t, j) => t.tabIndex = j === i ? 0 : -1);
    if (fresh) { this.unroll.x = reduced() ? 1 : 0.15; this.unroll.v = 0; this.itemBar.x = -1; }
    const list = this.items(menu);
    if (focus === 'first') this.focusItem(list[0], true);
    else if (focus === 'last') this.focusItem(list.at(-1), true);
    else top.focus({ preventScroll: true });
    this.request();
  }
  toggle(i) { if (this.open === i) this.close(true); else this.show(i, null); }
  close(refocus = true) {
    if (this.open < 0) return;
    this.closeSub();
    const i = this.open;
    this.menus[i].hidden = true; this.tops[i].setAttribute('aria-expanded', 'false');
    this.open = -1;
    if (refocus) this.tops[i].focus({ preventScroll: true });
    this.request();
  }
  openSub(btn, focusFirst = true) {
    const menu = this.$(`#${btn.dataset.sub}`), parent = btn.closest('[role=menu]');
    if (this.sub && this.sub.menu !== menu) this.closeSub();
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    // to the right of its item if it fits, otherwise to the left
    const p = this.at(parent), right = p.x + parent.offsetWidth - 3, x = right + menu.offsetWidth <= 360 ? right : p.x - menu.offsetWidth + 3;
    this.place(menu, x, p.y + this.within(btn, parent) - 3);
    this.sub = { menu, btn };
    if (focusFirst) { this.subBar.x = -1; this.focusItem(this.items(menu)[0], true); }
    this.request();
  }
  closeSub(refocus = false) {
    if (!this.sub) return;
    this.sub.menu.hidden = true; this.sub.btn.setAttribute('aria-expanded', 'false');
    if (refocus) this.sub.btn.focus({ preventScroll: true });
    this.sub = null;
  }
  focusItem(el, jump = false) {
    if (!el) return;
    const menu = el.closest('[role=menu]');
    if (this.sub && menu !== this.sub.menu && menu.contains(this.sub.btn) && el !== this.sub.btn) this.closeSub();
    el.focus({ preventScroll: true });
    if (jump) (menu.classList.contains('sub') ? this.subBar : this.itemBar).x = -1;
    this.request();
  }

  activate(it) {
    if (it.getAttribute('aria-disabled') === 'true') return;
    if (it.dataset.sub) return this.openSub(it);
    const menu = MENUS[this.open]?.label ?? '', cmd = it.dataset.cmd, label = it.querySelector('span').textContent;
    if (cmd === 'post') this.post();
    else if (cmd === 'undo') this.undo();
    else if (cmd === 'redo') this.redo();
    else this.sync(`${menu} › ${this.sub ? this.sub.btn.querySelector('span').textContent + ' › ' : ''}${label}: not part of this demo.`);
    this.close(true);
  }
  setting(input) {
    if (input.name === 'vat') this.vat(input.checked);
    if (input.name === 'unpaid') this.table.classList.toggle('unpaid-only', input.checked);
    this.sync(input.name === 'period' ? `Period: ${input.closest('.mi').textContent.trim()}.` : `${input.closest('.mi').textContent.trim()}: ${input.checked ? 'on' : 'off'}.`);
    changed(this);
  }
  // The VAT column narrows a frame at a time: its <col> width is changed in a frame callback, never inside
  // the paint handler, and each change raises a paint event of its own.
  vat(on) {
    if (on) this.table.classList.remove('novat');
    cancelAnimationFrame(this.vatRaf);
    let last = performance.now();
    const step = (now) => {
      const dt = clamp((now - last) / 1000, 1 / 240, 1 / 30); last = now;
      const moving = spring(this.vatW, on ? 42 : 0, dt, 200, 26);
      this.table.style.setProperty('--vw', `${Math.max(0, this.vatW.x).toFixed(2)}px`);
      if (moving) this.vatRaf = requestAnimationFrame(step);
      else if (!on) this.table.classList.add('novat');
    };
    this.vatRaf = requestAnimationFrame(step);
  }
  post() {
    const n = this.job++, [details, vat, sum] = JOBS[(n - 420) % JOBS.length], tr = this.row('26 Nov', `JC-0${n}`, details, vat, sum, true);
    this.tbody.prepend(tr);
    this.posted.push(tr); this.undone = [];
    this.flash = { tr, at: performance.now() };
    this.sync(`Posted JC-0${n}: ${details}, £${sum}.`);
    changed(this);
  }
  undo() {
    const tr = this.posted.pop(); if (!tr) return;
    tr.remove(); this.undone.push(tr); this.job--;
    this.sync(`Undo: removed ${tr.children[1].textContent}.`);
    changed(this);
  }
  redo() {
    const tr = this.undone.pop(); if (!tr) return;
    this.tbody.prepend(tr); this.posted.push(tr); this.job++;
    this.flash = { tr, at: performance.now() };
    this.sync(`Redo: posted ${tr.children[1].textContent}.`);
    changed(this);
  }
  // Menu items that depend on state, the status line and the form value.
  sync(message) {
    const cmd = (c) => this.$(`[data-cmd=${c}]`);
    cmd('undo').setAttribute('aria-disabled', !this.posted.length);
    cmd('redo').setAttribute('aria-disabled', !this.undone.length);
    cmd('post').querySelector('span').textContent = `Post job card JC-0${this.job}`;
    this.status.textContent = message;
    const fd = new FormData(), name = this.getAttribute('name') ?? 'books';
    for (const el of this.$$('[role=menu] input')) if (el.checked) fd.append(`${name}-${el.name}`, el.value);
    for (const tr of this.posted) fd.append(`${name}-posted`, tr.children[1].textContent);
    this.setValue(fd);
    this.request();
  }

  key(e) {
    const el = this.shadowRoot.activeElement;
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (k === 'j') { e.preventDefault(); this.post(); }
      return;
    }
    if (!el) return;
    const top = el.closest('[role=menubar]') ? +el.dataset.i : -1;
    const move = (d) => { const i = (((top >= 0 ? top : this.open) + d) % MENUS.length + MENUS.length) % MENUS.length; if (this.open >= 0 || top < 0) this.show(i, 'first'); else { this.tops[i].focus({ preventScroll: true }); this.tops.forEach((t, j) => t.tabIndex = j === i ? 0 : -1); this.request(); } };
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (top >= 0) {
      if (e.key === 'ArrowRight') { handled(); move(1); }
      else if (e.key === 'ArrowLeft') { handled(); move(-1); }
      else if (e.key === 'Home') { handled(); move(-top); }
      else if (e.key === 'End') { handled(); move(MENUS.length - 1 - top); }
      else if (['ArrowDown', 'Enter', ' '].includes(e.key)) { handled(); this.show(top, 'first'); }
      else if (e.key === 'ArrowUp') { handled(); this.show(top, 'last'); }
      else if (e.key === 'Escape') { handled(); this.close(true); }
      return;
    }
    const menu = el.closest('[role=menu]');
    if (!menu) return;
    const list = this.items(menu), i = list.indexOf(el), inSub = menu.classList.contains('sub');
    if (e.key === 'ArrowDown') { handled(); this.focusItem(list[(i + 1) % list.length]); }
    else if (e.key === 'ArrowUp') { handled(); this.focusItem(list[(i - 1 + list.length) % list.length]); }
    else if (e.key === 'Home') { handled(); this.focusItem(list[0]); }
    else if (e.key === 'End') { handled(); this.focusItem(list.at(-1)); }
    else if (e.key === 'Enter' || e.key === ' ') { handled(); if (el.matches('input')) el.click(); else this.activate(el); }
    else if (e.key === 'Escape') { handled(); if (inSub) this.closeSub(true); else this.close(true); this.request(); }
    else if (e.key === 'ArrowRight') { handled(); if (el.dataset.sub) this.openSub(el); else move(1); }
    else if (e.key === 'ArrowLeft') { handled(); if (inSub) { this.closeSub(true); this.request(); } else move(-1); }
    else if (e.key === 'Tab') this.close(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // type the first letter of an item to go to it
      const next = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((x) => this.rowOf(x).textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (next) { handled(); this.focusItem(next); }
    }
  }

  draw(ctx, w, h, now) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    let moving = false;
    // the ledger, with a fading band behind a row that was just posted
    const TY = 38, TB = 340;
    ctx.save(); ctx.beginPath(); ctx.rect(0, TY, w, TB - TY); ctx.clip();
    if (this.flash) {
      const age = (now - this.flash.at) / 1400, tr = this.flash.tr;
      if (age < 1 && tr.isConnected) { ctx.fillStyle = `rgba(255, 214, 0, ${0.85 * (1 - age)})`; ctx.fillRect(0, TY + tr.offsetTop, w, tr.offsetHeight); moving = true; }
      else this.flash = null;
    }
    put(ctx, this.table, 0, TY);
    ctx.restore();
    put(ctx, this.status, 0, TB);

    // the menubar, and a bar on the open menu's title that slides along it. The bar and the menus have no
    // background of their own, so that the white of a second draw through the filter is only their ink.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, 38);
    ctx.fillStyle = '#fff';
    for (const t of this.tops) ctx.fillRect(t.offsetLeft, 3, t.offsetWidth, 32);
    put(ctx, this.bar, 0, 0);
    const focus = this.shadowRoot.activeElement;
    if (this.open >= 0) {
      const t = this.tops[this.open], tx = t.offsetLeft, tw = t.offsetWidth;
      if (this.topBar.w === 0 || reduced()) { this.topBar.x = tx; this.topBar.w = tw; }
      const sx = { x: this.topBar.x, v: this.topBar.v }, sw = { x: this.topBar.w, v: this.topBar.vw };
      moving = spring(sx, tx, this.dt, 420, 34) | spring(sw, tw, this.dt, 420, 34) || moving;
      Object.assign(this.topBar, { x: sx.x, v: sx.v, w: sw.x, vw: sw.v });
      marker(ctx, this.bar, 0, 0, { x: this.topBar.x, y: 3, w: this.topBar.w, h: 32 }, '#1f1fff', TO_WHITE);

      // the open menu unrolls downwards, and a bar under the focused item slides to the next one
      const menu = this.menus[this.open], { x: mx, y: my } = this.at(menu), mw = menu.offsetWidth, mh = menu.offsetHeight;
      moving = spring(this.unroll, 1, this.dt, 300, 26) || moving;
      ctx.save(); ctx.beginPath(); ctx.rect(mx - 2, my, mw + 8, mh * clamp(this.unroll.x) + 6); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(mx + 5, my + 5, mw, mh);   // a hard shadow
      ctx.fillStyle = '#fff'; ctx.fillRect(mx, my, mw, mh);
      put(ctx, menu, mx, my);
      moving = this.itemMarker(ctx, menu, focus, this.itemBar) || moving;
      ctx.restore();
      if (this.sub) {
        const s = this.sub.menu, { x: sx, y: sy } = this.at(s);
        ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(sx + 5, sy + 5, s.offsetWidth, s.offsetHeight);
        ctx.fillStyle = '#fff'; ctx.fillRect(sx, sy, s.offsetWidth, s.offsetHeight);
        put(ctx, s, sx, sy);
        moving = this.itemMarker(ctx, s, focus, this.subBar) || moving;
      }
    } else this.topBar.w = 0;
    return moving;
  }
  // The blue bar under the focused item of one menu. It follows the item on a spring.
  itemMarker(ctx, menu, focus, bar) {
    const own = focus && menu.contains(focus) ? this.rowOf(focus) : (this.sub && menu.contains(this.sub.btn) ? this.sub.btn : null);
    if (!own) { bar.x = -1; return false; }
    const y = this.within(own, menu), m = this.at(menu);
    if (bar.x < 0 || reduced()) { bar.x = y; bar.v = 0; }
    const moving = spring(bar, y, this.dt, 520, 40);
    marker(ctx, menu, m.x, m.y, { x: m.x + 3, y: m.y + bar.x, w: menu.offsetWidth - 6, h: own.offsetHeight }, '#1f1fff', TO_WHITE);
    return moving;
  }
}
customElements.define('ledger-menubar', LedgerMenubar);
// #endregion ledger-menubar
