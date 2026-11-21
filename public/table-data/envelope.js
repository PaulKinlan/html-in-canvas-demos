import { mount, put, colors, clamp, smooth } from '/form-state/kit.js';

export default function start() {
  const canvas = document.getElementById('envelopeCanvas'), form = document.getElementById('envelopeForm'), address = document.getElementById('envelopeAddress'), out = document.getElementById('envelopeOut');
  const write = () => {
    const v = (n) => form.elements[n].value.trim();
    address.replaceChildren(...[v('name') || 'Name', v('street') || 'Street', v('town') || 'Town'].flatMap((line, i) => (i ? [document.createElement('br'), line] : [line])));
  };
  form.addEventListener('input', write);
  write();
  let t0 = -1e9, sent = 0;
  // #region envelope
  // The <address> is a real element that the script fills from the three fields. The canvas draws an
  // envelope and draws the address on it, turned a little. On submit the flap closes over 0.5 s, the
  // envelope leaves to the right and a new one comes in from the left.
  const stage = mount(canvas, (ctx, w, h, t) => {
    const c = colors(canvas), T = (t - t0) / 1000, busy = T < 1.8;
    const fw = form.offsetWidth, ew = Math.min(w - 24, 330), eh = ew * 0.56, ex = (w - ew) / 2, ey = eh * 0.44 + 8;
    const flap = busy ? smooth(clamp(T / 0.5)) : 0;
    const away = busy ? (T < 0.6 ? 0 : T < 1.2 ? smooth((T - 0.6) / 0.6) * (w + 40) : -(1 - smooth((T - 1.2) / 0.6)) * (w + 40)) : 0;
    const fresh = busy && T >= 1.2;
    ctx.save();
    ctx.translate(ex + away, ey);
    ctx.fillStyle = '#f3ead6'; ctx.strokeStyle = '#b9a98a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(0, 0, ew, eh, 6); ctx.fill(); ctx.stroke();
    // A stamp and a postmark.
    ctx.fillStyle = c.accent; ctx.fillRect(ew - 50, 12, 36, 44);
    ctx.strokeStyle = '#fff'; ctx.setLineDash([3, 3]); ctx.strokeRect(ew - 47, 15, 30, 38); ctx.setLineDash([]);
    // The address, on the envelope. With the flap shut and a new envelope coming it is still drawn:
    // it is the same element.
    const ak = Math.min(1, (ew - 90) / address.offsetWidth);
    ctx.save();
    ctx.translate(ew * 0.2, eh * 0.4); ctx.rotate(-0.03); ctx.scale(ak, ak);
    ctx.globalAlpha = fresh ? 0.35 : 1;
    put(ctx, address, 0, 0);
    ctx.restore();
    // The flap: a triangle that swings from open (above the envelope) to shut (over its upper half).
    const tip = -eh * 0.42 + flap * (eh * 0.42 + eh * 0.5);
    if (!fresh) {
      ctx.fillStyle = flap > 0.5 ? '#e8dcc2' : '#efe4cb'; ctx.strokeStyle = '#b9a98a';
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(ew / 2, tip); ctx.lineTo(ew, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    // The form, under the envelope, drawn flat so that its fields take input where they are.
    const k = Math.min(1, (w - 16) / fw);
    ctx.save(); ctx.translate((w - fw * k) / 2, ey + eh + 34); ctx.scale(k, k); put(ctx, form, 0, 0); ctx.restore();
    out.textContent = `Address element: "${address.innerText.replace(/\n/g, ' / ')}". Sent: ${sent}.${busy ? ' Sending.' : ''}`;
    return busy;
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); sent++; t0 = performance.now(); stage.request(); });
  // #endregion envelope
  return { stage };
}
