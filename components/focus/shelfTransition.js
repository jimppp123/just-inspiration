export function animateShelfTransition(root, grid, motion, closing, previous) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 1 : closing ? motion.shelfExit : motion.shelfEnter;
  const animating = new Set(
    previous.map((animation) => animation.effect.target),
  );
  const button = root.querySelector(".nav-dot");
  const buttonRect = button.getBoundingClientRect();
  const dotInset = parseFloat(getComputedStyle(button, "::before").left);
  const origin = {
    x: buttonRect.x + buttonRect.width / 2,
    y: buttonRect.y + buttonRect.height / 2,
    diameter: buttonRect.width - dotInset * 2,
  };
  // Read once, before cancelling: a quick return continues from the current pose.
  const surfaces = [...grid.querySelectorAll(".shelf-liquid-surface")]
    .map((element) => {
      // The card owns layout; its moving image cannot measure its destination.
      const rect = element.closest(".shelf-item").getBoundingClientRect();
      const style = animating.has(element) ? getComputedStyle(element) : null;
      return {
        element,
        rect,
        current: style
          ? { transform: style.transform, clipPath: style.clipPath }
          : null,
      };
    })
    .filter(
      ({ rect }) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight,
    );
  for (const animation of previous) {
    animation.effect.target.style.willChange = "";
    animation.cancel();
  }
  const animations = [];
  const animate = (element, frames, delay = 0) => {
    element.style.willChange = "transform, clip-path";
    const animation = element.animate(frames, {
      duration,
      delay: reduced ? 0 : delay,
      fill: "both",
      easing: "linear",
    });
    animations.push(animation);
  };
  const rest = { transform: "none", clipPath: "inset(0 round 8px)" };
  for (const { element, rect, current } of surfaces) {
    const dx = origin.x - rect.x - rect.width / 2;
    const dy = origin.y - rect.y - rect.height / 2;
    const side = Math.min(rect.width, rect.height);
    const dot = {
      transform: `translate3d(${dx}px, ${dy}px, 0) scale(${origin.diameter / side})`,
      clipPath: `inset(${((rect.height - side) / rect.height) * 50}% ${((rect.width - side) / rect.width) * 50}% round 50%)`,
    };
    const distance = Math.hypot(dx / innerWidth, dy / innerHeight);
    const frames = reduced
      ? [rest, rest]
      : closing
        ? [
            { ...(current || rest), easing: "cubic-bezier(0.5, 0, 0.75, 1)" },
            dot,
          ]
        : [
            {
              ...dot,
              offset: 0,
              easing: "cubic-bezier(0.16, 0.8, 0.22, 1)",
            },
            {
              transform: `translate3d(${-dx * (motion.shelfOvershoot - 1)}px, ${-dy * (motion.shelfOvershoot - 1)}px, 0) scale(${motion.shelfOvershoot})`,
              clipPath: "inset(0 round 10px)",
              offset: 0.72,
              easing: "cubic-bezier(0.2, 0, 0.2, 1)",
            },
            { ...rest, offset: 1 },
          ];
    animate(element, frames, closing ? 0 : distance * motion.shelfWave);
  }
  if (closing) {
    animations.push(
      root.animate(
        [
          { backgroundColor: "#fafafa", offset: 0 },
          { backgroundColor: "#fafafa", offset: 0.4 },
          { backgroundColor: "transparent", offset: 1 },
        ],
        { duration, fill: "both" },
      ),
    );
  }
  return animations;
}
