# The slot-view protocol, version 1

How a page (the **embedder**) shows a live, named piece of another site's page
(the **provider**) and sends input to it, without either side touching the
other's DOM. Reference code: `lib/slot-view.js` (embedder) and
`lib/slot-provider.js` (provider).

The provider's page runs in a frame that the embedder keeps invisible. Only
the provider needs HTML-in-canvas: it paints the piece through a canvas and
sends the pictures.

## 1. Offer (window messages)

The provider marks pieces of its page:

```html
<live-region slot-name="product" slot-title="Product card">…</live-region>
<live-region slot-name="price" slot-consent="none">…</live-region>
```

When the page finds itself in a frame it posts to its parent:

```js
{ slotview: 1, type: 'ready', supported: true, slots: [{ name, title, consent: 'ask' | 'none' }] }
```

The embedder answers with one request and a `MessagePort`. Everything after
this travels on the port.

```js
{ slotview: 1, type: 'request', slot: 'product', scopes: ['view', 'input'], sizing: 'fill' | 'content' }
```

The provider learns who is asking from the browser (`event.origin`), never
from the message.

## 2. Consent (provider → embedder unless marked)

| Message | Meaning |
| --- | --- |
| `{ t:'consent', state:'needed', title, scopes, popup, min:{w,h} }` | The person must be asked. Nothing has been sent. |
| → `{ t:'present', mode:'frame' }` | The embedder has made the provider's frame visible, at least `min` big. The provider draws its question in it. |
| → `{ t:'present', mode:'popup' }` | The embedder will offer a button that opens `popup`, a page on the provider's origin. |
| `{ t:'consent', state:'granted', scopes, how }` | Pictures follow. `how` is `frame`, `window, …`, `remembered`, `allow-list` or `public`. |
| `{ t:'consent', state:'denied', reason }` | Declined, or not offered to this site. |
| `{ t:'consent', state:'revoked' }` | The grant was given up. |
| → `{ t:'ask' }` | Ask again. |
| → `{ t:'dismiss' }` | Answer the open question with "no". |
| → `{ t:'revoke' }` | Give up the grant; the provider forgets it. |

Rules the provider keeps:

1. **No pixel and no element map before `granted`.** Every other message is answered with `{ t:'refused', why:'no consent' }`.
2. **Only a real click on the provider's origin grants.** The question is never part of the pictures, so forwarded input cannot reach it. In the frame, Allow is enabled only while `IntersectionObserver` v2 reports the prompt fully visible (not covered, faded, filtered or transformed). Otherwise the prompt offers the window instead.
3. **`view` and `input` are separate.** The person can allow viewing alone. Input messages to a view-only grant get `{ t:'refused', why:'view only' }`.
4. **Slots marked `slot-consent="none"` are public**: granted at once, `view` only.
5. **Grants are kept per embedding site and slot** in the frame's own storage, which browsers partition by the top-level site.
6. **The embedder can only say no**: `dismiss`, `revoke`. There is no message that says yes.

The consent window finds the waiting frame by itself (the embedder is not a
relay): the frame names its window `slot-view-<nonce>`, the window is opened
at `<provider page>#slot-view-ask=<nonce>` and calls
`window.open('', 'slot-view-<nonce>')`. Being same-origin, it reads the
request, including the embedder's true origin, straight from the frame.

## 3. Live (after `granted`)

Provider → embedder:

| Message | Meaning |
| --- | --- |
| `{ t:'layout', w, h, below, sizing }` | CSS size of the piece and how far its first text baseline is above its bottom edge. |
| `{ t:'meta', w, h, title, map }` | Element map: `{ id, role, name, rect, value?, editable? }` per control, rects 0..1. Private values withheld. |
| `{ t:'frame', bitmap }` | An `ImageBitmap` with alpha, transferred. |
| `{ t:'focus', … }`, `{ t:'select', … }` | What has focus; a request to show a native picker. |
| `{ t:'app', data }` | Whatever the provider's page chooses to tell its embedder. |
| `{ t:'themed', applied, ignored }` | Answer to `theme`. |
| `{ t:'attention', on:true, reason:'confirm', label, popup, min }` | A guarded action was requested; the person must confirm with the provider (answer with `present`, as for consent). |
| `{ t:'attention', on:false, done }` | Confirmed or cancelled. |
| `{ t:'plain' }` | The provider has no HTML-in-canvas. Show the frame as it is. |

Embedder → provider:

| Message | Meaning |
| --- | --- |
| `{ t:'hello', frames:'bitmap' }` | Start the pictures. |
| `{ t:'pointer', kind:'down'|'move'|'up'|'wheel', x, y }` | Pointer, 0..1 in the piece. |
| `{ t:'key', key, shift }`, `{ t:'text', data }` | Keyboard. |
| `{ t:'act', kind:'click'|'fill'|'focus', id, value }` | Act on a control by map id (keyboard and assistive technology). |
| `{ t:'choose', id, value }` | Answer to `select`. |
| `{ t:'highlight', id }` | Draw attention to a control (used as a focus ring). |
| `{ t:'theme', vars }` | Ask for custom properties. The provider applies the ones on its list whose values match its patterns. |
| `{ t:'bye' }` | Stop. |

Elements the provider marks `data-trusted` are never activated by forwarded
input. A press on one raises `attention`, and it happens only if the person
confirms on the provider's origin.

## What the embedder ends up holding

Pictures of the piece, its size and baseline, the names and positions of its
controls, and whatever the provider says in `app`. It never holds the DOM,
cookies, or anything outside the region.
