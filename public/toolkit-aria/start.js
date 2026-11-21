// start.js: load the Emscripten module and start the ImGui app on a canvas.
// #region start
export async function startToolkitAria(canvas) {
  await new Promise((resolve, reject) => {
    if (globalThis.createToolkitAria) return resolve();
    const s = document.createElement('script');
    s.src = '/toolkit-aria/app/toolkit_aria.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load toolkit_aria.js'));
    document.head.append(s);
  });
  // main() runs during this call and makes a WebGL2 context on the canvas with id "aria-app".
  const module = await globalThis.createToolkitAria({ canvas, locateFile: (file) => `/toolkit-aria/app/${file}` });
  if (!globalThis.__toolkitAria) throw new Error('WebGL2 is not available, so the app did not start');
  return { module, aria: globalThis.__toolkitAria };
}
// #endregion start
