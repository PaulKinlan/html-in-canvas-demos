import { EffectFrame } from '/lib/effect-frame.js';

// #region blinds
// An effect is a function. This one is registered by the page: vertical strips, each squeezed about its
// own middle by a travelling wave, like blinds turning.
EffectFrame.effects.blinds = (ctx, draw, { width, height, time, amount, pointer }) => {
  const strip = 28;
  for (let x = 0; x < width; x += strip) {
    const near = pointer ? Math.min(1, Math.abs(pointer.x - (x + strip / 2)) / 90) : 1;
    const k = 1 - 0.82 * amount * near * (0.5 + 0.5 * Math.sin(time * 2 - x / 60));
    ctx.save();
    ctx.beginPath(); ctx.rect(x, 0, strip, height); ctx.clip();
    ctx.translate(x + strip / 2, 0); ctx.scale(k, 1); ctx.translate(-(x + strip / 2), 0);
    draw();
    ctx.restore();
  }
  return true;
};
// #endregion blinds

// #region rating
// A form-associated custom element with its own shadow tree: five buttons. It is a light-DOM child of
// <effect-frame>, so it is drawn through two shadow trees.
class TapRating extends HTMLElement {
  static formAssociated = true;
  #internals = this.attachInternals();
  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML = `
      <style>
        :host { display: flex; gap: 4px; }
        button { flex: 1; min-height: 44px; padding: 0; border: 1px solid #b9b6ad; border-radius: 8px; background: #fff; color: #c9c5ba; font: 24px/1 system-ui, sans-serif; touch-action: manipulation; }
        button[aria-pressed="true"] { color: #e0a100; border-color: #e0a100; background: #fff8e0; }
      </style>${[1, 2, 3, 4, 5].map((n) => `<button type="button" value="${n}" aria-label="${n} of 5">★</button>`).join('')}`;
    this.shadowRoot.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.value = b.value; });
  }
  connectedCallback() { this.value = this.getAttribute('value') ?? 0; }
  get value() { return Number(this.getAttribute('value')) || 0; }
  set value(v) {
    if (this.getAttribute('value') !== String(v)) this.setAttribute('value', v);
    this.#internals.setFormValue(String(v));
    for (const b of this.shadowRoot.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.value) <= Number(v)));
  }
}
if (!customElements.get('tap-rating')) customElements.define('tap-rating', TapRating);
// #endregion rating

export default function start() {
  const frame = document.getElementById('fxFrame'), form = document.getElementById('fxForm');
  const out = document.getElementById('fxOut'), amount = document.getElementById('fxAmount');
  const buttons = [...document.querySelectorAll('[data-effect]')];
  const line = () => {
    out.textContent = frame.plain
      ? 'The element is showing its children as plain HTML.'
      : `effect="${frame.getAttribute('effect')}" amount="${frame.getAttribute('amount') ?? 1}". Paint events in the element's canvas: ${frame.paints}. The form in the page has ${form.querySelectorAll('[drawable]').length} elements with a drawable attribute.`;
  };
  for (const button of buttons) button.addEventListener('click', () => {
    frame.setAttribute('effect', button.dataset.effect);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
    line();
  });
  amount.addEventListener('input', () => { frame.setAttribute('amount', amount.value); line(); });
  frame.addEventListener('effect-frame-plain', line);
  // The form's own job. FormData reads the stars through the custom element's form value.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    form.elements.said.value = `Sent: ${data.get('name') || 'no name'}, ${data.get('stars')} of 5${data.get('again') ? ', would open it again' : ''}.`;
    line();
  });
  const timer = setInterval(() => { if (!frame.isConnected) clearInterval(timer); else if (document.visibilityState === 'visible') line(); }, 1000);
  line();
  return { frame };
}
