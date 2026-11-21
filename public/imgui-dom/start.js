// start.js: load the Emscripten module and start the ImGui app on a canvas.
// #region start
export async function startImgui(canvas) {
  await new Promise((resolve, reject) => {
    if (globalThis.createImguiDom) return resolve();
    const s = document.createElement('script');
    s.src = '/imgui-dom/app/imgui_dom.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load imgui_dom.js'));
    document.head.append(s);
  });
  // main() runs during this call and makes a WebGL2 context on the canvas with id "imgui-app".
  const module = await globalThis.createImguiDom({ canvas, locateFile: (file) => `/imgui-dom/app/${file}` });
  if (!globalThis.__imguiDom) throw new Error('WebGL2 is not available, so the app did not start');
  return { module, dom: globalThis.__imguiDom };
}
// #endregion start
