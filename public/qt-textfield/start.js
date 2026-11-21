// start.js: load Qt for WebAssembly and start the Qt Quick app in a container element.
const script = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});
const until = async (test, ms) => { for (let t = 0; t < ms; t += 50) { if (test()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

// #region start
export async function startQtTextField(container, { onExit = () => {} } = {}) {
  await script('/qt-textfield/app/qttf.js');
  await script('/qt-textfield/app/qtloader.js');
  const module = await globalThis.qtLoad({
    qt: { entryFunction: globalThis.qttf_entry, containerElements: [container], onExit },
    locateFile: (file) => `/qt-textfield/app/${file}`,
  });
  // DomItem moves the inputs into Qt's canvas on its first frame and records the canvas.
  if (!await until(() => globalThis.__qtTf?.canvas && Object.keys(globalThis.__qtTf.items).length >= 3, 20000)) throw new Error('Qt did not take the input elements');
  const dom = globalThis.__qtTf;
  // Qt's canvas is in a shadow root. Page stylesheets do not reach it, so the inputs get their own.
  const root = dom.canvas.getRootNode();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/qt-textfield/field.css';
  root.append(link);
  return { module, dom, root, canvas: dom.canvas };
}
// #endregion start
