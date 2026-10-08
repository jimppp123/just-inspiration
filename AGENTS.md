# AGENTS.md

Working notes for this repo. Read this before changing anything under
`components/` — most of the code is one WebGL machine and a lot of it is
non-obvious in ways that look like bugs.

## What this is

A single-page inspiration browser. The homepage is a horizontal gallery:
a large centre card, smaller neighbours, and glass that flares outward at
the screen edges. It auto-plays and accepts wheel, drag, swipe and arrow keys.
The top-left dot opens the inspiration shelf over the gallery.
The cards are not DOM elements or textured quads — the whole gallery is **one
full-screen fragment shader** drawing signed distance fields, which is what lets
neighbouring cards melt into each other ("goo") and string honey-like threads
as they separate.

Everything visible is either that one shader pass or a handful of absolutely
positioned DOM labels over the top of it.

## Commands

```bash
npm run dev      # localhost:3000
npm run build    # also the fastest correctness check
npm run lint     # eslint
npx prettier --check "components/**/*.{js,jsx}" "app/**/*.{js,jsx}"
```

There are **no tests**. `npm run build` plus `npm run lint` is the whole safety
net. GLSL is compiled at runtime, not at build time, so a shader typo builds
fine and fails in the browser console — check shader edits by loading the page.

## Layout

```
app/
  page.js              renders <Carousel />, nothing else
  layout.js            root layout + metadata
  globals.css          Tailwind v4 import, @font-face, page background

components/
  Carousel.jsx        the component. renderer, resize/fit, input, spin
                       physics, the per-frame layout loop, the entry timeline
  ring/
    projects.js        project data in carousel order
    params.js          every tunable, as a factory
    utils.js           TAU/DEG, easings, signedOffset, chase
    atlas.js           packs all art into one texture, incrementally
    meta.js            legacy ring type lockups; no longer imported
    splitText.js       the intro heading ("Works '26")
  ActionCursor.jsx     glass fallback and precision cursor for controls
    gui.js             lil-gui dev panel, dynamically imported
  shaders/
    planeShaders.js    the ring: SDFs, goo, glass lip, tag. ~430 lines of GLSL
    textShaders.js     the per-glyph reveal for the intro heading
```

`Carousel.jsx` is ~1400 lines and deliberately so. The fit logic, pointer
handling, layout loop and timeline share about twenty closure variables. They
have been left together because threading a context object through them reads
as tidier in a file tree and is harder to follow in an editor.

## The three coordinate ideas

Get these wrong and nothing else makes sense.

**World px.** Origin at screen centre, **Y up**. This is the space the shader
evaluates in, so pointer coordinates are converted into it once, on the way in,
and never again. Page Y is down, hence sign flips whenever the two meet.

**Ring slot vs plane index.** Planes are numbered in _fan order_: the seed
first, then alternating either side of it, so index 0,1,2,3,4 sits at slot
0,+1,-1,+2,-2. `signedOffset(i)` converts between them. The horizontal view
wraps `slot + spin / step` to the nearest copy, then negates it for X.
This preserves project order and spin when switching to the ring overview.

**`g`, the stage scale.** Every plane-pixel measurement is multiplied by `g`,
so the goo keeps its proportions. It interpolates from the gallery card scale
to the overview scale. `wheelView.progress` blends both layouts continuously.

## Responsive model

Params are authored against a **reference window** (`refWidth: 1512`, a 14"
MacBook Pro at default scaling) and scaled by `fit = viewW / refWidth`, clamped
to `[minScale, maxScale]`. Width alone drives it by default, which keeps the
composition proportional. Gallery width is additionally bounded by
`laneWidthFill` and `laneHeightFill`, so portrait and short landscape windows
both retain room for controls. The full ring overview fits the shorter side.

On top of that are two **bands**, computed in `refit()` and applied as
multipliers, not replacements:

|        | `narrowAt` ≤ 1024 | `tightAt` ≤ 640         |
| ------ | ----------------- | ----------------------- |
| plane  | ×1.25             | —                       |
| radius | ×1.3              | ×0.82 (stacks → ×1.066) |
| text   | ×1.5              | heading ×0.8            |

