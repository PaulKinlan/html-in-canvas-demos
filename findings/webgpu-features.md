# Newer WebGPU features on element textures (`/webgpu-features/`, `shared/backend.js`)

Measured in C157 (headless shell, software WebGPU adapter) on 2026-11-21, by drawing to an off-screen target and reading it back.

One page draws a form and a block of text, both uploaded with `drawElementImageToTexture()`, with one newer feature per tile. `webgpu({ features: true })` in `shared/backend.js` makes a second device that asks the adapter for each of `texture-component-swizzle`, `float32-blendable`, `dual-source-blending` and `primitive-index` that it lists. The device the other pages share is unchanged.

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

## Things that bit

- A swizzled view of the element texture must be made with `usage: TEXTURE_BINDING`. The texture itself needs `RENDER_ATTACHMENT` for the upload, and a swizzled view cannot be a render target.
- `primitive_index` and `dual_source_blending` shaders do not parse unless the device has the feature, so each has a second shader source and the pipeline is built inside an error scope.
- In an emulated phone the `ResizeObserver` device pixel size equals the CSS size. The page uses it only when it agrees with `devicePixelRatio`.
- A canvas keeps the first kind of context it gave out. Changing route from WebGPU to WebGL replaces the canvas and moves its children across.

## Not verified

- `dual-source-blending` and `primitive-index`: the software adapter has neither, so those two shaders have never been compiled. The page's live checks compare each with its other way on the device that opens it.
- WebGPU on screen for this page. The test browser loses the device when it presents.
- Whether a phone gives a compatibility mode adapter that is separate from its core one. The "Drawn with" menu has a compatibility mode entry and the table names the level of the device it got.

## For the index

- WebGPU: a swizzled view, immediates and a float blend target all work on a texture filled by `drawElementImageToTexture()` (measured, C157).
- WebGPU: a compatibility mode device builds and draws every shader of `/webgpu-features/` (measured, C157 software adapter).
