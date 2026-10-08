// Each element of every uniform array below costs a fragment uniform slot.
// The guaranteed WebGL2 minimum is 224 vec4s, so the link parameters are
// packed into one vec4 array and the image index is derived arithmetically
// rather than passed as a tenth array.
import { cursorLensShader } from "../ring/cursorLens";

export const MAX_PLANES = 32;
export const MAX_LINKS = 32;

export const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  #define MAX_PLANES ${MAX_PLANES}
  #define MAX_LINKS ${MAX_LINKS}

  varying vec2 vUv;

  uniform vec2  uResolution;   // canvas size in px
  uniform vec2  uSize;         // resting plane size in px
  uniform float uRadius;       // resting corner radius in px

  // per-plane state, driven from JS
  uniform float uCount;
  uniform vec2  uPos[MAX_PLANES];    // centre in px, origin at screen centre
  uniform float uRot[MAX_PLANES];    // radians
  // xy = 0..1 per axis, z = brightness (1 = lit, 0 = black), w = which atlas
  // cell this plane wears. All three ride in here rather than in arrays of
  // their own because GLSL ES gives every element of a uniform array a full
  // vec4 row whatever it is declared as — zw were already being paid for and
  // thrown away. The cell is resolved on the CPU because it depends on where
  // the plane sits on the ring, not on its index, and working that out per
  // pixel in the loop below would be absurd.
  uniform vec4  uScale[MAX_PLANES];

  // honey threads between neighbours, driven from JS
  uniform float uLinkCount;
  uniform vec2  uLinkA[MAX_LINKS];
  uniform vec2  uLinkB[MAX_LINKS];
  // (radius at the ends, radius at the pinch, droop, fillet)
  uniform vec4  uLinkPar[MAX_LINKS];

  uniform float uK;            // smin blend strength in px
  uniform float uWobble;       // surface tension noise amount, px
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uPage;

  // All the artwork lives in one atlas: ESSL 1.00 cannot index an array of
  // samplers with a varying index, so a per-plane texture is not an option.
  uniform sampler2D uAtlas;
  uniform vec2  uGrid;         // atlas cells across, down
  uniform float uBlend;        // px over which neighbouring art crossfades
  uniform float uTextured;

  // --- ASCII particle opening ---------------------------------------------
  // Real glyphs rasterised into a tiny atlas for the intro assembly.
  uniform sampler2D uAsciiTex;
  uniform vec4 uIntro; // gather progress, cloud expansion, cell px, opacity
  uniform vec4 uCardParticles; // launch, reach px, cell px, opacity
  uniform vec2 uFocusParticlePos;
  uniform vec4 uFocusParticleBox; // half size, radius, rotation
  uniform vec4 uFocusParticles; // amount, reach px, cell px, opacity
  uniform vec2 uFocusParticleMotion; // flow phase, motion multiplier

  // --- pointer -------------------------------------------------------------
  // Packed into vec4s for the same reason the link parameters are.
  uniform vec4 uMouse;  // cursor.xy px, presence 0..1, blend px added at it
  uniform vec4 uMelt;   // reach px, wake px, wake frequency, wake speed

  ${cursorLensShader}

  vec2 atlasUV(vec2 uv, float idx) {
    float col = mod(idx, uGrid.x);
    float row = floor(idx / uGrid.x);
    // Clamp after chromatic offsets too; a refracted edge must never sample
    // the neighbouring atlas cell.
    return (vec2(col, row) + clamp(uv, 0.004, 0.996)) / uGrid;
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // --- glass lip -----------------------------------------------------------
  // A band along the top and bottom of the screen behaving like the rounded
  // edge of a thick glass sheet. Because the whole scene is evaluated from p,
  // warping p here refracts the planes and the honey together, with no second
  // pass and no render target.
  uniform float uBandTop;     // px
  uniform float uBandBottom;  // px
  uniform vec4  uGlass;       // refract px, squeeze, ripple px, ripple freq
  uniform float uFringe;      // px of chromatic split inside the band
  uniform float uSheen;       // lift applied across the lip
  uniform vec4 uSideGlass;    // band px, inward pull px, vertical flare, amount
  uniform vec2 uSideFinish;   // contour softness and chromatic spread, px
  uniform float uCardRound;

  float sideProfile(float x) {
    float t = clamp((abs(x) - (uResolution.x * 0.5 - uSideGlass.x)) /
      max(uSideGlass.x, 0.01), 0.0, 1.0);
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0) * uSideGlass.w;
  }

  // Warps p in place and returns how deep into the lip this pixel sits, 0..1.
  float glassBend(inout vec2 p) {
    float band = p.y > 0.0 ? uBandTop : uBandBottom;
    float dy = abs(p.y) - (uResolution.y * 0.5 - band);
    float t = clamp(dy / max(band, 0.01), 0.0, 1.0);
    // Circular profile: barely bends at the inner edge, falls away sharply at
    // the very edge, which is what reads as thickness rather than a gradient.
    float bend = 1.0 - sqrt(max(0.0, 1.0 - t * t));

    float s = sign(p.y);
    // Sampling back toward centre throws content outward, so the image
    // stretches forward into the lip and swells as it reaches the edge.
    // Both terms are signed: negatives invert the lip and compress instead.
    p.y -= s * bend * (uGlass.x + sin(p.x * uGlass.w) * uGlass.z);
    p.x *= 1.0 - bend * uGlass.y;

    float side = sideProfile(p.x);
    p.x -= sign(p.x) * side * uSideGlass.y;
    p.y /= 1.0 + side * uSideGlass.z;
    return max(bend, side);
  }

  // --- simplex noise -------------------------------------------------------
  // Copyright (C) 2011 Ashima Arts. All rights reserved.
  // Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)
  // Distributed under the MIT License. https://github.com/ashima/webgl-noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                            dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // --- sdf helpers ---------------------------------------------------------
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  // The honey between two planes: a flat slab spanning centre to centre, as
  // wide as the edges it comes off and pinched in the middle, drooping under
  // its own weight.
  //
  // Deliberately not a capsule. A capsule has a round cross-section, so at
  // full merge it bulges out past the flat sides of the planes themselves.
  // This is swept as a box, so while the planes overlap it stays entirely
  // inside them and the silhouette reads as one flat card.
  float sdBridge(vec2 p, vec2 a, vec2 b, float rEnd, float rMid, float sag) {
    vec2 ba = b - a;
    float len = length(ba);
    if (len < 0.001) return 1e6;

    vec2 dir = ba / len;
    vec2 nrm = vec2(-dir.y, dir.x);

    vec2 q = p - (a + b) * 0.5;
    float along = dot(q, dir);
    float across = dot(q, nrm);

    float h = clamp(along / len + 0.5, 0.0, 1.0);
    float bell = sin(3.14159265 * h);           // 0 at the ends, 1 in the middle

    // droop, world -Y, resolved onto the across axis
    across += sag * bell * nrm.y;

    float taper = pow(1.0 - bell, 1.7);         // 1 at the ends, 0 in the middle
    float r = mix(rMid, rEnd, taper);

    // Ends are square and buried inside the planes, so they never show.
    return max(abs(along) - len * 0.5, abs(across) - r);
  }

  // smooth minimum — this is what makes the shapes read as liquid.
  // Note it also behaves as a plain min() when a is the 1e6 sentinel.
  float smin(float a, float b, float k) {
    if (k <= 0.0001) return min(a, b);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  vec4 introParticles(vec2 p) {
    float t = clamp(uIntro.x, 0.0, 1.0);
    float gather = t * t * (3.0 - 2.0 * t);
    float cloudScale = mix(max(1.0, uIntro.y), 1.0, gather);

    // Work in the seed card's local frame so the opening follows the image as
    // the centre card begins its launch onto the ring.
    vec2 q = p - uPos[0];
    float a = uRot[0];
    float ca = cos(a), sa = sin(a);
    q = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);

    vec2 target = q / cloudScale;
    vec2 halfSize = max(uSize * 0.5, vec2(1.0));
    vec2 normalised = target / halfSize;
    float diamondD = abs(normalised.x) + abs(normalised.y) - 1.0;
    float boxD = max(abs(normalised.x), abs(normalised.y)) - 1.0;
    float shapeMorph = smoothstep(0.35, 0.92, gather);
    float shapeD = mix(diamondD, boxD, shapeMorph);
    if (shapeD > 0.0) return vec4(0.0);

    float cell = max(uIntro.z, 5.0);
    float radius = max(length(q), 1.0);
    float ripple = sin(
      uTime * 1.4 + (abs(q.x) + abs(q.y)) * 0.018
    );
    vec2 current = q +
      (q / radius) * ripple * cell * 0.38 * (1.0 - gather);
    vec2 gridP = current / cell;
    vec2 mirrored = abs(gridP);
    vec2 tile = floor(mirrored);
    vec2 glyphUv = fract(mirrored);
    float seed = hash21(tile + 71.19);

    vec2 imageUv = target / uSize + 0.5;
    imageUv.y = 1.0 - imageUv.y;
    imageUv = clamp(imageUv, 0.004, 0.996);
    vec3 art = uTextured > 0.5
      ? texture2D(uAtlas, atlasUV(imageUv, uScale[0].w)).rgb
      : uColor;
    float luminance = dot(art, vec3(0.2126, 0.7152, 0.0722));

    float imageInfluence = smoothstep(0.28, 0.88, gather);
    float density = mix(0.30, 0.90, gather);
    float present = step(seed, density);
    float glyphBase = 3.0 + seed * 2.0;
    float glyphImage =
      (1.0 - luminance) * 4.8 + gather * 1.35 + seed * 0.8;
    float glyph = floor(clamp(
      mix(glyphBase, glyphImage, imageInfluence),
      0.0, 6.0
    ));
    vec2 atlasP = vec2((glyph + glyphUv.x) / 7.0, glyphUv.y);
    float mask = texture2D(uAsciiTex, atlasP).a;

    float born = smoothstep(0.0, 0.09, t);
    float handoff = 1.0 - smoothstep(0.58, 0.96, t);
    float pulse = 0.82 + 0.18 * sin(uTime * 3.2 + seed * 6.2831853);
    float cloudEdge = 1.0 - smoothstep(-0.16, 0.0, shapeD);
    float alpha =
      mask * present * born * handoff * pulse * cloudEdge * uIntro.w;

    // Keep pale source pixels legible on the paper field without flattening
    // the image back to monochrome.
    vec3 particle = mix(uColor, mix(uColor, art, 0.68), imageInfluence);
    return vec4(particle, alpha);
  }

  vec4 singleCardParticles(vec2 p) {
    float gather = clamp(uIntro.x, 0.0, 1.0);
    float launch = clamp(uCardParticles.x, 0.0, 1.0);
    float enter = smoothstep(0.52, 0.94, gather);
    float leave = smoothstep(0.04, 0.76, launch);
    float life = enter * (1.0 - leave);
    if (life <= 0.001) return vec4(0.0);

    // The field belongs only to the seed card. It rotates and contracts with
    // that card, then dies before the fan starts opening into a ring.
    vec2 q = p - uPos[0];
    float a = uRot[0];
    float ca = cos(a), sa = sin(a);
    q = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);

    vec2 seedScale = max(uScale[0].xy, vec2(0.08));
    vec2 halfSize = max(uSize * 0.5 * seedScale, vec2(1.0));
    float cardD = sdRoundBox(q, halfSize, min(uRadius, halfSize.y));
    float reach = max(uCardParticles.y, 8.0);

    // A four-axis diamond holds the particles behind the card instead of
    // allowing a circular fog. The inner cutout keeps the photograph crisp.
    vec2 outerHalf = halfSize + vec2(reach * 1.35, reach);
    float diamondD =
      abs(q.x / outerHalf.x) + abs(q.y / outerHalf.y) - 1.0;
    float envelope = 1.0 - smoothstep(-0.10, 0.0, diamondD);
    float outside = smoothstep(1.5, 5.0, cardD);
    float falloff = 1.0 - smoothstep(0.0, reach, cardD);
    float field = envelope * outside * pow(max(falloff, 0.0), 0.72);
    if (field <= 0.001) return vec4(0.0);

    float cell = max(uCardParticles.z, 5.0);
    float radius = max(length(q), 1.0);
    vec2 direction = q / radius;

    // Positive travel pulls mirrored rows inward. The sign reverses on exit,
    // so the same glyphs visibly peel back out through the four diamond tips.
    float travel = enter * 2.2 - leave * 5.0 + uTime * 0.16 * life;
    vec2 particleP = q + direction * cell * travel;
    vec2 gridP = abs(particleP / cell);
    vec2 tile = floor(gridP);
    vec2 glyphUv = fract(gridP);
    float seed = hash21(tile + 143.57);

    float density = mix(0.12, 0.66, enter) *
                    mix(0.62, 1.0, pow(max(falloff, 0.0), 0.55));
    float present = step(seed, density);
    float glyph = floor(clamp(
      falloff * 5.2 + seed * 1.45,
      0.0, 6.0
    ));
    vec2 atlasP = vec2((glyph + glyphUv.x) / 7.0, glyphUv.y);
    float mask = texture2D(uAsciiTex, atlasP).a;

    float phase = hash21(tile + 29.31) * 6.2831853;
    float pulse = 0.76 + 0.24 * sin(uTime * 3.0 + phase);
    float alpha =
      mask * present * field * life * pulse * uCardParticles.w;
    return vec4(uColor, alpha);
  }

  vec4 hoveredCardParticles(vec2 p) {
    float amount = clamp(uFocusParticles.x, 0.0, 1.0);
    if (amount <= 0.001) return vec4(0.0);

    vec2 q = p - uFocusParticlePos;
    float a = uFocusParticleBox.w;
    float ca = cos(a), sa = sin(a);
    q = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);

    vec2 halfSize = max(uFocusParticleBox.xy, vec2(1.0));
    float cardD = sdRoundBox(q, halfSize, uFocusParticleBox.z);
    float reach = max(uFocusParticles.y, 8.0);

    // Restore the original loose shadow field: distance from the rounded card
    // controls density, with no geometric envelope and no mirrored quadrants.
    float outside = smoothstep(1.5, 5.0, cardD);
    float falloff = 1.0 - smoothstep(0.0, reach, cardD);
    float field = outside * pow(max(falloff, 0.0), 1.25);
    if (field <= 0.001) return vec4(0.0);

    float cell = max(uFocusParticles.z, 5.0);
    float radius = max(length(q), 1.0);
    vec2 direction = q / radius;
    float travel =
      (uFocusParticleMotion.x + amount * 3.6) * uFocusParticleMotion.y;
    vec2 drift = vec2(
      uTime * 0.45 * cell,
      sin(uTime * 1.7 + q.x * 0.013) * cell * 0.34
    ) * uFocusParticleMotion.y;
    vec2 particleP = q + direction * cell * travel + drift;
    vec2 gridP = particleP / cell;
    vec2 tile = floor(gridP);
    vec2 glyphUv = fract(gridP);
    float seed = hash21(tile + 223.41);

    float density = mix(0.10, 0.76, pow(max(falloff, 0.0), 0.72)) *
                    mix(0.28, 1.0, amount);
    float present = step(seed, density);
    float glyph = floor(clamp(
      falloff * 6.35 + (seed - 0.5) * 1.35,
      0.0, 6.0
    ));
    vec2 atlasP = vec2((glyph + glyphUv.x) / 7.0, glyphUv.y);
    float mask = texture2D(uAsciiTex, atlasP).a;

    float phase = hash21(tile + 47.13) * 6.2831853;
    float movingPulse = 0.74 + 0.26 * sin(uTime * 3.2 + phase);
    float pulse = mix(1.0, movingPulse, uFocusParticleMotion.y);
    float alpha =
      mask * present * field * amount * pulse * uFocusParticles.w;
    return vec4(uColor, alpha);
  }

  void main() {
    vec2 ps = (vUv - 0.5) * uResolution;

    vec2 p = cursorRefract(ps);
    float bend = glassBend(p);

    // Read after the bend, so the cursor acts in the same warped space as the
    // ring: dragged into the lip, its influence is refracted with everything
    // else rather than sitting flat on top of it.
    float toMouse = length(p - uMouse.xy);

    // Blend strength is lifted in a halo around the cursor, so the ring goes
    // soft exactly where it is being touched and stays crisp everywhere else.
    // Resolved once per pixel rather than per plane: it costs one length().
    float k = uK;
    if (uMouse.z > 0.001) {
      float t = 1.0 - smoothstep(0.0, max(uMelt.x, 1.0), toMouse);
      k += uMouse.w * uMouse.z * t * t;
    }

    float d = 1e6;

    // Keep the color field continuous even outside a card's silhouette.
    // A circular distance cull is safe for geometry, but cuts visible arcs
    // through overlapping artwork when it also removes color contributors.
    float distances[MAX_PLANES];
    vec2 artUV[MAX_PLANES];
    float nearest = 1e6;

    for (int i = 0; i < MAX_PLANES; i++) {
      if (float(i) >= uCount) break;

      distances[i] = 1e6;
      vec4 st = uScale[i];
      vec2 sc = st.xy;
      float grown = min(sc.x, sc.y);
      if (grown <= 0.0001) continue;

      vec2 q = p - uPos[i];
      // into the plane's local frame
      float a  = uRot[i];
      float ca = cos(a), sa = sin(a);
      q = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);

      vec2 halfSize = max(uSize * 0.5 * sc, vec2(0.0001));

      // starts as a circle (r = half extent), relaxes into the rounded rect
      float rMax = min(halfSize.x, halfSize.y);
      float r = min(rMax, mix(rMax, uRadius, smoothstep(0.30, 1.0, uCardRound)));

      float di = sdRoundBox(q, halfSize, r);
      d = smin(d, di, k);
      distances[i] = di;
      nearest = min(nearest, di);

      // Local UV. Clamped, so the goo outside a plane carries that plane's
      // edge colour rather than repeating or sampling the next atlas cell.
      vec2 luv = q / (2.0 * halfSize) + 0.5;
      luv.y = 1.0 - luv.y;
      luv = clamp(luv, 0.004, 0.996);

      artUV[i] = luv;
    }

    // Threads strung between neighbours as they pull apart.
    for (int i = 0; i < MAX_LINKS; i++) {
      if (float(i) >= uLinkCount) break;

      vec4 par = uLinkPar[i];
      // Radii are allowed to go negative: that lifts the bridge's field clear
      // of the surface so it fades out, rather than bottoming out at zero as a
      // half-covered hairline. Only cull once it is further out than the
      // antialiasing can reach.
      if (par.x <= -3.0) continue;

      vec2 a = uLinkA[i];
      vec2 b = uLinkB[i];
      vec2 mid = (a + b) * 0.5;
      float reach = length(b - a) * 0.5 + par.x + par.w + 8.0;
      if (dot(p - mid, p - mid) > reach * reach) continue;

      d = smin(d, sdBridge(p, a, b, par.x, par.y, par.z), par.w);
    }

    // Surface tension wobble, decays to zero so resting planes are dead flat.
    if (uWobble > 0.001) {
      float n = snoise(p * 0.012 + vec2(uTime * 0.22, uTime * -0.17));
      d += n * uWobble;
    }

    // A capillary wake off the cursor, amplitude driven by how fast it is
    // moving. Rings out from it and dies over the same reach the softening
    // uses, so a flick leaves a ripple in the surface that outlives the
    // movement that made it.
    if (uMelt.y > 0.001) {
      d += sin(toMouse * uMelt.z - uTime * uMelt.w)
         * uMelt.y * exp(-toMouse / max(uMelt.x, 1.0));
    }

    // Clamped, not just floored: the distance cull above leaves a step in the
    // field, and an unclamped fwidth across that step paints a half-opaque
    // outline along every cull boundary.
    float aa = clamp(fwidth(d), 0.5, 2.0);
    float alpha = 1.0 - smoothstep(-aa, aa, d);
    float side = sideProfile(ps.x);
    float softness = aa + uSideFinish.x * side * side;
    float dispersion = uSideFinish.y * side * side;
    vec3 coverage = 1.0 - smoothstep(
      vec3(-softness), vec3(softness),
      vec3(d - dispersion, d, d + dispersion)
    );
    alpha = max(coverage.r, max(coverage.g, coverage.b));

    vec4 intro = vec4(0.0);
    if (uIntro.w > 0.001 && uIntro.x < 0.999) {
      intro = introParticles(p);
    }
    vec4 cardParticles = vec4(0.0);
    if (
      uCardParticles.w > 0.001 &&
      uIntro.x > 0.48 &&
      uCardParticles.x < 0.80
    ) {
      cardParticles = singleCardParticles(p);
    }
    vec4 focusParticles = vec4(0.0);
    if (uFocusParticles.x > 0.001) {
      focusParticles = hoveredCardParticles(p);
    }

    if (
      alpha <= 0.001 &&
      focusParticles.a <= 0.001 &&
      cardParticles.a <= 0.001 &&
      intro.a <= 0.001 &&
      (uCursor.w <= 0.001 || length(cursorLocal(ps)) > 1.6)
    ) discard;

    // Equal distances receive equal weights, regardless of loop/rank order.
    // Contributions reach zero smoothly before skipping their texture taps.
    vec3 colorSum = vec3(0.0);
    float weightSum = 0.0;
    vec2 pageFringe = vec2(uFringe * bend / max(uSize.x, 1.0), 0.0);
    vec2 lensFringe = cursorFringe(ps);
    for (int i = 0; i < MAX_PLANES; i++) {
      if (float(i) >= uCount) break;
      if (distances[i] >= 1e5) continue;
      float weight = 1.0 - smoothstep(
        0.0, max(uBlend, 0.001), distances[i] - nearest
      );
      if (weight <= 0.0) continue;
      vec3 art = uColor;
      if (uTextured > 0.5) {
        vec2 uv = artUV[i];
        float cell = uScale[i].w;
        float c = cos(uRot[i]), s = sin(uRot[i]);
        vec2 localFringe = vec2(
          lensFringe.x * c + lensFringe.y * s,
          lensFringe.x * s - lensFringe.y * c
        );
        vec2 fr = pageFringe + localFringe / max(uSize * uScale[i].xy, vec2(1.0));
        art = texture2D(uAtlas, atlasUV(uv, cell)).rgb;
        if (dot(fr, fr) > 0.0000000001) {
          art.r = texture2D(uAtlas, atlasUV(uv + fr, cell)).r;
          art.b = texture2D(uAtlas, atlasUV(uv - fr, cell)).b;
        }
      }
      colorSum += art * uScale[i].z * weight;
      weightSum += weight;
    }
    vec3 col = weightSum > 0.0 ? colorSum / weightSum : uColor;

    // A touch of lift where the lip is steepest, so the band reads as a
    // surface catching light rather than only a warp.
    col += bend * uSheen;
    // Disperse the silhouette as well as the photo, fading into the page.
    // A shared alpha keeps the outside edge soft without a white outline.
    if (alpha > 0.001) {
      vec3 covered = mix(uPage, col, coverage);
      col = (covered - uPage * (1.0 - alpha)) / alpha;
    }

    // Composite both particle phases behind the photographic surface. This
    // keeps antialiased card edges clean instead of tinting them like an
    // outline, and prevents the field from following the completed ring.
    if (cardParticles.a > 0.001) {
      float combined = alpha + cardParticles.a * (1.0 - alpha);
      col = (col * alpha +
             cardParticles.rgb * cardParticles.a * (1.0 - alpha)) /
            max(combined, 0.0001);
      alpha = combined;
    }
    if (focusParticles.a > 0.001) {
      float combined = alpha + focusParticles.a * (1.0 - alpha);
      col = (col * alpha +
             focusParticles.rgb * focusParticles.a * (1.0 - alpha)) /
            max(combined, 0.0001);
      alpha = combined;
    }
    if (intro.a > 0.001) {
      float combined = alpha + intro.a * (1.0 - alpha);
      col = (col * alpha + intro.rgb * intro.a * (1.0 - alpha)) /
            max(combined, 0.0001);
      alpha = combined;
    }
    // Written straight through. The atlas is tagged NoColorSpace so sampling
    // returns the authored sRGB values, and this shader adds no output
    // encoding of its own — decoding on read without encoding on write is
    // what darkens everything.
    gl_FragColor = cursorComposite(ps, vec4(col, alpha), uPage);
  }
`;
