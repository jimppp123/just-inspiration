import * as THREE from "three";

// Small tiles shade only nearby photographs. Keep room for every card:
// phone layouts and new births can put more than eight in the same tile.
export function createLookup(uniforms) {
  let texture,
    data,
    nextData,
    counts,
    columns = 0,
    rows = 0,
    width = 0,
    height = 0;
  // #region debug-point D:capacity
  let samples = 0,
    peak = 0;
  // #endregion
  const resize = (w, h) => {
    width = w;
    height = h;
    columns = Math.ceil(w / 80);
    rows = Math.ceil(h / 80);
    data = new Float32Array(columns * rows * 32).fill(-1);
    nextData = new Float32Array(data.length);
    counts = new Uint8Array(columns * rows);
    texture?.dispose();
    texture = new THREE.DataTexture(
      data,
      8,
      columns * rows,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    uniforms.uLookup.value = texture;
    uniforms.uTileGrid.value.set(columns, rows);
  };
  const update = (cards, count) => {
    // #region debug-point D:capacity
    if (
      process.env.NODE_ENV === "development" &&
      window.__liquidDebug &&
      samples++ % 60 === 0
    ) {
      let max = 0;
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) {
          const left = (col / columns) * width - width / 2,
            right = ((col + 1) / columns) * width - width / 2;
          const bottom = (row / rows) * height - height / 2,
            top = ((row + 1) / rows) * height - height / 2;
          max = Math.max(
            max,
            cards
              .slice(0, count)
              .filter(
                (c) =>
                  c.z >= 0.1 &&
                  c.w >= 0.1 &&
                  c.x + c.z + 40 >= left &&
                  c.x - c.z - 40 <= right &&
                  c.y + c.w + 40 >= bottom &&
                  c.y - c.w - 40 <= top,
              ).length,
          );
        }
      if (max > peak) {
        peak = max;
        fetch("http://127.0.0.1:7777/event", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "liquid-flicker",
            runId: window.__liquidDebug,
            hypothesisId: "D",
            msg: "[DEBUG] tile candidate peak",
            data: { max, width, height },
            ts: Date.now(),
          }),
        }).catch(() => {});
      }
    }
    // #endregion
    nextData.fill(-1);
    counts.fill(0);
    // Visit only tiles touched by a card; preserve card order for SDF blending.
    for (let i = 0; i < count; i++) {
      const c = cards[i];
      if (c.z < 0.1 || c.w < 0.1) continue;
      const x0 = Math.max(
        0,
        Math.ceil(((c.x - c.z - 40) / width + 0.5) * columns) - 1,
      );
      const x1 = Math.min(
        columns - 1,
        Math.floor(((c.x + c.z + 40) / width + 0.5) * columns),
      );
      const y0 = Math.max(
        0,
        Math.ceil(((c.y - c.w - 40) / height + 0.5) * rows) - 1,
      );
      const y1 = Math.min(
        rows - 1,
        Math.floor(((c.y + c.w + 40) / height + 0.5) * rows),
      );
      for (let row = y0; row <= y1; row++) {
        for (let col = x0; col <= x1; col++) {
          const tile = row * columns + col;
          nextData[tile * 32 + counts[tile]++] = i;
        }
      }
    }
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== nextData[i]) {
        data.set(nextData);
        texture.needsUpdate = true;
        break;
      }
    }
  };
  return { resize, update, dispose: () => texture?.dispose() };
}