Two rules when touching this:

- **`refit()` runs on resize only.** The layout loop reads
  `fit`/`planeK`/`radiusK`/`textK` thousands of times a second and must not
  recompute them.

If you tune on a machine that isn't 1512 wide, set `refWidth` to your window
first — the **fit** folder has a button that reads it off the live one.
Otherwise you are tuning against a scale factor that isn't 1 and everything
will be wrong everywhere else.

## Non-obvious things that will bite you

**`uScale` is a packed vec4.** `xy` is the birth scale, `z` is brightness (for
the side-card dim), `w` is which atlas cell the plane wears. They ride together
because GLSL ES allocates a full vec4 row per uniform-array element whatever
you declare, so `.zw` were already being paid for. Adding a separate `float[32]`
would cost 32 more rows against a guaranteed budget of 224.

**Art is dealt by ring slot, negated.** `cellOf(slot)` keeps the visual order
aligned with the project array while the fan-order plane indices alternate
between both sides of the seed.

**The deck shows twenty-two items; the shelf keeps the full collection.**
`RING_CAPACITY` only limits the active WebGL deck. Selecting an item outside
that deck moves the window of twenty-two rather than dropping projects.

**Side refraction and hit testing share coordinates.** `glassBend()` bends
the entire field before evaluating SDFs. The layout's probe applies that same
inverse warp. Keep both in sync so a curved side card remains clickable.
The ring requests uncropped 736px sources through the image proxy with a local
fallback. Atlas cells store complete images; `atlas.aspects` fits each card to
its decoded natural ratio through `uScale.xy`, in both layouts. There is no
second portrait crop. The chosen source and dimensions travel to the focus
preview. Side warp and CPU probe share the same quintic profile and bounded
horizontal pull; soft colour dispersion affects only the outer silhouette.

**Shelf images use the source image's natural ratio.** The shelf first asks the
same-origin Pinterest image proxy for the uncropped source, then falls back to
the local ring asset. `PinImage` updates `--image-ratio` after either source
loads. The liquid atlas must draw the complete source and use the same ratio;
do not restore `object-fit: cover` or centre-crop its canvas cell.
Animated GIFs request the original source through that proxy and remain DOM
images so the browser advances their frames. `ShelfLiquid` excludes
`data-animated="true"` cards from its static atlas; do not hide or canvas-copy
them at rest. The proxy allows GIF responses up to 24 MB, while other images
keep the 12 MB limit.

**`PROJECTS` order is ring order, not filename order.** Reordering rows moves
the ring and the shelf together.

**Loading is an invisible gate.** The smoothed readiness value tracks
`min(load progress, birth progress)` and releases the entry only when both
finish. There is no visible loading number.

**Gallery entry opens horizontally.** The centre image is born first, then
neighbours unfurl left and right with liquid bridges over 1.5 seconds.
`entryBirthTime`, `laneRevealTime`, `laneEnterScale` and `spreadEase` tune it.
Do not restore the small circle or orbit phase. Birth scales are uniform on
both axes, and side glass arrives near the end of the spread.
The full twenty-two-card deck remains available at rest.
Each card keeps its own image throughout the opening. All nearby images receive continuous,
normalized distance weights; do not rank-limit or circularly cull the color
field, since that cuts visible seams through overlapping cards.
Zero-width bridges use a negative sentinel so they cannot leave
hairlines at rest. The atlas uses linear filtering without mipmaps: automatic
mip selection across changing atlas cells can pull colours from unrelated
images.

**The side-card focus is one frame stale, deliberately.** The hit test that
decides which card is hovered runs _inside_ the layout loop, but every plane
needs an answer before the loop reaches that card. `focusPos` is latched at the
end of a frame for the next one. It is eased over ~10 frames, so the lag is not
perceptible.

