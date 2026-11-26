# Submerged page (`/submerged/`)

Not verified in a live browser yet (written 2026-11-26). All live checks wait for a tap (`<meta name="checks" content="tap">`) and run on isolated fixtures in the visitor's browser.

This experiment puts a live interactive HTML tide-station form (`#sub-card`) beneath a real-time 2D shallow-water heightfield in one WebGL 2 canvas managed by `ElementGL` (`/lib/element-gl.js`). A 128 by 128 damped wave PDE runs on CPU `Float32Array` buffers and uploads height, `dh/dx`, `dh/dy` and curvature into one 64 KB `RGBA8` texture via `gl.texSubImage2D()`. The fragment shader splits dry HTML from submerged water along an undulating shoreline meniscus, applies Snell's-law refraction (`n = 1.333`) with slight RGB dispersion, projects `1 / det(J)` Jacobian optical caustics directly over the live DOM text and controls, and adds Fresnel sky reflection and directional specular glints.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` canvas uploading `#sub-card` via `texElementSubImage2D()` and splitting dry from submerged pixels | not verified | Checked by live check 1 on a 200 by 120 fixture (`preserveDrawingBuffer: true` + `readPixels()` in the dry top half and submerged bottom half). |
| 2D shallow-water PDE energy propagation and damping stability | not verified | Checked by live check 2 on a 64 by 64 `WaterField`: checks zero initial energy, outward ring propagation after 18 steps, and damping below 15% of peak energy within 240 steps. |
| `updateElementGeometry()` keeping underwater buttons clickable (`elementsFromPoint()` and click handler) | not verified | Checked by live check 3 on a 220 by 120 fixture, both at identity transform and with a +16 px refraction offset plus `dataset.hitTick` toggle. |
| Zero `openSnapshots` and zero per-frame GPU readback | not verified | Checked by live check 4 against `window.__gfx.snapshots` and `window.__gfx.reads` after three animation frames. |
| Legibility, caustic clarity, frame rate and `touch-action: pan-y` scrolling on a 412 px phone | not verified | Needs a live run on Chrome 159 on Android and headless Chromium 157. |

## Things that bit

- Running the 128 by 128 shallow-water PDE on CPU typed arrays and uploading one `RGBA8` texture avoids `EXT_color_buffer_float` / half-float framebuffer failures on mobile GPUs, keeps `ElementGL` on a single WebGL 2 context, and lets the refraction hit-test offset read exact surface gradients without calling `readPixels()`.
- Aspect-ratio distortion turns circular splashes into ellipses on wide desktop canvases or tall phone canvases unless the 2D Laplacian weights scale with `(cssW / cssH)^2`. Normalising `sx + sy = 1` with `c2 = 0.36` keeps ripples circular in CSS pixels and guarantees CFL stability for any stage aspect ratio.
- `updateElementGeometry()` takes a single `DOMMatrix` per drawable element. Shifting the form's hit box by the negative Snell UV offset matches the visually refracted position under the pointer (`u_dom = vUv + off`, so visual screen shift is `-off * size`), yet one matrix cannot warp hit boxes non-linearly across several controls at the same time.
- Setting `cardDirty = true` on `focusin` and `focusout` alongside form input events makes sure focus outlines inside the submerged card re-upload immediately even when a browser build omits focus-only repaints from `changedElements`.

## Not verified

- Chromium 157 (headless): running all 4 live checks, verifying `npm run check:jank -- /submerged/` and `node tools/draw-size/audit.mjs /submerged/`, and capturing `social.jpg`.
- Chrome 159 on Android (412 px wide, device pixel ratio 2.625): vertical touch scrolling (`touch-action: pan-y`) over the submerged stage, tapping submerged buttons, dragging submerged range sliders, typing in the log input, real frame rate, canvas memory under 4 MP (about 1.44 MP at 380 by 550 CSS px), and recovery after a WebGL context loss.
- Chromium 153: 2D `drawElementImage()` fallback when WebGL `texElementSubImage2D()` is absent.

## Open ideas

- Split each interactive control inside the tide-station card into its own drawable child so `updateElementGeometry()` can shift every button and slider independently by its own local Snell refraction vector.
- Add a WebGPU compute-shader PDE route via `/shared/backend.js` alongside the CPU + `ElementGL` WebGL 2 route so visitors can compare wave resolution and frame time.

## For the index

- Motion and shaders: a single `ElementGL` canvas can combine `texElementSubImage2D()` with a real-time 128 by 128 shallow-water PDE texture (`RGBA8`) for Snell refraction, `1 / det(J)` Jacobian optical caustics and an undulating shoreline meniscus over a live interactive HTML form with zero per-frame readback (not verified, `/submerged/`).
- Hit testing: `updateElementGeometry()` can track the local Snell refraction displacement under the pointer for one drawable element using a CPU heightfield, but per-pixel non-linear wave warping across multiple controls simultaneously requires separate drawable elements (not verified, `/submerged/`).
