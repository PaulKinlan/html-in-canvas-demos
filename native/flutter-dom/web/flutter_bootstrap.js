// flutter_bootstrap.js for /flutter-dom/. The build fills in the two tokens below.
// The page loads this file when the reader asks for the app, then calls startFlutterDom().
{{flutter_js}}
{{flutter_build_config}}

// #region start
// Start the app inside `host` (Flutter's embedded mode) with the CanvasKit files that are
// served beside it. Resolves with the running app, rejects if the engine cannot start.
// `extra` adds engine configuration, for example { canvasKitForceMultiSurfaceRasterizer: true }.
window.startFlutterDom = (host, extra = {}, base = '/flutter-dom/app/') => new Promise((resolve, reject) => {
  const config = {
    entrypointBaseUrl: base,
    assetBase: base,
    canvasKitBaseUrl: `${base}canvaskit/`,
    canvasKitVariant: 'chromium',
    renderer: 'canvaskit',
    ...extra,
  };
  _flutter.loader.load({
    config,
    onEntrypointLoaded: async (engineInitializer) => {
      try {
        const appRunner = await engineInitializer.initializeEngine({ ...config, hostElement: host });
        resolve(await appRunner.runApp());
      } catch (err) {
        reject(err);
      }
    },
  }).catch(reject);
});
// #endregion start
