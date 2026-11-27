# Capillary ink-bleed scene dissolve (`/ink-bleed/`)

Status on 2026-11-27: measured in headless Chrome 160 (`160.0.8188.0` canary at `412x915`, `2.625` DPR) and static checks passed; `npm run check:jank` (C157) and real Chrome 159 on Android (A159) are not verified yet.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` WebGL 2 context uploading `#ib-scene-a` and `#ib-scene-b` via `texElementSubImage2D()` with `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` | measured (C160, 2026-11-27) | Live check 1 passed: `glErr=0`, `texA=630x368`, `texB=630x368`, `tMs` envelope `t450=0.58`, `t1350=1.00`, `reducedSnap=1`. |
| Tap origin `(ox, oy)` shifts the revealed capillary pool across opposite sides | measured (C160, 2026-11-27) | Live check 2 passed at `progress=0.35`: `origin(0.14)` gave cyan B on left `[12,152,184]` and cream A on right `[248,242,228]`; `origin(0.86)` flipped both flanks. |
| Wet capillary pigment rim reads darker than both Cream Paper A and Midnight Obsidian B | measured (C160, 2026-11-27) | Live check 3 passed at `progress=0.45`: Scene A `lum=242.2`, Scene B `lum=35.0`, advancing wet rim dipped to `lum=9.9` at `x=152 px`. |
| Live DOM clicks and text inputs work at `0%` (Scene A) and `100%` (Scene B) | measured (C160, 2026-11-27) | Live check 4 passed: `elementsFromPoint()` and `.click()` hit `#fx-a-btn` and `#fx-a-input` at `0%` and `#fx-b-btn` at `100%` (`clicks=1` each), plus live stage clicks on `#ib-a-stamp`, `#ib-a-bookmark`, `#ib-b-drop`, `#ib-b-grid`. |
| Synthetic `webglcontextlost`/`webglcontextrestored` rescue and 5-argument 2D radial fallback | measured (C160, 2026-11-27) | Live check 5 passed: `glRescue=true (err=0)` and 2D 5-arg radial pool `[12,152,184]` outside `[248,242,228]` at `2.63x`; `?route=2d` ran with `0` wrong-size draws (`1.16 MP`). |
| Stage stability, layout fit and graphics memory at `412x915`, `2.625` DPR | measured (C160, 2026-11-27) | `scrollWidth === 412 === innerWidth`, `0` console/page errors, `active=1`, `peak=2`, `lost=0`, `openSnapshots=0`, `unasked=0`, `removed=0`, `9.29 MB` total canvas memory. |

## Things that bit

- Reversing a transition from Scene B back to Scene A (`B -> A`) by only scrubbing `progress` from `1` down to `0` collapses Scene B inward towards the tap origin like a closing iris instead of pouring Scene A outward. Swapping `srcTex` and `dstTex` inside the shader via `uInvert` keeps `0%` bound to Scene A and `100%` bound to Scene B while letting pours in either direction spread outward from `(ox, oy)`.
- On a near-black Scene B background, a dark wet rim blends invisibly into the backdrop. Choosing a deep navy-obsidian studio base (`#111b2b`) with a sumi-indigo pigment crest (`vec3(0.008, 0.012, 0.020)`) keeps the advancing rim measurably darker than both scenes (`lum=9.9` vs `35.0` and `242.2`).
- Tapping open paper or slate to pour ink must not trigger browser text selection over labels while still letting visitors select and type inside `<input>` fields. Cancelling `selectstart` outside `input, textarea` and setting `user-select: none` on the stage with `user-select: text` on inputs keeps label drags clean (`copyPrevented=true`, `inputPrevented=false`).

## Not verified

- `npm run check:jank -- /ink-bleed/` in headless Chromium 157 (`412x915`, `2.625` DPR, 4x CPU throttle).
- Real Chrome 159 on Android phone hardware: real GPU FBM frame pacing, touch `pan-y` scrolling over the canvas vs tap-to-pour, and soft keyboard behaviour on `#ib-a-note` and `#ib-b-title`.
- `LEARN.mount()` rendering the `.motion-warn` reduced-motion banner once `npm run build` adds `/ink-bleed/` to `public/shared/pages.js`.

## For the index

- `texElementSubImage2D()`: one `ElementGL` WebGL 2 canvas uploads two contrasting live HTML scenes (`#ib-scene-a` cream notebook and `#ib-scene-b` midnight studio) and dissolves between them from any tapped origin via domain-warped FBM paper permeability, DOM luminance edge wicking and a wet sumi pigment rim (measured, C160, 2026-11-27, `/ink-bleed/`).
- `updateElementGeometry()`: toggles `inert`, `pointer-events` and `data-hit-tick` alongside `geometryUnit()`-calibrated `updateElementGeometry()` transforms so live `<input>` and `<button>` controls stay clickable on Scene A at `0%` and Scene B at `100%` (measured, C160, 2026-11-27, `/ink-bleed/`).
