"use client";

import { useEffect } from "react";
import { cursorParams } from "./ring/params";

function createBackdropLens() {
  const ns = "http://www.w3.org/2000/svg";
  const element = (name, attributes) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    return node;
  };
  // Encode the same radial sampling as cursorRefract once, not on movement.
  const map = document.createElement("canvas");
  map.width = map.height = 64;
  const context = map.getContext("2d");
  const pixels = context.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const qx = ((x + 0.5) / 64) * 2 - 1;
      const qy = ((y + 0.5) / 64) * 2 - 1;
      const r2 = Math.min(1, qx * qx + qy * qy);
      const bend = (1 - r2 * r2) * 0.5;
      const i = (y * 64 + x) * 4;
      pixels.data[i] = Math.round((0.5 - qx * bend) * 255);
      pixels.data[i + 1] = Math.round((0.5 - qy * bend) * 255);
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const svg = element("svg", {
    width: 0,
    height: 0,
    style: "position:absolute;overflow:hidden",
    "aria-hidden": "true",
  });
  const filter = element("filter", {
    id: "action-cursor-glass",
    x: "0%",
    y: "0%",
    width: "100%",
    height: "100%",
    "color-interpolation-filters": "sRGB",
  });
  const image = element("feImage", {
    href: map.toDataURL(),
    x: 0,
    y: 0,
    preserveAspectRatio: "none",
    result: "bend",
  });
  filter.append(image);
  const displacements = ["red", "green", "blue"].map((channel, index) => {
    const displacement = element("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "bend",
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: `${channel}-bend`,
    });
    const matrix = Array(20).fill(0);
    matrix[index * 6] = 1;
    matrix[18] = 1;
    filter.append(
      displacement,
      element("feColorMatrix", {
        in: `${channel}-bend`,
        type: "matrix",
        values: matrix.join(" "),
        result: channel,
      }),
    );
    return displacement;
  });
  filter.append(
    element("feBlend", {
      in: "red",
      in2: "green",
      mode: "screen",
      result: "red-green",
    }),
    element("feBlend", { in: "red-green", in2: "blue", mode: "screen" }),
  );
  svg.append(filter);
  let lastSize;
  let lastStrength;
  let lastDispersion;
  return {
    svg,
    update(size, strength, dispersion) {
      if (
        size === lastSize &&
        strength === lastStrength &&
        dispersion === lastDispersion
      )
        return;
      image.setAttribute("width", size);
      image.setAttribute("height", size);
      displacements.forEach((displacement, index) =>
        displacement.setAttribute(
          "scale",
          size * Math.min(0.8, strength) + (index - 1) * 2 * dispersion,
        ),
      );
      lastSize = size;
      lastStrength = strength;
      lastDispersion = dispersion;
    },
  };
}

export default function ActionCursor() {
  useEffect(() => {
    const cursor = document.createElement("div");
    cursor.className = "action-cursor";
    cursor.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    const lens = createBackdropLens();
    cursor.append(lens.svg, dot);
    document.body.append(cursor);
    const fine = matchMedia("(any-hover: hover) and (any-pointer: fine)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const params = cursorParams();
    let target = null;
    let x = 0;
    let y = 0;
    let mouse = false;
    let frame = 0;
    let lastX = 0;
    let lastY = 0;
    let stretch = 0;
    let lastTime = performance.now();

    const clear = () => {
      target = null;
      stretch = 0;
      cursor.classList.remove("is-visible", "is-pressed");
      delete document.documentElement.dataset.glassPointer;
    };
    const update = () => {
      frame = 0;
      if (!mouse || !fine.matches || document.hidden) return clear();
      const hit = document.elementFromPoint(x, y);
      if (!hit) return clear();
      document.documentElement.dataset.glassPointer = "true";
      const control = hit.closest(
        "button, a[href], [role=button], input, textarea, select, [contenteditable=true]",
      );
      const shader = hit.closest('[data-glass-cursor="true"]');
      const onShader =
        shader?.dataset.cursorRendered === "true" &&
        (!control || control.matches('.shelf-item[data-liquid="true"]'));
      const next = control || hit;
      if (target !== next) {
        target = next;
        lastX = x;
        lastY = y;
      }
      // A native dialog is above every body z-index.
      const host = hit.closest("dialog[open]") || document.body;
      if (cursor.parentElement !== host) host.append(cursor);
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      const precision =
        !!control &&
        !control.matches(".shelf-item, .liquid-hit, .inspiration-tile");
      cursor.classList.toggle("is-precision", precision);
      const size = precision ? params.precisionDiameter : params.diameter;
      lens.update(
        size,
        precision ? params.precisionMagnify : params.magnify,
        precision ? params.precisionDispersion : params.dispersion,
      );
      const now = performance.now();
      const dt = Math.min(0.04, Math.max(0.001, (now - lastTime) / 1000));
      const dx = x - lastX;
      const dy = y - lastY;
      const distance = Math.hypot(dx, dy);
      const wanted =
        reduced.matches || precision
          ? 0
          : Math.min(1, distance / (dt * 1000)) * params.deform;
      stretch += (wanted - stretch) * (1 - Math.exp(-dt * params.response));
      if (distance > 0.1)
        cursor.style.setProperty("--cursor-angle", `${Math.atan2(dy, dx)}rad`);
      cursor.style.setProperty("--cursor-size", `${size}px`);
      cursor.style.setProperty("--cursor-stretch", 1 + stretch);
      lastX = x;
      lastY = y;
      lastTime = now;
      cursor.classList.toggle("is-visible", !onShader);
      if (stretch > 0.0001) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (event) => {
      mouse = event.pointerType === "mouse";
      x = event.clientX;
      y = event.clientY;
      // The click point follows input directly; only the glass shape eases.
      cancelAnimationFrame(frame);
      update();
    };
    const leave = (event) => {
      if (!event.relatedTarget) {
        mouse = false;
        clear();
      }
    };
    const press = (event) => {
      if (event.pointerType !== "mouse") {
        mouse = false;
        return clear();
      }
      cursor.classList.add("is-pressed");
    };
    const release = () => cursor.classList.remove("is-pressed");
    const blur = () => {
      mouse = false;
      clear();
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      update();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "data-cursor-rendered",
        "data-liquid",
        "open",
        "disabled",
        "inert",
      ],
    });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", leave);
    window.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", blur);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", blur);
    fine.addEventListener("change", schedule);
    return () => {
      clear();
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", blur);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", blur);
      fine.removeEventListener("change", schedule);
      cursor.remove();
    };
  }, []);
  return null;
}
