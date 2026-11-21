# WebGPU across the shader demos (`/shader-css/`, `/slot-effects/`, `/particles/`, `/transitions/`, `/physical/`, `/three-form/`)

Every demo that put an element through a WebGL shader now has a WebGPU route as well, picked by itself when `shared/backend.js` says WebGPU is usable, with WebGL (and 2D where there was one) behind it. Each page has a "Drawn with" switch and a line saying what is drawing and, when that is not WebGPU, why.

| Experiment | Result | Notes |
|---|---|---|
| `GPUQueue.drawElementImageToTexture({ source: element }, { texture })` | works | Chromium 157. The texture is `rgba8unorm` with `COPY_DST`, `RENDER_ATTACHMENT` and `TEXTURE_BINDING`, sized from `canvas.getElementImageDefaultSize(el)`. Row 0 is the top of the element and the pixels are premultiplied. The canvas must hold a `webgpu` context, even if nothing is ever shown on it. |
| `fx` effects in WGSL against GLSL | same picture | none, ripple, glass, dissolve: 0.00 mean difference per channel of 255. curl 0.17, haze 0.20, tilt 0.58, crt 0.50 (the last two are animated or antialiased differently). |
| `<physical-ui>` mesh in WGSL, 4x MSAA | same picture | jelly, cloth, paper: 0.04 at rest, 0.05 to 0.13 mid-wobble. The simulation and hit testing do not change. |
| `<live-transition>` in WGSL | same picture | fade, morph, burn, ripple, pixelate, swirl 0.00; fold 0.05; shatter 0.14. A shader effect given only as GLSL moves the element to WebGL. |
| `<glyph-field engine="webgpu">`, instanced quads | same picture at rest | `engine="auto"` (the `/particles/` default now) is WebGPU, else the 2D atlas. WebGL is skipped by `auto` because it came out as a solid block on one Android phone. |
| `<canvas-slot effect>` and the `fx` attribute | WebGPU by default when usable | Only when every effect in use has WGSL source; a GLSL-only custom effect keeps that element on WebGL and the note says so. `backend="gl"` / `fx-backend="gl"` pins WebGL. |
| A custom effect typed into the page, in WGSL | works | `/shader-css/` has a WGSL editor beside the GLSL one. The text is compiled with `createShaderModule().getCompilationInfo()` before it is used, so an error shows with its line and the card keeps the last version that compiled. An effect that gains WGSL later moves its elements from WebGL to WebGPU. WGSL that fails inside an element's first frame is reported as the effect's error and no longer counts as WebGPU being broken. |
| Switching route on a live element | works | A canvas keeps its first context type, so the element swaps in a cloned canvas and moves its children across. Focus, form state and listeners stay. |
| Falling back by itself | works | Three guards: the first frame runs inside a validation error scope; the `webgpulost` event; and the first two shown frames are copied to a 24px 2D canvas, and if both are empty the element goes to WebGL with "WebGPU showed an empty canvas". The reason is on `element.gpuNote`. |
| Showing a WebGPU canvas in the headless test browser | fails | With `--enable-unsafe-webgpu --enable-unsafe-swiftshader` the adapter is SwiftShader. Render passes into textures work; `submit()` of a pass into any canvas texture (DOM or OffscreenCanvas, main thread or worker) destroys the device, with 15 sets of flags tried. So the comparisons above render to a texture and read it back (`offscreen` / `fx-offscreen` attributes). |
| A lost device and the rest of the page | collateral damage | Losing the device also loses every WebGL context and large 2D canvas on the page, even when the device lived in a worker. A cross-site iframe is spared. This is why `webgpu()` refuses software adapters. |
| three `WebGPURenderer` picked by itself | wired, not verified | `/three-form/` loads the WebGPU build when `webgpu()` passes. If the renderer does not start, falls back inside three, or loses its device, the page reloads on WebGL and shows the reason. |
| WebXR on WebGPU | not possible here | `XRGPUBinding` is missing in Chromium 157, so `/xr/` stays on three's `WebGLRenderer`. |

Not verified here, because the cloud browser cannot show a WebGPU canvas: every on-screen WebGPU path, its speed against WebGL, and three's `WebGPURenderer`. Each page has two checks for a real device: "the same picture as WebGL" (off-screen, pixel by pixel) and "on screen" (reads the shown canvas). On the cloud browser the first passes with the software adapter and the second fails with the reason.

## Newer WebGPU features on element textures (`/webgpu-features/`)

One page draws a form and a block of text, both uploaded with `drawElementImageToTexture()`, with one newer feature per tile. `webgpu({ features: true })` in `shared/backend.js` makes a second device that asks the adapter for each of `texture-component-swizzle`, `float32-blendable`, `dual-source-blending` and `primitive-index` that it lists. The device the other pages share is unchanged. Measured on the software adapter in Chromium 157, by reading an off-screen target back:

| Feature | Use | Without it | Result |
| --- | --- | --- | --- |
| Compatibility mode (`requestAdapter({ featureLevel: 'compatibility' })`) | `webgpu({ compat: true })` gives a compatibility device where there is no core adapter; `pickBackend()` accepts `'webgpu-compat'` in its order | WebGL | The compatibility device (4096 pixel textures, 4 colour attachments) builds every shader on the page and its picture matches the core device within 2 of 255 |
| `texture-component-swizzle` | `createView({ swizzle: 'aaa1', usage: TEXTURE_BINDING })` hands an element's alpha to a shader that reads `.r` | The shader is compiled again to read `.a` | Same picture, largest difference 0 of 255 |
| Immediates (`var<immediate>`, `setImmediates()`) | 48 bytes for each draw with no buffer and no bind group; `maxImmediateSize` is 64 | One uniform buffer, a 256-byte slot for each draw, dynamic offset | Same picture, largest difference 0 of 255 |
| `float32-blendable` | An `rgba32float` trail target that is faded and added to each frame | `rgba16float`, then `rgba8unorm` | Float targets read 251 of 255 after 8 additions and 0 after 200 fades; `rgba8unorm` reads 201 and keeps a mark of 14 |
| `primitive-index` | `@builtin(primitive_index)` tints each triangle in the fragment shader | `vertex_index / 3` as a flat varying | Not measured: the software adapter does not have the feature |
| `dual-source-blending` | Text with a separate coverage for red, green and blue (`@blend_src(1)`, `src1` blend factors) | The coverages averaged, plain alpha | Not measured: the software adapter does not have the feature |

- The WebGL 2 route draws the same frame as the WebGPU route with every feature off: mean difference 0.09 of 255 in the shards tile and 0.00 in the other four.
- `primitive_index` is a fragment input only. Moving triangles apart is vertex work, so it does not replace per-vertex data; for separate triangles a flat varying gives the fragment shader the same number.
- Flat varyings must be `@interpolate(flat, either)` to compile on a compatibility device.
- Subpixel text needs a canvas with one pixel for each screen pixel (`devicePixelContentBoxSize`) and assumes red, green, blue stripes. Most phone screens are not laid out that way.
- Needs a real GPU: the two unmeasured rows, WebGPU on screen for this page, and whether a phone's compatibility adapter is a separate one.
