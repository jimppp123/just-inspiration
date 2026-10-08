"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LiquidFrame } from "../InterfaceEffects";
import LiquidScene from "./LiquidScene";
import { focusParams, transitionParams } from "./params";
import { coreSize } from "./layout";
import MotionText from "../MotionText";

const recommendations = new Map();
const SAVED_PINS_KEY = "ice-works:saved-pins:v1";
const sourceOf = (project) => {
  if (
    project.file &&
    !project.file.startsWith("/api/") &&
    !/^https?:/.test(project.file)
  )
    return project.file.startsWith("/") ? project.file : `/${project.file}`;
  return project.source
    ? `/api/pinterest/image?url=${encodeURIComponent(project.source.replace("/originals/", "/736x/"))}`
    : project.file.startsWith("/")
      ? project.file
      : `/${project.file}`;
};
const localOf = (project) =>
  project.file.startsWith("/") ? project.file : `/${project.file}`;

function frameOf(origin, style) {
  const sx = origin.width / parseFloat(style["--seed-width"]);
  const sy = origin.height / parseFloat(style["--seed-height"]);
  const scale = Math.max(sx, sy);
  const viewW = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewH = typeof window === "undefined" ? 900 : window.innerHeight;
  return {
    transform: `translate(-50%, -50%) translate(${origin.x + origin.width / 2 - viewW / 2}px, ${origin.y + origin.height / 2 - viewH / 2}px) scale(${scale})`,
    // The portrait aperture opens onto the full source without stretching it.
    clipPath: `inset(${(1 - sy / scale) * 50}% ${(1 - sx / scale) * 50}%)`,
  };
}

