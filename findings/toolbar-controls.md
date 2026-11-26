# Controls drawn over page buttons, a fieldset of checkboxes, a menubar and a file input (`/toolbar-controls/`, `lib/ui-feed/toolbars.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-26, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds four more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [scene-controls.md](scene-controls.md) and the files it lists. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these. The place names, the ledger rows, the menu items and the sample artwork are my own. A sheet with the originals above the rebuilds is in the project files at `ui-feed-fidelity/toolbar-controls.png`.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<page-marker>` | pagination whose marker travels (o-64) | a `<nav aria-label="Pagination">` with a `<ul>` of `<button>`s, `aria-current="page"` on one, and Previous and Next buttons that use `aria-disabled` at the ends so they keep focus |
| `<route-avoid>` | route avoidances sign (toggle group) | a `<fieldset>` with a `<legend>` and four `<input type="checkbox">`s stretched over their `<label>`s, an `<h2>`, an `<output>` for the time and a `<p>` for the distance and arrival |
| `<ledger-menubar>` | workshop ledger menubar (menubar) | a `role="menubar"` of buttons, `role="menu"` panels of buttons with `role="menuitem"`, an `<input type="checkbox" role="menuitemcheckbox">`, `<input type="radio" role="menuitemradio">`s, two submenus, a `<table>` and an `<output role="status">` |
| `<tee-print>` | printed T-shirt artwork (file input) | an `<input type="file" accept="image/png">` over the whole picture, a `<label>` for it as "Browse files" and another as "Replace", a sample `<button>`, a Remove `<button>`, an `<h2>` headline and an `<output role="status">` |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can a marker show the text under it in another colour with no second copy of the text? | measured: yes | The canvas draws the element, clips to the marker, fills its colour and draws the element again with `ctx.filter = 'brightness(0) invert(1)'` (white) or with `sepia` added (paper). The element must have no background of its own, or the filter turns the background white too and the marker disappears. The canvas paints the backgrounds of the menubar and menus itself for this reason. |
| Does the pagination marker stretch? | measured: yes | 70 ms after a click on 4 from 2 the marker ran from 1.61 to 3.26 pages, and at rest from 3.00 to 4.00. The form sent `page=4`; two clicks on Next gave `page=5` with Next `aria-disabled="true"`. |
| Does a fieldset of checkboxes choose the route? | measured: yes | Checking tolls, motorways, ferries and unpaved one at a time gave the A8 (44 min), A3 (63), ferry (76), R305 (85) and N14 (97) routes. The yellow wipe was 0.16 of the way across about 30 ms after a click. The form sent all four values. |
| Do the menubar keys work? | measured: yes | Down opened File on its first item, Right moved to Edit (Undo `aria-disabled`) and on to Ledger. Enter posted JC-0420 at the top of the table and put focus back on Ledger; Ctrl+Z took it away. End, Right and Left went into and out of a submenu. Space on the VAT checkbox narrowed the column (28.9 px wide 60 ms later, from 42) and then hid it, and the form stopped sending `b-vat`. |
| Does the file input refuse and accept files? | measured: yes, with a DataTransfer | A 300 × 400 PNG gave "Too small" and "tiny.png is 300 × 400 px: 1.0 × 1.3 in at 300 dpi. Send 1200 px or more." A JPEG gave "Not a PNG". A 1500 × 1800 PNG printed at 5.0 × 6.0 in with "1 colour", and the form sent `art=art.png`. A JPEG after that kept the form sending `art.png` and offered "Keep art.png". |
| Do touches work? | measured: yes (emulated Pixel 7, CDP touch events) | Taps on 5 and Previous gave `page=5` then `page=4`. A tap on Motorways gave `avoid=motorways` and 76 MIN. A tap on Ledger opened it, a tap on "Post job card" added a row and closed it, a tap on "Show VAT column" hid the column, and a tap on the table closed the menu. A tap on the sample printed `sea-swim-club.png` and a tap on ✕ removed it. A vertical swipe on each of the four scrolled the page by 145 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the four checkboxes were plain HTML, and a click on Ferries gave `avoid=ferries`. |
| Do the controls stop painting? | measured: yes | 0 paint events in 500 ms at rest for each of the four. |
| Page checks | measured | `check:jank` ok (cls 0, scroll 0, 25.1 MB, checks wait for a tap), `tools/draw-size/audit.mjs` 0 calls with no size, `tools/scroll-anchor/audit.mjs` held still. |

## Things that bit

- Every direct child of a layoutsubtree canvas is laid out at the canvas's corner. `getComputedStyle()` reports `position: static` for a shown child even though the base class sets `position: absolute`, and `left` and `top` are ignored. A hidden child reports `absolute`. So the menus' places are kept in a `Map` and used when drawing, and the place of an item inside a menu is measured with `offsetTop` chains.
- `'-'.sub` is a function (the old `String.prototype.sub()`), so a check for a submenu with `it.sub` was true for the separator strings.
- A focused `appearance: none` radio still drew its focus outline in the menu's picture, which showed as a box under the blue bar.
- A headline drawn over the file input took the hit, so a press on the big letters did nothing. The input is now drawn after the headline (with no alpha) and before the buttons.
- `.next` matched the `<li class="step next">` before the button inside it.

## Not verified

- Everything on a phone.
- A real drag and drop of a file onto the drawn input (the "Let go" headline was only exercised by its event listeners), and the file picker opening from a tap.
- What a screen reader says for a menubar whose checkbox and radios are inputs with menu roles, and for `aria-disabled` page buttons.
- The fonts. The originals use a didone, a road sign face, a heavy extended grotesque and Times; the test browser fell back to Liberation Serif and Inter.

## For the index

- `/toolbar-controls/`: four ui-feed.dev demos rebuilt (pagination, route avoidances toggle group, workshop menubar, T-shirt file input).
- A marker that shows the text under it in another colour: draw the element, then draw it again clipped to the marker through `ctx.filter`. The element needs a transparent background.
- Direct children of a layoutsubtree canvas ignore `left` and `top` and report `position: static` while shown. Keep their places in script.
- A `<col>` width changed in a frame callback narrows a table column a frame at a time, and each change raises its own paint event.
