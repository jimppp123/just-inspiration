"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import InspirationControls from "./InspirationControls";
import { startRenderLoop } from "./renderLoop";
import MotionText from "./MotionText";

import {
  vertexShader,
  fragmentShader,
  MAX_PLANES,
  MAX_LINKS,
} from "./shaders/planeShaders";
import { buildAtlas } from "./ring/atlas";
import { createSplitText } from "./ring/splitText";
import { createAsciiTexture } from "./ring/ascii";
import { defaultParams } from "./ring/params";
import { createCursorLens, cursorUniforms } from "./ring/cursorLens";
import { PINTEREST_BOARD, PROJECTS } from "./ring/projects";
import { requestBoard } from "./pinterest/boards";
import {
  TAU,
  HALF_PI,
  DEG,
  chase,
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  signedOffset,
  smoothstep,
} from "./ring/utils";

// The fan starts fractionally into the spread so the seed reads first.
const FAN_START = 0.06;
const RING_CAPACITY = Math.min(22, MAX_PLANES);
const wrapSlot = (value, count) =>
  ((((value + count / 2) % count) + count) % count) - count / 2;

const deckStartFor = (index, total) =>
  Math.min(
    Math.floor(index / RING_CAPACITY) * RING_CAPACITY,
    Math.max(0, total - RING_CAPACITY),
  );

const mergeProjects = (remote, local) => {
  const localById = new Map(local.map((project) => [project.id, project]));
  return remote.map((project) => {
    const cached = localById.get(project.id);
    if (!cached) return project;
    return {
      ...project,
      file: cached.file,
      thumb: cached.thumb ?? cached.file,
      source: cached.source ?? project.source,
      width: cached.width ?? project.width,
      height: cached.height ?? project.height,
      dominantColor: cached.dominantColor ?? project.dominantColor,
    };
  });
};

const blankTexture = () => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
};

export default function Carousel({ onExplore, onFocus }) {
  const openingShelf = useRef(false);
  const [collection, setCollection] = useState({
    board: PINTEREST_BOARD,
    projects: PROJECTS,
  });
  const [switchingBoard, setSwitchingBoard] = useState("");
  const [syncingBoard, setSyncingBoard] = useState("");
  const [deck, setDeck] = useState({
    start: 0,
    focus: 0,
    instant: false,
  });

  const ringProjects = useMemo(
    () => collection.projects.slice(deck.start, deck.start + RING_CAPACITY),
    [collection.projects, deck.start],
  );

  useEffect(() => {
    requestBoard(collection.board).catch(() => {
      // Opening the shelf retries; the local seed remains usable offline.
    });
  }, [collection.board]);

  const selectBoard = async (nextBoard, beforeCommit) => {
    if (nextBoard.url === collection.board.url) return;
    setSwitchingBoard(nextBoard.url);
    try {
      let nextCollection;
      if (nextBoard.url === PINTEREST_BOARD.url) {
        nextCollection = { board: PINTEREST_BOARD, projects: PROJECTS };
      } else {
        nextCollection = await requestBoard(nextBoard);
      }
      await beforeCommit?.();
      setDeck({ start: 0, focus: 0, instant: false });
      setCollection(nextCollection);
    } finally {
      setSwitchingBoard("");
    }
  };

  const syncCurrentBoard = async () => {
    if (
      syncingBoard ||
      collection.board.hasMore === false ||
      collection.projects.length >= collection.board.totalPins
    ) {
      return;
    }
    const activeUrl = collection.board.url;
    setSyncingBoard(activeUrl);
    try {
      const data = await requestBoard(collection.board);
      setCollection((current) => {
        if (current.board.url !== activeUrl) return current;
        return {
          board: data.board,
          projects: mergeProjects(data.projects, current.projects),
        };
      });
      setDeck((current) => ({ ...current, instant: true }));
    } finally {
      setSyncingBoard("");
    }
  };

  const openExplore = async (previews) => {
    if (openingShelf.current) return;
    openingShelf.current = true;
    const active = collection;
    setSyncingBoard(active.board.url);
    try {
      let shelfCollection = active;
      try {
        const data = await requestBoard(active.board);
        shelfCollection = {
          board: data.board,
          projects: mergeProjects(data.projects, active.projects),
        };
      } catch {
        // A failed public request must not block the local fallback collection.
      }
      await onExplore?.(
        shelfCollection.board,
        shelfCollection.projects.map((project) => ({
          ...project,
          preview: previews?.get(project.id),
        })),
      );
    } finally {
      setSyncingBoard("");
      openingShelf.current = false;
    }
  };

  const selectProject = (index) => {
    const start = deckStartFor(index, collection.projects.length);
    setDeck({
      start,
      focus: index - start,
      instant: true,
    });
  };

  return (
    <CarouselStage
      key={collection.board.url}
      board={collection.board}
      projects={ringProjects}
      allProjects={collection.projects}
      deckStart={deck.start}
      initialIndex={deck.focus}
      instant={deck.instant}
      switchingBoard={switchingBoard}
      syncingBoard={syncingBoard === collection.board.url}
      onSelectBoard={selectBoard}
      onSyncBoard={syncCurrentBoard}
      onSelectProject={selectProject}
      onExplore={openExplore}
      onFocusProject={onFocus}
    />
  );
}

