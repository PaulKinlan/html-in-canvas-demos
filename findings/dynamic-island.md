# Dynamic Island metaball capsule (`/dynamic-island/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px mobile and 960 px desktop viewports). All live checks wait for a tap (`<meta name="checks" content="tap">`) and run on isolated fixtures on `testStage()`. Chrome 159 on Android is **not verified** yet.

This experiment places five live `drawable` HTML widgets (`#panel-compact`, `#panel-split`, `#panel-orb`, `#panel-media`, `#panel-timer`) inside one `<canvas content="drawable" layoutsubtree>` backed by a single WebGL 2 context through `ElementGL` (`/lib/element-gl.js`). In `ISLAND_FRAG`, the shader evaluates rounded-box and circle signed distance fields (`sdRoundBox`, `length`), combines them with a C2-continuous cubic smooth minimum `smin(d1, d2, k)` to form the glossy obsidian capsule and directional OLED specular rim, and only then samples uploaded DOM textures (`texElementSubImage2D()`) at 1:1 CSS layout coordinates inside the SDF mask so text, inputs and sliders stay sharp across state morphs and liquid neck stretching.

| Experiment or question | Result | Notes |
|---|---|---|
| `ElementGL` + `texElementSubImage2D()` rendering `smin` obsidian capsule with crisp 1:1 HTML overlay | measured (Chrome 160 Canary, 2026-11-27) | Live check 1 passed on the 240 by 120 fixture (`gl.getError() === 0`, checking swatch, obsidian shell and wallpaper). Canvas stays at `0.97 MP` (`992x977`) and `7.8 MB` live (`0` lost, `0` unasked readbacks, `0` open snapshots). Setting `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` resolved translucent white control washout. |
| Increasing separation splits one connected SDF neck into two isolated black shapes | measured (Chrome 160 Canary, 2026-11-27) | Live check 2 passed on the 260 by 120 fixture at `k = 46` px with a 4 px bridged gap and a 56 px pinched-off gap. |
| Switching island state updates `inert` flags and keeps live buttons clickable (`elementsFromPoint()`) | measured (Chrome 160 Canary, 2026-11-27) | Live check 3 passed on the 260 by 140 fixture using `geometryUnit()` + `updateElementGeometry()`, `OFFSTAGE` parking and `dataset.hitTick` cache clearing. |
| Context loss falls back to plain HTML without calling `loseContext()` | measured (Chrome 160 Canary, 2026-11-27) | Live check 4 passed by dispatching a synthetic cancelable `webglcontextlost` event on an `ElementGL` fixture and checking `plainHost` DOM recovery. |
| Drag-to-pinch orb physics, `touch-action: none` vs `pan-y` scroll, `prefers-reduced-motion: reduce` and 412 px Android feel | not verified | Needs a live run on Chrome 159 for Android at device scale factor 2.625. |

## Things that bit

- Standard CSS gooey filters apply blur and an alpha threshold over the DOM content, which softens glyphs and range thumbs. Splitting the fragment pass into an obsidian `smin(d1, d2, k)` SDF silhouette stage followed by 1:1 CSS-pixel texture sampling inside the capsule mask avoids blurring typography while still clipping incoming and outgoing panels cleanly during morphs.
- Measured in Chrome 160.0.8187.0 canary (`2026-11-27`): `ElementGL` leaves `UNPACK_PREMULTIPLY_ALPHA_WEBGL` at `false`, so `texElementSubImage2D()` uploaded `rgb(255 255 255 / 0.1)` as unpremultiplied `[255, 255, 255, 26]`, turning translucent white controls solid white behind white text. Setting `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at context startup and in `onRestored` produces `[26, 26, 26, 26]` so translucent panels blend cleanly over obsidian.
- Calling `geometryUnit(canvas, el, el.offsetWidth)` for two panels of different widths (`#panel-split` and `#panel-orb`) in the same paint frame causes `surface.js` to miss its single-entry per-canvas cache and re-measure via `getBoundingClientRect()`. Calibrating `cachedUnit` once per canvas resize and sharing that scale factor across active panels avoids layout thrashing during 60 fps spring animations.
- With `#panel-orb` sitting inside `<canvas>`, pointer events on the inner `<button id="orb-trigger">` bubble up to `<canvas>`. Guarding `beginOrbDrag()` against an active drag and checking `e.currentTarget === d.owner` in `moveOrbDrag()` and `endOrbDrag()` stops the canvas listener from stealing pointer capture or double-firing tap mode switches.
- Checking `uPrevGeom` in GLSL ES 3.00: dividing a `vec2` by `max(uPrevGeom, vec2(1.0))` fails shader compilation because `uPrevGeom` is a `vec4`; slicing `uPrevGeom.xy` keeps cross-fade sampling valid.

## Not verified

- Chromium 157 (headless): running all 4 live checks, verifying `npm run check:jank -- /dynamic-island/`, running `node tools/draw-size/audit.mjs /dynamic-island/`, and generating `social.jpg`.
- Chrome 159 on Android (412 px wide, device pixel ratio 2.625): dragging `#panel-orb` vertically and horizontally by touch (`touch-action: none` on the orb, `pan-y` on the stage), typing in `#media-track`, scrubbing `#media-scrub`, tapping timer/call controls, spring frame rate, canvas memory under 4 MP (about 0.96 MP at 378 by 372 CSS px) and real WebGL context loss/restore.
- Chromium 153: 5-argument 2D `drawElementImage()` fallback when `texElementSubImage2D()` is absent.

## Open ideas

- Add a WebGPU (`GPUQueue.drawElementImageToTexture()`) route through `/shared/backend.js` and WGSL shader parity to compare necking throughput against WebGL 2 `ElementGL`.
- Split the media album art and timer readout into independent `drawable` children so each sub-element can spring slightly out of phase during transitions without re-uploading the whole widget.

## For the index

- Motion and shaders: a single `ElementGL` canvas can evaluate a cubic `smin(d1, d2, k)` Dynamic Island metaball and OLED specular rim before sampling crisp 1:1 `texElementSubImage2D()` DOM panels inside the mask, letting a draggable satellite orb pinch off without blurring live inputs or sliders (not verified, `/dynamic-island/`).
- Hit testing: calibrating `geometryUnit()` once per canvas resize and sharing that unit across multiple `drawable` children avoids cache misses when positioning both a primary capsule and a dragged orb in the same frame (not verified, `/dynamic-island/`).
