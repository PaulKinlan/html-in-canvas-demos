// Shared by a.html and b.html: two documents with a view transition between them.
import '/lib/live-transition.js';

const lt = document.getElementById('lt');
const shader = new URLSearchParams(location.search).has('shader');
const KEY = 'vt-handover';

const t0 = performance.now();
setInterval(() => { for (const c of document.querySelectorAll('[data-clock]')) c.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }, 100);

for (const a of document.querySelectorAll('a[data-next]')) {
  a.href = a.dataset.next + (shader ? '?shader' : '');
  // #region leave
  // Leaving in shader mode: store a picture of this page's canvas for the next document, then navigate.
  a.addEventListener('click', async (e) => {
    if (!shader || !lt.supported || lt.fallbackReason) return;
    e.preventDefault();
    try {
      const pixels = await lt.readback();
      const c = document.createElement('canvas');
      c.width = pixels.width; c.height = pixels.height;
      c.getContext('2d').putImageData(pixels, 0, 0);
      sessionStorage.setItem(KEY, c.toDataURL('image/webp', 0.9));
    } catch { sessionStorage.removeItem(KEY); }
    location.href = a.href;
  });
  // #endregion leave
}

// #region arrive
// Arriving: the inline script in the page put the stored picture in as the first state. Burn from it to the real one.
const old = lt.querySelector('img[data-old]');
if (old) {
  await customElements.whenDefined('live-transition');
  if (lt.supported) {
    await old.decode().catch(() => {});
    await lt.show(1, { effect: 'burn', duration: 900, force: true }).catch(() => {});
  }
  old.remove();
  document.documentElement.classList.remove('handover');
}
// #endregion arrive