function CarouselStage({
  board,
  projects,
  allProjects,
  deckStart,
  initialIndex,
  instant,
  switchingBoard,
  syncingBoard,
  onSelectBoard,
  onSyncBoard,
  onSelectProject,
  onExplore,
  onFocusProject,
}) {
  const [ready, setReady] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [current, setCurrent] = useState(initialIndex);
  const controlsRef = useRef(null);
  const focusRef = useRef(onFocusProject);
  const containerRef = useRef(null);
  const titleRef = useRef(null);
  const liveRef = useRef(null);
  useEffect(() => {
    focusRef.current = onFocusProject;
  }, [onFocusProject]);

  useEffect(() => {
    const container = containerRef.current;
    // Async work (atlas decode, the lil-gui import) can land after cleanup
    // under StrictMode's double mount. Everything deferred checks this.
    let disposed = false;

    const params = defaultParams();
    params.count = projects.length;
    params.imageOffset = initialIndex;
    // progress: the seed is born at screen centre
    // launch:   the neighbours emerge from the seed
    // spread:   the gallery opens to the left and right
    // spin:     whole-ring rotation, radians
    // shift:    the side glass settles into place
    const state = {
      progress: 0,
      launch: 0,
      spread: 0,
      spin: 0,
      shift: 0,
    };
    // Kept outside state so picking a card cannot cancel the view tween.
    const wheelView = { progress: 0 };
    let showingWheel = false;
    // Read-only panel readouts, so an invalid ring is visible rather than
    // silent and the reference window can be matched to the live one.
    const info = { restingGap: 0, window: "", scale: 1, band: "wide" };

    // Browsers cap the number of live WebGL contexts (~16 in Chrome). If that
    // is hit, this throws and the rest of the effect never runs — no canvas is
    // appended and the page is simply blank, which is a miserable thing to
    // debug. Fail loudly instead. See the cleanup for why it should not
    // happen: the context is released explicitly rather than left to GC.
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      console.error("[ring] could not create a WebGL context:", err);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    container.dataset.glassCursor = "true";

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    const asciiTexture = createAsciiTexture();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const uniforms = {
      ...cursorUniforms(THREE),
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSize: { value: new THREE.Vector2(150, 100) },
      uRadius: { value: params.radius },
      uCount: { value: params.count },
      uPos: {
        value: Array.from({ length: MAX_PLANES }, () => new THREE.Vector2()),
      },
      uRot: { value: new Float32Array(MAX_PLANES) },
      // xy = birth scale, z = brightness, w = atlas cell. Packed because a
      // uniform array costs a full vec4 row per element either way.
      uScale: {
        value: Array.from(
          { length: MAX_PLANES },
          () => new THREE.Vector4(0, 0, 1, 0),
        ),
      },
      uLinkCount: { value: 0 },
      uLinkA: {
        value: Array.from({ length: MAX_LINKS }, () => new THREE.Vector2()),
      },
      uLinkB: {
        value: Array.from({ length: MAX_LINKS }, () => new THREE.Vector2()),
      },
      // (rEnd, rMid, sag, fillet), packed to stay inside the uniform budget.
      uLinkPar: {
        value: Array.from({ length: MAX_LINKS }, () => new THREE.Vector4()),
      },
      uK: { value: params.goo },
      uWobble: { value: params.wobble },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#0a0a0a") },
      uAtlas: { value: blankTexture() }, // placeholder so the sampler is bound
      uGrid: { value: new THREE.Vector2(1, 1) },
      uBlend: { value: params.blend },
      uTextured: { value: 0 },
      uBandTop: { value: 0 },
      uBandBottom: { value: 0 },
      uGlass: { value: new THREE.Vector4() },
      uFringe: { value: 0 },
      uSheen: { value: 0 },
      uSideGlass: { value: new THREE.Vector4() },
      uSideFinish: { value: new THREE.Vector2() },
      uCardRound: { value: 0 },
      uMouse: { value: new THREE.Vector4() },
      uMelt: { value: new THREE.Vector4() },
      uAsciiTex: { value: asciiTexture },
      // gather progress, cloud expansion, cell px, opacity
      uIntro: { value: new THREE.Vector4(1, 1, 12, 0) },
      // launch progress, halo reach px, cell px, opacity
      uCardParticles: { value: new THREE.Vector4(1, 0, 12, 0) },
      uFocusParticlePos: { value: new THREE.Vector2() },
      // half width, half height, corner radius, rotation
      uFocusParticleBox: { value: new THREE.Vector4() },
      // amount, reach px, cell px, opacity
      uFocusParticles: { value: new THREE.Vector4() },
      // flow phase in cells, spatial-motion multiplier
      uFocusParticleMotion: { value: new THREE.Vector2() },
      uPage: { value: new THREE.Color("#fafafa") },
    };
    const cursorLens = createCursorLens(uniforms);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
      }),
    );
    // Above the type, so the planes occlude it as the ring sweeps past.
    mesh.renderOrder = 10;
    scene.add(mesh);

    const textGroup = new THREE.Group();
    scene.add(textGroup);

    const splitText = createSplitText(textGroup, params);

    /* ---------------------------------------------------------------- art */
    // The atlas is bound on frame one and fills in as images arrive, so the
    // seed can be born already wearing its own art while the rest are still
    // in flight. It is also what gives the counter something to count.
    let firstIn = false; // the seed's own cell is on the texture
    let loadProg = 0; // and how much of the rest has arrived, 0..1

    // Opened on the frame the counter reads 100, and by nothing else — that is
    // what makes the number landing and the ring launching the same moment.
    let launchReady = false;
    const readyWaiters = [];
    const whenReady = (fn) => (launchReady ? fn() : readyWaiters.push(fn));

    const atlas = buildAtlas(
      projects,
      (p) => {
        if (!disposed) loadProg = p;
      },
      params.artTimeout,
    );

    uniforms.uAtlas.value.dispose();
    atlas.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    uniforms.uAtlas.value = atlas.texture;
    uniforms.uGrid.value.set(atlas.grid[0], atlas.grid[1]);
    // Up front, not on completion: the cell each plane wears is derived from
    // this and has to be right from the first frame, blank cells or not.
    const imageCount = atlas.count;

    atlas.first.then(() => {
      if (!disposed) firstIn = true;
    });
    atlas.ready.then(() => {
      if (!disposed) loadProg = 1;
    });

    /* --------------------------------------------------------------- size */
    let viewW = 1;
    let viewH = 1;
    // Cached: the pointer is tracked on every move, and reading the rect each
    // time is a forced layout. Only a resize can invalidate it.
    const bounds = { left: 0, top: 0 };

    // How far this window is from the reference one. Every px param is
    // multiplied through by it, so it is computed on resize and never in the
    // loop. planeK / radiusK / textK are the breakpoint bumps on top.
    let fit = 1;
    let planeK = 1;
    let radiusK = 1;
    let textK = 1;
    let tightNow = false;
    // Kept as flags rather than resolved into values here, so anything picked
    // off them still answers to the dev panel between resizes.

    const refit = () => {
      const byW = viewW / Math.max(1, params.refWidth);
      const byH = viewH / Math.max(1, params.refHeight);
      const s =
        byW * (1 - params.fitHeight) + Math.min(byW, byH) * params.fitHeight;
      fit = Math.min(params.maxScale, Math.max(params.minScale, s));

      const narrow = viewW <= params.narrowAt;
      const tight = viewW <= params.tightAt;
      tightNow = tight;
      planeK = narrow ? params.narrowPlane : 1;
      // The bands stack: tight sits inside narrow and pulls the arc back in
      // from where narrow had pushed it out to.
      radiusK =
        (narrow ? params.narrowRadius : 1) * (tight ? params.tightRadius : 1);
      textK = narrow ? params.narrowText : 1;

      info.window = `${Math.round(viewW)} x ${Math.round(viewH)}`;
      info.scale = Math.round(fit * 1000) / 1000;
      info.band = tight ? "tight" : narrow ? "narrow" : "wide";

      // The heading is rasterised per glyph, so it cannot be re-sized without
      // rebuilding every texture mid-animation. Scaling the group costs
      // nothing and stays sharp — the glyphs are drawn at 2x display already.
      const k = fit * textK * (tight ? params.tightSplit : 1);
      textGroup.scale.set(k, k, 1);
    };

    const resize = () => {
      viewW = container.clientWidth;
      viewH = container.clientHeight;
      refit();
      renderer.setSize(viewW, viewH);
      camera.left = -viewW / 2;
      camera.right = viewW / 2;
      camera.top = viewH / 2;
      camera.bottom = -viewH / 2;
      camera.updateProjectionMatrix();
      mesh.scale.set(viewW, viewH, 1);
      uniforms.uResolution.value.set(viewW, viewH);

      const rect = renderer.domElement.getBoundingClientRect();
      bounds.left = rect.left;
      bounds.top = rect.top;
    };

    const onResize = () => {
      resize();
    };

    resize();
    window.addEventListener("resize", onResize);

    /* ------------------------------------------------------- spin & input */
    const ringCentre = { x: 0, y: 0 };
    // Which way "front" is: from the ring's centre toward the middle of the
    // screen. Once the ring is off centre that is no longer 3 o'clock.
    let frontAngle = 0;
    let interactive = false;
    let spinVel = 0; // rad/s
    let dragging = false;
    let dragPrevAngle = 0;
    let dragPrevX = 0;
    let laneSpacing = 1;
    let dragPrevTime = 0;
    let autoResumeAt = 0;

    // A flick coasts untouched, then commits to the nearest slot once most of
    // its momentum is spent.
    let settling = false;
    let snapTo = 0;
    let snapCap = 0;

    // A click is turning the ring to a card. While this is up the momentum
    // above is suspended entirely, so the two cannot both drive spin.
    let picking = false;

    let pointerTravel = 0; // tells a click from a drag
    let travelX = 0;
    let travelY = 0;

    const pointerAngle = (e) => {
      const dx = e.clientX - bounds.left - ringCentre.x;
      const dy = e.clientY - bounds.top - ringCentre.y;
      return Math.atan2(-dy, dx);
    };

    const stopPick = () => {
      if (!picking) return;
      gsap.killTweensOf(state);
      picking = false;
    };

    const openPlane = (i) => {
      const scale = uniforms.uScale.value[i];
      const project = projects[Math.round(scale.w)];
      if (!project) return;
      const pos = uniforms.uPos.value[i];
      const angle = uniforms.uRot.value[i];
      const halfW = (uniforms.uSize.value.x * scale.x) / 2;
      const halfH = (uniforms.uSize.value.y * scale.y) / 2;
      const width =
        Math.abs(Math.cos(angle)) * halfW * 2 +
        Math.abs(Math.sin(angle)) * halfH * 2;
      const height =
        Math.abs(Math.sin(angle)) * halfW * 2 +
        Math.abs(Math.cos(angle)) * halfH * 2;
      focusRef.current?.(project, {
        x: bounds.left + viewW / 2 + pos.x - width / 2,
        y: bounds.top + viewH / 2 - pos.y - height / 2,
        width,
        height,
        src: atlas.sources[Math.round(scale.w)],
        imageWidth: atlas.dimensions[Math.round(scale.w)].width,
        imageHeight: atlas.dimensions[Math.round(scale.w)].height,
      });
    };

    // Turn the ring until plane i faces front.
    const pick = (i) => {
      const slot = TAU / Math.round(params.count);
      const base = frontAngle - params.seed * DEG - signedOffset(i) * slot;
      const target = base + Math.round((state.spin - base) / TAU) * TAU;
      const slots = Math.abs(target - state.spin) / slot;
      if (slots < 0.01) return;

      spinVel = 0;
      settling = false;
      autoResumeAt = performance.now() + params.autoResume * 1000;
      picking = true;
      gsap.killTweensOf(state);
      gsap.to(state, {
        spin: target,
        // Root of the distance, not linear: a card eight slots round should
        // take longer than its neighbour but not eight times longer.
        duration: reducedMotion.matches
          ? 0
          : params.pickTime * Math.sqrt(Math.max(1, slots)),
        ease: params.pickEase,
        onComplete: () => {
          picking = false;
        },
      });
    };

    /* ------------------------------------------------------------ pointer */
    // World px, origin at screen centre, Y up — the space the shader works in,
    // so nothing is converted twice.
    //
    // `inside` means the position is worth reading, which is what the card hit
    // test needs. Whether the softening is *on* is a separate question,
    // because on touch it is not simply "is there a pointer".
    const pointer = { x: 0, y: 0, inside: false, seeded: false };
    // What the ring actually follows: the cursor, smoothed. How far this
    // trails the real pointer stands in for speed and drives the wake.
    const cursor = { x: 0, y: 0, amt: 0, wake: 0 };

    // Read off the events rather than a media query, so a laptop with a
    // touchscreen behaves as whichever is being used at the time.
    let coarse = false;
    let held = false;
    let holdTimer = 0;

    const endHold = () => {
      clearTimeout(holdTimer);
      holdTimer = 0;
      held = false;
    };

    const beginHold = () => {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        held = true;
      }, params.touchHold * 1000);
    };

    // Mouse: being over it is the whole gesture. Touch: only a press held
    // still long enough to mean it.
    const engaged = () => (coarse ? held : pointer.inside);

    const trackPointer = (e) => {
      coarse = e.pointerType === "touch";
      pointer.x = e.clientX - bounds.left - viewW * 0.5;
      pointer.y = viewH * 0.5 - (e.clientY - bounds.top);
      pointer.inside = true;
      // Otherwise the first move sweeps the softening across the ring from
      // wherever the cursor was last left.
      if (!pointer.seeded) {
        pointer.seeded = true;
        cursor.x = pointer.x;
        cursor.y = pointer.y;
      }
    };

    const onPointerLeave = () => {
      pointer.inside = false;
    };

    const onWheel = (e) => {
      if (!interactive) return;
      e.preventDefault();
      // Trackpads send horizontal deltas too; take whichever dominates.
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      stopPick();
      settling = false;
      autoResumeAt = performance.now() + params.autoResume * 1000;
      spinVel += d * params.scrollSpeed;
      spinVel = Math.max(-params.maxSpeed, Math.min(params.maxSpeed, spinVel));
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      pointerTravel = 0;
      travelX = e.clientX;
      travelY = e.clientY;
      trackPointer(e);
      if (!interactive) return;
      stopPick();
      if (coarse) beginHold();
      dragging = true;
      settling = false;
      spinVel = 0;
      autoResumeAt = Infinity;
      dragPrevAngle = pointerAngle(e);
      dragPrevX = e.clientX;
      dragPrevTime = performance.now();
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
      trackPointer(e);

      // From coordinates, not movementX/Y: those are zero for touch in Safari,
      // which would make every swipe look stationary and end in a tap.
      pointerTravel +=
        Math.abs(e.clientX - travelX) + Math.abs(e.clientY - travelY);
      travelX = e.clientX;
      travelY = e.clientY;
      // Only before the hold takes. After that, moving drags the ring and the
      // melt together, same as a drag with the cursor down.
      if (coarse && !held && pointerTravel > params.touchSlop) endHold();

      if (!dragging) return;

      const a = pointerAngle(e);
      let delta = a - dragPrevAngle;
      if (delta > Math.PI) delta -= TAU;
      if (delta < -Math.PI) delta += TAU;

      const laneTurn =
        -((e.clientX - dragPrevX) / laneSpacing) *
        (TAU / Math.round(params.count));
      const now = performance.now();
      const turn =
        (laneTurn * (1 - wheelView.progress) + delta * wheelView.progress) *
        params.dragSpeed;
      state.spin += turn;
      spinVel = Math.max(
        -params.maxSpeed,
        Math.min(
          params.maxSpeed,
          turn / (Math.max(8, now - dragPrevTime) / 1000),
        ),
      );
      dragPrevAngle = a;
      dragPrevX = e.clientX;
      dragPrevTime = now;
    };

    const onPointerUp = (e) => {
      // Releasing the capture fires a leave at the container even though the
      // cursor never went anywhere, so re-track before anything else.
      trackPointer(e);
      // The finger is gone; a cursor is still there.
      endHold();
      if (!dragging) return;
      dragging = false;
      autoResumeAt = performance.now() + params.autoResume * 1000;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };

    // A drag ends in a click too, so only a near-stationary press counts.
    // `over` comes from the same hit test that activates the dot cursor.
    const onClick = (e) => {
      if (!interactive || pointerTravel >= 5) return;
      trackPointer(e);
      layout(0);
      if (over >= 0) openPlane(over);
    };

    const toggleWheel = () => {
      if (!interactive) return;
      showingWheel = !showingWheel;
      setWheelOpen(showingWheel);
      pointer.inside = false;
      stopPick();
      spinVel = 0;
      settling = false;
      autoResumeAt =
        performance.now() + (params.wheelTime + params.autoResume) * 1000;
      gsap.to(wheelView, {
        progress: showingWheel ? 1 : 0,
        duration: reducedMotion.matches ? 0 : params.wheelTime,
        ease: params.wheelEase,
        overwrite: true,
      });
    };

    const pickProject = (projectIndex) => {
      if (!interactive) return;
      const planeIndex = uniforms.uScale.value.findIndex(
        (scale, index) =>
          index < params.count && Math.round(scale.w) === projectIndex,
      );
      if (planeIndex >= 0) pick(planeIndex);
    };
    controlsRef.current = {
      toggleWheel,
      pickProject,
      shelfPreviews: () =>
        new Map(
          projects
            .map((project, index) => [
              project.id,
              { src: atlas.sources[index], ...atlas.dimensions[index] },
            ])
            .filter(([, preview]) => preview.width > 3),
        ),
    };
    const onKeyDown = (event) => {
      if (
        !interactive ||
        document.querySelector("dialog[open]") ||
        event.target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const next =
          (shown + (event.key === "ArrowRight" ? 1 : -1) + imageCount) %
          imageCount;
        pickProject(next);
      }
      if (
        event.key === "Escape" &&
        showingWheel &&
        !document.querySelector("dialog[open]")
      ) {
        toggleWheel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("click", onClick);

    const updatePointer = (dt) => {
      // Held off until the entry finishes, so the cursor cannot soften the
      // ring while the timeline is still drawing it.
      const live = params.hover && engaged() && pointer.seeded && interactive;
      cursor.amt += ((live ? 1 : 0) - cursor.amt) * chase(dt, 0.12);

      const k = chase(dt, params.lag);
      cursor.x += (pointer.x - cursor.x) * k;
      cursor.y += (pointer.y - cursor.y) * k;

      // The gap left behind the real pointer stands in for speed. Instant
      // attack, slow release, so the wake outlives the movement.
      const trail = Math.hypot(pointer.x - cursor.x, pointer.y - cursor.y);
      cursor.wake = Math.max(
        cursor.wake * Math.pow(0.94, dt * 60),
        clamp01(trail / (Math.max(dt, 0.001) * 2600)),
      );

      // Scaled by fit like the ring: a reach in raw px would cross two cards
      // on a small window and half of one on a large. Frequencies are not.
      uniforms.uMouse.value.set(
        cursor.x,
        cursor.y,
        cursor.amt,
        params.melt * fit,
      );
      uniforms.uMelt.value.set(
        params.meltReach * fit,
        params.wave * fit * cursor.wake * cursor.amt,
        params.waveFreq,
        params.waveSpeed,
      );
    };

    /* ------------------------------------------------------- load gate */
    // Keep the seed at centre until both its birth and the artwork are ready.
    const loading = { shown: 0 };

    const tickLoader = (dt) => {
      const target = Math.min(loadProg, clamp01(state.progress));
      loading.shown += (target - loading.shown) * chase(dt, params.loaderChase);

      const n = Math.min(100, Math.max(1, Math.round(loading.shown * 100)));

      if (!launchReady && n >= 100) {
        launchReady = true;
        for (const fn of readyWaiters) fn();
        readyWaiters.length = 0;
      }
    };

    /* ------------------------------------------------------- the carousel */
    const travel = new Float32Array(MAX_PLANES);
    const cum = new Float32Array(MAX_PLANES);
    const order = [];
    // Where each plane would sit with no cursor near it. The honey is measured
    // off these, so hovering cannot feed back into the unfurl's geometry.
    const rest = Array.from({ length: MAX_PLANES }, () => new THREE.Vector2());

    // Per-plane response to the pointer, eased rather than recomputed from
    // where it is, so the ring trails the cursor and settles back on its own.
    const hoverF = new Float32Array(MAX_PLANES);
    const leanX = new Float32Array(MAX_PLANES);
    const leanY = new Float32Array(MAX_PLANES);
    const webF = new Float32Array(MAX_LINKS);
    // The other half of it: how much a plane is standing aside for the card
    // being pointed at. Zero on that card, zero when there isn't one.
    const sideF = new Float32Array(MAX_PLANES);
    // Where the hovered card is, latched at the end of a frame for the next
    // one. The hit test runs inside the loop and every plane needs an answer
    // before the loop reaches that card, so this is deliberately one frame
    // behind — it is eased over ten of them anyway. Not reset when the cursor
    // leaves: the direction has to stay meaningful while the push decays.
    const focusPos = new THREE.Vector2();

    const swellOf = (i) =>
      Math.max(
        0.05,
        1 + params.swell * hoverF[i] - params.sideScale * sideF[i],
      );

    // Which card is at the front, and which is under the cursor.
    let shown = -1;
    let announced = -1;
    let over = -1;
    let particleCard = -1;
    let particleAmount = 0;
    let particleFlow = 0;

    const layout = (dt) => {
      const count = Math.min(projects.length, Math.round(params.count));
      uniforms.uCount.value = count;

      const step = TAU / count;
      const spread = clamp01(state.spread);
      const shift = clamp01(state.shift);
      const glassEntry = smoothstep(params.laneGlassAt, 1, shift);
      const wheelOuterPx = Math.max(
        1,
        Math.min(viewW, viewH) * params.wheelFill - params.wheelMargin,
      );
      const wheelOuterUnits =
        params.ringRadius * radiusK + params.planeSize * planeK * 0.62;
      const wheelG = wheelOuterPx / wheelOuterUnits;
      const amount = wheelView.progress * shift;
      // Keep horizontal sampling monotonic even at the smallest phone scale.
      const sidePull = Math.min(
        params.laneSidePull * fit,
        viewW * params.laneSideBand * 0.42,
      );
      // Hit tests read the same inverse warp as glassBend() in the shader.
      const probePoint = { x: pointer.x, y: pointer.y };
      if (params.glass) {
        const band =
          (probePoint.y > 0 ? params.bandTop : params.bandBottom) * viewH;
        const t = clamp01(
          (Math.abs(probePoint.y) - viewH * 0.5 + band) / Math.max(band, 0.01),
        );
        const bend = 1 - Math.sqrt(Math.max(0, 1 - t * t));
        probePoint.y -=
          Math.sign(probePoint.y) *
          bend *
          (params.refract +
            Math.sin(probePoint.x * params.rippleFreq) * params.ripple);
        probePoint.x *= 1 - bend * params.squeeze;
        const edgeT = clamp01(
          (Math.abs(probePoint.x) - viewW * (0.5 - params.laneSideBand)) /
            Math.max(viewW * params.laneSideBand, 1),
        );
        const side =
          edgeT *
          edgeT *
          edgeT *
          (edgeT * (edgeT * 6 - 15) + 10) *
          (1 - amount) *
          glassEntry;
        probePoint.x -= Math.sign(probePoint.x) * side * sidePull;
        probePoint.y /= 1 + side * params.laneSideFlare;
      }
      const galleryW = Math.min(
        params.laneWidth * fit * planeK,
        viewW * params.laneWidthFill,
        viewH * params.laneHeightFill * params.laneAspect,
      );
      const galleryH = galleryW / params.laneAspect;
      laneSpacing =
        galleryW * (tightNow ? params.laneTightSpacing : params.laneSpacing);
      const entryScale =
        params.laneEnterScale + (1 - params.laneEnterScale) * spread;
      const galleryG = galleryW / params.planeSize;
      const g = galleryG + (wheelG - galleryG) * amount;
      frontAngle = 0;
      const assembleOn =
        params.assemble &&
        viewW > params.assembleFrom &&
        !reducedMotion.matches;
      // The gathered image earns a larger beat at centre, then contracts as
      // it launches to the ring.
      const assembleBoost = assembleOn
        ? 1 +
          (params.assembleCardScale - 1) *
            (1 - smoothstep(0.05, 0.82, state.launch))
        : 1;

      const W =
        (galleryW + (params.planeSize * planeK * wheelG - galleryW) * amount) *
        assembleBoost *
        entryScale;
      const H =
        (galleryH +
          ((params.planeSize * planeK * wheelG) / 1.5 - galleryH) * amount) *
        assembleBoost *
        entryScale;
      uniforms.uSize.value.set(W, H);
      uniforms.uRadius.value = params.radius * g;

      // Screen-space centre, for pointer maths. World Y is up, page Y is down.
      ringCentre.x = viewW * 0.5;
      ringCentre.y = viewH * 0.5;

      // Radial: the long edge points outward, so a plane's reach toward its
      // neighbour is its short axis and the facing edges are the long ones.
      const sepExtent = W + ((params.radial ? H : W) - W) * amount;
      const faceEdge = H + ((params.radial ? W : H) - H) * amount;

      const R = params.ringRadius * radiusK * wheelG;
      const restingGap =
        (laneSpacing - (galleryW * (1 + params.laneSideScale)) / 2) *
          (1 - amount) +
        (2 * R * Math.sin(step / 2) - sepExtent) * amount;
      info.restingGap = Math.round((restingGap / g) * 10) / 10;
      const finalSep = Math.max(1, restingGap);

      const maxN = Math.max(1, Math.abs(signedOffset(count - 1)));
      const dur = Math.max(0.1, 1 - FAN_START - params.stagger);

      cum[0] = 0;
      for (let n = 1; n <= maxN; n++) {
        const start = FAN_START + ((n - 1) / maxN) * params.stagger;
        const t = clamp01((spread - start) / dur);
        const e = t * t * (3 - 2 * t);
        travel[n] = e;
        cum[n] = cum[n - 1] + e;
      }

      const seedAngle = params.seed * DEG;
      const launch = easeInOutCubic(clamp01(state.launch));
      const Rnow = R * launch;

      order.length = 0;

      const track = cursor.amt > 0.001;
      const reach = Math.max(1, params.reach * W);
      const sideReach = Math.max(1, params.sideReach * W);
      // Asymmetric on purpose: the ring takes up a lean quickly and lets go
      // slowly. Equal rates read as a mechanism following the cursor; the gap
      // between them is what reads as something viscous.
      const kRise = chase(dt, params.grab);
      const kFall = chase(dt, params.release);

      // Nearest plane to front, in angle rather than screen distance.
      let frontI = -1;
      let frontD = 1e9;
      let frontCell = 0;

      const imgOff = Math.round(params.imageOffset);
      const cellOf = (slot) =>
        imageCount > 0
          ? (((imgOff - slot) % imageCount) + imageCount) % imageCount
          : 0;

      // Which card the cursor is on. Independent of the hover falloff above:
      // turning the goo off should not disable click feedback.
      const probe = pointer.inside && pointer.seeded && interactive;
      let overI = -1;
      // Which card the rest are standing aside for, from last frame.
      const focusI = track ? over : -1;

      for (let i = 0; i < count; i++) {
        const sIdx = signedOffset(i);
        const n = Math.abs(sIdx);
        const u = i === 0 ? clamp01(state.progress) : travel[n];
        const cell = cellOf(sIdx);

        const angle = seedAngle + Math.sign(sIdx) * step * cum[n] + state.spin;
        const offset = wrapSlot(sIdx + state.spin / step, count);
        const emphasis = Math.exp(
          -Math.pow(offset, 2) * params.laneFocusFalloff,
        );
        const laneScale =
          params.laneSideScale + (1 - params.laneSideScale) * emphasis;
        const depthScale = laneScale + (1 - laneScale) * amount;
        const laneX = -offset * laneSpacing * spread;
        const px = laneX + (Math.cos(angle) * Rnow - laneX) * amount;
        const py = Math.sin(angle) * Rnow * amount;
        const cardScale = depthScale;
        rest[i].set(px, py);

        const da = angle - frontAngle;
        const toFront =
          Math.abs(offset) * (1 - amount) +
          Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) * amount;
        if (toFront < frontD) {
          frontD = toFront;
          frontI = i;
          frontCell = cell;
        }

        // Lean toward the cursor. Scaled by u so the unborn keep out of it:
        // they are stacked on their parent, and without this the whole stack
        // would lean at once and drag the seed off the ring.
        let f = 0;
        let toX = 0;
        let toY = 0;
        if (track) {
          const dx = cursor.x - px;
          const dy = cursor.y - py;
          const dist = Math.hypot(dx, dy);
          f = smoothstep(reach, reach * 0.22, dist) * cursor.amt * u;
          if (f > 0.0001 && dist > 0.0001) {
            const lean = (params.pull * fit * f) / dist;
            toX = dx * lean;
            toY = dy * lean;
          }
        }

        // One rate for the whole of a plane's response, so the swell, the lean
        // and the honey it feeds move together instead of drifting apart.
        const k = f > hoverF[i] ? kRise : kFall;
        hoverF[i] += (f - hoverF[i]) * k;
        leanX[i] += (toX - leanX[i]) * k;
        leanY[i] += (toY - leanY[i]) * k;

        // Standing aside. Measured from the hovered card, not the cursor, so
        // the response holds steady while the cursor moves around inside it.
        let sf = 0;
        if (focusI >= 0 && i !== focusI) {
          const d = Math.hypot(focusPos.x - px, focusPos.y - py);
          sf = smoothstep(sideReach, sideReach * 0.2, d) * u;
        }
        // Its own rate: a card can be letting go of a lean at the same moment
        // it is asked to back away, and sharing one would make the second
        // thing sluggish.
        sideF[i] += (sf - sideF[i]) * (sf > sideF[i] ? kRise : kFall);

        // Straight off the eased factor — sideF is already smooth, and easing
        // it twice would only add lag.
        let pushX = 0;
        let pushY = 0;
        if (sideF[i] > 0.0001) {
          const dx = px - focusPos.x;
          const dy = py - focusPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.0001) {
            const away = (params.sidePush * fit * sideF[i]) / dist;
            pushX = dx * away;
            pushY = dy * away;
          }
        }

        uniforms.uPos.value[i].set(
          px + leanX[i] + pushX,
          py + leanY[i] + pushY,
        );
        const ringRot = params.radial ? angle : angle + HALF_PI;
        uniforms.uRot.value[i] =
          Math.atan2(Math.sin(ringRot), Math.cos(ringRot)) * launch * amount;

        const sx = assembleOn
          ? i === 0
            ? easeOutCubic(clamp01(assembleOn ? (u - 0.5) / 0.46 : u / 0.7))
            : easeOutCubic(clamp01(u / 0.34))
          : easeOutCubic(u);
        const sy = assembleOn
          ? i === 0
            ? easeOutCubic(
                clamp01(assembleOn ? (u - 0.58) / 0.38 : (u - 0.18) / 0.74),
              )
            : easeOutCubic(clamp01((u - 0.06) / 0.36))
          : sx;
        // The swell rides on the birth scale rather than uSize, so a plane
        // under the cursor grows about its own centre.
        const sw = swellOf(i) * cardScale;
        const aspect = atlas.aspects[cell];
        const aspectX = Math.min(1, (H * aspect) / W);
        const aspectY = Math.min(1, W / (H * aspect));
        uniforms.uScale.value[i].set(
          sx * sw * aspectX,
          sy * sw * aspectY,
          (1 - params.sideDim * sideF[i]) *
            (1 - params.laneSideDim * (1 - emphasis) * (1 - amount) * shift),
          cell,
        );

        // Same box the shader draws, tested in the plane's own frame, so it
        // answers for the card as it actually is: turned, leaned and swollen.
        // Cards never overlap once formed, so the first hit is the only hit.
        if (probe && overI < 0) {
          const rot = uniforms.uRot.value[i];
          const qx = probePoint.x - (px + leanX[i] + pushX);
          const qy = probePoint.y - (py + leanY[i] + pushY);
          const cr = Math.cos(rot);
          const sr = Math.sin(rot);
          if (
            Math.abs(qx * cr + qy * sr) <= W * 0.5 * sx * sw * aspectX &&
            Math.abs(-qx * sr + qy * cr) <= H * 0.5 * sy * sw * aspectY
          ) {
            overI = i;
          }
        }

        order.push(i);
      }

      for (let i = count; i < MAX_PLANES; i++) {
        uniforms.uScale.value[i].set(0, 0, 1, 0);
        hoverF[i] = 0;
        leanX[i] = 0;
        leanY[i] = 0;
        sideF[i] = 0;
      }

      over = overI;
      const clickable = over >= 0 && !coarse && !dragging;
      if (container.dataset.cursorActive !== String(clickable))
        container.dataset.cursorActive = String(clickable);
      cursorLens.update(
        pointer.x,
        pointer.y,
        clickable && pointer.inside && interactive,
        dt,
        false,
        reducedMotion.matches,
      );
      const cursorRendered = String(uniforms.uCursor.value.w > 0);
      if (container.dataset.cursorRendered !== cursorRendered)
        container.dataset.cursorRendered = cursorRendered;

      // The ring itself never owns particles. A single latched hover card
      // does, so its field can finish flowing out after the pointer leaves
      // without jumping to another card midway through the exit.
      const focusParticlesOn =
        params.focusParticles &&
        viewW > params.focusParticleFrom &&
        !coarse &&
        interactive &&
        spread > 0.995;
      const wantedParticleCard = focusParticlesOn ? over : -1;
      if (particleCard < 0 && wantedParticleCard >= 0) {
        particleCard = wantedParticleCard;
        particleFlow = 0;
      }
      const particleEntering =
        particleCard >= 0 && particleCard === wantedParticleCard;
      const particleTarget = particleEntering ? 1 : 0;
      const particleRate = particleEntering
        ? params.focusParticleEnter
        : params.focusParticleExit;
      particleAmount +=
        (particleTarget - particleAmount) * chase(dt, particleRate);

      if (!reducedMotion.matches && particleCard >= 0) {
        particleFlow +=
          dt *
          (particleEntering
            ? params.focusParticleDrift
            : -params.focusParticleOut);
      }

      if (!particleEntering && particleAmount < 0.015) {
        particleCard = wantedParticleCard;
        particleAmount = 0;
        particleFlow = 0;
      }

      if (particleCard >= 0) {
        const particlePos = uniforms.uPos.value[particleCard];
        const particleScale = uniforms.uScale.value[particleCard];
        const particleHalfW = W * 0.5 * particleScale.x;
        const particleHalfH = H * 0.5 * particleScale.y;
        const particleRMax = Math.min(particleHalfW, particleHalfH);
        const particleRound = smoothstep(
          0.3,
          1,
          Math.min(particleScale.x, particleScale.y),
        );
        const particleRadius = Math.min(
          particleRMax,
          particleRMax +
            (uniforms.uRadius.value - particleRMax) * particleRound,
        );
        uniforms.uFocusParticlePos.value.copy(particlePos);
        uniforms.uFocusParticleBox.value.set(
          particleHalfW,
          particleHalfH,
          particleRadius,
          uniforms.uRot.value[particleCard],
        );
      }
      uniforms.uFocusParticles.value.set(
        particleAmount,
        params.focusParticleReach * fit,
        Math.max(6, params.focusParticleCell * fit),
        params.focusParticleOpacity,
      );
      uniforms.uFocusParticleMotion.value.set(
        particleFlow,
        reducedMotion.matches ? 0 : 1,
      );

      // Off the resting centre, so a card being pushed cannot chase its own
      // shadow next frame.
      if (over >= 0) focusPos.copy(rest[over]);

      if (frontI >= 0 && imageCount > 0 && frontCell !== shown) {
        shown = frontCell;
      }

      /* ---- honey ---- */
      order.sort((a, b) =>
        amount > 0.5
          ? signedOffset(a) - signedOffset(b)
          : rest[a].x - rest[b].x,
      );

      const edgeHalf = faceEdge * 0.5 * params.thread;
      const closed = amount > 0.995 && spread > 0.995 && count > 2;
      const linkCount = Math.min(closed ? count : count - 1, MAX_LINKS);

      for (let l = 0; l < linkCount; l++) {
        const ia = order[l];
        const ib = order[(l + 1) % count];

        const ca = uniforms.uPos.value[ia];
        const cb = uniforms.uPos.value[ib];
        const scA = uniforms.uScale.value[ia];
        const scB = uniforms.uScale.value[ib];

        // Measured between resting centres and birth scales, never hovered
        // ones. The unfurl's response to separation is ferociously steep — a
        // couple of percent of the gap is already a slab — so letting the lean
        // and the swell in turns a hover into a puzzle-piece join.
        const shrinkA =
          (scA.x * (1 - amount) + (params.radial ? scA.y : scA.x) * amount) /
          swellOf(ia);
        const shrinkB =
          (scB.x * (1 - amount) + (params.radial ? scB.y : scB.x) * amount) /
          swellOf(ib);
        const sep =
          rest[ia].distanceTo(rest[ib]) - sepExtent * 0.5 * (shrinkA + shrinkB);

        // 0 = faces still touching, 1 = landed at the resting gap.
        const v = clamp01(sep / finalSep);

        // Hover strings its own thread on its own curve, so it can be dialled
        // to a filament rather than inheriting the unfurl's slab. Taken at the
        // gap's midpoint, so the strongest pull lands between two planes.
        let fl = 0;
        if (track && params.web > 0.0001) {
          const mx = (ca.x + cb.x) * 0.5;
          const my = (ca.y + cb.y) * 0.5;
          const webReach = Math.max(1, params.webReach * W);
          const d = Math.hypot(cursor.x - mx, cursor.y - my);
          fl = smoothstep(webReach, webReach * 0.15, d) * cursor.amt;
        }
        // Eased on the same rates as the planes it hangs between, or the
        // thread would be there before the pull was.
        webF[l] += (fl - webF[l]) * (fl > webF[l] ? kRise : kFall);

        const entryThread =
          amount + (1 - amount) * (1 - smoothstep(0.75, 1, spread));
        const birthThread = Math.pow(1 - v, params.thin) * entryThread;
        // A newborn cannot support a bridge taller than its own facing edge.
        // Full-size bridges here leave broad streaks beside zero-height cards.
        const bornFace = Math.min(
          (scA.y * (1 - amount) + (params.radial ? scA.x : scA.y) * amount) /
            swellOf(ia),
          (scB.y * (1 - amount) + (params.radial ? scB.x : scB.y) * amount) /
            swellOf(ib),
        );
        const w =
          Math.max(birthThread, params.web * webF[l]) *
          (1 - Math.sin(amount * Math.PI)) *
          bornFace;
        // dissolve carries the radius past zero and out of antialiasing range
        // so the thread fades instead of bottoming out as a half-covered
        // hairline. In screen px, so unlike edgeHalf it does not carry g.
        const rEnd = w > 0.001 ? edgeHalf * w - params.dissolve : -100;
        const rMid = rEnd * (1 - (1 - params.pinch) * smoothstep(0, 0.7, v));

        uniforms.uLinkA.value[l].copy(ca);
        uniforms.uLinkB.value[l].copy(cb);
        uniforms.uLinkPar.value[l].set(
          rEnd,
          rMid,
          params.sag * g * Math.pow(v, 1.5),
          // Per link, not global: with staggered generations these are all at
          // different stages. Never wider than the neck it rounds.
          Math.min(
            params.fillet * g * smoothstep(0, 0.35, v),
            Math.max(rMid, 0) * 1.5,
          ),
        );
      }
      for (let l = linkCount; l < MAX_LINKS; l++) {
        uniforms.uLinkPar.value[l].set(-100, -100, 0, 0);
      }
      uniforms.uLinkCount.value = linkCount;

      // Both are px into the distance field, so they scale with the ring or
      // the merge reads as a different material at a different window size.
      uniforms.uK.value = params.goo * planeK * fit;
      uniforms.uWobble.value =
        params.wobble * fit * (1 - smoothstep(0.2, 0.95, state.progress));

      // Gated on the seed's own cell, not on the atlas existing: the texture
      // is bound from frame one but blank, and texturing before anything is
      // painted into it draws an empty cell.
      uniforms.uTextured.value = params.textured && firstIn ? 1 : 0;
      uniforms.uBlend.value = Math.max(0.5, params.blend * planeK * g);

      uniforms.uIntro.value.set(
        assembleOn ? clamp01(state.progress) : 1,
        params.assembleSpread,
        Math.max(7, params.assembleCell * fit),
        assembleOn ? params.assembleOpacity : 0,
      );
      uniforms.uCardParticles.value.set(
        clamp01(state.launch),
        params.assembleHaloReach * fit,
        Math.max(7, params.assembleCell * fit),
        assembleOn ? params.assembleHaloOpacity : 0,
      );

      const on = params.glass;
      uniforms.uBandTop.value = on ? params.bandTop * viewH : 0;
      uniforms.uBandBottom.value = on ? params.bandBottom * viewH : 0;
      uniforms.uGlass.value.set(
        params.refract,
        params.squeeze,
        params.ripple,
        params.rippleFreq,
      );
      uniforms.uFringe.value = on ? params.fringe : 0;
      uniforms.uSheen.value = on ? params.sheen : 0;
      uniforms.uSideGlass.value.set(
        params.laneSideBand * viewW,
        sidePull,
        params.laneSideFlare,
        on ? (1 - amount) * glassEntry : 0,
      );
      uniforms.uSideFinish.value.set(
        params.laneEdgeSoftness * fit,
        params.laneEdgeDispersion * fit,
      );
      uniforms.uCardRound.value = state.progress;
      if (titleRef.current) {
        titleRef.current.style.top = `${viewH * params.laneTitleY + (viewH * 0.5 - viewH * params.laneTitleY) * amount}px`;
      }
    };

    /* ------------------------------------------------------- entry timeline */
    // Bumped per build, so a hold left waiting on a run that has since been
    // replaced cannot resume a timeline nobody is watching.
    let entryGen = 0;

    const build = () => {
      interactive = false;
      setReady(false);
      setWheelOpen(false);
      showingWheel = false;
      gsap.killTweensOf(wheelView);
      wheelView.progress = 0;
      announced = -1;
      spinVel = 0;
      dragging = false;
      settling = false;
      autoResumeAt = 0;
      particleCard = -1;
      particleAmount = 0;
      particleFlow = 0;
      uniforms.uFocusParticles.value.x = 0;
      // The timeline tweens state.spin, so a pick in flight has to be off the
      // same property before it starts.
      stopPick();

      if (instant || reducedMotion.matches) {
        state.progress = 1;
        state.launch = 1;
        state.spread = 1;
        state.spin = 0;
        state.shift = 1;
        for (const uniform of splitText.chars) uniform.value = 1;
        for (const uniform of splitText.fades) uniform.value = 0;
        interactive = true;
        setReady(true);
        return null;
      }

      const gen = ++entryGen;

      const tl = gsap.timeline({
        delay: 0.25,
        onComplete: () => {
          interactive = true;
          setReady(true);
        },
      });

      const assembleMotion =
        params.assemble &&
        viewW > params.assembleFrom &&
        !reducedMotion.matches;
      tl.fromTo(
        state,
        { progress: 0, launch: 0, spread: 0, spin: 0, shift: 0 },
        {
          progress: 1,
          duration: assembleMotion
            ? params.assembleTime
            : params.entryBirthTime,
          ease: assembleMotion ? params.assembleEase : "power1.out",
        },
      );

      // Loading stays internal, so the gallery never opens onto empty cards.
      tl.addPause(">", () => {
        whenReady(() => {
          gsap.delayedCall(params.holdAfter, () => {
            if (disposed || gen !== entryGen) return;
            tl.resume();
          });
        });
      });

      tl.to(state, {
        launch: 1,
        spread: 1,
        shift: 1,
        duration: params.laneRevealTime,
        ease: params.spreadEase,
      });

      return tl;
    };

    let tl = null;
    let entryStarted = false;
    const replay = () => {
      tl?.kill();
      tl = build();
    };

    // The entry is built once, and not until the faces are in. Every glyph
    // mask is sized by the glyph inside it, and the timeline holds direct
    // references to the uniforms those masks own — so rebuilding the text
    // later means rebuilding the timeline, which snaps state back to zero and
    // restarts the whole entry. On a warm cache fonts resolve in milliseconds
    // and that was invisible; on a cold one they arrive late and it reads as
    // the page going blank and starting over.
    const startEntry = () => {
      if (disposed || entryStarted) return;
      entryStarted = true;
      splitText.build();
      replay();
    };

    // Canvas-only glyphs do not trigger CSS font loading. Request the actual
    // Chinese runs before measuring them or baking them into textures.
    const fontsReady = document.fonts
      ? Promise.all([
          document.fonts.load(
            `${params.textWeight} ${params.textSize}px "${params.textFont}"`,
            params.text,
          ),
          document.fonts.ready,
        ])
      : Promise.resolve();
    // A missing font must not keep the entry permanently blank.
    const fontFallback = setTimeout(startEntry, 3000);
    Promise.all([
      fontsReady,
      instant || reducedMotion.matches ? atlas.ready : atlas.first,
    ])
      .then(startEntry)
      .catch(startEntry);

    /* ------------------------------------------------------- dev controls */
    let gui;

    if (process.env.NODE_ENV === "development") {
      Promise.all([import("lil-gui"), import("./ring/gui")]).then(
        ([{ default: GUI }, { mountGui }]) => {
          if (disposed) return;
          gui = mountGui(GUI, {
            params,
            state,
            info,
            actions: {
              replay,
              refit,
              rebuildText: () => {
                splitText.build();
                replay();
              },
              adoptWindow: () => {
                params.refWidth = Math.round(viewW);
                params.refHeight = Math.round(viewH);
                refit();
              },
            },
          });

          // REMOVE THIS IF YOU WANNA TWEAK
          gui.hide();
        },
      );
    }

    /* ---------------------------------------------------------------- loop */
    const start = performance.now();
    let prevT = start;
    // #region debug-point A:entry-samples
    let debugEntrySample = 0;
    // #endregion

    const stopRendering = startRenderLoop(
      renderer,
      () => {
        const now = performance.now();
        // Clamped, so a backgrounded tab does not resume with one huge step.
        const dt = Math.min(0.05, (now - prevT) / 1000);
        prevT = now;
        uniforms.uTime.value = (now - start) * 0.001;

        if (interactive && !dragging && !picking) {
          const autoRunning =
            !reducedMotion.matches &&
            now >= autoResumeAt &&
            Math.abs(spinVel) < 0.0015 &&
            !settling &&
            params.autoSpeed !== 0;

          if (autoRunning) {
            spinVel = 0;
            state.spin += params.autoSpeed * dt;
          } else {
            state.spin += spinVel * dt;
            spinVel *= Math.pow(params.damping, dt * 60);

            let off = 0;
            if (params.snap) {
              const slot = TAU / Math.round(params.count);
              const decay = Math.max(0.01, -Math.log(params.damping) * 60);
              const engage = Math.max(params.snapFrom, decay * slot * 0.5);
              const rate = 4.8 / Math.max(0.05, params.snapTime);

              if (!settling && Math.abs(spinVel) < engage) {
                const coast = state.spin + spinVel / decay;
                const phase = params.seed * DEG - frontAngle;
                snapTo = Math.round((coast + phase) / slot) * slot - phase;
                snapCap = Math.max(Math.abs(spinVel), slot * 0.5 * rate);
                settling = true;
              }

              if (settling) {
                off = snapTo - state.spin;
                const aim = Math.max(-snapCap, Math.min(snapCap, off * rate));
                spinVel += (aim - spinVel) * clamp01(rate * dt);
              }
            } else {
              settling = false;
            }

            if (Math.abs(spinVel) < 0.0015 && Math.abs(off) < 0.0008) {
              spinVel = 0;
              state.spin += off;
              settling = false;
            }
          }
        }

        tickLoader(dt);
        updatePointer(dt);
        layout(dt);

        if (interactive && shown >= 0 && shown !== announced) {
          announced = shown;
          setCurrent(shown);
          const project = projects[shown];
          if (liveRef.current && project) {
            liveRef.current.textContent = `${project.name}，Pinterest 参考灵感。`;
          }
        }

        renderer.render(scene, camera);
        // #region debug-point A:entry-samples
        if (
          process.env.NODE_ENV === "development" &&
          window.__transitionDebug &&
          debugEntrySample < 3 &&
          state.spread >= 0.3 + debugEntrySample * 0.3
        ) {
          debugEntrySample++;
          fetch("http://127.0.0.1:7777/event", {
            method: "POST",
            body: JSON.stringify({
              sessionId: "liquid-transitions",
              runId: window.__transitionDebug,
              hypothesisId: "A",
              location: "Carousel:entry",
              msg: "[DEBUG] entry uniforms",
              data: {
                spread: state.spread,
                size: uniforms.uSize.value.toArray(),
                blend: uniforms.uBlend.value,
                goo: uniforms.uK.value,
                scale: uniforms.uScale.value.map((v) => v.toArray()),
                pos: uniforms.uPos.value.map((v) => v.toArray()),
              },
              ts: Date.now(),
            }),
          }).catch(() => {});
        }
        // #endregion
      },
      undefined,
      container,
      () => renderer.render(scene, camera),
      true,
    );

    return () => {
      disposed = true;
      clearTimeout(holdTimer);
      clearTimeout(fontFallback);
      stopRendering();
      controlsRef.current = null;
      gsap.killTweensOf(wheelView);

      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("click", onClick);

      tl?.kill();
      gsap.killTweensOf(splitText.chars);
      gsap.killTweensOf(splitText.fades);
      splitText.dispose();
      gui?.destroy();

      mesh.geometry.dispose();
      mesh.material.dispose();
      atlas.dispose();
      uniforms.uAsciiTex.value?.dispose();
      delete container.dataset.cursorActive;
      delete container.dataset.glassCursor;
      delete container.dataset.cursorRendered;

      // dispose() frees GL resources but leaves the context itself alive until
      // the canvas is collected, which is not deterministic. This effect
      // re-runs on every StrictMode double mount and every hot update, so
      // without an explicit release they pile up, and once the browser's limit
      // is reached the renderer above cannot be constructed at all.
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [projects, initialIndex, instant]);

  const selectFromIndex = (index) => {
    const localIndex = index - deckStart;
    if (localIndex >= 0 && localIndex < projects.length) {
      controlsRef.current?.pickProject(localIndex);
      return;
    }
    onSelectProject(index);
  };
  const openShelf = () => onExplore?.(controlsRef.current?.shelfPreviews());

  return (
    <>
      <InspirationControls
        ready={ready}
        wheelOpen={wheelOpen}
        onWheelToggle={() => controlsRef.current?.toggleWheel()}
        total={allProjects.length}
        projects={allProjects}
        currentIndex={deckStart + current}
        ringStart={deckStart}
        ringCount={projects.length}
        board={board}
        switchingBoard={switchingBoard}
        syncingBoard={syncingBoard}
        onSelectBoard={onSelectBoard}
        onSyncBoard={onSyncBoard}
        onSelectProject={selectFromIndex}
        onExplore={openShelf}
      />
      {/* touch-none, or the browser claims the gesture for panning and the
          pointermove stream dies mid-drag. Nothing here scrolls — the swipe
          is the carousel. */}
      <div
        ref={containerRef}
        className="carousel-stage fixed inset-0 touch-none"
      />

      <button
        ref={titleRef}
        type="button"
        className={`home-lockup ${ready ? "is-visible" : ""}`}
        onClick={openShelf}
        disabled={!ready}
        aria-label="打开灵感册"
        aria-hidden={!ready}
      >
        <MotionText visible={ready}>JUST INSPIRATION.</MotionText>
      </button>

      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
    </>
  );
}
