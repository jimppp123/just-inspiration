---
name: AI 灵感
description: "A dense Pinterest notebook with bounded liquid branching."
colors:
  ink: "#111111"
  paper: "#fafafa"
  line: "#d8d8d8"
typography:
  interface:
    fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif'
    fontWeight: 400
  numeric:
    fontFamily: '"Geist", monospace'
    fontWeight: 400
rounded:
  image: "8px"
  bloom-image: "12px"
---

# Design System: AI 灵感

## North Star

**The Liquid Memory Field**

The default view is a horizontal liquid gallery of 22 images. A portrait centre
card stays largest while neighbours recede and flare through the glass at the
left and right edges. It plays automatically and accepts dragging, swiping,
wheel input and arrow keys. “JUST INSPIRATION.” sits below the images. The
top-left control transitions to a full ring overview, carrying the title into
its centre and preserving the current image order. Selecting an image isolates
it at the center before a second click or long press grows a bounded field of
Pinterest-related references.

During entry, cards resolve at their own positions with uniform scale; no
bridges join the lane until interaction. Side refraction arrives after the
cards take shape. The lower title uses 14–21px type, and the homepage has no
bottom-right source link; Pinterest links remain in the explorer.

## Product Model

- The board is the collection boundary.
- The horizontal gallery is the entry surface; the ring is its overview.
- The contact sheet is the high-capacity browsing surface.
- A Pin is both a source link and a seed for further exploration.
- A liquid bloom is temporary exploration state, not another permanent layout.
- One bloom contains at most 30 related images.

## Main Surface

### Header

The sticky header contains a compact back button, the active board name,
loaded item count, and active-board switcher. Search and the small collection
eyebrow are omitted.

### Contact Sheet

- Desktop: multi-column masonry with a target column width around 170px.
- Tablet: four columns.
- Phone: two columns.
- Images preserve the source aspect ratio and use an 8px corner radius.
- Images carry no visible title or numeric locator.
- Pointer position gently pulls the image and its refracting edge. Nearby
  images share the same SDF surface so close edges fuse continuously.
- A normal click isolates the selected image at screen center.

The contact sheet supports hundreds of items without putting all images into a
single GPU texture. Images use lazy loading and browser-native scrolling.
Only the visible region is drawn in WebGL, with stable atlas slots reused on
scroll. Its canvas is attached outside the scrolling container. If the context
is lost, the original DOM photographs are restored immediately.

## Liquid Bloom

### Timing

- First click in the contact sheet: the grid withdraws and the selected image
  moves to screen center.
- Second click on the seed: eight related images separate from it.
- Long press on the seed: related images continue appearing one at a time.
- Birth spacing is 200ms; each separation takes about 780ms.
- Double-click any rendered image: open that Pin in a new tab without
  triggering a branch change.
- The bottom-right action saves the current seed to browser-local board
  storage and changes to “已加入画板”.
- Maximum: 30 related images.
- Pointer release stops growth immediately and preserves the current result.
- Moving dots and a loading label become a dark breathing dot with
  “点击展开 · 长按继续” after the scene paints.
- Failed loads expose a labelled retry action.

### Form

The center image remains largest. Related images settle into irregularly
spaced positions with small variations in size and density. Rectangle packing
keeps their resting positions separate, while damped springs and gentle
collision response let neighbours move aside with at most 3.5% compression.
One WebGL SDF pass fuses cards as they are born, stretches a tapered
image-bearing neck, and pinches it away as each card settles. Hover gently
pulls the photograph and refracts its rounded glass edge.

The seed is drawn by WebGL after a single handoff from its entry preview.
Photographs upload as one prepared atlas; small screen tiles select nearby
cards for shading.

### Branching

Clicking a related image makes it the new center and requests another bounded
branch. The dedicated source link opens Pinterest. Escape or the back control
returns to the contact sheet.

### Related Ordering

The server requests Pinterest's `RelatedPinFeedResource` for the selected Pin
ID and returns at most 30 normalized public recommendations. It never substitutes
board neighbours or colour-distance guesses for related results.

## Board Data

The primary board starts with 25 local WebP files so the interface remains
usable offline. The client then requests cursor-paginated public board data
through same-origin API routes. A board can contribute up to 200 Pins and a
successful response is cached in session storage for ten minutes.

Pinterest images remain attributed and link back to their source Pin. Private
boards are outside this unauthenticated public-data flow.

## Responsive Behavior

- The compact header stays on one row on phones.
- The image field becomes two columns at 560px.
- Bloom positions use viewport-relative coordinates and stay inside the screen.
- Satellite images become smaller on phones while the center remains dominant.
- Motion is disabled under `prefers-reduced-motion`; the final state remains
  fully usable.

## Accessibility

- Every image is a keyboard-focusable button.
- Enter or Space opens a selected image and adds a batch from the center.
- A dedicated link opens the original Pin.
- The bloom is an ARIA modal dialog and closes with Escape.
- Focus states are high-contrast and do not depend on color alone.

## Shared Effects

The wheel, shelf and explorer bend photograph coordinates at the viewport edge to
produce sharp glass refraction with a small chromatic fringe. The shelf uses
the same refraction at the sticky header's lower edge. No blurred backdrop
stripe, decorative texture, or DOM hairline is placed over the images.
Text uses two stationary layers with reciprocal blur and slow alpha decay,
combined before a shared SVG alpha threshold. `textMotion.js` defines the
1.2s circ-out curve matched to the reference clip: dense strokes fuse into
rounded ink shapes, then resolve into the next string. No scale or per-glyph
stagger is applied. Labels and status updates share `MotionText`; reduced
motion shows the final string directly. Mouse users get a 10px breathing
contrast dot that flips through `mix-blend-mode: difference`.

WebGL pauses behind dialogs and in hidden tabs while retaining its context
and textures. The shelf holds its last frame when idle; rectangle measurements
run on layout changes rather than every frame. Spatial lookup uploads only
when a card crosses tile boundaries.
