// start.js: load the Emscripten module, start the ImGui app on a canvas, attach the routes.
import { createOcclusion } from '/toolkit-occlusion/routes.js';

// #region start
export async function startToolkitOcclusion(canvas, stage) {
  await new Promise((resolve, reject) => {
    if (globalThis.createToolkitOcclusion) return resolve();
    const s = document.createElement('script');
    s.src = '/toolkit-occlusion/app/toolkit_occlusion.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load toolkit_occlusion.js'));
    document.head.append(s);
  });
  // main() runs during this call and makes the page's one WebGL2 context, on the canvas with id "occlusion-app".
  const module = await globalThis.createToolkitOcclusion({ canvas, locateFile: (file) => `/toolkit-occlusion/app/${file}` });
  const app = globalThis.__occApp;
  if (!app) throw new Error('WebGL2 is not available, so the app did not start');
  return { module, app, occ: createOcclusion({ canvas, stage, module, app }) };
}
// #endregion start
