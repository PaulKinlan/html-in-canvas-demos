# Plan

The goals of this project, the strands of work and their status, every open idea with its source, and what is still unverified because it needs real hardware. Status is as of 2026-11-22 (evening UTC), after the pre-launch pass, homepage restructure, three.js WebGPU HiDPI fix, and the four follow-up Chrome APIs demos. Results are in [FINDINGS.md](FINDINGS.md). How the code is organised is in [ARCHITECTURE.md](ARCHITECTURE.md).

This file has one writer at a time. A pull request that adds or changes a page does not edit it: the page's open ideas and unverified items go in its file in [findings/](findings/), and a planning pass copies them here. The reason is in [ARCHITECTURE.md](ARCHITECTURE.md), "Files that parallel branches share".

## Contents

- [Goals](#goals)
- [How the work is run](#how-the-work-is-run)
- [Strands and status](#strands-and-status)
- [Pull requests](#pull-requests)
- [Planned demos from the Chrome APIs plan](#planned-demos-from-the-chrome-apis-plan)
- [Open ideas by strand](#open-ideas-by-strand)
- [Ideas from the element catalogue](#ideas-from-the-element-catalogue)
- [Backlog](#backlog)
- [Site-wide work that is open](#site-wide-work-that-is-open)
- [Not verified: needs real hardware or a person](#not-verified-needs-real-hardware-or-a-person)
- [Reports to make upstream](#reports-to-make-upstream)

## Goals

The goals below are Paul Kinlan's, quoted or summarised from the project chat with the date he said them.

1. **A playground for the HTML-in-canvas API** (2026-11-20). The repository is a place to push the limits of the API and try new UI primitives. It is not one demo. His opening brief named slots in a canvas first ("the slot element allows us to reproject DOM inside"), then OffscreenCanvas, reprojecting parts of one DOM into another page or tab, and cross-origin sharing with `postMessage` and transferables.
2. **Explore widely** (2026-11-20). "I want to explore many different types of things we could do with html in canvas and I want you to riff with on it. Start with more ideas. Use your imagination." When given sixteen ideas in five groups he answered "Let's do all of them."
3. **Named areas** (2026-11-20): three.js, WebGL and WebGPU integration; cross-origin reprojection; how accessibility holds up; new application primitives; a drop-in custom element or simple API that any developer could install. He asked that the `<canvas-slot>` element be kept as it is and extended compatibly.
4. **A learning resource and a source of ideas** (2026-11-20). Every demo shows its code: "I need this to be very clear what to do."
5. **Experiments, not lessons** (2026-11-20). "There's a lot of this where I want to push the capabilities and new experiments. Slots, canvas slot, dom-portal are not really learning paths, they are me wanting to experiment with the boundaries of what is possible or not." Only `/start/` is a tutorial. Experiments come first on the homepage and in the menu.
6. **Plain technical writing** (2026-11-20). He objected to the heading "One element, two places" as generated-sounding. Rules are in [DESIGN.md](DESIGN.md).
7. **WebGPU when available** (2026-11-20), with WebGL and then 2D behind it.
8. **It must work on his phone.** He tests every page on Chrome 159 on an Android phone and reports what breaks.
9. **Effects that are dynamic and visually strong** (2026-11-21). He found `/player-parts/` underwhelming because it showed placement of the controls, and asked for effects where the parts act on each other. On the first fiery-eye lens he said it was "not a very good lens": he wanted the page's own letters to burn. An effect should transform the page content, not paint decoration over it.
10. **New strands on 2026-11-21**: a customisable select, a catalogue of every HTML element, research on native UI frameworks (Qt, Flutter and others), video and media, text selection effects, and a survey of the last 20 to 30 Chrome releases for features to combine with the API ("comprehensive and expressive and out there ideas"), followed by building the planned demos.
11. **The repository holds what was learned** (2026-11-21), so other tools can work from it. That request produced this file and its siblings.

## How the work is run

- Build the test even when it is expected to fail. Let it fail visibly, record the finding, then try the alternatives one after another. Try every transport or route, not only the first one that works.
- Do not ask clarifying questions. Make a sensible choice, say which one was made, and carry on.
- When there is a plan, carry it out. Do not hand back a list of decisions.
- Each strand has its own long-running thread and ships small pull requests. Pull requests are merged quickly, often within seconds of opening.
- Ideas are wanted from whoever is doing the work, in addition to the ideas listed here.

## Strands and status

| Strand | Pages | Libraries | Pull requests | Status |
|---|---|---|---|---|
| Slots | `/slot/`, `/slot-bare/`, `/slot-bare/plain.html` | `canvas-slot.js`, `light-slots.js` | #1, #2, #5, #23, #30, #31 | Done. The mount-point pattern from the ExtensibleWebApps repository was studied and added (`/slot/mount.html`). |
| Workers, tabs, origins | `/offscreen/`, `/cross-tab/`, `/cross-origin/`, `/transports/`, `/transports-2/` | `slot-share.js`, `broker.js`, `freeze-log.js` | #1, #2, #3, #18, #54 | Done. 49 transport routes tested in the first lab. Demo 18 (newer routes) is built as `/transports-2/`. Element Capture, a frozen tab and WebTransport against a real server are not verified. |
| Cross-context | `/tear-off/`, `/remote/`, `/embed/`, `/support/`, `/slot-view/`, `/pip/`, `/iframe-tiles/` | `live-*.js`, `slot-view.js`, `slot-provider.js`, `element-pip.js`, `src/cross-context.js` | #9, #15, #26, #35, #54 | Built. Not verified between two real networks or with a real cross-site pair. Demo 22 is built as `/iframe-tiles/`. |
| UI primitives | `/portal/`, `/lens/`, `/shader-css/`, `/slot-effects/`, `/physical/`, `/component-kit/`, `/view-source/`, `/view-dom/`, `/conveyor/`, `/canvas-skin/`, `/liquid-glass/`, `/retro-display/`, `/node-graph/`, `/dom-pinball/` | `surface.js`, `dom-portal.js`, `dom-lens.js`, `lens-gl.js`, `lens-gpu.js`, `shader-fx.js`, `effects.js`, `slot-effects.js`, `physical-ui.js`, `fx.js`, `page-peel.js`, `canvas-skin.js`, `canvas-skin-themes*.js`, `canvas-skin-draw.js`, `glass-gl.js` | #6, #12, #17, #19, #28, #32, #33, #42, #44, #53, #122, #127, #128 | Built. Five pages still gate their checks behind a tap. Demo 21 is built as `/component-kit/`. `/canvas-skin/` wraps each element in its own drawable 2D canvas and has 29 skins; the owner called the change of skin "a lot faster" on the phone after the frame budget (2026-11-22), and what could still be improved is under "Per-element themes" below. `/view-source/`, `/view-dom/` and `/conveyor/` are not verified on the phone. Added 2026-11-22: `/liquid-glass/`, `/retro-display/`, `/node-graph/` and `/dom-pinball/`. |
| Form controls | `/select/`, `/datalist/`, `/inputs/`, `/select-ideas/`, `/input-ideas/`, `/instruments/`, `/form-state/`, `/form-scenes/`, `/select-selection/`, `/field-heads/` | `select-picker.js`, `placed-popover.js`, `datalist-picker.js`, `input-pickers.js`, `select-ideas.js`, `input-ideas.js`, `select-selection.js` | #45, #69, #72, #86, #90, #112, #123 | Built, including backlog groups 1, 7, 8, 12, 13 and 24 and five ideas of group 28 (`/field-heads/`). The first version of `/instruments/` lost its 2D canvases on the phone. Touch `:active` on a drawn button and the native pickers are not verified on the phone. |
| Transitions and motion | `/transitions/`, `/view-transitions/`, `/scoped-transitions/`, `/time-scrubber/`, `/particles/`, `/motion-capture/`, `/origami-ticket/`, `/page-book/` | `live-transition.js`, `dom-rewind.js`, `glyph-field.js`, `element-gl.js` | #4, #8, #10, #20, #27, #43, #70, #85, #87, #109 | Built. `/scoped-transitions/` builds backlog group 10 (five view transition experiments) and `/motion-capture/` builds group 25 (rewind history to a video encoder, two pointers on moving pieces). Its 2D canvas of experiment 2 was reported white on the phone; the cause is not known. Added 2026-11-22: `/origami-ticket/` and `/page-book/`. |
| WebGPU across the shader pages | the six shader pages, `/lens/` and `/webgpu-features/` | `shared/backend.js`, `shared/route-switch.js`, `gpu-util.js` | #33, #37, #42, #60, #74 | Built. Confirmed on screen on the phone for `/shader-css/` and `/webgpu-features/`. On `/webgpu-features/` the phone passed 10 of 10 live checks, including `dual-source-blending` and `primitive-index`, which the software adapter cannot compile. |
| 3D and spatial | `/three-form/`, `/board/`, `/xr/`, `/xr-room/`, `/webgl-chart/`, `/relief-map/`, `/pack-3d/` | `html3d.js`, `check-fixture.js`, `xr-room.js` | #11, #21, #25, #59 | Built. three `WebGPURenderer` HiDPI cropping fixed on 2026-11-22; a real headset and Android AR are not verified. Demo 24 is built as `/xr-room/` with a simulated room and a headset emulator. Added 2026-11-22: `/webgl-chart/`, `/relief-map/` and `/pack-3d/`. |
| Native UI toolkits | `/native-ui/`, `/wasm-ui/`, `/imgui-dom/`, `/flutter-dom/`, `/qt-widgets-dom/`, `/godot-dom/`, `/toolkit-aria/`, `/qt-textfield/`, `/toolkit-occlusion/` | `native/egui-dom/`, `native/qt-dom/`, `docs/native-frameworks.md` | #47, #55, #71, #114 | Built for egui, Qt Quick, Dear ImGui, Flutter web, Qt Widgets and Godot 4, with an accessibility tree for the ImGui app (backlog group 11), a Qt Quick text field backed by an `<input>` and four occlusion routes (group 27). None has been tried on a phone or with a screen reader. |
| Devices | `/fold/`, `/hardware-out/`, `/window-chrome/` | `fold-view.js`, `device-out.js` | #57 | Built with simulated devices (demos 23, 25 and 27 of the Chrome APIs plan). No real foldable, peripheral or installed app window has been tried. |
| Video and sound | `/video/`, `/overlay/`, `/audio/`, `/player-parts/`, `/player-fx/`, `/gpu-video/`, `/worker-compositor/`, `/presenter/`, `/telestrator/`, `/video-text/`, `/captions/`, `/timed-comments/`, `/live-captions/`, `/speak-words/`, `/cassette/`, `/media-tiles/`, `/animated-images/`, `/video-lab/`, `/media-state/`, `/modular-synth/` | `video-export.js`, `webm-mux.js`, `cue-layer.js` | #46, #51, #77, #78, #99, #107, #113, #115 | Built, including backlog groups 5, 6, 15, 22 and 23, plus `/modular-synth/` (2026-11-22). Lottie (part of 22.6) is not built. Casting to a real device is not verified. Hardware decoding, sound, `importExternalTexture()` on a real GPU, a real camera, speech recognition and speech synthesis are not verified. |
| Accessibility, capture, performance | `/a11y/`, `/capture/`, `/perf/`, `/protected/` | `a11y-audit.js`, `element-capture.js`, `device-tier.js`, `tools/protected/` | #7, #13, #14, #16, #22, #24, #56 | Built. By-hand results (screen reader, IME, flicker, frame rates) are still wanted. Demos 10, 17 and 20 are built as `/protected/`, the latency buttons on `/perf/` and section C of `/capture/`. |
| Pages that hold still | every page | `tools/jank/`, `shared/support.js`, `shared/nav.js` | #29 and the per-page fixes #23 to #28 | Done. All pages hold still on load. Gated pages carry `<meta name="checks" content="tap">`. |
| Show the code | every page | `shared/show-code.js`, `shared/source-view.js` | #30, #34 | Done. The two listing components could be unified. |
| Learning resource | `/start/`, `/about/`, homepage, `shared/learn.js`, `/use-it/` | | #36, #38, #39, #40, #41, #105, #106, #129 | Done. `/use-it/` holds the smallest working markup for nine drop-in elements (backlog 30.2). On 2026-11-22 the homepage was restructured into 31 visual examples, a drop-in libraries section, and 14 focused experiment groups (all open by default) with a searchable collapsible menu bar, plus `/about/` telling the `<slot>` origin story. |
| Element catalogue | `/elements/`, `/element-ideas/`, `/sort-table/`, `/accordion/`, `/minimap/`, `/heat-map/`, `/tab-fan/`, `ELEMENTS.md`, `/list-table/`, `/structure-depth/`, `/top-layer/`, `/paint-clocks/`, `/nested-frames/`, `/play/`, `/text-marks/`, `/table-data/`, `/block-play/`, `/odd-elements/`, `/field-heads/`, `/blocked/` | `tools/elements/`, `tools/element-ideas/`, `stage-2d.js`, `effect-frame.js` | #48, #76, #89, #91, #95, #97, #100, #101, #102, #104, #115, #117, #118, #119, #120, #121, #123 | Built. Of 121 ideas, 17 are built on `/element-ideas/` and the rest of the built ones as pages of their own (backlog groups 1 to 4, 6, 12 to 21 and 28). `/blocked/` tests the six blocked ideas of group 29 beside the routes that replace them. The inner canvases of `/nested-frames/` were reported empty on the phone on 2026-11-21 and reported drawing on 2026-11-22; the cause was not found. `ELEMENTS.md` marks only the 17, because its `built` field is an anchor on `/element-ideas/`. |
| Text selection | `/selection/`, `/caret/`, `/selection-peers/`, `/selection-glyphs/`, `/redact/`, `/selection-heat/`, `/share-card/` | `selection-fx.js`, `selection-tools.js` | #49, #52, #73 | Built, including backlog group 9. Demo 9 (carets and highlights) landed in #52 as `/caret/`. Touch selection is not verified. |
| Chrome APIs plan | `/chrome-apis/`, `/chrome-apis/probes.html`, `/chrome-apis/plan.md`, `/stream/`, `/carousel/`, `/patch/`, `/popovers/`, `/hdr-glow/`, `/css-uniforms/`, `/plan-followups/`, `/linear-color/`, `/scroll-directions/`, `/sanitized-stream/`, `/webgpu-immediates/` | `tools/chrome-apis/`, `element-gl.js`, `css-uniforms.js` | #50, #67, #75, #82, #96, #108, #124, #126 | Plan written, 27 probes recorded. All 33 planned demos are built (including the four gap-closing demos added 2026-11-22: `/linear-color/`, `/scroll-directions/`, `/sanitized-stream/` and `/webgpu-immediates/`), and the five follow-ups of backlog group 26 are on `/plan-followups/`. On the phone the labels of its float buffer route were reported readable (2026-11-22). Demos 1, 2, 3 and 29 came in #50, and demos 4 and 5 in #67 as `/hdr-glow/` and `/css-uniforms/`. #75, #82 and #96 changed `/hdr-glow/` after its float16 contexts were lost on the phone: a float `getImageData()` is what loses them. `/hdr-glow/repro.html` showed values above 1.0 brighter than white on the phone. |
| Effects from CSS and sensors (plan demos 6, 7, 8, 11) | `/scroll-fx/`, `/shape-ui/`, `/text-labels/`, `/tilt-card/` | `tilt-light.js`, `char-rects.js`, `shared/fx-route.js` | #62 | Built. The overscroll drawer of demo 6 was not built (no `overscroll-area` in Chromium 157). The real tilt sensor and touch scrolling are not verified. |
| AI and input (plan demos 12 to 16) | `/translate-lens/`, `/agent-view/`, `/voice/`, `/nav-shader/`, `/focus-nav/` | `text-twin.js` | #61 | Demos 12 to 16 built. No model, WebMCP or microphone in the test browser, so each page runs on a labelled fallback there. |
| Lost canvases, graphics rules and crash reports | every page, `/canvas-loss/`, `/crashes/`, `/friction/` | `shared/context-guard.js`, `shared/backend.js`, `surface.js`, `tools/jank/`, `tools/gfx/`, `docs/graphics-rules.md`, `docs/lost-contexts.md`, `docs/crash-reports.md`, `tools/draw-size/`, `docs/draw-size.md` | #63, #81, #84, #85, #93, #94, #110, #111, #116 | Built. Two causes were found on the phone with `/canvas-loss/`: a drawable 2D canvas made with `willReadFrequently: true`, and a float16 `getImageData()`. The guard now removes the first, `npm run build` fails on five graphics rules (`npm run check:gfx`), the WebGL limit in `check:jank` is 3, and every copy of the site sends crashes and lost contexts to `/api/reports` (`npm run reports`). The phone ran all 21 trials and both guard fixes held (#94). #111 added a build rule (`draw-size`: a `drawElementImage()` call with no size) after `/element-ideas/` drew its elements 2.625 times too large on the phone, and `/friction/` lists 79 places where the API did not behave as expected, 19 of them re-run in the visitor's browser. The losses on `/instruments/`, `/scoped-transitions/` and the text pages of #80 are not explained. |
| Text elements | `/mark-pen/`, `/keycaps/`, `/split-flap/`, `/flip-clock/`, `/typed-code/`, `/text-notes/` | `text-canvas.js` | #80, #88, #92 | Built (backlog groups 2 and 14). Lost their canvases or the tab on the phone in the first version. |
| Developer tools and accessibility views drawn by a canvas | `/focus-path/`, `/layout-debug/`, `/paint-inspector/`, `/hit-regions/`, `/landmark-map/`, `/a11y-views/`, `/tilt-layers/` | `lib/devtools/` | #79, #98 | Built (backlog groups 4 and 21, plus `/tilt-layers/` on 2026-11-22). No screen reader was used. |
| Repository layout for parallel branches | every page | `tools/site/`, `public/<name>/page.json`, `findings/` | #64, #65 | Done. Each page registers itself with its own `page.json` and records results in its own findings file. The menu is generated by `npm run build`. |

## Pull requests

On 2026-11-22 at 12:10 UTC, pull requests #1 to #129 have merged and none is open. Merged since 14:00 UTC on 2026-11-21:

| PR | Adds |
|---|---|
| #48 | `/elements/`, `/element-ideas/`, `ELEMENTS.md` |
| #50 | The Chrome APIs plan, `/stream/`, `/carousel/`, `/patch/`, `/popovers/` |
| #53 | `/component-kit/` |
| #54 | `/transports-2/`, `/iframe-tiles/` |
| #55 | `/wasm-ui/` |
| #56 | `/protected/`, latency on `/perf/`, clipboard, print and folder additions on `/capture/` |
| #57 | `/fold/`, `/hardware-out/`, `/window-chrome/` |
| #59 | `/xr-room/` |
| #60 | `/webgpu-features/` |
| #61 | `/translate-lens/`, `/agent-view/`, `/voice/`, `/nav-shader/`, `/focus-nav/` |
| #62 | `/scroll-fx/`, `/shape-ui/`, `/tilt-card/`, `/text-labels/` |
| #63 | `shared/context-guard.js` and the context limits in `check:jank` |
| #64, #65 | `page.json` per page, `findings/` per page or strand, one file per menu group |
| #66 | Documentation pass for #48 to #65 |
| #67 | `/hdr-glow/`, `/css-uniforms/` |
| #68 | The backlog in this file |
| #70 | `/scoped-transitions/` |
| #71 | `/imgui-dom/`, `/flutter-dom/`, `/qt-widgets-dom/`, `/godot-dom/`, `/toolkit-aria/` |
| #75 | `/hdr-glow/`: float readback on request, 8-bit fallback when the float context is lost |
| #76 | `/sort-table/`, `/accordion/`, `/minimap/`, `/heat-map/`, `/tab-fan/` |
| #69 | `/select-ideas/`, `/input-ideas/` |
| #72 | `/instruments/` |
| #73 | `/selection-peers/`, `/selection-glyphs/`, `/redact/`, `/selection-heat/`, `/share-card/` |
| #74 | Phone results for `/webgpu-features/` |
| #77 | `/gpu-video/`, `/worker-compositor/`, `/presenter/`, `/telestrator/`, `/video-text/` |
| #78 | `/captions/`, `/timed-comments/`, `/live-captions/`, `/speak-words/`, `/cassette/` |
| #79 | `/focus-path/`, `/layout-debug/`, `/paint-inspector/`, `/hit-regions/`, `/landmark-map/` |
| #80 | `/mark-pen/`, `/keycaps/`, `/split-flap/`, `/flip-clock/`, `/typed-code/` |
| #81 | Graphics rules, `npm run check:gfx`, a memory budget and crash reports (`/api/reports`, `/canvas-loss/`) |
| #82, #96 | `/hdr-glow/`: recovery after a float readback, a WebGPU route, `/hdr-glow/repro.html` |
| #83 | Documentation pass for #67 to #76 |
| #84, #93, #94 | `/crashes/`, no `willReadFrequently` on drawable canvases, the phone's run of the `/canvas-loss/` trials |
| #85, #87 | Motion pages: no readback of a drawable canvas; `/scoped-transitions/` fixes |
| #86, #90 | `/form-state/`, `/form-scenes/` |
| #88, #92 | `/text-notes/`, and `home()` in `text-canvas.js` |
| #89, #91 | `/list-table/`, `/structure-depth/` |
| #95, #101 | `/paint-clocks/`, `/top-layer/` |
| #97, #98 | `/play/`, `/a11y-views/` |
| #99, #100 | `/media-tiles/`, `/nested-frames/` |
| #102, #119, #120 | `/nested-frames/`: a second route when the inner canvases are empty, and the phone report that they now draw |
| #103 | Documentation pass for #77 to #101 |
| #104, #111 | Element ideas drawn at CSS size on dense screens; the `draw-size` build rule, guard measurement and `tools/draw-size/audit.mjs` |
| #105, #106 | Homepage changes |
| #107 | `/animated-images/` |
| #108 | `/plan-followups/`, and the hit boxes of the WebGPU route of `/hdr-glow/` |
| #109 | `/motion-capture/` |
| #110, #116 | `/friction/` |
| #112 | `/select-selection/` |
| #113 | `/video-lab/` |
| #114 | `/qt-textfield/`, `/toolkit-occlusion/` |
| #115 | `/media-state/`, `/text-marks/` |
| #117, #118, #121 | `/table-data/`, `/block-play/`, `/odd-elements/` |
| #123 | `/field-heads/`, `/blocked/` |
| #122 | `/view-source/`, `/view-dom/`, `lib/page-peel.js` |
| #124, #126 | `/plan-followups/`: lower defaults for the float buffer, and the label results from the phone |
| #125 | Documentation pass for #102 to #123 |
| #127 | `/conveyor/` |
| #128 | `/canvas-skin/`, `lib/canvas-skin.js` and its theme files, `lib/glass-gl.js` |
| #129 | `/use-it/`, and the selected option kept by `select-picker.js` |

## Planned demos from the Chrome APIs plan

Source: `tools/chrome-apis/demos.json` and `public/chrome-apis/plan.md` (written by `npm run build`). The plan surveys the 678 features that chromestatus.com lists for Chrome 130 to 160, has an idea for 359 of them, and tracks 33 demos in three tiers. The full description of each demo (what it shows, how to build it, what was measured, what is uncertain) is in the plan document. A page that builds a demo names it with `"plan": "<key>"` in its `page.json`, and the build marks the demo as built from that.

On 2026-11-22, all 33 planned demos are built and carry `"plan"` in their `page.json` (`grep -l '"plan"' public/*/page.json` lists every page that claims a demo).

| # | Key | Demo | Tier | Built as |
|---|---|---|---|---|
| 1 | `stream-materialise` | Streamed HTML that the canvas draws as it arrives (`streamAppendHTML()`, Prompt API or Workers AI) | next | `/stream/` (#50) |
| 2 | `carousel-3d` | A CSS-only carousel (`::scroll-marker`, `::scroll-button()`) drawn as a cover flow | next | `/carousel/` (#50) |
| 3 | `popover-tips` | Native popovers, hints (`interestfor`) and commands (`commandfor`) on warped surfaces | next | `/popovers/` (#50) |
| 4 | `hdr-glow` | HDR interface: elements brighter than white in a `float16` canvas | next | `/hdr-glow/` (#67, #75) |
| 5 | `css-uniforms` | Shader uniforms written in CSS only (typed `attr()`, `@function`, `if()`, `sibling-index()`, `random()`) | next | `/css-uniforms/` (#67) |
| 6 | `scroll-fx` | Scroll-linked shaders with no scroll listener | next | `/scroll-fx/` (#62), without the overscroll drawer |
| 7 | `shape-ui` | CSS shapes (`corner-shape`, `border-shape`, `shape()`) lit as solid objects | next | `/shape-ui/` (#62) |
| 8 | `text-labels` | Text measured by CSS for textures, signs and particles (`text-box-trim`, `text-fit`, `OpaqueRange`) | next | `/text-labels/` (#62) |
| 9 | `caret-fx` | Carets, highlights and editing drawn through shaders | next | `/caret/` (#52) |
| 10 | `caps-in-canvas` | What a canvas may not see or wrap: permission elements, `:visited`, system colours, spelling markers, autofill previews, cross-origin iframes | next | `/protected/` (#56) |
| 11 | `sensor-parallax` | Tilt the phone to light a live card | next | `/tilt-card/` (#62) |
| 12 | `translate-lens` | A lens that translates, simplifies or summarises what is under it | then | `/translate-lens/` (#61) |
| 13 | `agent-view` | An agent operating a canvas UI through WebMCP tools, drawn as it happens | then | `/agent-view/` (#61) |
| 14 | `voice-ui` | Speak a label to press what the canvas draws | then | `/voice/` (#61) |
| 15 | `nav-shader` | Page navigations drawn by a shader that starts at the clicked link (Navigation API) | then | `/nav-shader/` (#61) |
| 16 | `focus-nav` | Controller, keyboard (`focusgroup`) and haptic navigation of drawn UI | then | `/focus-nav/` (#61) |
| 17 | `perf-latency` | Latency from DOM change to canvas pixels, and a device tier | then | latency buttons on `/perf/` (#56) |
| 18 | `transport-2` | New routes for the transport lab and the remote component (WebTransport, Element Capture, worker input) | then | `/transports-2/` (#54) |
| 19 | `media-states` | Media state pseudo-classes for canvas-drawn players | then | additions to `/player-parts/` and the media pages (#51) |
| 20 | `capture-print` | Capture additions: clipboard, print margins, files | then | section C of `/capture/` (#56) |
| 21 | `component-kit` | The custom elements packaged with newer DOM features (scoped registries, Reference Target, `using`, Observable) | then | `/component-kit/` (#53) |
| 22 | `iframe-tiles` | Iframes as tiles: sizing, prerender and limits | then | `/iframe-tiles/` (#54) |
| 23 | `foldable` | DOM drawn across a fold | hardware | `/fold/` (#57) |
| 24 | `xr-real` | HTML panels in a real room (hands, planes, depth, quad layers) | hardware | `/xr-room/` (#59) |
| 25 | `hardware-out` | Live DOM on physical devices (Stream Deck, receipt printer, LED matrix) | hardware | `/hardware-out/` (#57) |
| 26 | `webgpu-pipeline` | WebGPU features for element textures (compatibility mode, dual source blending, `primitive_index`, immediates) | hardware | `/webgpu-features/` (#60) |
| 27 | `window-chrome` | An installed app whose window frame is a canvas | hardware | `/window-chrome/` (#57) |
| 28 | `wasm-ui` | WebAssembly toolkits (JSPI) and WebNN models over live elements | hardware | `/wasm-ui/` (#55) |
| 29 | `partial-updates` | Declarative partial updates (`<template for>`) and `moveBefore()` drawn by a canvas | next | `/patch/` (#50) |
| 30 | `linear-color` | Linear-light blending (`srgb-linear` / `display-p3-linear`), `contrast-color()` and `CanvasTextDrawingStyles.lang` | next | `/linear-color/` (2026-11-22) |
| 31 | `scroll-directions` | Scroll-direction shaders (`scroll-state(scrolled)`), `:target-before` / `:target-after` carousel and rounded `polygon()` | next | `/scroll-directions/` (2026-11-22) |
| 32 | `sanitized-stream` | Sanitizer API (`setHTML()`, `javascriptURLs`), `getComposedRanges()` across shadow DOM and `Temporal` frame log | then | `/sanitized-stream/` (2026-11-22) |
| 33 | `webgpu-immediates` | WebGPU `GPUTextureView` for `externalTexture`, `pass.setImmediateData()` and `SpeechRecognition.start(audioTrack)` | hardware | `/webgpu-immediates/` (2026-11-22) |

Guidance given to every thread building these (2026-11-21): ship in small pull requests of two or three demos, let a demo that fails on the API fail visibly with the finding recorded, start each page on its lightest effect, create one graphics context per page where possible, keep live checks behind a tap, recover from a lost context with a message, and favour dynamic, visually strong effects. The hardware-tier demos are built with a simulated fallback (a fold control, a simulated device panel, a simulated title bar) because the cloud browser cannot verify the real thing.

Four probe results differ between the two test browsers (Chromium 157 and 153) and are wanted from Chrome 159 on the phone: anchor positioning from outside the canvas, `interestfor`, `highlightsFromPoint()` and `OpaqueRange` rects. All four are about where the browser thinks a drawn element is.

## Open ideas by strand

Every item here was unbuilt when it was listed. Many have been built since: the "Backlog" section below repeats each item with a number and ends the line with "Built:" and the page when it is done. Read the backlog for the current state. The source is the FINDINGS.md section, the page, the pull request or the project note that lists it.

### View transitions

Source: FINDINGS.md, "View Transitions API", "Not tried yet".

- Drive a WebGL or WebGPU shader from the canvas-scoped transition clock.
- A scoped transition on an ancestor with a canvas-scoped one nested inside it.
- Navigation API `intercept()` with a shader for single-page route changes (also demo 15).
- `view-transition-class` and nested groups with one canvas per list item.
- One page-wide canvas that draws every transition itself.
- Use a child's group box as a timing source.

### Transitions and motion

- Feed `<dom-rewind>.frames()` to a real video encoder. `encodeFrames()` in `element-capture.js` takes the same `{ time, bitmap }` shape. Source: FINDINGS.md, "Transitions and motion".
- Hit testing for two pointers at once on shards or glyphs. One element has one hit box. Source: FINDINGS.md summary.

### Video and sound

Source: FINDINGS.md, "Video and sound", "Further experiments". Each item has a paragraph there.

- WebGPU external textures (`importExternalTexture(video)`) composed with element textures in one pass.
- A worker as the compositor: `MediaStreamTrackProcessor`, transferred `ElementImage` overlays, `VideoTrackGenerator`.
- A presenter over live slides (alpha or segmented camera over a DOM slide).
- Live captions from `SpeechRecognition`, and the Translator API for a second language.
- Timed comments that cross the video as clickable DOM.
- A title editor: clips, HTML title cards, the `/transitions/` shaders between clips, `exportFrames()`.
- A screen-share telestrator (`getDisplayMedia()` with HTML annotation tools).
- A cinema screen in the `/three-form/` scene with a `PannerNode` at the screen.
- Video as a material for text.
- Animated images (GIF, APNG, WebP, AVIF, SVG SMIL, Lottie) as canvas children: does `paint` fire per frame?
- A `display-p3` canvas with HDR or wide-gamut video.
- Casting the composed stream with the Presentation or Remote Playback API.
- A player skin as a shader on the timeline strip only.
- A proposal to test: `drawElementImage()` taking a pseudo-element or a `::part()`.
- Customisable media controls mocked with a custom element.
- State pseudo-classes on other elements (`:open`, `:popover-open`, `:user-invalid`, `:checked`) driving `--fx-*` through `:has()`.
- Word-by-word highlighting from `SpeechSynthesis` boundary events.
- A WebGPU version of the `/player-fx/` shader. Source: FINDINGS.md, "One shader over the controls and the frame".

### Customisable select, datalist and inputs

Source: the "ideas" lists on `/select/`, `/datalist/` and `/inputs/` (PR #45).

- A lens over a long option list.
- Physical options (cloth or jelly).
- A map or seat plan as a picker.
- A colour select that samples pixels.
- A transition that carries the chosen option into the button.
- `<select multiple>` drawn by a canvas.
- A range input bent round a dial.
- A date range on one calendar.
- A colour wheel that reads its own pixels.
- A week picker on a year view.
- Ghost-text suggestion in the input.
- Rich suggestions through a customisable select with no button.

### Text selection

Source: the ideas list on `/selection/`.

- Other people's selections, selected glyphs as particles, a share card, selection in 3D, a heat map, a minimap, redaction, translate in place, haptics, selection effects for form controls.

### Native UI toolkits

Source: `docs/native-frameworks.md`, "Ideas for further experiments".

1. Flutter web showing a DOM element through `createImageFromTextureSource()`.
2. Qt Widgets: `drawElementImage()` on a raster window's 2D canvas after Qt's flush.
3. A Qt Quick `TextField` backed by an `<input>`, compared for IME and autofill on Android.
4. Dear ImGui with Emscripten: one `ImGui::Image()` call.
5. Unity or Godot: a DOM chat box and login form on a quad in a 3D scene.
6. A framework's ARIA tree inside the canvas, positioned with `updateElementGeometry()`.
7. Occlusion without a guard: can `canvasClip` express "this window covers that field"?
8. Real-device checks: IME in a DOM field inside egui, native pickers for a rotated field in Qt Quick, TalkBack over both apps.

### fx library

Source: PR #44 and the project notes.

- An npm package. Publishing is the project owner's decision.
- TypeScript types.
- A minified build.

### Cross-context

- Safari and Firefox as viewers. The viewer pages are written not to need the API. Source: FINDINGS.md, "Cross-context".
- A real cross-site pair of origins. The two deployed Workers are same-site. Source: project notes.

### 3D and spatial

- The form as an `XRQuadLayer`. Written, opt-in, not verified. Source: FINDINGS.md, "3D and spatial".
- A way to hand the browser a ray hit and receive a trusted event. This is an API request, listed in FINDINGS.md.

### Per-element themes (`/canvas-skin/`)

Source: `findings/canvas-skin.md`, "Open ideas". The owner asked on 2026-11-22 for the ways the skins could be made faster or better later to be in this plan ("put it in the plan about how we might improve these in the future"). The phone numbers are from `skin-change` reports of Chrome 159 on Android that day.

1. Speed of a change of skin. On the phone some changes still miss 17 to 28 of about 94 frames (glass to X-ray, comic to 1-bit, default to gravity). To try: compile every shader program when the page is idle, not on a skin's first paint; keep one old-picture canvas per wrapper for its lifetime, not one made per change; fade only the wrappers nearest the tap and switch the rest at once; lower the canvas scale to 2 on a device scale of 3 while a change runs.
2. Shader skins at rest. Every shader pass is followed by a `drawImage()` from the shared WebGL canvas into the wrapper's 2D canvas. To try: give underwater, foil, metal and the painting skins the kept texture that gravity and underwater have; run one pass over an atlas of all visible wrappers and cut it up with `drawImage()`, which is one GPU sync per frame and not one per element.
3. WebGPU. The project order is WebGPU, WebGL, 2D. `shade()` and the glass shader are WebGL only. A WGSL version through `webgpu()` in `shared/backend.js` is not written.
4. Measurement. The `skin-change` report covers the change only. Add a report of frames missed over a few seconds at rest and while a finger moves, per skin, so that a slow skin shows in `npm run reports` without the owner saying so. The frame rate read from the gaps was wrong twice (144 Hz reported on a 60 Hz phone before the middle-gap fix); check it against the next reports.
5. Skins the owner judged weak: clay ("not super excited") and old master were reworked once and have not been judged again. Oscilloscope, stained glass and X-ray likewise.
6. Skins offered and not built: ice, ember, aurora.
7. Options: 14 skins have none (pencil, gel, terminal, blueprint, thermal, neon, embroidery, Christmas, seaside, LED board, punch card, X-ray, crayon, native).
8. 3D blocks: tilt is not verified on a device. A real perspective (the face smaller toward the back, text on the floor of a field) needs more than the 14 px of room round each canvas.
9. A skin whose background moves, such as the glass background drifting. Every glass wrapper would repaint each frame.
10. A wrapper that takes its backdrop from a second canvas that draws the root, to show arbitrary content through glass.
11. `CanvasSkin.wrap()` run again from a `MutationObserver` for elements added later.

### Peel, conveyor and use-it pages

Sources: the "Open ideas" of `findings/view-source.md`, `findings/conveyor.md` and `findings/use-it.md`.

1. `/view-source/`: a third page that shows only the lines that differ between the two sources; reading the first response with a service worker that tees the navigation response; the source layer as a second texture of the same canvas, so the shader can light it.
2. `/conveyor/`: the belt in WebGL through `ElementGL` with a true cylinder and lighting; a horizontal belt; rows of different heights; a sensor line that reads each row as it passes.
3. `/use-it/`: the same page for the shader elements, one WebGL context at a time, started by a tap; a check that loads each snippet in an iframe on the second origin.

## Ideas from the element catalogue

Source: `ELEMENTS.md` (PR #48), generated from `public/elements/notes.js` and `ideas.js`. 121 ideas: 28 at rank 1 (build next), 60 at rank 2, 33 at rank 3 (small, speculative or blocked). Each has the elements it needs and whether the recording says it is possible. 17 are built on `/element-ideas/`; that page lists which. The list below is the full rank 1 list and still includes the built ones. By 21:15 UTC on 2026-11-21 most of rank 1 and rank 2 is built as pages of their own: the "Backlog" section marks each one.

Rank 1:

- Picker wheel from `select multiple`.
- Mixing desk from rotated range inputs.
- Step sequencer from a grid of checkboxes.
- Textarea as a CRT terminal.
- Rotary switch from a radio group.
- Odometer for a number input.
- Form on a prism, one fieldset per face.
- Animated diff from `ins` and `del`.
- MathML terms that move between steps.
- Marker-pen highlight on `mark`.
- Keycaps from `kbd`.
- Television with native controls and captions.
- Image map on a perspective floor plan.
- Cassette deck from audio controls.
- Table cells that extrude into a bar chart.
- Cover flow from a `ul`.
- Radial menu from a `menu` element.
- Sortable table with rows that travel.
- Find in page that moves the camera (`hidden=until-found`, `beforematch`).
- Accordion that unfolds (`details`).
- Live minimap of a page.
- In-canvas dialog with a canvas backdrop (`dialog open`, `position: static`).
- Anchored popover call-outs on drawn elements.
- LED ticker from a `marquee`.
- Tab switcher of live pages (same-origin iframes).
- Editable `style` element drawn in the scene.
- Set `inert` on undrawn children automatically.
- Focus order shown as a path.

Rank 2 and rank 3 are in `ELEMENTS.md` under "Ideas". Rank 2 includes developer tools drawn by a canvas (layout debugger overlay, paint event inspector, hit region viewer, landmark map, heading outline) that would also serve this project's own testing.

## Backlog

Every idea that was listed in this project and was not built on 2026-11-21 at 16:00 UTC, one line each. Sources: the sections above, `public/elements/ideas.js`, the files in `findings/`, `docs/native-frameworks.md` and `tools/chrome-apis/ideas.json`. The list has 170 lines in 30 groups. Of the 121 element catalogue ideas, 17 are built, which is what the project owner pointed at on 2026-11-21 ("we haven't even got half of the demos done").

Rank 1 was built first, then rank 2. Rank 3 is small, speculative, blocked, or not a demo. Inside a rank, groups are in build order. The element catalogue comes first because most of the unbuilt ideas are there. Each group is 2 to 7 ideas that share fixtures, is built by one thread on a branch from `main`, and ships as one pull request with its own page folder and its own file in `findings/`. Lines that end with "Built:" were built after the list was written. By 12:10 UTC on 2026-11-22, 164 of the 170 lines are built, covered or tested: groups 1 to 28 (18.1 is covered by `/popovers/`, and Lottie in 22.6 is not built), and 29.1 to 29.6, which `/blocked/` tests beside the routes that work instead. Open: 29.7 to 29.9, which need a headset, a phone or a second site, and 30.1, 30.3 and 30.4, which are library and site work. Every line stays in the list so the numbering holds. A group does not edit `public/elements/ideas.js` or `/element-ideas/`: it names the ideas it built under "For the index" in its findings file, and a documentation pass marks them here and in the catalogue.

### Rank 1: built (55 ideas, groups 1 to 11)

#### 1. Form controls drawn as instruments

- 1.1 (rank 1) Rotary switch from a radio group (element catalogue, rank 1) Built: `/instruments/`, #72.
- 1.2 (rank 1) Odometer for a number input (element catalogue, rank 1) Built: `/instruments/`, #72.
- 1.3 (rank 1) Form on a prism, one fieldset per face (element catalogue, rank 1) Built: `/instruments/`, #72.
- 1.4 (rank 1) Dial gauge from a meter (element catalogue, rank 2) Built: `/instruments/`, #72.
- 1.5 (rank 1) Clock hands from a time input (element catalogue, rank 2) Built: `/instruments/`, #72.

#### 2. Text elements

- 2.1 (rank 1) Marker-pen highlight (element catalogue, rank 1) Built: `/mark-pen/`, #80.
- 2.2 (rank 1) Keycaps from kbd (element catalogue, rank 1) Built: `/keycaps/`, #80.
- 2.3 (rank 1) Split-flap output (element catalogue, rank 2) Built: `/split-flap/`, #80.
- 2.4 (rank 1) Flip clock from a time element (element catalogue, rank 2) Built: `/flip-clock/`, #80.
- 2.5 (rank 1) Code that types itself (element catalogue, rank 2) Built: `/typed-code/`, #80.

#### 3. Tables, lists and page structure

- 3.1 (rank 1) Sortable table with rows that travel (element catalogue, rank 1) Built: `/sort-table/`, #76.
- 3.2 (rank 1) Accordion that unfolds (element catalogue, rank 1) Built: `/accordion/`, #76.
- 3.3 (rank 1) Live minimap of a page (element catalogue, rank 1) Built: `/minimap/`, #76.
- 3.4 (rank 1) Tab switcher of live pages (element catalogue, rank 1) Built: `/tab-fan/`, #76.
- 3.5 (rank 1) Heat map over table cells (element catalogue, rank 2) Built: `/heat-map/`, #76.

#### 4. Developer tools drawn by a canvas

- 4.1 (rank 1) Focus order shown as a path (element catalogue, rank 1) Built: `/focus-path/`, #79.
- 4.2 (rank 1) Layout debugger overlay (element catalogue, rank 2) Built: `/layout-debug/`, #79.
- 4.3 (rank 1) Paint event inspector (element catalogue, rank 2) Built: `/paint-inspector/`, #79.
- 4.4 (rank 1) Hit region viewer (element catalogue, rank 2) Built: `/hit-regions/`, #79.
- 4.5 (rank 1) Landmark map (element catalogue, rank 2) Built: `/landmark-map/`, #79.

#### 5. Video compositing

- 5.1 (rank 1) WebGPU external textures (`importExternalTexture(video)`) composed with element textures in one pass (video and sound) Built: `/gpu-video/`, #77.
- 5.2 (rank 1) A worker as the compositor: `MediaStreamTrackProcessor`, transferred `ElementImage` overlays, `VideoTrackGenerator` (video and sound) Built: `/worker-compositor/`, #77.
- 5.3 (rank 1) A presenter over live slides (video and sound) Built: `/presenter/`, #77.
- 5.4 (rank 1) A screen-share telestrator (video and sound) Built: `/telestrator/`, #77.
- 5.5 (rank 1) Video as a material for text (video and sound) Built: `/video-text/`, #77.

#### 6. Video, time and words

- 6.1 (rank 1) Cassette deck from audio controls (element catalogue, rank 1) Built: `/cassette/`, #78.
- 6.2 (rank 1) Live captions from `SpeechRecognition`, with the Translator API for a second language (video and sound) Built: `/live-captions/`, #78.
- 6.3 (rank 1) Timed comments that cross the video as clickable DOM (video and sound) Built: `/timed-comments/`, #78.
- 6.4 (rank 1) Captions drawn apart from the video (element catalogue, rank 2) Built: `/captions/`, #78.
- 6.5 (rank 1) Word-by-word highlighting from `SpeechSynthesis` boundary events (video and sound) Built: `/speak-words/`, #78.

#### 7. Select pickers

- 7.1 (rank 1) A lens over a long option list (`/select/` ideas) Built: `/select-ideas/`, #69.
- 7.2 (rank 1) Physical options (cloth or jelly) (`/select/` ideas) Built: `/select-ideas/`, #69.
- 7.3 (rank 1) A map or seat plan as a picker (`/select/` ideas) Built: `/select-ideas/`, #69.
- 7.4 (rank 1) A colour select that samples pixels (`/select/` ideas) Built: `/select-ideas/`, #69.
- 7.5 (rank 1) A transition that carries the chosen option into the button (`/select/` ideas) Built: `/select-ideas/`, #69.

#### 8. Input pickers

- 8.1 (rank 1) A range input bent round a dial (`/datalist/` and `/inputs/` ideas) Built: `/input-ideas/`, #69.
- 8.2 (rank 1) A date range on one calendar (`/datalist/` and `/inputs/` ideas) Built: `/input-ideas/`, #69.
- 8.3 (rank 1) A colour wheel that reads its own pixels (`/datalist/` and `/inputs/` ideas) Built: `/input-ideas/`, #69.
- 8.4 (rank 1) A week picker on a year view (`/datalist/` and `/inputs/` ideas) Built: `/input-ideas/`, #69.
- 8.5 (rank 1) Ghost-text suggestion in the input (`/datalist/` and `/inputs/` ideas) Built: `/input-ideas/`, #69.

#### 9. Text selection

- 9.1 (rank 1) Other people's selections (`/selection/` ideas) Built: `/selection-peers/`, #73.
- 9.2 (rank 1) Selected glyphs as particles (`/selection/` ideas) Built: `/selection-glyphs/`, #73.
- 9.3 (rank 1) A share card made from the selection (`/selection/` ideas) Built: `/share-card/`, #73.
- 9.4 (rank 1) Redaction of the selected text (`/selection/` ideas) Built: `/redact/`, #73.
- 9.5 (rank 1) A heat map and a minimap of selections (`/selection/` ideas) Built: `/selection-heat/`, #73.

#### 10. View transitions

- 10.1 (rank 1) A WebGL or WebGPU shader driven by the canvas-scoped transition clock (view transitions, not tried) Built: `/scoped-transitions/`, #70.
- 10.2 (rank 1) A scoped transition on an ancestor with a canvas-scoped one nested inside it (view transitions, not tried) Built: `/scoped-transitions/`, #70.
- 10.3 (rank 1) `view-transition-class` and nested groups with one canvas per list item (view transitions, not tried) Built: `/scoped-transitions/`, #70.
- 10.4 (rank 1) One page-wide canvas that draws every transition itself (view transitions, not tried) Built: `/scoped-transitions/`, #70.
- 10.5 (rank 1) A child's group box as a timing source (view transitions, not tried) Built: `/scoped-transitions/`, #70.

#### 11. Native UI toolkits

- 11.1 (rank 1) Dear ImGui with Emscripten: a DOM element through one `ImGui::Image()` call (`docs/native-frameworks.md`) Built: `/imgui-dom/`, #71.
- 11.2 (rank 1) Flutter web showing a DOM element through `createImageFromTextureSource()` (`docs/native-frameworks.md`) Built: `/flutter-dom/`, #71.
- 11.3 (rank 1) Qt Widgets: `drawElementImage()` on a raster window's 2D canvas after Qt's flush (`docs/native-frameworks.md`) Built: `/qt-widgets-dom/`, #71.
- 11.4 (rank 1) Godot or Unity: a DOM chat box and login form on a quad in a 3D scene (`docs/native-frameworks.md`) Built: `/godot-dom/` (Godot only), #71.
- 11.5 (rank 1) A framework's ARIA tree inside the canvas, positioned with `updateElementGeometry()` (`docs/native-frameworks.md`) Built: `/toolkit-aria/` (Dear ImGui), #71.

### Rank 2: built (74 ideas, groups 12 to 27)

#### 12. Forms: effects raised by the control's own state

- 12.1 (rank 2) Per-keystroke ink (element catalogue, rank 2) Built: `/form-state/`, #86.
- 12.2 (rank 2) Button press that dents the surface (element catalogue, rank 2) Built: `/form-state/`, #86.
- 12.3 (rank 2) Colour input that recolours its own scene (element catalogue, rank 2) Built: `/form-state/`, #86.
- 12.4 (rank 2) Liquid progress bar (element catalogue, rank 2) Built: `/form-state/`, #86.
- 12.5 (rank 2) Search field that focuses the scene (element catalogue, rank 2) Built: `/form-state/`, #86.

#### 13. Forms: controls in a drawn setting

- 13.1 (rank 2) Exploded form diagram (element catalogue, rank 2) Built: `/form-scenes/`, #90.
- 13.2 (rank 2) Wall calendar around a date input (element catalogue, rank 2) Built: `/form-scenes/`, #90.
- 13.3 (rank 2) File input on a drawn letter box (element catalogue, rank 2) Built: `/form-scenes/`, #90.
- 13.4 (rank 2) Disabled panel in one step (element catalogue, rank 2) Built: `/form-scenes/`, #90.

#### 14. Text, second batch

- 14.1 (rank 2) Ruby that appears near the pointer (element catalogue, rank 2) Built: `/text-notes/`, #88.
- 14.2 (rank 2) Pull quote behind the column (element catalogue, rank 2) Built: `/text-notes/`, #88.
- 14.3 (rank 2) Selection that glows (element catalogue, rank 2) Built: `/text-notes/`, #88.
- 14.4 (rank 2) Kinetic heading (element catalogue, rank 2) Built: `/text-notes/`, #88.
- 14.5 (rank 2) Footnotes that slide out (element catalogue, rank 2) Built: `/text-notes/`, #88.
- 14.6 (rank 2) Strike-through drawn by hand (element catalogue, rank 2) Built: `/text-notes/`, #88.

#### 15. Images, charts and video tiles

- 15.1 (rank 2) Video wall (element catalogue, rank 2) Built: `/media-tiles/`, #99.
- 15.2 (rank 2) Figure with a live caption (element catalogue, rank 2) Built: `/media-tiles/`, #99.
- 15.3 (rank 2) Resolution chosen by drawn size (element catalogue, rank 2) Built: `/media-tiles/`, #99.
- 15.4 (rank 2) SVG chart as a live texture (element catalogue, rank 2) Built: `/media-tiles/`, #99.
- 15.5 (rank 2) Chart and legend exported as one picture (element catalogue, rank 2) Built: `/media-tiles/`, #99.

#### 16. Lists and tables, second batch

- 16.1 (rank 2) Column highlight from col (element catalogue, rank 2) Built: `/list-table/`, #89.
- 16.2 (rank 2) Glossary cards from a dl (element catalogue, rank 2) Built: `/list-table/`, #89.
- 16.3 (rank 2) Staggered list entrance (element catalogue, rank 2) Built: `/list-table/`, #89.
- 16.4 (rank 2) Sticky header that casts a shadow (element catalogue, rank 2) Built: `/list-table/`, #89.
- 16.5 (rank 2) Timeline from an ordered list (element catalogue, rank 2) Built: `/list-table/`, #89.

#### 17. Page structure in depth

- 17.1 (rank 2) Sections on a cube (element catalogue, rank 2) Built: `/structure-depth/`, #91.
- 17.2 (rank 2) Navigation on a ribbon (element catalogue, rank 2) Built: `/structure-depth/`, #91.
- 17.3 (rank 2) Slices between hr elements (element catalogue, rank 2) Built: `/structure-depth/`, #91.
- 17.4 (rank 2) Header that folds away (element catalogue, rank 2) Built: `/structure-depth/`, #91.
- 17.5 (rank 2) Drawer cabinet from details (element catalogue, rank 2) Built: `/structure-depth/`, #91.
- 17.6 (rank 2) Aside as a margin note on a string (element catalogue, rank 2) Built: `/structure-depth/`, #91.

#### 18. Top layer and paint clocks

- 18.1 (rank 2) Menu that stays readable on a tilted toolbar (element catalogue, rank 2) Covered by `/popovers/`, #50.
- 18.2 (rank 2) Tooltip drawn by the canvas (element catalogue, rank 2) Built: `/top-layer/`, #101.
- 18.3 (rank 2) Modal that leaves the scene (element catalogue, rank 2) Built: `/top-layer/`, #101.
- 18.4 (rank 2) Loading state that stops by itself (element catalogue, rank 2) Built: `/paint-clocks/`, #95.
- 18.5 (rank 2) Caret as a heartbeat (element catalogue, rank 2) Built: `/paint-clocks/`, #95.
- 18.6 (rank 2) Video as a frame clock for a whole scene (element catalogue, rank 2) Built: `/paint-clocks/`, #95.
- 18.7 (rank 2) Animated image as the only clock (element catalogue, rank 2) Built: `/paint-clocks/`, #95.

#### 19. Frames and nested canvases

- 19.1 (rank 2) Widget with its own effect inside a scene (element catalogue, rank 2) Built: `/nested-frames/`, #100.
- 19.2 (rank 2) Email preview on a drawn phone (element catalogue, rank 2) Built: `/nested-frames/`, #100.
- 19.3 (rank 2) Custom element that packages an effect (element catalogue, rank 2) Built: `/nested-frames/`, #100.
- 19.4 (rank 2) HTML button inside an SVG diagram (element catalogue, rank 2) Built: `/nested-frames/`, #100.
- 19.5 (rank 2) Script that shows itself (element catalogue, rank 2) Built: `/nested-frames/`, #100.

#### 20. Play

- 20.1 (rank 2) Drag a card out of the scene (element catalogue, rank 2) Built: `/play/`, #97.
- 20.2 (rank 2) Pixel editor from checkboxes (element catalogue, rank 2) Built: `/play/`, #97.
- 20.3 (rank 2) Sliding puzzle of a live page (element catalogue, rank 2) Built: `/play/`, #97.
- 20.4 (rank 2) Contenteditable on a curling page (element catalogue, rank 2) Built: `/play/`, #97.

#### 21. Accessibility views

- 21.1 (rank 2) Focus ring that leads the eye (element catalogue, rank 2) Built: `/a11y-views/`, #98.
- 21.2 (rank 2) Heading outline beside the page (element catalogue, rank 2) Built: `/a11y-views/`, #98.

#### 22. Video, second batch

- 22.1 (rank 2) A title editor: clips, HTML title cards, the `/transitions/` shaders between clips, `exportFrames()` (video and sound) Built: `/video-lab/`, #113.
- 22.2 (rank 2) A cinema screen in the `/three-form/` scene with a `PannerNode` at the screen (video and sound) Built: `/video-lab/`, #113.
- 22.3 (rank 2) A `display-p3` canvas with HDR or wide-gamut video (video and sound) Built: `/video-lab/`, #113.
- 22.4 (rank 2) A player skin as a shader on the timeline strip only (video and sound) Built: `/video-lab/`, #113.
- 22.5 (rank 2) A WebGPU version of the `/player-fx/` shader (video and sound) Built: `/video-lab/`, #113.
- 22.6 (rank 2) Animated images (GIF, APNG, WebP, AVIF, SVG SMIL, Lottie) as canvas children: does `paint` fire per frame (video and sound) Built: `/animated-images/`, #107, apart from Lottie.

#### 23. Media controls and state

- 23.1 (rank 2) Customisable media controls mocked with a custom element (video and sound) Built: `/media-state/`, #115.
- 23.2 (rank 2) State pseudo-classes on other elements (`:open`, `:popover-open`, `:user-invalid`, `:checked`) driving `--fx-*` through `:has()` (video and sound) Built: `/media-state/`, #115.
- 23.3 (rank 2) A test of the proposal that `drawElementImage()` takes a pseudo-element or a `::part()` (video and sound) Built: `/media-state/`, #115.
- 23.4 (rank 2) Casting the composed stream with the Presentation or Remote Playback API (video and sound) Built: `/media-state/`, #115.

#### 24. Select, inputs and selection, second batch

- 24.1 (rank 2) `<select multiple>` drawn by a canvas (`/select/` ideas) Built: `/select-selection/`, #112.
- 24.2 (rank 2) Rich suggestions through a customisable select with no button (`/datalist/` and `/inputs/` ideas) Built: `/select-selection/`, #112.
- 24.3 (rank 2) Selection in 3D (`/selection/` ideas) Built: `/select-selection/`, #112.
- 24.4 (rank 2) Translate the selection in place (`/selection/` ideas) Built: `/select-selection/`, #112.
- 24.5 (rank 2) Haptics on selection change (`/selection/` ideas) Built: `/select-selection/`, #112.
- 24.6 (rank 2) Selection effects for form controls (`/selection/` ideas) Built: `/select-selection/`, #112.

#### 25. Motion and capture

- 25.1 (rank 2) `<dom-rewind>.frames()` fed to a real video encoder (`findings/motion.md`) Built: `/motion-capture/`, #109.
- 25.2 (rank 2) Hit testing for two pointers at once on shards or glyphs (FINDINGS.md summary) Built: `/motion-capture/`, #109.

#### 26. Follow-ups to the Chrome APIs plan

- 26.1 (rank 2) Semantic zoom on `/board/`: a tile too small to read is replaced by a summary from the Summarizer API (`tools/chrome-apis/ideas.json`) Built: `/plan-followups/`, #108.
- 26.2 (rank 2) Multicol `::column` fragments drawn as book pages with a page-turn shader (plan demo 2, second layout) Built: `/plan-followups/`, #108.
- 26.3 (rank 2) Canvas `TextMetrics` selection rectangles (Chrome 160) compared with DOM Range rects (`tools/chrome-apis/ideas.json`) Built: `/plan-followups/`, #108.
- 26.4 (rank 2) A WebGL route for `/hdr-glow/` with an `RGBA16F` drawing buffer and a bloom pass (`findings/hdr-glow.md`) Built: `/plan-followups/`, #108.
- 26.5 (rank 2) The CSS uniform binding moved into `shader-fx.js`, and a registered `<custom-ident>` that selects the effect (`findings/css-uniforms.md`) Built: `/plan-followups/`, #108, without the move into `shader-fx.js`.

#### 27. Native UI toolkits, second batch

- 27.1 (rank 2) A Qt Quick `TextField` backed by an `<input>`, compared for IME and autofill on Android (`docs/native-frameworks.md`) Built: `/qt-textfield/`, #114.
- 27.2 (rank 2) Occlusion without a guard: can `canvasClip` express "this window covers that field" (`docs/native-frameworks.md`) Built: `/toolkit-occlusion/`, #114.

### Rank 3: later, blocked, or not a demo (41 lines, groups 28 to 30)

#### 28. Element catalogue, rank 3

- 28.1 (rank 3) Suggestion ring from a datalist (element catalogue, rank 3) Built: `/field-heads/`, #123.
- 28.2 (rank 3) Password field that can be shared (element catalogue, rank 3) Built: `/field-heads/`, #123.
- 28.3 (rank 3) Hero picture from selectedcontent (element catalogue, rank 3) Built: `/field-heads/`, #123.
- 28.4 (rank 3) Folder tabs from legends (element catalogue, rank 3) Built: `/block-play/`, #118.
- 28.5 (rank 3) Subscripts that settle (element catalogue, rank 3) Built: `/text-marks/`, #115.
- 28.6 (rank 3) Bidirectional text explained (element catalogue, rank 3) Built: `/text-marks/`, #115.
- 28.7 (rank 3) Abbreviations expanded in place (element catalogue, rank 3) Built: `/text-marks/`, #115.
- 28.8 (rank 3) Quotation marks as ornaments (element catalogue, rank 3) Built: `/text-marks/`, #115.
- 28.9 (rank 3) Variables that light up together (element catalogue, rank 3) Built: `/text-marks/`, #115.
- 28.10 (rank 3) Line breaks as cut lines (element catalogue, rank 3) Built: `/text-marks/`, #115.
- 28.11 (rank 3) Photo gallery with real alt text (element catalogue, rank 3) Built: `/block-play/`, #118.
- 28.12 (rank 3) Caption as a rubber stamp (element catalogue, rank 3) Built: `/table-data/`, #117.
- 28.13 (rank 3) Footer totals that count up (element catalogue, rank 3) Built: `/table-data/`, #117.
- 28.14 (rank 3) Machine values next to shown values (element catalogue, rank 3) Built: `/table-data/`, #117.
- 28.15 (rank 3) Document title as a heading (element catalogue, rank 3) Built: `/field-heads/`, #123.
- 28.16 (rank 3) Address on an envelope (element catalogue, rank 3) Built: `/table-data/`, #117.
- 28.17 (rank 3) Footer that is the floor (element catalogue, rank 3) Built: `/odd-elements/`, #121.
- 28.18 (rank 3) Subtitle that types under the title (element catalogue, rank 3) Built: `/field-heads/`, #123.
- 28.19 (rank 3) Toast stack in the scene (element catalogue, rank 3) Built: `/top-layer/`, #101.
- 28.20 (rank 3) Stock ticker with real links (element catalogue, rank 3) Built: `/table-data/`, #117.
- 28.21 (rank 3) Warn about invisible frames (element catalogue, rank 3) Built: `/odd-elements/`, #121.
- 28.22 (rank 3) Template stamped many times (element catalogue, rank 3) Built: `/block-play/`, #118.
- 28.23 (rank 3) Unknown elements in a design system audit (element catalogue, rank 3) Built: `/odd-elements/`, #121.
- 28.24 (rank 3) xmp as a literal code sample (element catalogue, rank 3) Built: `/odd-elements/`, #121.
- 28.25 (rank 3) Label coverage check (element catalogue, rank 3) Built: `/a11y-views/`, #98.
- 28.26 (rank 3) Minesweeper from a table of buttons (element catalogue, rank 3) Built: `/block-play/`, #118.
- 28.27 (rank 3) Summary as a lever (element catalogue, rank 3) Built: `/block-play/`, #118.
- 28.28 (rank 3) Old web page in a drawn monitor (element catalogue, rank 3) Built: `/odd-elements/`, #121.

#### 29. Blocked by the browser or by hardware

- 29.1 (rank 3) Customisable select with the picker in the scene (element catalogue, rank 3). Blocked today. Tested: `/blocked/`, #123.
- 29.2 (rank 3) PDF pages as a book (element catalogue, rank 3). Not measured. Tested: `/blocked/`, #123.
- 29.3 (rank 3) Cross-origin image wall (element catalogue, rank 3). Blocked without CORS. Tested: `/blocked/`, #123.
- 29.4 (rank 3) Popover drawn into the canvas (element catalogue, rank 3). Blocked today. Tested: `/blocked/`, #123.
- 29.5 (rank 3) Permission button in a scene (element catalogue, rank 3). Blocked. Tested: `/blocked/`, #123.
- 29.6 (rank 3) A drawer on the overscroll area (plan demo 6). No `overscroll-area` property in Chromium 157. Tested: `/blocked/`, #123.
- 29.7 (rank 3) The form as an `XRQuadLayer` (`findings/3d.md`). Written, needs a headset.
- 29.8 (rank 3) Real-device checks of the native toolkit pages: IME, native pickers, TalkBack (`docs/native-frameworks.md`).
- 29.9 (rank 3) Safari and Firefox as viewers, and a real cross-site pair of origins (`findings/cross-context.md`). Needs a person and a second site.

#### 30. Library and site work, not demos

- 30.1 (rank 3) fx library: an npm package, TypeScript types, a minified build (PR #44). Publishing is the project owner's decision.
- 30.2 (rank 3) A "Use it" block for every library (learning-resource review). Built for nine 2D elements: `/use-it/`, #129. The shader elements are open.
- 30.3 (rank 3) Real-GPU recordings for the homepage (learning-resource review). Needs a real GPU.
- 30.4 (rank 3) The rows of "Site-wide work that is open" below.

## Site-wide work that is open

| Item | Source | Notes |
|---|---|---|
| Canvases losing their graphics context on the phone | Phone reports 2026-11-21, PRs #63, #81, #84, #93, #94, `findings/canvas-loss.md`, `/crashes/` | Two causes are identified from the phone: a drawable 2D canvas made with `willReadFrequently: true` (every 2D context on the page is lost, again every half second), and `getImageData()` with `pixelFormat: 'rgba-float16'`. Both are now forbidden by the graphics rules in AGENTS.md and checked by `npm run check:gfx`. Open: the 2D-only losses on `/instruments/`, `/scoped-transitions/` and the text pages of #80 have no identified cause. Read `npm run reports` after the owner tests a page. |
| Pages whose checks wait for a tap | `<meta name="checks" content="tap">` in each page (`grep -l 'name="checks"' public/*/index.html`) | 102 pages on 2026-11-22 at 12:10 UTC. `/portal/`, `/lens/`, `/shader-css/`, `/physical/` shift by 0.25 to 1.03 with checks forced on because `#check-bench` grows and shrinks. `/slot-effects/` shifts by 1.40 and covers over 40% of the screen. `/cross-origin/` scrolls 990 px. `/remote/` moves focus four times. A fixed-size bench would probably fix the bench cases. |
| A flaky check | project notes | `/lens/`: "Pinned lens: clicks land on the magnified drawing". |
| `<dom-portal>` in viewport mode resizes its canvas on every `innerHeight` change | project notes | This clears the canvas when a phone's URL bar moves. |
| `testStage()` takes taps while checks run | FINDINGS.md, "Video and sound" | The media pages wrap it with `pointer-events: none`. Other pages still have the problem. |
| `SurfaceElement` listens for `contextlost` only | FINDINGS.md, "Text selection" | WebGL fires `webglcontextlost`. Subclasses listen themselves today. |
| Canvases that go soft at 150% zoom | FINDINGS.md, "Accessibility" | `/slot-bare/`, `/offscreen/`, `/cross-origin/`, `/transitions/`, `/time-scrubber/`, `/particles/` at the time of the audit. PR #43 fixed the motion elements under CSS zoom. Re-run the audit to confirm which remain. |
| No `prefers-reduced-motion` handling | FINDINGS.md, "Accessibility" | `/slot/`, `/transitions/`, `/particles/`. |
| Unlabelled pixel-only canvases | FINDINGS.md, "Accessibility" | `/cross-origin/`, `/transports/`. |
| "Use it" block for every library | learning-resource review, PR #36 | A short "how to use this on your own page" block per library. `/use-it/` (#129) has one for nine elements that draw on a 2D canvas. The shader elements (`fx`, `<physical-ui>`, `<live-transition>`) have none, apart from `/shader-css/`. |
| Real-GPU recordings for the homepage | learning-resource review | The thumbnails are from software rendering. |
| Check the stated floor of Chrome 148 | learning-resource review | The pages say "Chrome 148+". Nothing older than Chromium 153 was tested. |
| Unify `show-code.js` and `source-view.js` | PR #34 | Two listing components exist. |
| Split FINDINGS.md | learning-resource review | Done 2026-11-21: one file per strand in `findings/`. The index, bug list and API requests in `FINDINGS.md` are not yet split and are updated in a documentation pass. |
| Browser CI (`check:jank`) | this document | `.github/workflows/check.yml` now runs `npm run build`, `npm run check:fx`, `npm run check:writing` and `node tools/social/validate.mjs`. `check:jank` still runs locally because it needs Playwright with a Chromium build that has the API. |

## Not verified: needs real hardware or a person

The cloud browser that every result was measured in is headless Chromium 157 (and 153 for some probes) with software rendering, no GPU, no sound card, no native popup windows, no outbound UDP and no immersive WebXR. Everything below is unverified for that reason. Each page has live checks or a button that answers the question on the device that opens it.

Confirmed on the phone so far: the jank fixes ("I think it all works", 2026-11-20, no pages named), WebGPU on screen on `/shader-css/` ("Drawn with WebGPU (6), WebGL (1)", 2026-11-21), `/webgpu-features/` (10 of 10 live checks pass, drawn with WebGPU), the 21 trials of `/canvas-loss/` (both guard fixes hold), and `/hdr-glow/repro.html` (a float16 2D canvas, a drawable one and a WebGPU `rgba16float` canvas each show 4.0 brighter than 1.0), and the nested canvases of `/nested-frames/` (reported drawing on 2026-11-22 after being reported empty the day before; the cause was not found), the readable labels of the float buffer route of `/plan-followups/` (2026-11-22), and the change of skin on `/canvas-skin/` ("a lot faster", 2026-11-22, with `skin-change` reports of 0 to 28 missed frames of about 94).

| Area | What is unverified | How to verify |
|---|---|---|
| WebGPU | Every on-screen WebGPU path except `/shader-css/` and `/webgpu-features/`; its speed against WebGL; three `WebGPURenderer`; what the compatibility mode entry of `/webgpu-features/` shows on screen; `importExternalTexture()` and `copyExternalImageToTexture(video)` on a real GPU (`/gpu-video/`, `/video-text/`) | Open each shader page and read the "Drawn with" line and the two WebGPU check rows. `/three-form/?renderer=webgpu`. |
| Lens | Frame times on a real GPU; whether Chrome on Android keeps the sub-rectangle canvas-to-texture copy on the GPU | "Measure on this device" on `/lens/`. |
| Built-in AI | `Translator`, `Rewriter`, `Summarizer` filling the lens copy; the Prompt API planning tool calls and describing a picture | `/translate-lens/` and `/agent-view/`: the line under each demo lists what the browser reports; press "Use ... on this device" and run the live checks. |
| WebMCP | Whether Chrome 159 has `registerTool()` or `provideContext()`, and an agent calling the tools | `/agent-view/` with the WebMCP flag on: the first chip under the demo and the first live check. |
| Speech | Recognition, on-device processing, the effect of `phrases`, result timestamps, and whether `SpeechRecognition.available()` crashes outside headless | `/voice/`: press "Listen", say "lamp", and read the line under the demo. |
| Navigation shader | The ink shader in WGSL on screen, the Back gesture of the phone and its preview animation, taps on either view part way through a transition | `/nav-shader/`: tick "Slow", tap a card, tap inside both views while the shader runs, then go Back. Run the live checks for the WebGPU comparison. |
| Controller and focus | A real game controller (mapping, vibration, the `rawgamepadinputchange` origin trial), whether the phone vibrates on each move, the direction pad by thumb, a screen reader on each move | `/focus-nav/`: use the direction pad and the A button, then connect a controller and read the line under the demo. |
| Performance | The real performance wall and frame rates | `/perf/?run=full` on real hardware. |
| Particles | Whether the 2D default fixed the white block on Android; its cause | `/particles/` on the phone, then `engine="webgl"`. |
| Lost contexts | Which cause the phone hit on `/embed/` and `/selection/`; whether a 2D drawable canvas fires `contextlost` on Android | Phone, with the page's messages. |
| Touch | Touch dragging in the select pickers; `touch-action` inside a top-layer canvas; touch selection, handles and the copy menu, on a rotated line and with a transparent `::selection`; the loupe under a finger; a first tap on a curved 3D surface | Phone. |
| Native popups | Where the list of a plain `select`, the date, time and colour pickers, datalist suggestions and `title` tooltips open when the element is drawn transformed; whether `readonly` stops the Android date and time dialogs; the suggestions popover above the on-screen keyboard | Phone or a desktop browser with a window. Each row of `/elements/` has a "Draw it here" canvas. |
| Keyboard and IME | Whether the Android keyboard stays down during checks; IME composition and candidate windows; composition underlines in a drawn field | `/a11y/` section C by hand. |
| Screen readers | TalkBack or another screen reader on any page; the accessible proxy on `/embed/`; both `/native-ui/` apps | By hand. |
| Find in page | Whether the find bar's highlight is painted into an element's picture; `hidden=until-found`; `::target-text`; spelling marks | By hand with the find bar open. |
| Capture | Visible flicker during a capture | "Flicker check" on `/capture/`. |
| Video | Hardware-decoded video in the canvas; Widevine and HDR; audible output and audio timing; `AudioEncoder` and seek accuracy on Android; which media state pseudo-classes Chrome 159 has by default; `texImage2D(video)` with a hardware decoder; the touch layout of the controls | First four checks on `/video/`, fourth check on `/player-parts/`. |
| Remote | Any WebRTC connection between two real networks; TURN; the deployed rooms across devices | `/remote/` on two devices. Both ends have a connection log with a Copy button. |
| Vision endpoint | `/api/x/vision` with its real AI binding | `/support/` on the deployed site. |
| Storage partitioning | The BroadcastChannel bridge and the window-name consent route between two real sites | Needs two origins that are not same-site. |
| Consent window on Android | Android opens the `/slot-view/` consent window as a tab | Phone. |
| WebXR | A real headset or Android AR session; whether `paint` keeps firing behind an immersive session; `XRQuadLayer` | `/xr/` in a headset. The page counts paint events in session and shows the result on a panel. |
| Transports | Element Capture of a plain element, a drawable canvas and a canvas child (tab capture does not start in the test browsers); what stops while a tab is frozen; WebTransport against a real server | `/transports-2/`: the Element Capture button in desktop Chrome, the freeze test on a phone with the tab hidden for 90 seconds, `?wt=<url>` for a server. |
| Iframe tiles | `frame-sizing: content-height` and the focus policy on the phone; cross-origin tiles during prerender | `/iframe-tiles/`: "Run the measurements", and "Prerender both pages" pressed by a person. |
| Recent CSS and DOM features on the phone | Whether Chrome 159 has `<template for>` and the streaming methods; where it anchors a popover to a drawn control (Chromium 153 uses the layout box); long press for an `interestfor` hint; touch fling and the generated buttons on the carousel; which of the six component-kit features it reports | First live check on `/patch/`, third and fourth on `/popovers/`, the checks on `/carousel/` and `/component-kit/`. |
| Effects from CSS and sensors | Touch scrolling against main-thread property reads; the real tilt sensor (event rate, permission step); IME in the drawn input; `createValueRange()` on Chrome 159 | Scroll `/scroll-fx/` by touch; "Use the phone's tilt" on `/shape-ui/`; `/tilt-card/` prints the sensor's event rate; `/text-labels/` prints which measuring method it used. |
| Protected content | Spelling markers and the autofill preview in a drawn field; a tap on a permission element in a canvas on Android; a custom system accent colour | "Try it by hand" on `/protected/`. |
| Latency and capture additions | Latency and the long-frame split on real hardware, and whether `deviceTier()` matches the measured wall; `showDirectoryPicker()` and `FileSystemObserver` on Android; a printed capture with its margin boxes | The two latency buttons on `/perf/`; `/capture/` section C. |
| WebAssembly and WebNN | The WebNN graph on `/wasm-ui/` (ran only against a JavaScript stand-in); touch on its slider and dialog | "Run the edge filter" and the last live check on `/wasm-ui/` in a browser with WebNN on. |
| Room-scale XR | Hand joints, planes and depth on Android Chrome and a headset; a real anchor; `texElementSubImage2D()` into a quad layer's texture | `/xr-room/` in a session. Its "What a session reports" table records each. |
| Element ideas | The browser's find-in-page on `/element-ideas/#find`; a list box for `<select multiple>` on Android; touch drag on a slider drawn rotated 90 degrees | Phone. |
| HDR | Whether the WebGPU route of `/hdr-glow/` shows values above 1.0 brighter than white on the phone; whether an 8-bit readback of a float16 canvas also loses the context; whether the loss is a GPU process crash | `/hdr-glow/`: press "Use a WebGPU canvas", pick "As stored", and move the headroom slider between 1.0 and 8.0 while looking for the word BRIGHTER. |
| Uniforms from CSS | Every card of `/css-uniforms/` on the phone, the per-frame read cost, `:hover` on touch, a canvas buffer above 4096 px on a phone with a pixel ratio above 2.8 | `/css-uniforms/`: the status line under the canvas reports the cost. |
| Scoped view transitions | Why a 2D canvas of `/scoped-transitions/` lost its context on the phone; whether a 2D drawable canvas on Android fires `contextlost`; frame rate; a WGSL version | `/scoped-transitions/`: the line that starts "Contexts made:" under experiment 2, then Shuffle with "Run everything at 3 seconds" on. |
| Tables, lists and frames | Frame rate of `/sort-table/`, `/accordion/` and `/heat-map/` on a phone; the keyboard when a focused row is moved; find-in-page opening a closed `<details>`; whether Chrome 159 cuts the picture of a nested drawable; how many live iframes a phone keeps drawing on `/tab-fan/` | Each page on the phone. On `/minimap/` the check "The same with drawable on the scroll container" reports the cut. |
| Toolkits with DOM elements | `/imgui-dom/`, `/flutter-dom/`, `/qt-widgets-dom/` and `/godot-dom/` on a phone (keyboard, IME, autofill, native pickers, frame rate); a lost context on each; multi-threaded Skwasm; the gzip branch of the Godot loader on the deployed site | Each page on the phone. Each prints its timings under the demo. |
| Toolkit accessibility tree | Any screen reader on `/toolkit-aria/`: what is announced, where the focus rectangle sits, whether activate arrives as a `click`, slider increments | TalkBack on, swipe through the canvas, double tap Save and read the status line. |
| Backlog pages on the phone | Every page added by #69 to #101 by touch: frame rate, the on-screen keyboard, native pickers, long-press selection, `navigator.share()`. `:active` on a drawn button for a touch press (`/form-state/`). | Open the page on the phone and run its live checks. Each findings file ends with its own "Not verified" list. Then `npm run reports -- --since 2h --list`. |
| Speech and captions | `SpeechSynthesis` (no voices in the test browser), recognition of the video's audio track on `/live-captions/` (only the start was measured), `Translator` (never settles headless) | `/speak-words/` and `/live-captions/` on a device with voices and a model. |
| Video compositing | A real camera and background segmentation on `/presenter/`; a real screen capture on a phone on `/telestrator/`; the worker compositor with hardware decoding | The pages on a device with a camera and a GPU. |
| Developer tools and accessibility views | A screen reader on `/landmark-map/`, `/a11y-views/` and `/structure-depth/` | By hand. |
| Backlog pages of #107 to #123 on the phone | Every page added by #107 to #123 by touch. `/animated-images/`: the four raster formats and whether images pause off screen. `/video-lab/`: WebGPU on screen, a wide-gamut and an HDR screen, sound. `/plan-followups/`: whether the `RGBA16F` WebGL buffer is shown and brighter than white. `/motion-capture/`: hardware encoders and two real fingers. `/media-state/`: Remote Playback and Presentation with a real device. `/select-selection/`: `<select multiple>` on Android. `/blocked/`: a PDF viewer, the real permission prompt, two real hosts. | Open the page on the phone and run its live checks. Each findings file ends with its own "Not verified" list. |
| Qt text field | Autofill, one-time codes, which keyboard opens, a real IME, scroll into view, touch selection and fonts for the Qt and DOM fields of `/qt-textfield/` | `/qt-textfield/` on the phone: "Load the Qt app", do the step, "Copy the log". |
| Occlusion routes | The four routes of `/toolkit-occlusion/` by real touch; whether "the most recent `updateElementGeometry()` call wins" is specified | Pick each route, drag window A over the textarea and tap the covered part. |
| Draw size | That `/element-ideas/` and `/elements/` now draw at the right size on the phone; draws made only after a tap; draws in a worker | `/element-ideas/#ticker` on the phone, then `npm run reports -- --since 2h --list` for a `draw-size` report. |
| Friction log | The 19 probes of `/friction/` on Chrome 159; whether any entry is already filed upstream | `/friction/` on the phone: "Run these 19 checks". |
| Per-element themes | `/canvas-skin/` on the phone beyond the reported change of skin: the frame budget after the frame-time fix, gravity after it kept one texture per element, the glass shader's cost per element, the pencil skin's SVG filter, tilt for foil, metal and 3D blocks, a wrapped `<select>` picker, the on-screen keyboard, whether the "ResizeObserver loop" error is gone | Change skins on the phone, then `npm run reports -- --since 2h --list --page /canvas-skin/` for the `skin-change` reports. |
| Peel and conveyor | `/view-source/` and `/view-dom/`: the WebGPU route on a screen, the frame rate while the paper is dragged, touch selection in the source layer. `/conveyor/`: drag, flick and taps with a real finger, about 60 `drawImage()` slices a frame. `/use-it/`: all nine elements by touch, and the snippets pasted into a page on another origin | Each page on the phone; the pages write their numbers under "Findings". |
| Other browsers | Safari and Firefox as viewers of the cross-context pages | By hand. |
| Chrome version | Chrome 159 against the four probe results that differ between 153 and 157; Chrome 148 as the floor | `/chrome-apis/probes.html` on the phone. |
| Native UI | Qt Widgets (2D canvas route) | Not built. |
| Foldables | Any real foldable on `/fold/`: the segment rectangles, the hinge width of a dual-screen device, segments with the keyboard open, whether the drawn crease lines up with the real one, the opening swing on a real posture change | Open `/fold/` on a foldable and press "Use this device's fold". The table on the page shows the posture and segments. |
| Peripherals | A real Stream Deck (WebHID), ESC/POS receipt printer (Web Serial) and LED matrix on `/hardware-out/`; the report layout comes from open-source drivers | Desktop Chrome with the device, the "Connect" button of each panel. The status line beside it reports the result. |
| App window | `/window-chrome/` installed on a desktop: the window controls overlay, whether a drag region is at the drawn position or the layout box, `window.minimize()` and the other windowing calls | Install the app from `/window-chrome/`, turn on the overlay, run "Test 1" and "Test 2" in the app. |
| Chrome APIs gap-closing demos (demos 30 to 33) | `/linear-color/` (`srgb-linear`, `display-p3-linear`, `contrast-color()`, `ctx.lang` with separate CJK fonts), `/scroll-directions/` (`@container scroll-state(scrolled)`, `:target-before`/`:target-after`, `polygon(round ...)`), `/sanitized-stream/` (`Element.setHTML()`, `getComposedRanges()` across shadow DOM, `Temporal` frame log), `/webgpu-immediates/` (`GPUTextureView` for `texture_external`, `setImmediateData()`/`setImmediates()`, `SpeechRecognition.start(audioTrack)`), plus `npm run check:jank` on all four | Open each page on Chrome desktop and Chrome for Android (412 px, DPR 2.625) and run its live checks; run `npm run check:jank` where Playwright is installed. |

## Reports to make upstream

FINDINGS.md has two lists near the top: "Chromium bugs worth filing" (crashes and wrong behaviour with a reproduction page for each) and "API changes that would help" (requests that came out of the experiments). Nothing has been filed. Filing is the project owner's decision.
