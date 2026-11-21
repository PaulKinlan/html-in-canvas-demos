# Newer WebGPU features on element textures (`/webgpu-features/`, `shared/backend.js`)

Measured in C157 (headless shell, software WebGPU adapter) on 2026-11-21, by drawing to an off-screen target and reading it back. The rows marked A159 are reported: Paul ran the page's live checks on his phone on 2026-11-21 and pasted the table (10 of 10 pass).

One page draws a form and a block of text, both uploaded with `drawElementImageToTexture()`, with one newer feature per tile. `webgpu({ features: true })` in `shared/backend.js` makes a second device that asks the adapter for each of `texture-component-swizzle`, `float32-blendable`, `dual-source-blending` and `primitive-index` that it lists. The device the other pages share is unchanged.

| Feature | Use | Without it | Result |
| --- | --- | --- | --- |
| Compatibility mode (`requestAdapter({ featureLevel: 'compatibility' })`) | `webgpu({ compat: true })` gives a compatibility device where there is no core adapter; `pickBackend()` accepts `'webgpu-compat'` in its order | WebGL | The compatibility device (4096 pixel textures, 4 colour attachments) builds every shader on the page and its picture matches the core device within 2 of 255 |
| `texture-component-swizzle` | `createView({ swizzle: 'aaa1', usage: TEXTURE_BINDING })` hands an element's alpha to a shader that reads `.r` | The shader is compiled again to read `.a` | Same picture, largest difference 0 of 255 |
| Immediates (`var<immediate>`, `setImmediates()`) | 48 bytes for each draw with no buffer and no bind group; `maxImmediateSize` is 64 | One uniform buffer, a 256-byte slot for each draw, dynamic offset | Same picture, largest difference 0 of 255 |
| `float32-blendable` | An `rgba32float` trail target that is faded and added to each frame | `rgba16float`, then `rgba8unorm` | Float targets read 251 of 255 after 8 additions and 0 after 200 fades; `rgba8unorm` reads 201 and keeps a mark of 14 |
| `primitive-index` | `@builtin(primitive_index)` tints each triangle in the fragment shader | `vertex_index / 3` as a flat varying | Reported, A159: same picture both ways, largest difference 0 of 255. Not in C157 (the software adapter does not have the feature) |
| `dual-source-blending` | Text with a separate coverage for red, green and blue (`@blend_src(1)`, `src1` blend factors) | The coverages averaged, plain alpha | Reported, A159: 7986 pixels have red and blue more than 24 apart, and the channel average is within 2.0 of 255 of the plain alpha picture. Not in C157 |

- The WebGL 2 route draws the same frame as the WebGPU route with every feature off: mean difference 0.09 of 255 in the shards tile and 0.00 in the other four.
- `primitive_index` is a fragment input only. Moving triangles apart is vertex work, so it does not replace per-vertex data; for separate triangles a flat varying gives the fragment shader the same number.
- Flat varyings must be `@interpolate(flat, either)` to compile on a compatibility device.
- Subpixel text needs a canvas with one pixel for each screen pixel (`devicePixelContentBoxSize`) and assumes red, green, blue stripes. Most phone screens are not laid out that way.

## Things that bit

- A swizzled view of the element texture must be made with `usage: TEXTURE_BINDING`. The texture itself needs `RENDER_ATTACHMENT` for the upload, and a swizzled view cannot be a render target.
- `primitive_index` and `dual_source_blending` shaders do not parse unless the device has the feature, so each has a second shader source and the pipeline is built inside an error scope.
- In an emulated phone the `ResizeObserver` device pixel size equals the CSS size. The page uses it only when it agrees with `devicePixelRatio`.
- A canvas keeps the first kind of context it gave out. Changing route from WebGPU to WebGL replaces the canvas and moves its children across.

## Reported from the phone (A159, 2026-11-21)

- The page says "Drawn with WebGPU" and shows all five tiles. The last check reads the visible canvas: drawn with webgpu, 93% of sampled pixels have ink.
- The device is a core device with all four optional features and immediates (up to 64 bytes).
- Swizzle, immediates and `primitive_index` each match their other way with a largest difference of 0 of 255.
- Float trails: the same numbers as C157 (251 and 0 for both float formats, 201 and 14 for `rgba8unorm`).
- `requestAdapter({ featureLevel: 'compatibility' })` gives an adapter that can also give core devices. A device made from it with no features asked for is a compatibility device (4096 pixel textures, 4 colour attachments), has every feature the core device has, and draws the same picture within 2 of 255.
- WebGL against WebGPU with every feature off: mean difference 0.01 of 255 in the trails tile and 0.00 in the other four.

## Not verified

- What the "WebGPU compatibility mode" entry of the "Drawn with" menu shows on screen on the phone. The off-screen check of that device passes there.
- Whether the per-channel text looks better or worse than plain alpha on the phone's screen. The check only shows that the channels differ.
- A device without `dual-source-blending` or `primitive-index` other than the software adapter.

## For the index

- WebGPU: a swizzled view, immediates and a float blend target all work on a texture filled by `drawElementImageToTexture()` (measured, C157).
- WebGPU: a compatibility mode device builds and draws every shader of `/webgpu-features/` (measured, C157 software adapter; reported, A159).
- WebGPU: `primitive_index` and dual-source blending work on an element texture (reported, A159, `/webgpu-features/`).
- WebGPU draws on screen on the phone on `/webgpu-features/` (reported, A159).
