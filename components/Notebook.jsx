"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Carousel from "./Carousel";
import InterfaceEffects from "./InterfaceEffects";

const InspirationShelf = dynamic(() => import("./InspirationShelf"));
const FocusExplorer = dynamic(() => import("./focus/FocusExplorer"));

export default function Notebook() {
  const [shelf, setShelf] = useState(null);
  const [shelfClosing, setShelfClosing] = useState(false);
  const [focus, setFocus] = useState(null);
  const openShelf = useCallback(async (board, projects) => {
    await import("./InspirationShelf");
    setShelfClosing(false);
    setShelf({ board, projects });
  }, []);
  const finishShelf = useCallback(() => {
    setShelf(null);
    setShelfClosing(false);
  }, []);
  // #region debug-point B:scene-switch
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !window.__transitionDebug)
      return;
    fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "liquid-transitions",
        runId: window.__transitionDebug,
        hypothesisId: "B",
        location: "Notebook:scene",
        msg: "[DEBUG] scene commit",
        data: {
          shelf: !!shelf,
          focus: !!focus,
          canvases: document.querySelectorAll("canvas").length,
          home: !!document.querySelector(".home-lockup"),
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  }, [shelf, focus]);
  // #endregion
  return (
    <>
      <div
        className={`notebook-home ${shelf && !shelfClosing ? "is-covered" : ""}`}
        data-scene-paused={shelf && !shelfClosing ? "true" : undefined}
        inert={!!shelf}
      >
        <Carousel
          onExplore={openShelf}
          onFocus={(project, origin) => setFocus({ project, origin })}
        />
      </div>
      {shelf && (
        <InspirationShelf
          initialCollection={shelf}
          closing={shelfClosing}
          onBack={() => setShelfClosing(true)}
          onExited={finishShelf}
        />
      )}
      {focus && (
        <FocusExplorer
          key={focus.project.id}
          selection={focus}
          onClose={() => setFocus(null)}
          onBranch={(project, origin) => setFocus({ project, origin })}
        />
      )}
      <InterfaceEffects />
    </>
  );
}
