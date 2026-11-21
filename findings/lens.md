# Lens pipeline (`/lens/`, `lib/lens-gl.js`)

Paul found the fisheye "super slow" on his phone. It was a polar mesh of clipped triangles, one `drawElementImage()` per triangle: 60 to 70 draws a frame while moving (sized to a 14ms budget) and 199 at rest, on top of a full-canvas redraw for every pointer move.

Every lens is now the same four steps: draw the square of page under the lens once, clipped, at the lens's magnification, into a patch of the element's own canvas; copy the patch to a texture on one shared WebGL context; run the lens's fragment shader; `drawImage()` the result back and repaint only the patch and the old lens position with the page at rest. Two paint-record replays, two copies and one shader pass per frame, whatever the lens does.

Measured in headless Chromium 157 as a phone (412px wide, `--force-device-scale-factor=2.625`, `viewport: null`, CPU 4× slower, lens radius 80, zoom 3, lens swept across the card). The test machine has no GPU, so rasterization, the copies and the shader all run in software; a real phone GPU should do relatively better on the new route, and only a phone can say by how much. The page has a "Measure on this device" button for that.

| Route | ms per frame | worst 5% | draws per frame |
|---|---|---|---|
| Fisheye, old mesh | 254 | 567 | 63 moving, 199 at rest |
| Fisheye, shader, full-size patch every frame | 115 | 167 | 2 |
| Fisheye, shader, patch sized to the frame rate | 32 | 50 | 2 |
| Magnifier, old (full canvas redraw) | 62 | 83 | 2 |
| Magnifier, shader route (redraws the lens's neighbourhood only) | 26 | 33 | 2 |
| Real glass (three ray traces per pixel) | 38 | 50 | 2 |
| Black hole | 35 | 50 | 2 |

Without CPU throttling the same sweep runs at 59 frames a second for the shader fisheye and 16 for the mesh.

| Experiment | Result | Why |
|---|---|---|
| Keep text sharp through a shader | works | The patch is rasterized at the lens's zoom by `drawElementImage()`, so the shader samples real pixels: 0.17 soft pixels per ink pixel against 3.86 for a stretched bitmap at zoom 6. The lens is drawn on whole device pixels and the patch has an even size, so at 1:1 texels land on pixels. |
| Use the element's own canvas as scratch space | works | An element image only draws into its own canvas, so the patch borrows a square near the lens and is painted over in the same task. Nothing in between is ever presented. |
| Copy a sub-rectangle of a 2D canvas into a texture | works | `texImage2D(target, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, canvas)` with `UNPACK_SKIP_PIXELS` / `UNPACK_SKIP_ROWS`. Same speed here as going through a small 2D canvas first (`copy="scratch"`); the speed test runs both because a phone may differ. |
| One WebGL context for every lens on the page | works | Shaders are compiled on first use and the canvas only grows. A lens that just animates (ripples, the black hole's glow) reuses the texture if it was the last to upload. |
| Cost per frame | scales with patch pixels | A fisheye at zoom 3 needs a patch three times the lens's width for a sharp centre: 1262px for an 80px lens at 2.625×. In software that was 70ms of the frame; mipmaps were only 9ms of it. |
| Draw the patch smaller while the lens moves | works | The element times its own frames. Over 26ms it steps the patch down (1.5×, 1×, 0.6× the lens size) and redraws at full size 140ms after the lens stops. A run of fast frames steps it back up, and each relapse doubles the run needed. |
| A physically modelled magnifying glass | works | A biconvex lens of two spherical caps, ray traced per pixel with Snell's law at both faces, once per colour channel with indices 1.508, 1.520 and 1.534. Edge distortion is real spherical aberration; the zoom slider solves for the lens's height above the page from a paraxial ray. |
| Gravitational lens | works | The point-mass lens equation β = θ − θE²/θ. Negative β samples the far side, which gives the second image inside the Einstein ring for free. |
| A lens that burns the page's own letters (the fiery eye) | works | Driven by the sampled page, not painted over it: ink is found from luminance, the page is pushed outward from the eye and stretched towards the rim, each glyph throws a flame (six samples back towards the centre), ink goes from soot to ember to white hot and crumbles against a noise threshold, and the lens ends in a ragged, glowing burn edge with sparks. The element passes the shader an eased direction (travel, or the pointer when pinned) for the pupil. Still two draws. |
| WebGPU route for the lenses | works, picked automatically | All 15 lenses are also written in WGSL (`lib/lens-gpu.js`). `queue.copyExternalImageToTexture({ source: canvas2d, origin }, …)` takes the patch straight out of the 2D canvas, a blit pipeline builds six mip levels, one render pass draws the lens into a shared WebGPU canvas and `drawImage()` copies it back. Compared with WebGL by reading the texture back: mean difference under 3 levels of 255 for every lens. |
| `drawElementImageToTexture()` for the lens | not used | It draws the element at its own size. The lens needs the patch re-rasterized at the lens's zoom, which only the 2D context's transform gives, so both GPU routes start from the 2D patch. |
| Choosing WebGPU safely | works | `shared/backend.js`: needs an adapter that is not a software one, then a self-test (clear a WebGPU canvas, `drawImage()` it to 2D, read the pixel). The headless test browser has no adapter by default and only SwiftShader with flags, so it always falls to WebGL; a dying WebGPU device takes WebGL contexts with it, which is why the test is strict. |
| X-ray overlay without `ctx.filter` | works | `difference`, `color` and a dim fill on the patch replace `grayscale() invert() sepia() hue-rotate()`; the element boxes are drawn onto the patch before the shader. |
| `getImageData()` on the demo's canvas from a check | avoided | A full-canvas readback can move a 2D canvas off the GPU, which would turn both copies into readbacks. The "still drawn" check reads a 160px copy instead. |

Not verified here: frame times on a real phone GPU, and whether Chrome on Android keeps the canvas-to-texture copy on the GPU for a sub-rectangle. The WebGPU route has only been checked by texture readback on a software adapter: presenting it on screen, and its speed against WebGL, need a real device (the speed test on the page times both).
