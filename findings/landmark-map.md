# Landmark map (`/landmark-map/`, `lib/devtools/landmarks.js`)

Measured in headless Chromium 157 (C157) on 2026-11-21. The accessibility tree was read through the DevTools protocol by `node tools/devtools-pages/verify.mjs`. The other rows are the page's live checks.

| What | Result | Detail |
|---|---|---|
| Role and name of every element of the drawn page, rule table against the accessibility tree | agree | 32 elements as loaded and 33 with the faults on, 6 landmarks each time. |
| `<header>` and `<footer>` of a page drawn inside a canvas that is inside the site's `<main>` | not banner and contentinfo | The tree reports `sectionheader` and `sectionfooter`. Ancestors outside the canvas count. |
| `<form>` with no name | role `form` | The HTML accessibility mapping gives it no landmark role. The map follows Chromium and reports the missing name. |
| `<section>` with no name, `<header>` and `<footer>` inside `<article>` | no landmark role | Dashed outline in the map. |
| `element.computedRole`, `computedName` | do not exist | Without a flag. A page must carry its own rules. A live check compares when they exist. |
| Names from `aria-labelledby`, `aria-label`, `title`, in that order | works | Four sections in a fixture. |
| Position of a tint at a draw scaled by 0.5 | on the pixels | Map 50, 25, 50 by 20; red pixels the same. |
| Faults found | four kinds | More than one main, two navigation landmarks with no name, a form with no name, text in no landmark. |
| Setting `aria-label` | no paint event | 0 events in 300 ms. The page uses a MutationObserver. |
| `ctx.filter = 'grayscale(1)'` on the drawn page | works | Controls in it still take taps. |

## Things that bit

- The first rule table stopped at the drawn element and called the small page's header a banner. The comparison with the accessibility tree showed the difference. The page now has a switch for either scope.
- The site's own `main { max-width; margin: 0 auto }` rule applied to the `<main>` of the small page and made it narrower than its siblings.
- The shared test stage has `aria-hidden="true"`. A rule that skipped everything under an `aria-hidden` ancestor found no landmarks in any fixture, so that test stops at the root.

## Not verified

- A screen reader. TalkBack on the phone should list six regions for the canvas content with the names in the map. Not run.
- Names from `<label>` or content, `aria-owns`, shadow trees, landmarks inside frames.

## For the index

- Accessibility: landmark roles of canvas children in the accessibility tree follow the whole document, so a `<header>` drawn in a canvas that sits inside a `<main>` is not a banner (measured through the DevTools protocol, C157, `/landmark-map/`).
- Accessibility: `element.computedRole` and `computedName` are not available without a flag (measured, C157, `/landmark-map/`).
- The canvas, the attributes and the paint event: a change to `aria-label` raises no paint event (measured, C157, `/landmark-map/`).
- drawElementImage() in a 2D context: `ctx.filter` applies to the drawn element and the element stays interactive (measured, C157, `/landmark-map/`).
- Ideas built: "Landmark map" (`ELEMENTS.md`, rank 2, a11y).
