import { MAX_PLANES } from "../shaders/planeShaders";
import { cursorParams, EASES, WEIGHTS } from "./params";
import { TAU } from "./utils";
import { drawerParams, transitionParams } from "../focus/params";

/**
 * The lil-gui panel. Development only, and imported dynamically so it never
 * reaches a production bundle.
 *
 * `actions` are the things a control has to call when it changes something the
 * loop does not re-read on its own: `refit` for responsive values and `replay`
 * for anything baked into the entry timeline when it is built.
 */
export function mountGui(GUI, { params, state, info, actions }) {
  const { replay, refit, rebuildText } = actions;

  const gui = new GUI({ title: "ring" });

  gui.add(state, "progress", 0, 1, 0.001).listen();
  gui.add(state, "launch", 0, 1, 0.001).listen();
  gui.add(state, "spread", 0, 1, 0.001).listen();
  gui.add(state, "spin", -TAU * 10, TAU * 10, 0.001).listen();
  gui.add(state, "shift", 0, 1, 0.001).listen();
  gui.add({ replay }, "replay");

  const navigation = gui.addFolder("page transitions");
  const motion = transitionParams();
  navigation.add(motion, "enter", 300, 1400, 10).name("enter (ms)");
  navigation.add(motion, "exit", 300, 1200, 10).name("return (ms)");
  navigation.add(motion, "ease");
  navigation.add(motion, "shelfEnter", 300, 1200, 10).name("shelf enter (ms)");
  navigation.add(motion, "shelfExit", 200, 900, 10).name("shelf return (ms)");
  navigation.add(motion, "shelfOvershoot", 1, 1.04, 0.001).name("settle");
  navigation.add(motion, "shelfWave", 0, 120, 5).name("wave (ms)");

  const lens = gui.addFolder("glass cursor");
  const cursor = cursorParams();
  for (const [key, min, max] of [
    ["diameter", 16, 80],
    ["precisionDiameter", 12, 28],
    ["magnify", 0, 0.8],
    ["precisionMagnify", 0, 0.6],
    ["dispersion", 0, 2],
    ["precisionDispersion", 0, 1],
    ["shine", 0, 0.6],
    ["rim", 0, 0.5],
    ["deform", 0, 0.12],
    ["response", 8, 40],
  ])
    lens.add(cursor, key, min, max);

  const drawer = gui.addFolder("glass menu");
  const surface = drawerParams();
  for (const [key, min, max] of [
    ["enter", 100, 1000],
    ["exit", 80, 350],
    ["travel", 0, 12],
    ["scaleX", 0.5, 1],
    ["scaleY", 0.5, 1],
    ["springDamping", 5, 14],
    ["springFrequency", 5, 14],
    ["squeeze", 0, 0.06],
    ["cornerFlex", 0, 24],
    ["gap", 4, 24],
    ["corner", 8, 40],
    ["bevel", 2, 16],
    ["refract", 0, 30],
    ["bendWidth", 24, 120],
    ["edgeBlend", 4, 28],
    ["lens", 0, 0.08],
    ["frost", 0, 8],
    ["veil", 0, 1],
    ["shadow", 0, 0.3],
    ["shine", 0, 0.15],
    ["fringe", 0, 1],
    ["pixelRatio", 1, 2],
  ]) {
    drawer.add(surface, key, min, max).onChange(() => {
      window.dispatchEvent(new Event("liquid-drawer-change"));
    });
  }

  // -- fit -----------------------------------------------------------------
  // Every px param in the folders below is quoted at the reference window.
  // Tuning at some other size and leaving it alone is what makes the ring look
  // right here and wrong everywhere else, so the live size sits next to it.
  const fit = gui.addFolder("fit");
  const onFit = (k, lo, hi, step, label) =>
    fit.add(params, k, lo, hi, step).name(label).onChange(refit);

  fit.add(info, "window").listen().disable().name("this window");
  fit.add(info, "scale").listen().disable().name("scale");
  onFit("refWidth", 320, 3840, 1, "ref width");
  onFit("refHeight", 320, 2400, 1, "ref height");
  fit
    .add(
      {
        adopt: () => {
          actions.adoptWindow();
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
        },
      },
      "adopt",
    )
    .name("use this window as ref");
  onFit("fitHeight", 0, 1, 0.01, "height's say");
  onFit("minScale", 0.1, 2, 0.01, "min");
  onFit("maxScale", 0.5, 4, 0.01, "max");

  fit.add(info, "band").listen().disable().name("band");
  onFit("narrowAt", 320, 1600, 10, "narrow at (px)");
  onFit("narrowPlane", 0.5, 3, 0.01, "narrow plane x");
  onFit("narrowRadius", 0.5, 3, 0.01, "narrow radius x");
  fit
    .add(params, "narrowText", 0.5, 3, 0.01)
    .name("narrow text x")
    .onChange(refit);
  fit.add(params, "narrowPosX", -4, 4, 0.005).name("narrow move x");
  fit.add(params, "narrowEndScale", 0.05, 8, 0.01).name("narrow end scale");
  onFit("tightAt", 240, 1200, 10, "tight at (px)");
  onFit("tightRadius", 0.3, 2, 0.01, "tight radius x");
  fit.add(params, "tightPosX", -6, 6, 0.005).name("tight move x");
  onFit("tightSplit", 0.2, 2, 0.01, "tight heading x");

  // -- shape ---------------------------------------------------------------
  const shape = gui.addFolder("shape");
  shape.add(params, "planeSize", 10, 900, 1).name("plane size");
  shape.add(params, "count", 2, MAX_PLANES, 1);
  shape.add(params, "ringRadius", 20, 2400, 1).name("ring radius");
  shape.add(params, "seed", -180, 180, 1).name("seed angle");
  shape.add(params, "radial");
  shape.add(params, "radius", 0, 300, 0.5).name("corner");
  shape.add(params, "textured");
  shape.add(params, "blend", 0, 120, 0.5).name("art crossfade");
  shape.add(params, "imageOffset", 0, 32, 1).name("image offset");
  shape.add(info, "restingGap").listen().disable().name("resting gap");

  const lane = gui.addFolder("horizontal gallery");
  lane.add(params, "laneWidth", 240, 800, 1).name("card width");
  lane.add(params, "laneAspect", 0.5, 1.5, 0.01).name("card bounds aspect");
  lane.add(params, "laneHeightFill", 0.4, 0.85, 0.01).name("height limit");
  lane.add(params, "laneWidthFill", 0.4, 0.85, 0.01).name("width limit");
  lane.add(params, "laneSpacing", 0.8, 1.5, 0.01).name("spacing");
  lane.add(params, "laneTightSpacing", 0.8, 1.2, 0.01).name("phone spacing");
  lane.add(params, "laneSideScale", 0.4, 0.9, 0.01).name("side scale");
  lane.add(params, "laneFocusFalloff", 1, 6, 0.1).name("focus falloff");
  lane.add(params, "laneSideDim", 0, 0.4, 0.01).name("side dim");
  lane.add(params, "laneTitleY", 0.85, 0.96, 0.005).name("title position");
  lane.add(params, "laneEnterScale", 0.3, 1, 0.01).name("entry scale");
  lane.add(params, "laneGlassAt", 0, 0.95, 0.01).name("glass starts");
  lane
    .add(params, "laneRevealTime", 0.4, 3, 0.05)
    .name("entry time")
    .onChange(replay);
  lane.add(params, "wheelFill", 0.2, 0.65, 0.01).name("wheel fill");
  lane.add(params, "wheelTime", 0.2, 2, 0.05).name("wheel time");
  lane.add(params, "wheelEase", EASES).name("wheel ease");
  lane.add(params, "wheelMargin", 0, 80, 1).name("wheel margin");
  lane.add(params, "laneSideBand", 0.05, 0.4, 0.01).name("edge band");
  lane.add(params, "laneSidePull", 0, 160, 1).name("edge pull");
  lane.add(params, "laneSideFlare", 0, 2, 0.01).name("edge flare");
  lane.add(params, "laneEdgeSoftness", 0, 20, 0.5).name("edge softness");
  lane.add(params, "laneEdgeDispersion", 0, 16, 0.5).name("edge dispersion");

  // -- loader --------------------------------------------------------------
  const loader = gui.addFolder("load gate");
  loader.add(params, "loaderChase", 0.02, 1, 0.01).name("settle speed");
  loader.add(params, "holdAfter", 0, 3, 0.05).name("ready hold (s)");
  loader
    .add(params, "artTimeout", 1000, 15000, 100)
    .name("image timeout (next load)");

  // -- entry ---------------------------------------------------------------
  const timing = gui.addFolder("opening");
  timing.add(params, "entryBirthTime", 0.2, 1.5, 0.01).onChange(replay);
  timing.add(params, "spreadEase", EASES).onChange(replay);

  // -- the intro heading ----------------------------------------------------
  const text = gui.addFolder("text");
  text.add(params, "text").onFinishChange(rebuildText);
  text.add(params, "textSize", 8, 200, 1).onChange(rebuildText);
  text
    // Only families with an @font-face block in globals.css — anything else
    // silently falls back to system sans and looks like a bug.
    .add(params, "textFont", [
      "PingFang Heavy",
      "Noto Sans SC",
      "Satoshi",
      "Geist",
    ])
    .name("family")
    .onChange(rebuildText);
  text.add(params, "textWeight", WEIGHTS).onChange(rebuildText);
  text
    .add(params, "textTracking", -0.1, 0.4, 0.005)
    .name("tracking (em)")
    .onChange(rebuildText);
  text
    .add(params, "textAt", 0, 1, 0.01)
    .name("start (frac of spread)")
    .onChange(replay);
  text.add(params, "textTime", 0.05, 6, 0.05).onChange(replay);
  text.add(params, "textStagger", 0, 0.4, 0.005).onChange(replay);
  text.add(params, "textEase", EASES).onChange(replay);
  text.add(params, "textOut").name("leaves").onChange(replay);
  text.add(params, "textOutAt", -6, 6, 0.05).name("leaves at (s)").onChange(replay); // prettier-ignore
  text.add(params, "textOutTime", 0.05, 6, 0.05).onChange(replay);
  text.add(params, "textOutEase", EASES).onChange(replay);

  // -- glass ---------------------------------------------------------------
  const glass = gui.addFolder("glass");
  glass.add(params, "glass").name("enabled");
  glass.add(params, "bandTop", 0, 0.5, 0.005).name("top band");
  glass.add(params, "bandBottom", 0, 0.5, 0.005).name("bottom band");
  glass.add(params, "refract", -400, 400, 1);
  glass.add(params, "squeeze", -1, 1, 0.005);
  glass.add(params, "ripple", -120, 120, 0.5);
  glass.add(params, "rippleFreq", 0, 0.2, 0.0005);
  glass.add(params, "fringe", 0, 40, 0.1);
  glass.add(params, "sheen", -0.5, 0.5, 0.005);

  // -- input ---------------------------------------------------------------
  const scroll = gui.addFolder("scroll");
  scroll.add(params, "autoSpeed", -2, 2, 0.005).name("auto rad / s");
  scroll.add(params, "autoResume", 0, 8, 0.1).name("resume delay");
  scroll.add(params, "scrollSpeed", 0, 0.05, 0.0001);
  scroll.add(params, "damping", 0.5, 0.999, 0.001);
  scroll.add(params, "maxSpeed", 0.5, 60, 0.5);
  scroll.add(params, "dragSpeed", 0, 5, 0.01);
  scroll.add(params, "snap");
  scroll.add(params, "snapTime", 0.2, 3, 0.05).name("snap time (s)");
  scroll.add(params, "snapFrom", 0.1, 20, 0.1).name("settle below");
  scroll.add(params, "pickTime", 0.1, 2, 0.05).name("pick, per slot (s)");
  scroll.add(params, "pickEase", EASES).name("pick ease");

  const pointer = gui.addFolder("pointer");
  pointer.add(params, "hover").name("enabled");
  pointer.add(params, "touchHold", 0, 1, 0.01).name("touch hold (s)");
  pointer.add(params, "touchSlop", 0, 60, 1).name("touch hold slop");
  pointer.add(params, "lag", 0.02, 1, 0.01).name("cursor chase");
  pointer.add(params, "melt", 0, 200, 0.5);
  pointer.add(params, "meltReach", 0, 900, 5).name("melt reach");
  pointer.add(params, "reach", 0.2, 8, 0.05).name("hover reach");
  pointer.add(params, "swell", 0, 1, 0.005);
  pointer.add(params, "pull", 0, 300, 1).name("lean");
  pointer.add(params, "grab", 0.01, 1, 0.005);
  pointer.add(params, "release", 0.01, 1, 0.005);
  pointer.add(params, "web", 0, 1, 0.005).name("thread");
  pointer.add(params, "webReach", 0.1, 4, 0.05).name("thread reach");
  pointer.add(params, "wave", 0, 60, 0.1).name("wake");
  pointer.add(params, "waveFreq", 0, 0.5, 0.001).name("wake freq");
  pointer.add(params, "waveSpeed", 0, 40, 0.1).name("wake speed");

  // Apart from the pointer folder above: those answer to the cursor and are
  // always live, these answer to the card under it and only while there is one.
  const sides = gui.addFolder("side cards");
  sides.add(params, "sideScale", 0, 0.9, 0.005).name("scale down");
  sides.add(params, "sidePush", 0, 240, 1).name("push away");
  sides.add(params, "sideDim", 0, 1, 0.01).name("dim");
  sides.add(params, "sideReach", 0.2, 12, 0.05).name("reach (how many)");

  const focusParticles = gui.addFolder("hover particles");
  focusParticles.add(params, "focusParticles").name("enabled");
  focusParticles
    .add(params, "focusParticleFrom", 0, 2000, 10)
    .name("desktop from (px)");
  focusParticles.add(params, "focusParticleReach", 10, 260, 1).name("reach");
  focusParticles
    .add(params, "focusParticleCell", 5, 32, 0.5)
    .name("glyph size");
  focusParticles
    .add(params, "focusParticleOpacity", 0, 1, 0.01)
    .name("opacity");
  focusParticles
    .add(params, "focusParticleEnter", 0.01, 1, 0.005)
    .name("enter rate");
  focusParticles
    .add(params, "focusParticleExit", 0.01, 1, 0.005)
    .name("exit rate");
  focusParticles
    .add(params, "focusParticleDrift", 0, 6, 0.05)
    .name("inward drift");
  focusParticles
    .add(params, "focusParticleOut", 0, 12, 0.05)
    .name("outward speed");

  const assemble = gui.addFolder("particle opening");
  assemble.add(params, "assemble").name("enabled").onChange(replay);
  assemble
    .add(params, "assembleFrom", 0, 2000, 10)
    .name("desktop from (px)")
    .onChange(replay);
  assemble.add(params, "assembleTime", 0.4, 4, 0.05).name("gather time").onChange(replay); // prettier-ignore
  assemble.add(params, "assembleEase", EASES).name("ease").onChange(replay);
  assemble.add(params, "assembleSpread", 1, 8, 0.05).name("cloud spread");
  assemble.add(params, "assembleCardScale", 1, 5, 0.05).name("image scale");
  assemble.add(params, "assembleCell", 6, 30, 0.5).name("glyph size");
  assemble.add(params, "assembleOpacity", 0, 1, 0.01).name("opacity");
  assemble.add(params, "assembleHaloReach", 20, 260, 1).name("card halo reach");
  assemble
    .add(params, "assembleHaloOpacity", 0, 1, 0.01)
    .name("card halo opacity");

  // -- material ------------------------------------------------------------
  const honey = gui.addFolder("honey");
  honey.add(params, "thread", 0, 6, 0.01);
  honey.add(params, "thin", 0.05, 12, 0.01);
  honey.add(params, "pinch", 0.01, 2, 0.01); // above 1 barrels instead of necks
  honey.add(params, "sag", -300, 300, 0.5); // negative arches it upward
  honey.add(params, "dissolve", 0, 100, 0.1);
  honey.add(params, "fillet", 0, 250, 0.5);

  const birth = gui.addFolder("birth");
  birth.add(params, "wobble", 0, 120, 0.1);
  birth.add(params, "goo", 0, 250, 0.5);

  return gui;
}