**The hover ASCII field is deliberately disabled.** `focusParticles` remains
available in the dev panel, but defaults to `false` so hovered images do not
grow a character cloud behind them.

**UI text morphs through one shared component.** `MotionText` stacks outgoing
and incoming strings and sends their combined alpha through `#ui-text-goo`.
`textMotion.js` restores the reference's 1.2s circ-out curve, reciprocal blur,
and slow alpha decay. Glyph positions stay fixed: do not add scaleX, separate
thresholds per layer, or per-character stagger. The filter is removed at rest.
The homepage and static shelf cards share the 28px glass cursor in
`ring/cursorLens.js`. Their existing shader passes keep its centre clear and
bend the image through a monotone magnifying interior and lip, with radial RGB
dispersion across internal contrast edges, directional highlights and slight
movement-driven deformation; no central white glint, idle breathing or extra
render target. Tune `cursorParams()` in `ring/params.js`.
`ActionCursor` provides a DOM glass fallback for animated GIFs, focus images,
blank space, dragging and page transitions.
Commands use an 18px clear ring with a tiny precision point, without blurring
the text beneath or shrinking on press. A cached SVG displacement map bends each RGB channel with the
same profile, at a gentler strength over controls and text fields. Browsers without SVG
backdrop filters retain the CSS glass rim. Position follows input directly; only the glass deforms.
It moves into the active native dialog, including its backdrop. Mouse input
sets `data-glass-pointer` on the root to suppress all native pointer shapes;
touch and window blur clear it. `data-cursor-rendered` explicitly hands
ownership to a currently visible shader cursor, with no opacity delay.
The top-left dot stays visually 14px inside a real
52px button; retain that hit area when changing its appearance.
The shelf disables shader pointer effects under reduced motion and uses the
static DOM glass cursor in that mode.
The ring exposes its SDF hit result through `data-cursor-active`.

**Only visible scenes render.** `renderLoop.js` pauses WebGL behind dialogs
and beneath `data-scene-paused` ancestors, and in hidden tabs, without
destroying the atlas or context. A modal ignores paused ancestors outside
its own top-layer boundary. The homepage explicitly keeps rotating under a
board menu (`data-scene-background="live"`); a covered homepage still pauses
under the shelf and its menu. `Notebook` keeps the homepage mounted while the shelf is open, so
returning preserves the current ring instead of replaying its loader.
DOM images own page transitions; the shelf canvas takes over after they settle.
The shelf's first WebGL frame matches the flat DOM image. `handoffTime` then
eases refraction, goo and the glass rim in over 480ms; start after the first
paint so shader compilation cannot skip the handoff. Keep rendering until it
finishes, then retain the idle frame. Do not fade two differently warped
images over each other. The shelf opts into `CONTINUOUS_GLASS`: a quadratic
edge profile with bounded displacement keeps UVs from folding back during
the reveal. The focus scene retains its existing glass profile.
`shelfTransition.js` animates visible image surfaces from the top-left black
dot into their shelf positions over 820ms with a small distance delay and
1.2% settling overshoot. Exit contracts them back to that same dot over 560ms,
including after scrolling. Translation and uniform scale preserve natural
ratios; a circular aperture relaxes to the final rounded rectangle.
Measure destinations from the stationary card, not its moving image.
The header and footer never scale or translate. During navigation the shelf
header is transparent and the underlying homepage header stays hidden, so
the exiting shelf cannot leave an opaque white strip over the gallery.
The page does not blur or fade in. Interrupted entry continues from its current pose;
all animation layers are released at rest. The homepage prefetches the complete
active board without replacing the live ring. Opening the shelf waits for that
shared request, then mounts the final deduplicated collection once; do not
replace or append to a visible multi-column shelf because the browser will
rebalance every column and make the page flash. Pinterest feeds deduplicate by
source-image hash as well as Pin ID. The shelf reuses decoded homepage sources
and their dimensions.
GIFs still request the original animation. The shelf shows no collection counts.
Focus reuses the clicked source and crossfades only after its first WebGL frame.
The shelf also
keeps its last frame at rest. Cache shelf rectangles until scroll, resize,
image load or transition completion; do not measure every card on every frame.

