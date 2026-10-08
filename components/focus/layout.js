export const ratioOf = (p) =>
  p.width > 0 && p.height > 0 ? p.width / p.height : 1;
export const fit = (ratio, width, height) => {
  const w = Math.min(width, height * ratio);
  return [w, w / ratio];
};

// The preview and WebGL seed must agree when ownership of the image changes.
export function coreSize(width, height, project, params) {
  const mobile = width < 640;
  return fit(
    ratioOf(project),
    (mobile ? width * 0.39 : params.coreWidth) * params.coreScale,
    (mobile ? height * 0.25 : Math.min(params.coreHeight, height * 0.42)) *
      params.coreScale,
  );
}

function randomFrom(seed) {
  let state = 2166136261;
  for (const ch of String(seed))
    state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// Candidate rectangles leave uneven breathing room. A seed makes the same Pin
// stable across re-renders; this calculation only runs at load and resize.
export function arrange(width, height, projects, params) {
  const mobile = width < 640;
  const pad = mobile ? 18 : 48;
  const area = {
    left: -width / 2 + pad,
    right: width / 2 - pad,
    bottom: -height / 2 + 48,
    top: height / 2 - 84,
  };
  const [cw, ch] = coreSize(width, height, projects[0], params);
  const core = { x: 0, y: 0, w: cw, h: ch };
  for (let attempt = 0; attempt < 32; attempt++) {
    const random = randomFrom(projects[0].id);
    const scale = Math.pow(0.94, attempt);
    const gap = (mobile ? params.gap * 0.6 : params.gap) * scale;
    const occupied = [core],
      children = [];
    let success = true;
    for (let i = 1; i < projects.length; i++) {
      const size =
        (mobile || height < 500 ? params.mobileImageSize : params.imageSize) *
        scale *
        (0.76 + random() * 0.42);
      const [w, h] = fit(ratioOf(projects[i]), size * 1.15, size);
      const spacing = gap * (0.7 + random() * 1.1);
      let best = null,
        score = Infinity;
      for (let n = 0; n < params.packSamples; n++) {
        const x = area.left + w / 2 + random() * (area.right - area.left - w);
        const y = area.bottom + h / 2 + random() * (area.top - area.bottom - h);
        if (
          occupied.some(
            (p) =>
              Math.abs(x - p.x) < (w + p.w) / 2 + spacing &&
              Math.abs(y - p.y) < (h + p.h) / 2 + spacing,
          )
        )
          continue;
        const distance = Math.hypot(x / (width * 0.5), y / (height * 0.5));
        const cluster =
          Math.sin((x / width) * 8 + 0.8) * Math.cos((y / height) * 6 - 0.4);
        const cost = distance + cluster * 0.22 + random() * 0.16;
        if (cost < score) {
          score = cost;
          best = { x, y, w, h, phase: random() * Math.PI * 2, gap: spacing };
        }
      }
      if (!best) {
        success = false;
        break;
      }
      occupied.push(best);
      children.push(best);
    }
    if (success) return { core, children, area, gap, scale };
  }
  throw new Error("无法为当前视窗排列图片");
}

// Displace along the shallowest contact axis and retain the orthogonal volume.
// The seed is fixed; neighbouring cards share the small displacement.
export function separate(nodes, core, area, gap, squeeze) {
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.age < 0.8) continue;
      for (let j = -1; j < i; j++) {
        const b = j < 0 ? core : nodes[j];
        if (j >= 0 && b.age < 0.8) continue;
        const dx = a.x - b.x,
          dy = a.y - b.y;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const horizontal = ox < oy,
          depth = horizontal ? ox : oy;
        const direction = Math.sign(horizontal ? dx : dy) || 1;
        const key = horizontal ? "x" : "y";
        const shift = depth * 0.56;
        a[key] += direction * shift;
        if (j >= 0) b[key] -= direction * shift;
        else a[key] += direction * shift * 0.8;
        const pressure = Math.min(
          squeeze,
          (depth / Math.max(1, Math.min(a.w, a.h))) * 0.1,
        );
        a.pressure =
          (horizontal ? -1 : 1) * Math.max(Math.abs(a.pressure), pressure);
        if (j >= 0)
          b.pressure =
            (horizontal ? -1 : 1) * Math.max(Math.abs(b.pressure), pressure);
      }
      a.x = Math.max(area.left + a.w / 2, Math.min(area.right - a.w / 2, a.x));
      a.y = Math.max(area.bottom + a.h / 2, Math.min(area.top - a.h / 2, a.y));
    }
  }
}
