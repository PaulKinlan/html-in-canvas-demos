# Canary crash and stress suite (`/crashes/suite/`)

Measured on 2026-11-24 on macOS (Apple M4 Pro, ANGLE Metal) with `--use-gl=angle --use-angle=metal --ignore-gpu-blocklist --enable-features=CanvasDrawElement --enable-blink-features=CanvasDrawElement,ScopedViewTransitions`.

Browsers compared:
- Earlier baseline recorded in `public/crashes/cases.js` and `FINDINGS.md`: Headless Chromium 157 (2026-11-20/21) and Chrome 159 on Android 10 (2026-11-21).
- Current stable on this machine: `Chrome/158.0.8127.88`.
- Current Canary on this machine: `Chrome/160.0.8180.0`.

## Standalone crash & loss reproductions

| Case | Repro page | Earlier (C157 / A159) | Chrome 158.0.8127.88 | Canary 160.0.8180.0 | Status |
|---|---|---|---|---|---|
| Remove iframe child inside `paint` | `/crashes/repro/iframe-in-paint.html` (B) | Crashed tab (CHECK int3) | **CRASHED** | **SURVIVED** (`done: no crash`) | Fixed in Canary 160 |
| `adoptNode()` of painted drawable canvas into iframe | `/crashes/repro/adopt-painted-canvas.html` (A) | Crashed tab | **CRASHED** (`Inspector.targetCrashed`) | **SURVIVED** (`painted in the frame, no crash`) | Fixed in Canary 160 |
| Multi-canvas WebGL `loseContext()` inside `paint` + remove | `/crashes/repro/lose-context-stress.html` (A) | Crashed on fuller pages | **CRASHED** | **SURVIVED** (`4 lost, 0 restored, no crash`) | Isolated & fixed in Canary 160 |
| Multi-canvas WebGL `loseContext()` + `restoreContext()` | `/crashes/repro/lose-context-stress.html` (B) | Crashed on fuller pages | **CRASHED** (`Inspector.targetCrashed`) | **SURVIVED** (`4 lost, 4 restored, no crash`) | Isolated & fixed in Canary 160 |
| `opacity: 0.02` around drawable canvas in drawn iframe | `/crashes/repro/opacity-in-drawn-iframe.html` (A) | Crashed tab in C157 | **SURVIVED** (2 s of paints) | **SURVIVED** (2 s of paints) | Fixed by Chrome 158 |
| `element.startViewTransition()` on a `drawable` child | `/crashes/repro/view-transition-drawable-child.html` (A) | Crashed renderer | **CRASHED** | **CRASHED** | Still crashes in Canary 160 |
| Iframe playing video inside canvas + repaint + `getImageData()` | `/crashes/repro/video-iframe-readback.html` (A) | Crashed in `/video/` fixture | SURVIVED (6 paints, valid pixels) | SURVIVED (6 paints, valid pixels) | No crash on desktop |
| `SpeechRecognition.available({ processLocally: true })` | `/crashes/repro/speech-available.html` (A) | Crashed headless C157 | SURVIVED (`downloadable`) | SURVIVED (`downloadable`) | Fixed (non-API) |
| Continuous `ctx.rotate()` + `drawElementImage()` | `/crashes/repro/rotated-draw-text-flicker.html` (A vs B) | Dropped text lines on Metal | **DROPS TEXT** (2/60 frames >15% loss, min 1998 vs median 2771; fixed angle 0 drops, min 2781) | **DROPS TEXT** (2/60 frames >15% loss, min 1998 vs median 2771; fixed angle 0 drops, min 2781) | Still present in Canary 160 |
| Animated transparent WebGL 2 + drawable children | `/crashes/repro/white-webgl.html` (A) | Solid white on Android C159 | SURVIVED (182 frames, 0 white/blank) | SURVIVED (181 frames, 0 white/blank) | Needs Android Canary check |
| `willReadFrequently: true` drawable 2D canvas | `/crashes/repro/frequent-read-drawable.html` (A) | Lost all 2D contexts on Android C159 | SURVIVED (no loss on macOS) | SURVIVED (no loss on macOS) | Needs Android Canary check |
| `float16` Display P3 `getImageData()` | `/crashes/repro/float-readback.html` (B) | Lost float16 contexts on Android C159 | SURVIVED (no loss on macOS) | SURVIVED (no loss on macOS) | Needs Android Canary check |