**Focus images split one at a time.** `LiquidScene` releases one image every
0.2s with a 0.78s reveal. A click queues eight images; holding requests one
every 200ms. Only loaded images can appear, and closing stops new births.
The atlas still uploads once before the scene becomes ready.
The main image uses `coreScale: 1.18`; both the DOM preview and WebGL layout
call `coreSize()` so the handoff preserves its dimensions and natural ratio.
Tune `birthInterval`, `splitTime` and `coreScale` in the focus GUI.
Below the main image, three loading dots merge and fly to its centre only
after the scene has painted and related images are available. `LiquidScene`
owns the ready dot and concentric photo refraction in the same shader and
clock: breathing and waves start on arrival, then fade on the first split.
The arrived dot is white at 28% opacity. Ripples use narrow Gaussian crests,
clear refraction and a 0.9-second period, leaving the photograph calm between
wave fronts. Merge and flight take 0.5s; the ripple has its own 0.12s attack.
The travelling envelope extends past the first crest so it appears immediately,
without waiting a full wavelength. Keep the main image still until then. The wave displaces only its
texture, not its outline or aspect ratio. Tune the `ready cue` GUI folder.
Reduced motion uses a static white centre dot. Guidance stays screen-reader-only;
errors expose an accessible retry icon.

**Board menus share `BoardMenu` and `useLiquidDialog`.** Backdrop clicks and Escape
keep the native dialog open until its exit animation finishes. There is no
visible close button or reserved heading row. Changing
boards waits for that exit before replacing the keyed carousel.
The current design is a light translucent 388px menu anchored below its
trigger, with 24px rounded corners, a softly lit 7px lip, pronounced backdrop
refraction, 4% lens magnification and dark type. The add form is always
visible and there is no visible "画板" heading. Its iOS-style spring scales the
glass and DOM together from the trigger, retaining velocity through reversals.
A small overshoot, gentle squeeze and rounded corner flex give it
inertia. Menu items use plain DOM text. Both top-right board triggers use
`MotionText` for the same stationary liquid morph on hover and name changes;
the shelf has no visible board name beside its top-left dot.
Do not reintroduce the dark tint, thick white bevel, blurred menu text, or
full-height drawer.
Tint and frost are uniform across the entire pane, including the corners.
Do not fade them at the perimeter: that creates a clear gutter around a milky
interior. Edge depth comes from refraction and a soft highlight, without dark
tint or rim shading. The bend uses separate face weights and a slope-limited falloff; do not squeeze a large UV
offset into the narrow highlight band or use SDF normals for the broad bend.
Both create folded image strips and abrupt corner creases.
`liquidDrawer.js` draws the glass behind `.drawer-content`; its ResizeObserver
tracks changing content height. `sceneSnapshot.js` captures the visible art
before opening; on the homepage it then publishes each new frame directly to
the menu. Both the initial copy and live texture upload must happen synchronously
after the source draws (its drawing buffer is not preserved). The shelf menu
stops drawing at rest. Menus unsubscribe when closed, reuse their context, and
explicitly release it on unmount. Tune them in `focus/params.js` / the
`glass menu` GUI folder.
Homepage, shelf and focus share `.nav-dot`: a black dot with a 52px hit area,
and `--nav-top`, `--nav-side`, `--nav-height` keep their centres aligned.
Press feedback changes only the dot opacity, never the button's position or
scale. Board labels and chevrons also share coordinates. Focus's “加入画板”
control has no underline.

**Manual input temporarily owns the ring.** Drag and wheel input write angular
velocity; after it snaps and `autoResume` expires, automatic rotation
continues. Horizontal drag distance is converted through the live lane spacing
into that same angular phase. `pick()` tweens `state.spin` directly and suspends both.

