import * as THREE from "three";
import { PROJECTS } from "./projects";

// Cells store full sources; per-card dimensions restore their natural aspect.
const CELL_W = 512;
const CELL_H = Math.round(CELL_W / 1.5);

const localSource = (src) =>
  src.startsWith("/") || /^https?:/.test(src) ? src : `/${src}`;

const load = (src, priority, timeout, pending) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    // Must be set before src or the request is already away.
    if (priority) img.fetchPriority = priority;
    const clear = () => {
      clearTimeout(timer);
      pending.delete(cancel);
      img.onload = img.onerror = null;
    };
    const cancel = () => {
      clear();
      img.src = "";
      reject(new Error(`image cancelled: ${src}`));
    };
    const timer = setTimeout(cancel, timeout);
    pending.add(cancel);
    img.onload = () => {
      clear();
      resolve(img);
    };
    img.onerror = () => {
      clear();
      reject(new Error(`failed to load ${src}`));
    };
    img.src = src;
  });

/**
 * Packs every image into one texture. A single atlas rather than one texture
 * per plane because ESSL 1.00 cannot index an array of samplers with a
 * non-constant index.
 *
 * Returns synchronously with the sheet blank and filling in as images arrive:
 * the caller needs something to bind on frame one, and the entry shows cell 0
 * while the rest are still coming.
 *
 * `first` settles once cell 0 is on the texture, `ready` once all of them are.
 * Neither rejects — a missing file leaves its cell blank and still counts as
 * settled, so one bad path cannot strand the entry.
 */
export function buildAtlas(projects = PROJECTS, onProgress, timeout = 6500) {
  const cols = Math.ceil(Math.sqrt(projects.length));
  const rows = Math.ceil(projects.length / cols);
  const aspects = projects.map(() => 1.5);
  const sources = projects.map((project) => localSource(project.file));
  const dimensions = projects.map(() => ({ width: 3, height: 2 }));
  const pending = new Set();
  let disposed = false;

  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL_W;
  canvas.height = rows * CELL_H;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  // The shader flips each cell itself, so leave the sheet as drawn.
  texture.flipY = false;
  // NoColorSpace deliberately: this shader writes straight to the framebuffer
  // with no encoding step, and decoding on read without encoding on write is
  // what washes everything out.
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // Nearest-card selection changes atlas cells across neighbouring pixels.
  // Implicit mip derivatives see that jump as huge minification and sample
  // unrelated cells, leaving seams in the liquid blend.
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const paint = (img, i) => {
    const x = (i % cols) * CELL_W;
    const y = Math.floor(i / cols) * CELL_H;

    // UVs span the complete photo. Only storage is resampled to the cell;
    // the drawn plane uses this decoded ratio, including local fallbacks.
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(x, y, CELL_W, CELL_H);
    ctx.drawImage(img, x, y, CELL_W, CELL_H);
    aspects[i] = img.naturalWidth / img.naturalHeight;
    sources[i] = img.currentSrc || img.src;
    dimensions[i] = { width: img.naturalWidth, height: img.naturalHeight };
  };

  let settled = 0;
  const tick = () => onProgress?.(settled / projects.length);

  const fetchInto = (i, priority) => {
    const fallback = localSource(projects[i].file);
    const source = projects[i].source
      ? `/api/pinterest/image?url=${encodeURIComponent(projects[i].source.replace("/originals/", "/736x/"))}`
      : fallback;
    return load(source, priority, timeout, pending)
      .catch((error) => {
        if (source === fallback || disposed) throw error;
        return load(fallback, priority, timeout, pending);
      })
      .then((img) => {
        if (!disposed) paint(img, i);
      })
      .catch((err) => {
        if (!disposed) console.warn("[atlas]", err.message);
      })
      .finally(() => {
        settled++;
        if (!disposed) tick();
      });
  };

  // Cell 0 is the seed's art, the only thing on screen during the hold, so it
  // is asked for ahead of the rest and uploaded the moment it lands.
  const first = fetchInto(0, "high").then(() => {
    if (!disposed) texture.needsUpdate = true;
  });

  // One upload at the end for everything else. Marking dirty per image would
  // re-send the whole sheet eighteen times for cells nobody is looking at yet.
  const ready = Promise.all([
    first,
    ...projects.slice(1).map((_, k) => fetchInto(k + 1, "low")),
  ]).then(() => {
    if (!disposed) texture.needsUpdate = true;
  });

  tick();
  return {
    texture,
    grid: [cols, rows],
    count: projects.length,
    aspects,
    sources,
    dimensions,
    first,
    ready,
    dispose: () => {
      disposed = true;
      for (const cancel of pending) cancel();
      texture.dispose();
    },
  };
}