## Engine regression checks (in `/crashes/suite/`)

| Check | C157 baseline | Chrome 158.0.8127.88 | Canary 160.0.8180.0 |
|---|---|---|---|
| `movebefore-same-task` | Threw `InvalidStateError` | **PASS** | **PASS** |
| `clear-geometry-keeps-region` | Kept old hit region | **PASS** | **PASS** |
| `stale-hit-test` | Stale hit at old point | **FAIL** (`oldPoint=STALE BUTTON`) | **FAIL** (`oldPoint=STALE BUTTON`) |
| `source-rect-hit-region` | Clipped to source rect | **FAIL** (`right(130px)=miss`) | **FAIL** (`right(130px)=miss`) |
| `inner-canvas-shifted` | Shifted by minus padding | **FAIL** (blue `#1166dd` at red stripe) | **FAIL** (blue `#1166dd` at red stripe) |
| `snapshot-burst-close` (120 ops) | Baseline | **PASS** (1.5 ms, 0 open) | **PASS** (1.5 ms, 0 open) |
| `webgpu-upload-smoke` | Baseline | **PASS** (5.4 ms) | **PASS** (6.0 ms) |

## Heavy stress benchmarks (2.5 s each, Apple M4 Pro Metal)

| Stress test | Chrome 158.0.8127.88 | Canary 160.0.8180.0 |
|---|---|---|
| `2d-128` (128 live cards + reflow churn) | 60.0 fps, avg paint 0.38 ms, p95 0.50 ms, 0 losses | 60.0 fps, avg paint 0.38 ms, p95 0.50 ms, 0 losses |
| `2d-64-rotate` (64 live cards + continuous rotate) | 60.0 fps, avg paint 0.19 ms, p95 0.30 ms, 0 losses | 60.0 fps, avg paint 0.22 ms, p95 0.30 ms, 0 losses |
| `snapshots-24` (continuous `captureElementImage` + `close`) | 60.0 fps, avg capture 0.01 ms, 24 open, 0 losses | 60.0 fps, avg capture 0.02 ms, 24 open, 0 losses |
| `webgl-16tex-fbo-resize` (16 live textures + mipmaps + FBO + resize) | 60.0 fps, avg upload 0.22 ms, 0 errors, 0 losses | 60.0 fps, avg upload 0.23 ms, 0 errors, 0 losses |
| `webgpu-8tex` (8 live `drawElementImageToTexture` + WGSL) | 60.0 fps, avg upload 0.17 ms, 0 errors, device OK | 60.0 fps, avg upload 0.20 ms, 0 errors, device OK |
| `lifecycle-iframe` (DOM add/remove + live iframe + hit-test) | 60.0 fps, 0 errors, 0 losses | 60.1 fps, 0 errors, 0 losses |

## For the index

- Four renderer crashes from Chrome 158 (`iframe-in-paint` remove, `adoptNode` of a painted canvas, and multi-canvas WebGL `loseContext()` inside `paint` with remove or restore) no longer crash in Chrome Canary 160.0.8180.0 (measured, 2026-11-24).
- `element.startViewTransition()` on a `drawable` child still crashes Chrome Canary 160.0.8180.0 (measured, 2026-11-24).
- `moveBefore()` same-task round-trip and `clearElementGeometry()` both pass in Chrome 158 and Canary 160; stale hit-test cache, source-rect hit clipping, nested padded inner canvas shift and continuous-rotation text drops on Apple Metal still reproduce in Canary 160.0.8180.0 (measured, 2026-11-24).

## Not verified

- Chrome Canary on Android: `willReadFrequently` on a drawable 2D canvas, repeated `getImageData()` in a paint loop (`readback-matrix.html`), `float16` Display P3 readback (`float-readback.html`), and animated transparent WebGL turning solid white (`white-webgl.html`). Run `/crashes/suite/` on an Android phone with Canary and use "Copy Eng report (Markdown)".
