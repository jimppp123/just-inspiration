import * as THREE from "three";
import { drawerParams } from "./focus/params";
import { captureSceneSnapshot, subscribeSceneFrames } from "./sceneSnapshot";
import { fragmentShader, vertexShader } from "./shaders/drawerShaders";

export function createLiquidDrawer(dialog) {
  const content = dialog.querySelector(".drawer-content");
  const body = dialog.querySelector(".drawer-body");
  const params = drawerParams();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  } catch {
    // Native form controls remain usable on devices without a WebGL context.
  }
  const uniforms = {
    uScene: { value: null },
    uResolution: { value: new THREE.Vector2() },
    uPanel: { value: new THREE.Vector4() },
    uProgress: { value: 0 },
    uShape: { value: new THREE.Vector3() },
    uGlass: { value: new THREE.Vector3() },
    uLight: { value: new THREE.Vector2() },
    uLens: { value: 0 },
    uBend: { value: new THREE.Vector2() },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  scene.add(new THREE.Mesh(geometry, material));
  if (renderer) {
    renderer.domElement.className = "drawer-liquid-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    dialog.prepend(renderer.domElement);
    dialog.dataset.liquidSurface = "true";
    renderer.compile(scene, camera);
  }
  let progress = 0;
  let velocity = 0;
  let opacity = 0;
  let raf = 0;
  let finish = null;
  let anchor = null;
  let panel = null;
  let origin = { x: 0, y: 0 };
  let reducedMotion = false;
  let unsubscribe = null;

  const setSource = (canvas) => {
    if (!renderer) return;
    if (uniforms.uScene.value?.image === canvas) {
      uniforms.uScene.value.needsUpdate = true;
      return;
    }
    uniforms.uScene.value?.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    uniforms.uScene.value = texture;
  };
  const snapshot = () => {
    if (renderer) setSource(captureSceneSnapshot());
  };
  const stopLive = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const startLive = () => {
    if (!renderer || unsubscribe) return;
    unsubscribe = subscribeSceneFrames((canvas) => {
      if (!dialog.open || !panel) return;
      setSource(canvas);
      renderer.render(scene, camera);
    });
  };
  const fit = () => {
    const button = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    if (button) {
      const top = Math.max(
        12,
        Math.min(button.bottom + params.gap, innerHeight - 120),
      );
      const right = Math.max(
        12,
        Math.min(
          innerWidth - content.offsetWidth - 12,
          innerWidth - button.right,
        ),
      );
      content.style.setProperty("--menu-top", `${top}px`);
      content.style.setProperty("--menu-right", `${right}px`);
    }
    // Cache untransformed bounds only when the menu's content or viewport changes.
    content.style.transform = "none";
    panel = content.getBoundingClientRect();
    origin = {
      x: button
        ? Math.max(
            0,
            Math.min(panel.width, button.x + button.width / 2 - panel.x),
          )
        : panel.width / 2,
      y: button ? button.y + button.height / 2 - panel.y : 0,
    };
    content.style.transformOrigin = `${origin.x}px ${origin.y}px`;
    uniforms.uResolution.value.set(innerWidth, innerHeight);
    renderer?.setPixelRatio(Math.min(devicePixelRatio, params.pixelRatio));
    renderer?.setSize(innerWidth, innerHeight);
  };
  const render = () => {
    if (!panel) return;
    const remaining = reducedMotion ? 0 : 1 - progress;
    const strain =
      reducedMotion || progress === 1 ? 0 : Math.sin(Math.PI * progress);
    const squeeze = strain * params.squeeze;
    const scaleX = 1 - (1 - params.scaleX) * remaining + squeeze;
    const scaleY = 1 - (1 - params.scaleY) * remaining - squeeze;
    const offset = -params.travel * remaining;
    const corner = params.corner + params.cornerFlex * remaining;
    uniforms.uPanel.value.set(
      panel.x + origin.x + (panel.width / 2 - origin.x) * scaleX,
      panel.y + origin.y + (panel.height / 2 - origin.y) * scaleY + offset,
      (panel.width / 2) * scaleX,
      (panel.height / 2) * scaleY,
    );
    uniforms.uProgress.value = opacity;
    uniforms.uShape.value.set(
      corner * Math.min(scaleX, scaleY),
      params.bevel,
      params.shadow,
    );
    uniforms.uGlass.value.set(params.refract, params.frost, params.veil);
    uniforms.uLight.value.set(params.shine, params.fringe);
    uniforms.uLens.value = params.lens * (1 + Math.abs(strain));
    uniforms.uBend.value.set(params.bendWidth, params.edgeBlend);
    content.style.borderRadius = `${corner}px`;
    content.style.opacity = String(opacity);
    content.style.transform =
      remaining || squeeze
        ? `translateY(${offset}px) scale(${scaleX}, ${scaleY})`
        : "none";
    if (renderer) renderer.render(scene, camera);
  };
  const resize = () => {
    if (!dialog.open) return;
    snapshot();
    fit();
    render();
  };
  const invalidate = () => {
    if (dialog.open) {
      fit();
      render();
    }
  };
  const sizeObserver = new ResizeObserver(invalidate);
  sizeObserver.observe(content);
  sizeObserver.observe(body);
  window.addEventListener("resize", resize);
  window.addEventListener("liquid-drawer-change", invalidate);
  dialog.addEventListener("close", stopLive);

  return {
    prepare(trigger) {
      anchor = trigger;
      progress = 0;
      velocity = 0;
      opacity = 0;
      content.style.opacity = "0";
      snapshot();
    },
    animate(closing, reduced) {
      cancelAnimationFrame(raf);
      finish?.(false);
      reducedMotion = reduced;
      fit();
      startLive();
      const from = progress;
      const fromVelocity = velocity;
      const fromOpacity = opacity;
      const to = closing ? 0 : 1;
      const duration = reduced ? 0 : closing ? params.exit : params.enter;
      const seconds = duration / 1000;
      const decay = params.springDamping;
      const frequency = params.springFrequency;
      const displacement = from - to;
      // Carry momentum through reversals instead of restarting a fixed curve.
      const impulse =
        (fromVelocity * seconds + decay * displacement) / frequency;
      const started = performance.now();
      dialog.dataset.animating = "true";
      return new Promise((resolve) => {
        finish = resolve;
        const tick = (now) => {
          const t = duration
            ? Math.max(0, Math.min(1, (now - started) / duration))
            : 1;
          const envelope = Math.exp(-decay * t);
          const cosine = Math.cos(frequency * t);
          const sine = Math.sin(frequency * t);
          const wave = displacement * cosine + impulse * sine;
          progress = t === 1 ? to : to + envelope * wave;
          velocity =
            t === 1
              ? 0
              : (envelope *
                  (frequency * (impulse * cosine - displacement * sine) -
                    decay * wave)) /
                seconds;
          const fade = closing ? t : Math.min(1, t * 3);
          opacity = fromOpacity + (to - fromOpacity) * (1 - (1 - fade) ** 3);
          render();
          if (t < 1) raf = requestAnimationFrame(tick);
          else {
            delete dialog.dataset.animating;
            if (closing) stopLive();
            finish = null;
            resolve(true);
          }
        };
        tick(started);
      });
    },
    dispose() {
      cancelAnimationFrame(raf);
      finish?.(false);
      stopLive();
      sizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("liquid-drawer-change", invalidate);
      dialog.removeEventListener("close", stopLive);
      uniforms.uScene.value?.dispose();
      geometry.dispose();
      material.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      delete dialog.dataset.liquidSurface;
      delete dialog.dataset.animating;
    },
  };
}
