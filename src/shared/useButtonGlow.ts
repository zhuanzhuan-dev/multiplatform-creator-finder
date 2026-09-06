import { useEffect } from "react";

/** One delegated listener covers buttons added by expanding settings, without React renders per move. */
export function useButtonGlow() {
  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let active: HTMLButtonElement | null = null;
    let frame = 0;
    let clientX = 0;
    let clientY = 0;

    const clear = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      active?.removeAttribute("data-pointer-glow");
      active = null;
    };
    const paint = () => {
      frame = 0;
      if (!active || active.disabled || !active.isConnected || !media.matches) return clear();
      const rect = active.getBoundingClientRect();
      // Percentages keep the highlight aligned during the existing press-scale animation.
      active.style.setProperty("--pointer-x", `${(clientX - rect.left) / rect.width * 100}%`);
      active.style.setProperty("--pointer-y", `${(clientY - rect.top) / rect.height * 100}%`);
      active.setAttribute("data-pointer-glow", "");
    };
    const move = (event: PointerEvent) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!media.matches || event.pointerType !== "mouse" || !button || button.disabled) return clear();
      if (button !== active) {
        clear();
        active = button;
      }
      clientX = event.clientX;
      clientY = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = (event: PointerEvent) => {
      if (!(event.relatedTarget instanceof Node) || !active?.contains(event.relatedTarget)) clear();
    };

    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", leave, { passive: true });
    document.addEventListener("pointercancel", clear);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("blur", clear);
    media.addEventListener("change", clear);
    return () => {
      clear();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointercancel", clear);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("blur", clear);
      media.removeEventListener("change", clear);
    };
  }, []);
}
