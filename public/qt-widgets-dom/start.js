// start.js: load Qt for WebAssembly and start the Qt Widgets app in a container element.
const script = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

// #region start
export async function startQtWidgets(container, { onExit = () => {} } = {}) {
  // Qt's canvas is in a shadow root. Page stylesheets do not reach it, so each element
  // carries its computed style inline before Qt takes it.
  for (const el of document.querySelectorAll('.qtw-dom')) {
    const cs = getComputedStyle(el);
    for (const p of ['boxSizing', 'margin', 'font', 'color', 'colorScheme', 'background', 'border', 'borderRadius', 'padding', 'resize']) el.style[p] = cs[p];
  }
  globalThis.__qtwContainer = container;         // domwidget.cpp finds the window's canvas through this
  await script('/qt-widgets-dom/app/qtwdom.js');
  await script('/qt-widgets-dom/app/qtloader.js');
  const module = await globalThis.qtLoad({
    qt: { entryFunction: globalThis.qtwdom_entry, containerElements: [container], onExit },
    locateFile: (file) => `/qt-widgets-dom/app/${file}`,
  });
  return { module, dom: globalThis.__qtwDom };
}
// #endregion start
