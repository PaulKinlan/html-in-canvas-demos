# 3D portal test chamber with live HTML consoles and FBO sightlines (`/portal-room/`)

Built on 2026-11-22. Source checked locally with `npm run check:gfx` and `node tools/writing/check.mjs --strict`. All 6 live checks passed in headless `Chrome/160.0.8177.0` with 0 console errors; interactive DPR=2 clicks on `#chamber-console` (`#con-swap`, `#con-launch`, `#con-code`) verified after switching from `Shoot Blue portal` back to `Orbit / Interact` and via `Console close-up`. Chrome for Android (A159) and `check:jank` are **not verified** yet.

The question: can a single WebGL 2 canvas render a 3D test chamber with live interactive HTML control panels and a live-HTML Companion Cube, shoot Blue and Orange portals onto walls, render a real secondary-camera portal view into an FBO so you see the live HTML console through the portal, and launch the cube from Blue out of Orange?

Prior art credited on the page: Valve's *Portal* (2007) for the portal-camera render-to-texture concept and test chamber aesthetic, plus `/three-form/` (projective `updateElementGeometry()` hit testing on 3D quads) and `/portal-split/` on this site.

| Experiment | Status | Notes |
|---|---|---|
| Single `ElementGL` WebGL 2 context uploading three live `drawable` HTML children (`#chamber-console`, `#chamber-sign`, `#cube-face`) | measured (Chrome/160.0.8177.0, 2026-11-22) | Live check 1 verified multi-element upload (`80×80` blue and orange panels) on one `ElementGL` context; all three chamber elements upload cleanly with mipmaps on `paint`. |
| Secondary-camera portal render into dual 512×512 colour+depth FBOs on `stage.gl` | measured (Chrome/160.0.8177.0, 2026-11-22) | Live check 2 verified `128×128` FBO round-trip pixels (`rgba(236,94,154,255)`); live check 3 verified `det=1.000` and `NDC error=4.7e-8`. Skipping the exit portal in its own FBO pass and using `DEPTH_COMPONENT24` eliminated exit-plane occlusion and z-fighting. |
| Projective 3D `updateElementGeometry()` hit testing scaled with `geometryUnit()` + `dataset.hitTick` | measured (Chrome/160.0.8177.0, 2026-11-22) | Live check 4 hit button at `(120.0, 75.0)` CSS px; DPR=1 and DPR=2 real mouse clicks hit `#con-swap`, `#con-launch` and `#con-code`. Switching to `Console close-up` now auto-returns to `Orbit / Interact`, `setMode()` toggles `inert` and clears cached geometry keys, `cachedGeometryUnit()` invalidates `consoleEl`'s cached key after probing, and `#cube-face` is parked off-stage. |
| Parabolic Companion Cube launch from Blue Portal out of Orange Portal | Not verified in Chromium yet | Clicking the cube, the wall console button or the toolbar Launch button arcs the cube into Blue, increments `#sign-count` and `#cube-count` at portal transit (raising `paint`), flashes both portals and arcs the cube out of Orange back onto the floor pad. Live check 5 steps the trajectory and verifies DOM counter mutation raises `paint`. |
| Wall-shooting portal placement and layout presets (`Look at console through Blue`, `Opposite walls`, `Floor drop`) | Not verified in Chromium yet | Raycasts clicks against all six chamber planes in Shoot Blue / Shoot Orange mode, clamps the ellipse inside wall margins and animates a scale-open pop; `Portal view (FBO)` checkbox toggles live FBO sightlines against opaque energy vortices. |
| 2D 5-argument `drawElementImage()` fallback and plain HTML rescue on context loss | Not verified in Chromium yet | Falls back to a 2D room schematic with 5-argument `drawElementImage()` calls when WebGL 2 `texElementSubImage2D()` is absent, and moves `#chamber-console`, `#chamber-sign` and `#cube-face` into `.plain-host` when HTML-in-canvas is missing or WebGL context stays lost. Live check 6 verifies 5-arg 2D fallback and `window.__gfx?.retire()` cleanup. |

## Things that bit

- A naive portal reflection across the exit plane has determinant -1, which flips HTML console text backwards when read through the portal. Using a 180-degree rotation around the portal's local up axis (`R_180 = diag(-1, 1, -1, 1)`) keeps determinant +1 so text on `#chamber-console` stays readable through Blue Portal.
- Binding an FBO's colour texture as a sampler while rendering into that same FBO triggers a WebGL 2 feedback loop warning and undefined reads. Drawing portals as opaque energy vortices inside the FBO pass (`drawPortalsAsVortex = true`) and unbinding `TEXTURE_2D` before switching framebuffers keeps every draw clean.
- Calling `geometryUnit()` separately for `#chamber-console` (360 px) and `#chamber-sign` (260 px) on every frame would miss `surface.js`'s `WeakMap` cache (keyed by canvas plus element width) and force `getBoundingClientRect()` layout reads per frame. Caching `geometryUnit()` per canvas size and reusing the factor for both panels avoids layout thrashing while preserving HiDPI hit-box scaling.

## Not verified

- Headless Chromium 157 (`npm run check:jank -- /portal-room/` and `node tools/draw-size/audit.mjs /portal-room/`): run both to confirm zero layout shift, zero timed readbacks, backing-store sizing under 4 MP at 412 px and DPR 2.625, and live check results.
- Chrome 159 on Android at 412 px wide by touch: orbiting the chamber, tapping the right-wall `#chamber-console` buttons, `<select>` and `<input>` in `Console close-up` and `Portal sightline` views, shooting Blue and Orange portals onto walls and floor, and verifying FBO sightlines update live when typing into `#con-code`.
- Frame rate and visual alignment of the 512×512 FBO portal texture across different aspect ratios (16:10 desktop vs 4:5 phone) on real GPU hardware.

## For the index

- WebGL and 3D: `/portal-room/` renders an Aperture-inspired 3D test chamber on one `ElementGL` WebGL 2 context with three live `drawable` HTML elements (wall console, lightbox sign and Companion Cube face), dual 512×512 secondary-camera FBO portal sightlines, projective `updateElementGeometry()` hit testing scaled by `geometryUnit()` and wall-shootable Blue/Orange portals.
