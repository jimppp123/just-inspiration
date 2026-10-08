"use client";

import { useEffect, useRef, useState } from "react";
import { TEXT_MORPH_MS, TEXT_SOFTEN_EM, textFrames } from "./textMotion";

const incomingFrames = textFrames(true);
const outgoingFrames = textFrames(false);

export default function MotionText({ children, visible = true }) {
  const text = String(children ?? "");
  const [initial] = useState(text);
  const rootRef = useRef(null);
  const runner = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const out = root.querySelector(".motion-text-out");
    const into = root.querySelector(".motion-text-in");
    const host = root.closest("button, a") || root;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let displayed = initial;
    let destination = initial;
    let pending = null;
    let animations = [];
    let disposed = false;

    const settle = (value) => {
      displayed = value;
      into.textContent = value;
      into.style.opacity = "1";
      out.style.opacity = "0";
      out.textContent = "";
      root.classList.remove("is-morphing");
    };
    const run = (value, replay = false) => {
      if (animations.length) {
        if (!replay && destination === displayed) {
          // A click during hover can become the same morph's destination.
          destination = value;
          into.textContent = value;
        } else if (!replay) pending = value;
        return;
      }
      if (reduced.matches || (!replay && value === displayed)) {
        settle(value);
        return;
      }
      out.textContent = displayed;
      destination = value;
      into.textContent = value;
      root.classList.add("is-morphing");
      animations = [
        out.animate(outgoingFrames, { duration: TEXT_MORPH_MS, fill: "both" }),
        into.animate(incomingFrames, { duration: TEXT_MORPH_MS, fill: "both" }),
      ];
      Promise.all(animations.map((a) => a.finished))
        .then(() => {
          if (disposed) return;
          settle(destination);
          animations.forEach((a) => a.cancel());
          animations = [];
          // Fast status updates coalesce; they never restart a half-melted word.
          if (pending !== null) {
            const next = pending;
            pending = null;
            run(next);
          }
        })
        .catch(() => {});
    };
    runner.current = run;
    const hover = (event) => {
      if (event.pointerType === "touch" || host.disabled) return;
      run(displayed, true);
    };
    const focus = () => {
      if (host.matches(":focus-visible")) run(displayed, true);
    };
    const motionChanged = () => {
      if (!reduced.matches) return;
      const latest = pending ?? into.textContent;
      animations.forEach((a) => a.cancel());
      animations = [];
      pending = null;
      settle(latest);
    };
    host.addEventListener("pointerenter", hover);
    host.addEventListener("focus", focus);
    reduced.addEventListener("change", motionChanged);
    return () => {
      disposed = true;
      animations.forEach((a) => a.cancel());
      host.removeEventListener("pointerenter", hover);
      host.removeEventListener("focus", focus);
      reduced.removeEventListener("change", motionChanged);
      runner.current = null;
    };
  }, [initial]);

  useEffect(() => {
    runner.current?.(visible ? text : "");
  }, [text, visible]);

  return (
    <span
      ref={rootRef}
      className="motion-text"
      style={{ "--text-soften": `${TEXT_SOFTEN_EM}em` }}
      aria-label={visible ? text : ""}
    >
      <span className="motion-text-sizer" aria-hidden="true">
        {text}
      </span>
      <span className="motion-text-goo" aria-hidden="true">
        <span className="motion-text-layer motion-text-out" />
        <span className="motion-text-layer motion-text-in">{initial}</span>
      </span>
    </span>
  );
}
