import { publishSceneFrame, registerSceneSnapshot } from "./sceneSnapshot";

// Covered scenes keep their context and atlas. The homepage can remain live
// beneath its glass menu, which consumes the frame before its buffer is cleared.
export function startRenderLoop(
  renderer,
  draw,
  onResume = () => {},
  scope = renderer.domElement,
  captureFrame,
  liveUnderMenu = false,
) {
  const unregister = captureFrame
    ? registerSceneSnapshot(renderer.domElement, scope, () => {
        draw();
        // A resting shelf can skip draw(); restore its buffer before copying.
        captureFrame();
      })
    : () => {};
  const drawFrame = liveUnderMenu
    ? () => {
        draw();
        publishSceneFrame(renderer.domElement);
      }
    : draw;
  let running = false;
  let pausedAt = performance.now();
  const sync = () => {
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    const modal = dialogs.at(-1);
    const paused = scope.closest('[data-scene-paused="true"]');
    const insideModal = modal?.contains(scope);
    // Top-layer dialogs remain active even when their owning page is paused.
    const covered = paused && (!insideModal || modal.contains(paused));
    const visible =
      !document.hidden &&
      !covered &&
      (!modal ||
        insideModal ||
        (liveUnderMenu && modal.dataset.sceneBackground === "live"));
    if (visible === running) return;
    running = visible;
    if (running) {
      onResume(performance.now() - pausedAt);
      renderer.setAnimationLoop(drawFrame);
    } else {
      pausedAt = performance.now();
      renderer.setAnimationLoop(null);
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "data-scene-paused"],
    childList: true,
  });
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    unregister();
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    renderer.setAnimationLoop(null);
  };
}
