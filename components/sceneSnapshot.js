const scenes = new Set();
const frameListeners = new Set();

export function subscribeSceneFrames(listener) {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

// Consumers upload synchronously, before the source drawing buffer is cleared.
export function publishSceneFrame(canvas) {
  for (const listener of frameListeners) listener(canvas);
}

export function registerSceneSnapshot(canvas, scope, render) {
  const scene = { canvas, scope, render };
  scenes.add(scene);
  return () => scenes.delete(scene);
}

// Capture once while the source context still owns its drawing buffer. Reading
// a preserveDrawingBuffer:false canvas on a later frame can return empty pixels.
export function captureSceneSnapshot() {
  const snapshot = document.createElement("canvas");
  snapshot.width = innerWidth;
  snapshot.height = innerHeight;
  const ctx = snapshot.getContext("2d");
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, snapshot.width, snapshot.height);
  const visible = [...scenes].filter(
    ({ scope }) =>
      scope.isConnected && !scope.closest('[data-scene-paused="true"]'),
  );
  for (const { canvas, scope, render } of visible) {
    // During shelf entry or a texture fallback, the DOM still owns the art.
    for (const image of scope.querySelectorAll(".shelf-image img")) {
      if (!image.complete || !image.naturalWidth) continue;
      const rect = image.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    }
    render();
    if (getComputedStyle(canvas).opacity === "0") continue;
    const rect = canvas.getBoundingClientRect();
    ctx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height);
  }
  return snapshot;
}
