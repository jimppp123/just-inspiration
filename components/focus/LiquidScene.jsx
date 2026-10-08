"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { vertexShader, fragmentShader } from "./shaders";
import { focusParams, shelfParams } from "./params";
import { arrange, ratioOf, separate } from "./layout";
import { createLookup } from "./lookup";
import { startRenderLoop } from "../renderLoop";

const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const sourceOf = (p) =>
  p.file.startsWith("/") || /^https?:/.test(p.file) ? p.file : `/${p.file}`;

export default function LiquidScene({
  projects,
  origin,
  requested,
  onCoreClick,
  onCoreDown,
  onCoreUp,
  onBranch,
  onOpenPin,
  onReady,
  onCount,
  onFailure,
  closing,
}) {
  const rootRef = useRef(null),
    hitRef = useRef([]);
  const clickTimer = useRef(null);
  const requestRef = useRef(requested),
    closeRef = useRef(closing);
  const pointer = useRef({ x: 0, y: 0, inside: false, down: false, index: -1 });
  const callbacks = useRef({ onReady, onCount, onFailure });
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    requestRef.current = requested;
  }, [requested]);
  useEffect(() => {
    closeRef.current = closing;
  }, [closing]);
  useEffect(() => {
    callbacks.current = { onReady, onCount, onFailure };
  }, [onReady, onCount, onFailure]);
  useEffect(
    () => () => {
      clearTimeout(clickTimer.current);
    },
    [],
  );

  const activate = (project, index) => {
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      if (index === 0) onCoreClick();
      else onBranch(project, hitRef.current[index].getBoundingClientRect());
    }, 220);
  };
  const openPin = (event, project) => {
    event.preventDefault();
    clearTimeout(clickTimer.current);
    onOpenPin(project);
  };

  useEffect(() => {
    const root = rootRef.current,
      params = focusParams();
    const edge = shelfParams();
    // #region debug-point C:lifecycle
    if (process.env.NODE_ENV === "development" && window.__liquidDebug)
      fetch("http://127.0.0.1:7777/event", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "liquid-flicker",
          runId: window.__liquidDebug,
          hypothesisId: "C",
          msg: "[DEBUG] scene mount",
          data: { count: projects.length },
          ts: Date.now(),
        }),
      }).catch(() => {});
    // #endregion
    let disposed = false,
      renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    } catch {
      callbacks.current.onFailure("浏览器暂时无法显示液态效果。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, params.pixelRatio));
    renderer.domElement.style.opacity = "0";
    root.prepend(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const sheet = document.createElement("canvas"),
      grid = Math.ceil(Math.sqrt(projects.length));
    sheet.width = sheet.height = grid * params.textureCell;
    const ctx = sheet.getContext("2d"),
      texture = new THREE.CanvasTexture(sheet);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const uniforms = {
      uResolution: { value: new THREE.Vector2() },
      uLookup: { value: null },
      uTileGrid: { value: new THREE.Vector2() },
      uAtlas: { value: texture },
      uGrid: { value: grid },
      uCard: { value: Array.from({ length: 31 }, () => new THREE.Vector4()) },
      uStyle: { value: Array.from({ length: 31 }, () => new THREE.Vector4()) },
      uPull: { value: Array.from({ length: 31 }, () => new THREE.Vector2()) },
      uCount: { value: projects.length },
      uLinks: { value: 0 },
      uEnds: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uThread: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uGoo: { value: params.goo },
      uGlass: { value: params.glass },
      uCue: { value: new THREE.Vector4() },
      uCueStyle: { value: new THREE.Vector3() },
      uReadyRipple: { value: new THREE.Vector4() },
      uReadyRippleFx: { value: new THREE.Vector3() },
      uBands: { value: new THREE.Vector4() },
      uLip: {
        value: new THREE.Vector4(
          edge.refract,
          edge.squeeze,
          edge.ripple,
          edge.rippleFreq,
        ),
      },
      uFinish: { value: new THREE.Vector2(edge.fringe, edge.sheen) },
      uContentTop: { value: 0 },
    };
    const lookup = createLookup(uniforms);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    const loaded = new Set(),
      images = [],
      timers = new Set();
    const loadDeadline = performance.now() + params.loadTimeout;
    const load = (i) =>
      new Promise((resolve) => {
        if (performance.now() >= loadDeadline) return resolve();
        const image = new Image();
        images.push(image);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          timers.delete(timer);
          image.onload = image.onerror = null;
          // Release stalled requests so a retry does not join the same load.
          if (!image.complete) image.src = "";
          resolve();
        };
        const timer = setTimeout(
          finish,
          Math.max(1, loadDeadline - performance.now()),
        );
        timers.add(timer);
        image.onload = () => {
          if (disposed || settled) return finish();
          const target = ratioOf(projects[i]),
            source = image.naturalWidth / image.naturalHeight;
          const sw =
            source > target ? image.naturalHeight * target : image.naturalWidth;
          const sh =
            source > target ? image.naturalHeight : image.naturalWidth / target;
          ctx.drawImage(
            image,
            (image.naturalWidth - sw) / 2,
            (image.naturalHeight - sh) / 2,
            sw,
            sh,
            (i % grid) * params.textureCell,
            Math.floor(i / grid) * params.textureCell,
            params.textureCell,
            params.textureCell,
          );
          loaded.add(i);
          finish();
        };
        image.onerror = finish;
        image.src = sourceOf(projects[i]);
      });
    let next = 0,
      assetsReady = false;
    const worker = async () => {
      while (!disposed && next < projects.length) await load(next++);
    };
    Promise.all(Array.from({ length: 6 }, worker)).then(() => {
      if (disposed) return;
      if (!loaded.has(0)) {
        callbacks.current.onFailure("图片暂时无法载入。");
        return;
      }
      texture.needsUpdate = true;
      assetsReady = true;
      // #region debug-point C:upload
      if (process.env.NODE_ENV === "development" && window.__liquidDebug)
        fetch("http://127.0.0.1:7777/event", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "liquid-flicker",
            runId: window.__liquidDebug,
            hypothesisId: "C",
            msg: "[DEBUG] atlas upload",
            data: { count: loaded.size },
            ts: Date.now(),
          }),
        }).catch(() => {});
      // #endregion
    });
    let w = 0,
      h = 0,
      layout;
    const bodies = new Map();
    const resize = () => {
      const r = root.getBoundingClientRect();
      // #region debug-point C:resize
      if (process.env.NODE_ENV === "development" && window.__liquidDebug)
        fetch("http://127.0.0.1:7777/event", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "liquid-flicker",
            runId: window.__liquidDebug,
            hypothesisId: "C",
            msg: "[DEBUG] scene size",
            data: {
              width: r.width,
              height: r.height,
              open: root.closest("dialog")?.open,
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
      // #endregion
      // A closing dialog can report its removed box before effect cleanup.
      if (disposed || r.width <= 0 || r.height <= 0) return;
      if (r.width === w && r.height === h) return;
      w = r.width;
      h = r.height;
      renderer.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
      uniforms.uBands.value.set(
        h * edge.band,
        w * edge.sideBand,
        h * edge.band,
        w * edge.sideBand,
      );
      lookup.resize(w, h);
      layout = arrange(w, h, projects, params);
      for (const [i, b] of bodies) {
        const dest = layout.children[i - 1];
        b.x = dest.x;
        b.y = dest.y;
        b.vx = b.vy = 0;
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = projects.map(() => ({ x: 0, y: 0, hover: 0, squeeze: 0 }));
    let started = null,
      last = performance.now(),
      lastBirth = -Infinity,
      closeAt = null,
      usedAt = null,
      ready = false,
      reported = 0;
    const placeHit = (i, x, y, bw, bh, visible) => {
      const el = hitRef.current[i];
      if (!el) return;
      el.style.cssText = `width:${bw}px;height:${bh}px;transform:translate(${w / 2 + x - bw / 2}px,${h / 2 - y - bh / 2}px);visibility:${visible ? "visible" : "hidden"}`;
      el.disabled = !visible || closeAt !== null;
    };
    const stopRendering = startRenderLoop(
      renderer,
      () => {
        if (disposed || !assetsReady || !layout) return;
        const now = performance.now(),
          rawDt = (now - last) / 1000,
          dt = Math.min(rawDt, 0.032);
        last = now;
        if (started === null) started = now;
        const clock = (now - started) / 1000;
        if (closeRef.current && closeAt === null) closeAt = clock;
        if (requestRef.current > 0 && usedAt === null) usedAt = clock;
        const retreat = closeAt === null ? 0 : smooth((clock - closeAt) / 0.5);
        const cueFade =
          usedAt === null ? 1 : 1 - smooth((clock - usedAt) / params.cueFade);
        if (
          ready &&
          closeAt === null &&
          bodies.size < Math.min(requestRef.current, loaded.size - 1) &&
          (reduced.matches || clock - lastBirth >= params.birthInterval)
        ) {
          const i = projects.findIndex(
            (_, index) => index > 0 && loaded.has(index) && !bodies.has(index),
          );
          if (i > 0) {
            const dest = layout.children[i - 1],
              core = layout.core;
            const len = Math.hypot(dest.x, dest.y),
              nx = dest.x / len,
              ny = dest.y / len;
            const edge = Math.min(
              core.w / 2 / Math.max(Math.abs(nx), 0.001),
              core.h / 2 / Math.max(Math.abs(ny), 0.001),
            );
            bodies.set(i, {
              i,
              born: clock,
              x: nx * edge * 0.86,
              y: ny * edge * 0.86,
              startX: nx * edge * 0.86,
              startY: ny * edge * 0.86,
              vx: 0,
              vy: 0,
              pressure: 0,
            });
            lastBirth = clock;
          }
        }
        if (reported !== bodies.size) {
          reported = bodies.size;
          callbacks.current.onCount(reported);
        }
        const hit = pointer.current;
        const hoverIndex = hit.inside ? hit.index : -1;
        const core = layout.core;
        const coreMotion = motion[0];
        coreMotion.hover +=
          ((hoverIndex === 0 ? 1 - cueFade : 0) - coreMotion.hover) *
          (1 - Math.exp(-dt * 10));
        const px = Math.max(-1, Math.min(1, (hit.x - w / 2) / (core.w / 2)));
        const py = Math.max(-1, Math.min(1, (h / 2 - hit.y) / (core.h / 2)));
        coreMotion.x +=
          (px * params.hoverPull * coreMotion.hover - coreMotion.x) *
          (1 - Math.exp(-dt * 9));
        coreMotion.y +=
          (py * params.hoverPull * coreMotion.hover - coreMotion.y) *
          (1 - Math.exp(-dt * 9));
        const float = reduced.matches
          ? 0
          : Math.sin(clock * 0.75) * params.float * (1 - cueFade);
        const cx = mix(
          coreMotion.x,
          origin.x + origin.width / 2 - w / 2,
          retreat,
        );
        const cy = mix(
          coreMotion.y + float,
          h / 2 - origin.y - origin.height / 2,
          retreat,
        );
        const cw = mix(core.w, origin.width, retreat),
          ch = mix(core.h, origin.height, retreat);
        // The DOM seed owns the return flight; only the satellites retreat here.
        uniforms.uCard.value[0].set(
          cx,
          cy,
          closeRef.current ? 0 : cw / 2,
          closeRef.current ? 0 : ch / 2,
        );
        uniforms.uStyle.value[0].set(params.corner, 0, coreMotion.hover, 0);
        uniforms.uPull.value[0].set(px, py);
        placeHit(0, 0, 0, core.w + 18, core.h + 18, ready);
        // The first painted frame takes over the loading dots at the same position.
        const merged = reduced.matches ? 1 : smooth(clock / params.cueMerge);
        const flight = reduced.matches
          ? 1
          : smooth((clock - params.cueMerge) / params.cueFlight);
        const arrived = Math.max(0, clock - params.cueMerge - params.cueFlight);
        const breath = reduced.matches
          ? 0
          : (1 - Math.cos((arrived * Math.PI * 2) / params.cuePeriod)) * 0.5;
        const cueAlpha = closeAt === null && loaded.size > 1 ? cueFade : 0;
        uniforms.uCue.value.set(
          cx,
          cy - (core.h / 2 + params.cueOffset) * (1 - flight),
          mix(params.cueRadius, params.cueReadyRadius, merged) *
            (1 + breath * params.cueBreath),
          cueAlpha,
        );
        uniforms.uCueStyle.value.set(
          params.cueGap * (1 - merged),
          flight,
          params.cueOpacity,
        );
        const imageSize = Math.min(core.w, core.h);
        const wavelength = imageSize * params.rippleSpan;
        uniforms.uReadyRipple.value.set(
          arrived,
          reduced.matches
            ? 0
            : cueAlpha * smooth(arrived / params.rippleAttack),
          wavelength,
          wavelength / params.ripplePeriod,
        );
        uniforms.uReadyRippleFx.value.set(
          imageSize * params.rippleStrength,
          params.rippleShine,
          params.rippleWidth,
        );
        const active = [];
        for (const [i, b] of bodies) {
          const dest = layout.children[i - 1],
            m = motion[i];
          b.age = reduced.matches
            ? 1
            : clamp((clock - b.born) / params.splitTime);
          const eased = 1 - Math.pow(1 - b.age, 3);
          const hover = hoverIndex === i ? 1 : 0;
          m.hover += (hover - m.hover) * (1 - Math.exp(-dt * 11));
          const hx = Math.max(
            -1,
            Math.min(1, (hit.x - w / 2 - b.x) / (dest.w / 2)),
          );
          const hy = Math.max(
            -1,
            Math.min(1, (h / 2 - hit.y - b.y) / (dest.h / 2)),
          );
          const tx =
            mix(b.startX, dest.x, eased) +
            (reduced.matches
              ? 0
              : Math.sin(clock * 0.61 + dest.phase) * params.float) +
            hx * m.hover * params.hoverPull;
          const ty =
            mix(b.startY, dest.y, eased) +
            (reduced.matches
              ? 0
              : Math.cos(clock * 0.69 + dest.phase) * params.float) +
            hy * m.hover * params.hoverPull;
          if (b.age < 0.8 || reduced.matches) {
            b.x = tx;
            b.y = ty;
          } else {
            b.vx += (tx - b.x) * params.spring * dt;
            b.vy += (ty - b.y) * params.spring * dt;
            b.vx *= Math.exp(-params.damping * dt);
            b.vy *= Math.exp(-params.damping * dt);
            b.x += b.vx * dt;
            b.y += b.vy * dt;
          }
          const birthScale = reduced.matches
            ? 1
            : 0.16 + 0.84 * smooth(b.age * 1.7);
          b.w = dest.w * birthScale;
          b.h = dest.h * birthScale;
          b.pressure = 0;
          uniforms.uPull.value[i].set(hx, hy);
          active.push(b);
        }
        separate(
          active,
          { ...core, x: cx, y: cy },
          layout.area,
          layout.gap * 0.65,
          params.squeeze,
        );
        let links = 0;
        for (const b of active) {
          const i = b.i,
            m = motion[i];
          m.squeeze += (b.pressure - m.squeeze) * (1 - Math.exp(-dt * 12));
          const bw = b.w * (1 + m.squeeze) * (1 - retreat),
            bh = (b.h / (1 + m.squeeze)) * (1 - retreat);
          const x = mix(b.x, cx, retreat),
            y = mix(b.y, cy, retreat);
          uniforms.uCard.value[i].set(x, y, bw / 2, bh / 2);
          uniforms.uStyle.value[i].set(
            mix(Math.min(bw, bh) * 0.4, params.corner, smooth(b.age)),
            0,
            m.hover,
            i,
          );
          placeHit(i, b.x, b.y, b.w + 4, b.h + 4, b.age === 1);
          if (b.age < 0.72 && links < 8 && !reduced.matches && retreat === 0) {
            const pinch = 1 - smooth((b.age - 0.14) / 0.58);
            uniforms.uEnds.value[links].set(b.startX, b.startY, x, y);
            uniforms.uThread.value[links].set(
              params.thread * pinch,
              params.thread * pinch * pinch - 1,
              i,
              params.goo * pinch + 0.1,
            );
            links++;
          }
        }
        uniforms.uLinks.value = links;
        uniforms.uGoo.value = params.goo;
        uniforms.uGlass.value = params.glass;
        // #region debug-point B:bounds
        if (
          process.env.NODE_ENV === "development" &&
          window.__liquidDebug &&
          Math.floor(clock * 4) !== Math.floor((clock - dt) * 4)
        )
          fetch("http://127.0.0.1:7777/event", {
            method: "POST",
            body: JSON.stringify({
              sessionId: "liquid-flicker",
              runId: window.__liquidDebug,
              hypothesisId: "B",
              msg: "[DEBUG] frame bounds",
              data: {
                clock,
                dt: rawDt,
                shown: bodies.size,
                core: uniforms.uCard.value[0].toArray(),
                dom: root.parentElement
                  .querySelector(".focus-seed-preview")
                  ?.getBoundingClientRect()
                  .toJSON(),
              },
              ts: Date.now(),
            }),
          }).catch(() => {});
        // #endregion
        lookup.update(uniforms.uCard.value, projects.length);
        renderer.render(scene, camera);
        if (!ready) {
          ready = true;
          root.dataset.painted = "true";
          renderer.domElement.style.opacity = "1";
          setPainted(true);
          callbacks.current.onReady(loaded.size - 1);
        }
      },
      (pausedFor) => {
        last = performance.now();
        if (started !== null) started += pausedFor;
      },
    );
    let gui;
    if (process.env.NODE_ENV === "development")
      import("lil-gui").then(({ default: GUI }) => {
        if (disposed) return;
        gui = new GUI({ title: "液态探索", autoPlace: false });
        root.append(gui.domElement);
        gui.hide();
        for (const [key, min, max] of [
          ["goo", 0, 35],
          ["glass", 0, 1],
          ["thread", 0, 25],
          ["float", 0, 5],
          ["hoverPull", 0, 18],
          ["spring", 15, 70],
          ["damping", 5, 20],
          ["squeeze", 0, 0.06],
          ["birthInterval", 0.15, 0.6],
          ["splitTime", 0.3, 1.5],
          ["corner", 4, 24],
        ])
          gui.add(params, key, min, max);
        const cue = gui.addFolder("ready cue");
        for (const [key, min, max] of [
          ["cueOffset", 20, 60],
          ["cueGap", 6, 16],
          ["cueRadius", 2, 5],
          ["cueReadyRadius", 3, 9],
          ["cueOpacity", 0, 1],
          ["cueMerge", 0.1, 0.5],
          ["cueFlight", 0.3, 1.2],
          ["cuePeriod", 1, 4],
          ["cueBreath", 0, 0.5],
          ["cueFade", 0.15, 0.8],
          ["rippleAttack", 0.04, 0.4],
          ["rippleSpan", 0.15, 0.6],
          ["ripplePeriod", 0.7, 3],
          ["rippleWidth", 0.02, 0.2],
          ["rippleStrength", 0, 0.09],
          ["rippleShine", 0, 0.15],
        ])
          cue.add(params, key, min, max);
        for (const [key, min, max] of [
          ["gap", 8, 32],
          ["imageSize", 100, 220],
          ["coreWidth", 180, 360],
          ["coreHeight", 200, 380],
          ["coreScale", 0.9, 1.2],
          ["mobileImageSize", 55, 100],
        ])
          gui.add(params, key, min, max).onChange(() => {
            w = 0;
            resize();
          });
      });
    return () => {
      // #region debug-point C:cleanup
      if (process.env.NODE_ENV === "development" && window.__liquidDebug)
        fetch("http://127.0.0.1:7777/event", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "liquid-flicker",
            runId: window.__liquidDebug,
            hypothesisId: "C",
            msg: "[DEBUG] scene cleanup",
            data: {},
            ts: Date.now(),
          }),
        }).catch(() => {});
      // #endregion
      disposed = true;
      observer.disconnect();
      stopRendering();
      timers.forEach(clearTimeout);
      images.forEach((i) => {
        i.onload = i.onerror = null;
        if (!i.complete) i.src = "";
      });
      gui?.destroy();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      lookup.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [projects, origin]);

  const move = (event) => {
    if (event.pointerType === "touch") return;
    pointer.current.x = event.clientX;
    pointer.current.y = event.clientY;
    pointer.current.inside = true;
    const target = event.target.closest(".liquid-hit");
    const index =
      target && !target.disabled ? Number(target.dataset.index) : -1;
    // #region debug-point A:hover
    if (
      process.env.NODE_ENV === "development" &&
      window.__liquidDebug &&
      index !== pointer.current.index
    )
      fetch("http://127.0.0.1:7777/event", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "liquid-flicker",
          runId: window.__liquidDebug,
          hypothesisId: "A",
          msg: "[DEBUG] pointer target",
          data: { index },
          ts: Date.now(),
        }),
      }).catch(() => {});
    // #endregion
    pointer.current.index = index;
  };
  return (
    <div
      ref={rootRef}
      className="liquid-scene"
      data-painted={painted}
      onPointerMove={move}
      onPointerLeave={() => {
        pointer.current.inside = false;
        pointer.current.index = -1;
      }}
    >
      {projects.map((p, i) => (
        <button
          key={p.id}
          ref={(el) => {
            hitRef.current[i] = el;
          }}
          className={`liquid-hit ${i === 0 ? "liquid-core" : "liquid-satellite"}`}
          data-index={i}
          type="button"
          aria-label={i === 0 ? "长按展开关联灵感" : "聚焦这张关联灵感"}
          onPointerDown={i === 0 ? onCoreDown : undefined}
          onPointerUp={i === 0 ? onCoreUp : undefined}
          onPointerCancel={i === 0 ? onCoreUp : undefined}
          onLostPointerCapture={i === 0 ? onCoreUp : undefined}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={(event) => openPin(event, p)}
          onClick={() => activate(p, i)}
        />
      ))}
    </div>
  );
}
