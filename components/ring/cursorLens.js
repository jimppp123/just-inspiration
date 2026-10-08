import { cursorParams } from "./params";

export function cursorUniforms(THREE) {
  return {
    uCursor: { value: new THREE.Vector4() },
    uCursorFx: { value: new THREE.Vector4() },
    uCursorMotion: { value: new THREE.Vector2() },
  };
}

export function createCursorLens(uniforms) {
  const params = cursorParams();
  let lastX = 0;
  let lastY = 0;
  let seeded = false;
  return {
    update(x, y, visible, dt, pressed = false, reduced = false) {
      const cursor = uniforms.uCursor.value;
      const motion = uniforms.uCursorMotion.value;
      const response = 1 - Math.exp(-dt * params.response);
      const dx = seeded ? x - lastX : 0;
      const dy = seeded ? y - lastY : 0;
      const distance = Math.hypot(dx, dy);
      const speed = Math.min(1, distance / Math.max(dt * 1000, 1));
      const stretch = visible && !reduced ? speed * params.deform : 0;
      motion.x += ((dx / (distance || 1)) * stretch - motion.x) * response;
      motion.y += ((dy / (distance || 1)) * stretch - motion.y) * response;
      cursor.set(
        x,
        y,
        (params.diameter / 2) * (pressed ? 0.9 : 1),
        // Ownership changes in one frame; only the shape eases.
        visible ? 1 : 0,
      );
      uniforms.uCursorFx.value.set(
        params.magnify,
        params.dispersion,
        params.shine,
        params.rim,
      );
      seeded = visible;
      lastX = x;
      lastY = y;
    },
    reset() {
      seeded = false;
      uniforms.uCursor.value.w = 0;
      uniforms.uCursorMotion.value.set(0, 0);
    },
  };
}

// Shared by the two existing scene passes: no frame capture or extra context.
export const cursorLensShader = /* glsl */ `
  uniform vec4 uCursor; // screen-centred position, radius, presence
  uniform vec4 uCursorFx; // magnification, dispersion px, light, dark shoulder
  uniform vec2 uCursorMotion;

  vec2 cursorLocal(vec2 p) {
    vec2 q = (p - uCursor.xy) / max(uCursor.z, 1.0);
    float stretch = length(uCursorMotion);
    vec2 axis = stretch > 0.0001 ? uCursorMotion / stretch : vec2(1.0, 0.0);
    vec2 across = vec2(-axis.y, axis.x);
    return vec2(dot(q, axis) / (1.0 + stretch),
                dot(q, across) * (1.0 + stretch));
  }

  float cursorMask(vec2 p) {
    float r = length(cursorLocal(p));
    float aa = 0.9 / max(uCursor.z, 1.0);
    return (1.0 - smoothstep(1.0 - aa, 1.0 + aa, r)) * uCursor.w;
  }

  vec2 cursorRefract(vec2 p) {
    if (uCursor.w < 0.001) return p;
    float r = min(length(cursorLocal(p)), 1.0);
    // Magnify the whole interior; the monotone slope returns to the real
    // image at the lip without doubling a background edge.
    float r2 = r * r;
    float bend = 1.0 - r2 * r2;
    float lens = 1.0 - clamp(uCursorFx.x, 0.0, 0.8) * bend * uCursor.w;
    return uCursor.xy + (p - uCursor.xy) * lens;
  }

  vec2 cursorFringe(vec2 p) {
    float r = min(length(cursorLocal(p)), 1.0);
    float r2 = r * r;
    // Each colour sees a slightly different interior magnification.
    return (p - uCursor.xy) / max(uCursor.z, 1.0) *
      uCursorFx.y * (1.0 - r2 * r2) * uCursor.w;
  }

  vec4 cursorComposite(vec2 p, vec4 surface, vec3 page) {
    if (uCursor.w < 0.001) return surface;
    float r = length(cursorLocal(p));
    float mask = cursorMask(p);
    vec2 normalXY = (p - uCursor.xy) / max(uCursor.z, 1.0);
    vec2 direction = normalize(normalXY + vec2(0.0001));
    float light = dot(direction, normalize(vec2(-0.55, 0.83)));
    float edge = exp(-pow((r - 0.94) / 0.055, 2.0));
    float inner = exp(-pow((r - 0.81) / 0.105, 2.0));
    float arc = pow(max(light, 0.0), 3.0);
    float opposite = pow(max(-light, 0.0), 5.0);
    vec3 glass = mix(page, surface.rgb, surface.a);
    glass *= 1.0 - uCursorFx.w * inner * (0.35 + 0.65 * opposite);
    float shoulder = exp(-pow((r - 0.68) / 0.24, 2.0));
    glass += uCursorFx.z * shoulder * arc * 0.065;
    glass += uCursorFx.z * edge * (0.16 + 0.84 * arc + 0.55 * opposite);
    float shadowR = length((p - uCursor.xy - vec2(0.4, -0.8)) /
      max(uCursor.z, 1.0));
    float shadow = exp(-pow((shadowR - 1.0) / 0.12, 2.0)) *
      0.07 * uCursor.w * (1.0 - mask);
    float alpha = surface.a + (1.0 - surface.a) * max(mask, shadow);
    vec3 base = surface.rgb * surface.a;
    base = mix(base, glass, mask);
    base *= 1.0 - shadow;
    return vec4(base / max(alpha, 0.0001), alpha);
  }
`;