export default function FocusExplorer({
  selection,
  onClose,
  onClosing,
  onBranch,
}) {
  const dialogRef = useRef(null);
  const previewRef = useRef(null);
  const previewAnimation = useRef(null);
  const gesture = useRef(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const [requested, setRequested] = useState(0);
  const [shown, setShown] = useState(0);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewSize, setPreviewSize] = useState(null);
  const [saved, setSaved] = useState(false);
  const closingRef = useRef(false);
  // #region debug-point C:focus-phases
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !window.__transitionDebug)
      return;
    fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "liquid-transitions",
        runId: window.__transitionDebug,
        hypothesisId: "C",
        location: "FocusExplorer:phase",
        msg: "[DEBUG] focus phase",
        data: {
          entered,
          loading,
          sceneReady,
          closing,
          related: related.length,
          preview: dialogRef.current
            ?.querySelector(".focus-seed-preview")
            ?.getBoundingClientRect()
            .toJSON(),
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  }, [entered, loading, sceneReady, closing, related.length]);
  // #endregion
  const params = useMemo(() => focusParams(), []);
  const motion = useMemo(() => transitionParams(), []);
  const seed = useMemo(
    () => ({
      ...selection.project,
      file: previewFailed
        ? localOf(selection.project)
        : selection.origin.src || sourceOf(selection.project),
      width:
        previewSize?.width ||
        selection.origin.imageWidth ||
        selection.project.width,
      height:
        previewSize?.height ||
        selection.origin.imageHeight ||
        selection.project.height,
    }),
    [selection, previewFailed, previewSize],
  );
  const projects = useMemo(
    () => [seed, ...related].slice(0, params.maxRelated + 1),
    [seed, related, params.maxRelated],
  );
  const previewStyle = useMemo(() => {
    const viewW = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewH = typeof window === "undefined" ? 900 : window.innerHeight;
    const [width, height] = coreSize(viewW, viewH, seed, params);
    const origin = selection.origin;
    return {
      "--seed-ratio": width / height,
      "--seed-width": `${width}px`,
      "--seed-height": `${height}px`,
      "--seed-x": `${origin.x + origin.width / 2 - viewW / 2}px`,
      "--seed-y": `${origin.y + origin.height / 2 - viewH / 2}px`,
      "--seed-sx": origin.width / width,
      "--seed-sy": origin.height / height,
      "--cue-offset": `${params.cueOffset}px`,
      "--cue-gap": `${params.cueGap}px`,
      "--cue-radius": `${params.cueRadius}px`,
    };
  }, [selection, seed, params]);
  const originFrame = useMemo(
    () => frameOf(selection.origin, previewStyle),
    [selection.origin, previewStyle],
  );

  const stopHold = useCallback(() => {
    const press = gesture.current;
    if (!press) return;
    clearTimeout(press.delay);
    clearInterval(press.interval);
    press.stopped = true;
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    stopHold();
    const destination = onClosing?.();
    const target = destination
      ? frameOf(destination, previewStyle)
      : originFrame;
    const preview = previewRef.current;
    const current = getComputedStyle(preview);
    const from = {
      transform: current.transform,
      clipPath: current.clipPath,
      opacity: 1,
      borderRadius: "12px",
    };
    previewAnimation.current?.cancel();
    setClosing(true);
    previewAnimation.current = preview.animate(
      [from, { ...target, opacity: 1, borderRadius: "8px" }],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 1
          : motion.exit,
        easing: motion.ease,
        fill: "forwards",
      },
    );
    previewAnimation.current.finished.then(onClose).catch(() => {});
  }, [onClose, onClosing, stopHold, motion, originFrame, previewStyle]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const prior = document.activeElement;
    dialog.showModal();
    // Opening from artwork should not paint a focus ring around the back dot.
    dialog.focus({ preventScroll: true });
    const blur = () => stopHold();
    window.addEventListener("blur", blur);
    return () => {
      stopHold();
      previewAnimation.current?.cancel();
      closingRef.current = false;
      window.removeEventListener("blur", blur);
      dialog.close();
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, [stopHold]);

  useLayoutEffect(() => {
    if (!previewLoaded || closingRef.current) return;
    const animation = previewRef.current.animate(
      [
        { ...originFrame, borderRadius: "8px" },
        {
          transform: "translate(-50%, -50%)",
          clipPath: "inset(0% 0%)",
          borderRadius: "12px",
        },
      ],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 1
          : motion.enter,
        easing: motion.ease,
        fill: "forwards",
      },
    );
    previewAnimation.current = animation;
    animation.finished
      .then(() => {
        if (!closingRef.current) setEntered(true);
      })
      .catch(() => {});
    return () => animation.cancel();
  }, [previewLoaded, originFrame, motion]);

  useEffect(() => {
    const id = selection.project.id;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        let data = recommendations.get(id);
        if (!data) {
          const response = await fetch(
            `/api/pinterest/related?pin=${encodeURIComponent(id)}`,
            {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(20000),
              ]),
            },
          );
          data = await response.json();
          if (!response.ok) throw new Error(data.error);
          if (data.source !== "pinterest-related" || data.seedId !== id)
            throw new Error("关联图片来源未能确认，请重试。");
          recommendations.set(id, data);
          if (recommendations.size > 80)
            recommendations.delete(recommendations.keys().next().value);
        }
        if (controller.signal.aborted) return;
        setRelated(data.projects);
        if (!data.projects.length)
          setError("Pinterest 暂未返回这张图的关联图片。");
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err.message || "关联图片暂时无法载入。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [selection.project.id, retry]);

  const more = () => {
    if (!ready || loading || error) return;
    if (gesture.current?.long) {
      gesture.current = null;
      return;
    }
    setRequested((n) =>
      Math.min(related.length, params.maxRelated, n + params.clickBatch),
    );
  };
  const hold = (event) => {
    if (event.button !== 0 || !ready || loading || error) return;
    stopHold();
    const press = { long: false, stopped: false };
    gesture.current = press;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.delay = setTimeout(() => {
      if (press.stopped) return;
      press.long = true;
      const grow = () =>
        setRequested((n) => Math.min(related.length, params.maxRelated, n + 1));
      grow();
      press.interval = setInterval(grow, params.holdInterval);
    }, params.holdDelay);
  };
  const release = (event) => {
    stopHold();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleSceneReady = useCallback((count) => {
    setReady(count > 0);
    setSceneReady(true);
    if (!count) setError("关联图片未能载入，请重试。");
  }, []);
  const sceneFailure = useCallback((message) => setError(message), []);
  const saveToBoard = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_PINS_KEY);
      const pins = raw ? JSON.parse(raw) : [];
      if (!pins.some((pin) => pin.id === selection.project.id)) {
        window.localStorage.setItem(
          SAVED_PINS_KEY,
          JSON.stringify([
            ...pins,
            {
              id: selection.project.id,
              url: selection.project.url,
              source: selection.project.source,
              savedAt: Date.now(),
            },
          ]),
        );
      }
      setSaved(true);
    } catch {
      setError("当前浏览器无法保存到画板。");
    }
  }, [selection.project]);
  const openPin = useCallback((project) => {
    if (project.url) window.open(project.url, "_blank", "noopener,noreferrer");
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`focus-explorer ${closing ? "is-closing" : ""}`}
      aria-label="灵感探索"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div
        ref={previewRef}
        className={`focus-seed-preview ${sceneReady ? "is-live" : ""}`}
        style={{ ...previewStyle, ...originFrame }}
        aria-hidden="true"
      >
        <Image
          src={previewFailed ? localOf(selection.project) : seed.file}
          alt=""
          fill
          priority
          unoptimized
          onLoad={(event) => {
            const image = event.currentTarget;
            setPreviewSize({
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
            setPreviewLoaded(true);
          }}
          onError={() => setPreviewFailed(true)}
        />
      </div>
      {entered &&
        !loading &&
        related.length > 0 &&
        (!closing || sceneReady) && (
          <LiquidScene
            key={retry}
            projects={projects}
            origin={selection.origin}
            requested={requested}
            onCoreClick={more}
            onCoreDown={hold}
            onCoreUp={release}
            onBranch={(project, rect) => {
              stopHold();
              onBranch(project, {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                src:
                  project.file.startsWith("/") || /^https?:/.test(project.file)
                    ? project.file
                    : `/${project.file}`,
              });
            }}
            onOpenPin={openPin}
            onReady={handleSceneReady}
            onCount={setShown}
            onFailure={sceneFailure}
            closing={closing}
          />
        )}
      <header className="focus-header">
        <button
          className="focus-back nav-dot"
          type="button"
          onClick={close}
          aria-label="返回画板"
        />
        <a
          href={selection.project.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Pinterest 原图 ↗
        </a>
      </header>
      <div
        className={`focus-signal ${ready ? "is-ready" : ""} ${error ? "is-error" : ""} ${shown ? "is-used" : ""}`}
        style={previewStyle}
      >
        <span className="sr-only" role="status" aria-live="polite">
          {error ||
            (ready ? "已就绪，点击主图展开，长按继续" : "正在载入关联灵感")}
        </span>
        <span className="focus-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {error && (
          <button
            className="focus-retry"
            type="button"
            title={error}
            aria-label="重试加载关联灵感"
            onClick={() => {
              recommendations.delete(selection.project.id);
              setLoading(true);
              setError("");
              setSceneReady(false);
              setReady(false);
              setRequested(0);
              setShown(0);
              setRetry((n) => n + 1);
            }}
          >
            <span aria-hidden="true">↻</span>
          </button>
        )}
      </div>
      <button
        className={`focus-save ${saved ? "is-saved" : ""}`}
        type="button"
        onClick={saveToBoard}
        aria-pressed={saved}
      >
        <MotionText>{saved ? "已加入画板" : "加入画板"}</MotionText>
      </button>
      <LiquidFrame />
    </dialog>
  );
}