**Touch is not a mouse with one finger.** `pointer.inside` (is the position
worth reading — what the hit test needs) is separate from `engaged()` (should
the softening be on). On touch the latter requires a deliberate press-and-hold,
because a finger has no hover state. Also: **Safari reports `movementX` as 0
for touch**, so drag distance is measured from `clientX`/`clientY`; using
`movementX` makes every swipe look stationary and end in a tap.

**`touch-action: none`** on the canvas is load-bearing. Without it the browser
claims the gesture and the `pointermove` stream dies mid-drag.

**The WebGL context must be released explicitly.** `renderer.dispose()` frees
GL resources but leaves the context alive until the canvas is collected, which
is not deterministic. The effect re-runs on every StrictMode double mount and
every hot update, so contexts pile up; past the browser's limit (~16 in
Chrome) `new THREE.WebGLRenderer()` throws before the canvas is ever appended
and the page is blank with no canvas in the DOM at all. Cleanup calls
`forceContextLoss()` for this reason — do not remove it. Symptom if it
regresses: blank after a long dev session, fine after a hard reload.

## Conventions

- **All tuning lives in `params.js`.** If you are about to hardcode a number in
  the layout loop, it probably wants to be a param with a dev-panel control.
- **Add a control when you add a param.** `ring/gui.js`, in the matching
  folder. Wire the right `onChange`: `refit` for anything the bands depend on
  and `replay` for anything baked into the entry timeline at build time.
- **Comments explain why, not what.** The code says what it does. Keep them
  short; the one long doc block in the repo is on `meta.js` because that
  technique genuinely does not read off the code.
- Prettier defaults, no config file. Run it before committing.
- The dev panel is `process.env.NODE_ENV === "development"` only and both it
  and lil-gui are dynamically imported, so neither reaches production.

## Known gaps

Listed roughly by how much they matter, so an agent picking up work knows what
is missing versus what is deliberate.

1. **Fonts are `.otf`/`.ttf`, ~340 KB.** Converting to `woff2` would cut that
   by roughly 60%. PP Neue Montreal is also gitignored, so the heading falls
   back on a fresh clone — see below.
2. **The art is webp but still oversized.** ~3.3 MB across eighteen files. The
   atlas downsamples every one to a 512px cell, so resizing the sources to
   match would cut it again by a large margin.
3. **Local homepage fallbacks are pre-cropped.** The ring and shelf request
   uncropped Pinterest sources first. If those fail, local files cannot recover
   image content already removed by the original asset crop.
4. **All the sample data is placeholder.** Every `type` and `year` in
   `projects.js` is invented and names marked `(*)` are guesses. The images
   are other people's work, collected from Behance to build the layout
   against — not the author's, not licensed, and flagged as such in the README
   and LICENSE. Do not present them as portfolio work or strip those notices.
5. **Remote originals depend on Pinterest availability.** Local fallback files
   cannot recover image content removed by the original asset crop.

## This is a public repo

Two things to respect when adding files.

**PP Neue Montreal is bundled but not licensed.** `public/ppneuemontreal-book.otf`
is a commercial Pangram Pangram face, kept in the repo so the design renders
during development. It is called out in the README and LICENSE as development
only, not for commercial use. Do not quietly widen its use, do not remove the
notices, and if you swap the heading to a free face, take the file out with it.
Satoshi (ITF Free Font Licence) and Geist (OFL) have no such restriction.

**Keep third-party attribution intact.** The simplex noise in
`planeShaders.js` carries an MIT notice that has to travel with the code. If
you pull in more shader snippets, credit them the same way and add a line to
the LICENSE and the README's Credits section.

Source is MIT. The contents of `public/` are explicitly _not_ covered — see
`LICENSE`.

Font families are looked up **by name**: `textFont` in `params.js` must match a
`@font-face` family in `app/globals.css`, and the dropdown in `gui.js` lists it
a third time. A missing name falls back silently and can look like a rendering
bug.

## Dead files — safe to delete

- `components/TwoPlaneMorph.jsx` — an earlier experiment, nothing imports it.
- `shader` (repo root, no extension) — a 13 KB paste of somebody's component
  library docs. Not code, not referenced.
