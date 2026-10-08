export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec4 uPanel;
uniform float uProgress;
uniform vec3 uShape; // corner, bevel, shadow
uniform vec3 uGlass; // refraction, frost, uniform tint
uniform vec2 uLight; // shine, chromatic fringe
uniform float uLens;
uniform vec2 uBend; // refraction reach, edge blend

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float field(vec2 p) {
  return roundedBox(p - uPanel.xy, uPanel.zw, uShape.x);
}

vec2 softRamp(vec2 t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 source(vec2 p) {
  vec2 uv = clamp(p / uResolution, vec2(0.001), vec2(0.999));
  vec4 art = texture2D(uScene, vec2(uv.x, 1.0 - uv.y));
  // Live WebGL frames are transparent where the page's paper shows through.
  return mix(vec3(0.980392), art.rgb, art.a);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
  float d = field(p);
  float coverage = 1.0 - smoothstep(-0.8, 0.8, d);
  if (d > 0.8) {
    float shadow = exp(-max(field(p - vec2(0.0, 5.0)), 0.0) / 10.0);
    gl_FragColor = vec4(0.03, 0.04, 0.035, shadow * uShape.z * uProgress);
    return;
  }
  vec2 normal = normalize(vec2(
    field(p + vec2(0.8, 0.0)) - field(p - vec2(0.8, 0.0)),
    field(p + vec2(0.0, 0.8)) - field(p - vec2(0.0, 0.8))
  ) + vec2(0.00001));
  float depth = max(0.0, -d);
  float lip = 1.0 - smoothstep(0.0, uShape.y, depth);
  float rim = 4.0 * lip * (1.0 - lip);
  vec2 local = p - uPanel.xy;
  // Bound the falloff slope so the UVs cannot reverse inside a narrow rim.
  vec2 reach = min(vec2(max(uBend.x, uGlass.x * 3.0)), uPanel.zw * 0.85);
  float innerReach = min(reach.x, reach.y);
  vec2 blend = softRamp(vec2(
    depth / min(uBend.y, innerReach * 0.5),
    depth / innerReach
  ));
  // Separate face weights blend through corners without an SDF normal crease.
  vec2 faceDepth = max(uPanel.zw - abs(local), 0.0);
  vec2 bend = min(vec2(uGlass.x), reach / 3.0)
    * (1.0 - softRamp(faceDepth / reach)) * blend.x;
  vec2 lensPoint = uPanel.xy + (p - uPanel.xy) / (1.0 + uLens);
  vec2 samplePoint = mix(p, lensPoint, blend.y) - sign(local) * bend;
  // Frost and tint belong to the whole pane, including its rounded perimeter.
  float blur = uGlass.y;
  vec3 color = source(samplePoint) * 0.4;
  color += source(samplePoint + vec2(blur, blur)) * 0.15;
  color += source(samplePoint + vec2(-blur, blur)) * 0.15;
  color += source(samplePoint + vec2(blur, -blur)) * 0.15;
  color += source(samplePoint - vec2(blur, blur)) * 0.15;
  color.r = mix(color.r, source(samplePoint + normal * uLight.y).r, rim);
  color.b = mix(color.b, source(samplePoint - normal * uLight.y).b, rim);
  // A light diffusion layer keeps dark DOM type readable over moving artwork.
  color = mix(color, vec3(0.98, 0.985, 0.99), uGlass.z);
  float light = dot(normal, normalize(vec2(-0.65, -0.76)));
  color = mix(color, vec3(1.0), rim * uLight.x * (0.55 + light * 0.45));
  gl_FragColor = vec4(color, coverage * uProgress);
}
`;
