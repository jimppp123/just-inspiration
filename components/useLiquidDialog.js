"use client";

import { useCallback, useEffect, useRef } from "react";
import { createLiquidDrawer } from "./liquidDrawer";

export default function useLiquidDialog(dialogRef) {
  const surfaceRef = useRef(null);
  const openerRef = useRef(null);
  const closingRef = useRef(null);
  const generation = useRef(0);

  const animate = useCallback(
    (closing, trigger) => {
      const dialog = dialogRef.current;
      if (!dialog) return Promise.resolve(false);
      if (closing && !dialog.open) return Promise.resolve(true);
      if (closing && closingRef.current) return closingRef.current;
      if (!closing && dialog.open && !closingRef.current)
        return Promise.resolve(true);

      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wasOpen = dialog.open;
      const token = ++generation.current;
      closingRef.current = null;
      surfaceRef.current ??= createLiquidDrawer(dialog);
      const surface = surfaceRef.current;
      dialog.inert = closing;
      if (closing) dialog.dataset.closing = "true";
      else {
        delete dialog.dataset.closing;
        if (!wasOpen) {
          openerRef.current = trigger || document.activeElement;
          surface.prepare(openerRef.current);
          openerRef.current?.setAttribute("aria-expanded", "true");
          dialog.showModal();
        }
      }

      const finished = surface
        .animate(closing, reduced)
        .then((completed) => {
          if (!completed || generation.current !== token || !dialog.isConnected)
            return false;
          // Keep the native modal and its focus boundary alive through the exit.
          if (closing) dialog.close();
          dialog.inert = false;
          delete dialog.dataset.closing;
          closingRef.current = null;
          return true;
        })
        .catch(() => false);
      if (closing) closingRef.current = finished;
      return finished;
    },
    [dialogRef],
  );

  const open = useCallback(
    (event) => animate(false, event?.currentTarget),
    [animate],
  );
  const close = useCallback(() => animate(true), [animate]);
  const onCancel = useCallback(
    (event) => {
      event.preventDefault();
      close();
    },
    [close],
  );
  const onBackdropClick = useCallback(
    (event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget
        .querySelector(".drawer-content")
        .getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        close();
    },
    [close],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const closed = () =>
      openerRef.current?.setAttribute("aria-expanded", "false");
    dialog?.addEventListener("close", closed);
    // Precompile during idle time to keep the first click responsive.
    const warm = () => {
      if (dialog?.isConnected)
        surfaceRef.current ??= createLiquidDrawer(dialog);
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(warm)
      : window.setTimeout(warm, 1600);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
      closingRef.current = null;
      if (dialog?.open) dialog.close();
      closed();
      dialog?.removeEventListener("close", closed);
    };
  }, [dialogRef]);

  return { open, close, onCancel, onBackdropClick };
}
