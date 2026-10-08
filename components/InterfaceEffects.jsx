"use client";

import ActionCursor from "./ActionCursor";

export function LiquidFrame() {
  return (
    <div className="liquid-frame" aria-hidden="true">
      <span className="liquid-edge liquid-edge-top" />
      <span className="liquid-edge liquid-edge-right" />
      <span className="liquid-edge liquid-edge-bottom" />
      <span className="liquid-edge liquid-edge-left" />
    </div>
  );
}

export default function InterfaceEffects() {
  return (
    <>
      <ActionCursor />
      <svg
        className="interface-filter-defs"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            id="ui-text-goo"
            x="-25%"
            y="-100%"
            width="150%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 400 -132"
            />
          </filter>
          <filter
            id="button-text-liquid"
            x="-45%"
            y="-160%"
            width="190%"
            height="420%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="3.2"
              result="soft"
            />
            <feColorMatrix
              in="soft"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 14 -5"
            />
          </filter>
          <filter
            id="card-edge-goo"
            x="-28%"
            y="-28%"
            width="156%"
            height="156%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="soft" />
            <feColorMatrix
              in="soft"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 22 -9"
              result="goo"
            />
            <feMerge>
              <feMergeNode in="goo" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>
      <LiquidFrame />
    </>
  );
}
