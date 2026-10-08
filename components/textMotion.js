// The reference uses the original meta morph: stationary glyphs, reciprocal
// blur and a shared alpha threshold. Scale would move the word centres.
export const TEXT_MORPH_MS = 1200;
export const TEXT_BLUR_EM = 8.5 / 24;
export const TEXT_SOFTEN_EM = 0.35 / 24;

export function textFrames(incoming) {
  return Array.from({ length: 61 }, (_, i) => {
    const p = i / 60;
    const t = Math.sqrt(1 - (p - 1) ** 2);
    const f = incoming ? t : 1 - t;
    return {
      offset: p,
      filter:
        f <= 0 || f >= 1
          ? "blur(0em)"
          : `blur(${Math.min(TEXT_BLUR_EM / f - TEXT_BLUR_EM, 100 / 24)}em)`,
      opacity: f ** 0.4,
    };
  });
}
