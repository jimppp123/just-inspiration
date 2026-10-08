"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { fragmentShader, vertexShader } from "./shelfShaders";
import { shelfParams } from "./params";
import { createLookup } from "./lookup";
import { startRenderLoop } from "../renderLoop";
import { createCursorLens, cursorUniforms } from "../ring/cursorLens";

export default function ShelfLiquid({ gridRef }) {
  useEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const params = shelfParams();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const hover = matchMedia("(hover: hover)");
    const scroller = gridEl.closest("main");
    const header = scroller.querySelector(".shelf-header");
    let headerBottom = 0;
    // #region debug-point C:handoff-mount
    if (process.env.NODE_ENV === "development" && window.__shelfHandoffDebug)
      fetch("http://127.0.0.1:7777/event", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "shelf-handoff",
          runId: window.__shelfHandoffDebug,
          hypothesisId: "C",
          msg: "[DEBUG] liquid layer mount",
          data: {
            at: performance.now(),
            viewport: [innerWidth, innerHeight],
            surface: getComputedStyle(
              gridEl.querySelector(".shelf-liquid-surface"),
            ).transform,
            animations: scroller.getAnimations({ subtree: true }).length,
            count: gridEl.querySelectorAll(".shelf-item").length,
          },
        }),
      }).catch(() => {});
    // #endregion
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, params.pixelRatio));
    renderer.domElement.className = "shelf-liquid-canvas";
    // A transformed scrolling ancestor moves even position:fixed descendants.
    document.body.append(renderer.domElement);
    gridEl.dataset.glassCursor = "true";
    const atlas = document.createElement("canvas"),
      cell = params.textureCell;
    atlas.width = atlas.height = cell * 6;
    const ctx = atlas.getContext("2d"),
      texture = new THREE.CanvasTexture(atlas);
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    const uniforms = {
      ...cursorUniforms(THREE),
      uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uLookup: { value: null },
      uTileGrid: { value: new THREE.Vector2() },
      uAtlas: { value: texture },
      uCard: { value: Array.from({ length: 31 }, () => new THREE.Vector4()) },
      uStyle: { value: Array.from({ length: 31 }, () => new THREE.Vector4()) },
      uPointer: { value: new THREE.Vector4() },
      uSurface: { value: new THREE.Vector4() },
      uBands: { value: new THREE.Vector4() },
      uLip: { value: new THREE.Vector4() },
      uFinish: { value: new THREE.Vector2() },
      uContentTop: { value: 0 },
      uTime: { value: 0 },
      uCorner: { value: params.corner },
      uGlass: { value: params.glass },
      uReveal: { value: 0 },
    };
    const cursorLens = createCursorLens(uniforms);
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const lookup = createLookup(uniforms);
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    let items = [],
      active = null,
      x = 0,
      y = 0,
      smoothX = 0,
      smoothY = 0,
      speed = 0,
      down = false,
      amount = 0,
      handoff = 0,
      painted = false,
      dirty = true,
      lost = false,
      disposed = false,
      last = performance.now();
    const restore = () =>
      items.forEach(({ el }) => {
        delete el.dataset.liquid;
      });
    const syncItems = () => {
      headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
      const candidates = [...gridEl.querySelectorAll(".shelf-item")]
        .map((el) => ({
          el,
          rect: el.getBoundingClientRect(),
          img: el.querySelector("img"),
        }))
        .filter(
          ({ el, rect, img }) =>
            el.dataset.animated !== "true" &&
            img?.complete &&
            img.naturalWidth > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > -64 &&
            rect.top < innerHeight + 64,
        );
      candidates.sort((a, b) => {
        const priority = ({ el, rect }) =>
          el === active
            ? -1e6
            : Math.min(
                rect.top,
                innerHeight - rect.bottom,
                Math.hypot(rect.x - x, rect.y - y),
              );
        return priority(a) - priority(b);
      });
      const selected = candidates.slice(0, 31);
      const retained = new Map(items.map((item) => [item.el, item]));
      const keep = new Set(selected.map(({ el }) => el));
      for (const item of items)
        if (!keep.has(item.el)) delete item.el.dataset.liquid;
      const used = new Set(
        items.filter(({ el }) => keep.has(el)).map(({ slot }) => slot),
      );
      let changed = false;
      items = selected.map(({ el, rect: r, img }) => {
        const previous = retained.get(el);
        const ratio = r.width / r.height;
        if (
          previous &&
          previous.source === img.currentSrc &&
          Math.abs(previous.ratio - ratio) < 0.001
        ) {
          previous.rect = r;
          return previous;
        }
        let slot = previous?.slot;
        if (slot === undefined) {
          slot = 0;
          while (used.has(slot)) slot++;
          used.add(slot);
        }
        const cellX = (slot % 6) * cell;
        const cellY = Math.floor(slot / 6) * cell;
        const sourceRatio = img.naturalWidth / img.naturalHeight;
        const drawW = sourceRatio > ratio ? cell : cell * (sourceRatio / ratio);
        const drawH = sourceRatio > ratio ? cell * (ratio / sourceRatio) : cell;
        ctx.fillStyle =
          getComputedStyle(el).getPropertyValue("--item-color").trim() ||
          "#e8e8e8";
        ctx.fillRect(cellX, cellY, cell, cell);
        ctx.drawImage(
          img,
          0,
          0,
          img.naturalWidth,
          img.naturalHeight,
          cellX + (cell - drawW) / 2,
          cellY + (cell - drawH) / 2,
          drawW,
          drawH,
        );
        changed = true;
        return {
          el,
          slot,
          rect: r,
          ratio,
          source: img.currentSrc,
          dx: 0,
          dy: 0,
          scale: 1,
        };
      });
      if (changed) texture.needsUpdate = true;
      // #region debug-point B:handoff-geometry
      if (process.env.NODE_ENV === "development" && window.__shelfHandoffDebug)
        fetch("http://127.0.0.1:7777/event", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "shelf-handoff",
            runId: window.__shelfHandoffDebug,
            hypothesisId: "B",
            msg: "[DEBUG] geometry sync",
            data: {
              at: performance.now(),
              headerBottom,
              changed,
              count: gridEl.querySelectorAll(".shelf-item").length,
              items: items.map(({ el, rect, ratio }) => ({
                id: el.dataset.projectId,
                rect: rect.toJSON(),
                ratio,
                naturalRatio:
                  el.querySelector("img").naturalWidth /
                  el.querySelector("img").naturalHeight,
              })),
            },
          }),
        }).catch(() => {});
      // #endregion
      dirty = false;
    };
    const move = (e) => {
      if (e.pointerType === "touch" || !hover.matches || reduced.matches)
        return;
      const el = e.target.closest(".shelf-item");
      speed = Math.min(
        1,
        speed + Math.hypot(e.clientX - x, e.clientY - y) / 60,
      );
      x = e.clientX;
      y = e.clientY;
      if (!el) leave();
      else if (el !== active) {
        active = el;
        dirty = true;
      }
    };
    const leave = () => {
      active = null;
      down = false;
      if (gridEl.dataset.cursorRendered !== "false")
        gridEl.dataset.cursorRendered = "false";
    };
    const press = () => {
        down = true;
      },
      release = () => {
        down = false;
      };
    const resize = () => {
      renderer.setSize(innerWidth, innerHeight);
      uniforms.uResolution.value.set(innerWidth, innerHeight);
      lookup.resize(innerWidth, innerHeight);
      dirty = true;
    };
    const scroll = () => {
      leave();
      restore();
      renderer.domElement.style.opacity = "0";
      dirty = true;
    };
    const contextLost = () => {
      lost = true;
      leave();
      restore();
      renderer.domElement.style.opacity = "0";
    };
    const contextRestored = () => {
      lost = false;
      dirty = true;
    };
    const invalidate = () => {
      dirty = true;
    };
    const movingItems = new Set();
    const transition = (event) => {
      if (
        event.propertyName !== "transform" ||
        !event.target.matches(".shelf-item")
      )
        return;
      if (event.type === "transitionrun") {
        movingItems.add(event.target);
        leave();
        restore();
        renderer.domElement.style.opacity = "0";
      } else movingItems.delete(event.target);
      invalidate();
    };
    const visibilityObserver = new MutationObserver(() => {
      if (scroller.dataset.scenePaused === "true") {
        restore();
        renderer.domElement.style.opacity = "0";
        leave();
      }
      invalidate();
    });
    visibilityObserver.observe(scroller, {
      attributes: true,
      attributeFilter: ["data-scene-paused"],
    });
    resize();
    gridEl.addEventListener("pointermove", move);
    gridEl.addEventListener("pointerleave", leave);
    gridEl.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("resize", resize);
    // #region debug-point A:scroll-surface
    const debugSurface = () => {
      if (process.env.NODE_ENV !== "development" || !window.__shelfDebug)
        return;
      fetch("http://127.0.0.1:7778/event", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "shelf-scroll-glass",
          runId: window.__shelfDebug,
          hypothesisId: "A",
          msg: "[DEBUG] scroll surface",
          data: {
            scroll: scroller.scrollTop,
            canvas: renderer.domElement.getBoundingClientRect().toJSON(),
            hidden: items.map(({ el }) => ({
              hidden: el.dataset.liquid,
              rect: el.getBoundingClientRect().toJSON(),
              loaded: el.querySelector("img")?.naturalWidth,
            })),
            contextLost: renderer.getContext().isContextLost(),
            ancestorTransform: getComputedStyle(scroller).transform,
            ancestorAnimation: getComputedStyle(scroller).animation,
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    };
    scroller.addEventListener("scroll", debugSurface, { passive: true });
    // #endregion
    scroller.addEventListener("scroll", scroll, { passive: true });
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      contextRestored,
    );
    gridEl.addEventListener("load", invalidate, true);
    for (const event of ["transitionrun", "transitionend", "transitioncancel"])
      gridEl.addEventListener(event, transition);
    scroller.addEventListener("animationend", invalidate);
    const observer = new MutationObserver(invalidate);
    observer.observe(gridEl, { childList: true });
    const sizeObserver = new ResizeObserver(invalidate);
    sizeObserver.observe(gridEl);
    sizeObserver.observe(header);
    const stopRendering = startRenderLoop(
      renderer,
      () => {
        const now = performance.now(),
          dt = Math.min((now - last) / 1000, 0.04);
        last = now;
        if (lost || disposed || movingItems.size) return;
        // With no wake or hover, the glass is static. Keep the last frame and
        // wake only for input/layout changes instead of repainting every pixel.
        if (
          !dirty &&
          handoff === 1 &&
          !active &&
          !movingItems.size &&
          amount < 0.0001 &&
          uniforms.uCursor.value.w < 0.0001 &&
          speed < 0.0001
        )
          return;
        if (dirty) syncItems();
        // DOM cards own navigation motion. Sample their final geometry once
        // and hand back to WebGL only after the last transition settles.
        if (!items.length) {
          renderer.domElement.style.opacity = "0";
          leave();
          return;
        }
        // Begin from the DOM silhouette. Compilation must not skip this frame.
        if (reduced.matches) handoff = 1;
        else if (painted)
          handoff = Math.min(1, handoff + dt / params.handoffTime);
        const reveal = handoff * handoff * (3 - 2 * handoff);
        uniforms.uReveal.value = reveal;
        if (reduced.matches || (active && !active.isConnected)) leave();
        amount += ((active ? 1 : 0) - amount) * (1 - Math.exp(-dt * 10));
        smoothX += (x - smoothX) * (1 - Math.exp(-dt * 16));
        smoothY += (y - smoothY) * (1 - Math.exp(-dt * 16));
        speed *= Math.exp(-dt * 6);
        uniforms.uPointer.value.set(
          smoothX - innerWidth / 2,
          innerHeight / 2 - smoothY,
          amount,
          speed * amount,
        );
        uniforms.uSurface.value.set(
          params.goo * reveal,
          params.melt,
          params.reach,
          params.wake,
        );
        uniforms.uBands.value.set(
          innerHeight * params.band,
          innerWidth * params.sideBand,
          innerHeight * params.band,
          innerWidth * params.sideBand,
        );
        uniforms.uLip.value.set(
          params.refract,
          params.squeeze,
          params.ripple,
          params.rippleFreq,
        );
        uniforms.uFinish.value.set(params.fringe, params.sheen);
        uniforms.uCorner.value = params.corner;
        uniforms.uGlass.value = params.glass * reveal;
        uniforms.uTime.value = now / 1000;
        uniforms.uContentTop.value = headerBottom;
        cursorLens.update(
          x - innerWidth / 2,
          innerHeight / 2 - y,
          !!active && items.some(({ el }) => el === active),
          dt,
          down,
          reduced.matches,
        );
        for (let i = 0; i < items.length; i++) {
          const item = items[i],
            { el } = item,
            r = item.rect,
            focus = el === active;
          const nx = Math.max(
            -1,
            Math.min(1, (x - r.x - r.width / 2) / (r.width / 2)),
          );
          const ny = Math.max(
            -1,
            Math.min(1, -(y - r.y - r.height / 2) / (r.height / 2)),
          );
          const response = 1 - Math.exp(-dt * (focus ? 11 : 7));
          item.dx +=
            ((focus ? nx * amount * params.pull * (down ? 1.25 : 1) : 0) -
              item.dx) *
            response;
          item.dy +=
            ((focus ? ny * amount * params.pull * (down ? 1.25 : 1) : 0) -
              item.dy) *
            response;
          item.scale +=
            ((focus ? 1 + amount * params.swell : 1) - item.scale) * response;
          uniforms.uCard.value[i].set(
            r.x + r.width / 2 - innerWidth / 2 + item.dx,
            innerHeight / 2 - r.y - r.height / 2 + item.dy,
            (r.width / 2) * item.scale,
            (r.height / 2) * item.scale,
          );
          uniforms.uStyle.value[i].set(0, 0, 0, item.slot);
        }
        lookup.update(uniforms.uCard.value, items.length);
        renderer.domElement.style.clipPath = `inset(${headerBottom}px 0 0)`;
        // #region debug-point A:handoff-paint
        if (
          process.env.NODE_ENV === "development" &&
          window.__shelfHandoffDebug &&
          (renderer.domElement.style.opacity !== "1" ||
            window.__shelfHandoffSample)
        )
          fetch("http://127.0.0.1:7777/event", {
            method: "POST",
            body: JSON.stringify({
              sessionId: "shelf-handoff",
              runId: window.__shelfHandoffDebug,
              hypothesisId: "A",
              msg: "[DEBUG] liquid paint",
              data: {
                at: performance.now(),
                lip: uniforms.uLip.value.toArray(),
                canvas: renderer.domElement.getBoundingClientRect().toJSON(),
                card: uniforms.uCard.value[0].toArray(),
                rect: items[0].rect.toJSON(),
                surface: getComputedStyle(
                  items[0].el.querySelector(".shelf-liquid-surface"),
                ).transform,
                hidden: items[0].el.dataset.liquid,
              },
            }),
          }).catch(() => {});
        // #endregion
        renderer.render(scene, camera);
        const cursorRendered = String(uniforms.uCursor.value.w > 0);
        if (gridEl.dataset.cursorRendered !== cursorRendered)
          gridEl.dataset.cursorRendered = cursorRendered;
        painted = true;
        items.forEach(({ el }) => {
          if (el.dataset.liquid !== "true") el.dataset.liquid = "true";
        });
        renderer.domElement.style.opacity = "1";
      },
      () => {
        last = performance.now();
        dirty = true;
        if (renderer.domElement.style.opacity !== "1") {
          handoff = 0;
          painted = false;
        }
        leave();
        cursorLens.reset();
      },
      scroller,
      () => renderer.render(scene, camera),
    );
    let gui;
    if (process.env.NODE_ENV === "development")
      import("lil-gui").then(({ default: GUI }) => {
        if (disposed) return;
        gui = new GUI({ title: "灵感册液态", autoPlace: false });
        scroller.append(gui.domElement);
        gui.hide();
        for (const [key, min, max] of [
          ["pull", 0, 30],
          ["swell", 0, 0.08],
          ["goo", 0, 20],
          ["melt", 0, 50],
          ["reach", 80, 350],
          ["wake", 0, 5],
          ["corner", 4, 18],
          ["glass", 0, 1],
          ["handoffTime", 0.2, 1],
          ["band", 0, 0.12],
          ["sideBand", 0, 0.05],
          ["refract", 0, 80],
          ["squeeze", 0, 0.04],
          ["ripple", 0, 8],
          ["rippleFreq", 0, 0.08],
          ["fringe", 0, 3],
          ["sheen", 0, 0.1],
        ])
          gui.add(params, key, min, max).onChange(invalidate);
      });
    return () => {
      disposed = true;
      delete gridEl.dataset.glassCursor;
      delete gridEl.dataset.cursorRendered;
      restore();
      observer.disconnect();
      visibilityObserver.disconnect();
      sizeObserver.disconnect();
      gui?.destroy();
      gridEl.removeEventListener("pointermove", move);
      gridEl.removeEventListener("pointerleave", leave);
      gridEl.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("resize", resize);
      scroller.removeEventListener("scroll", scroll);
      gridEl.removeEventListener("load", invalidate, true);
      for (const event of [
        "transitionrun",
        "transitionend",
        "transitioncancel",
      ])
        gridEl.removeEventListener(event, transition);
      scroller.removeEventListener("animationend", invalidate);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        contextRestored,
      );
      // #region debug-point A:scroll-cleanup
      scroller.removeEventListener("scroll", debugSurface);
      // #endregion
      stopRendering();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      lookup.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [gridRef]);
  return null;
}
