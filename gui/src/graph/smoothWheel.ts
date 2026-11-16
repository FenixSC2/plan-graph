// Smooth wheel / trackpad navigation for the canvas.
//
// React Flow's default maps every wheel event straight to a zoom step, so a two-finger trackpad
// scroll zooms instead of panning and a mouse wheel moves in visible jumps. Here:
//   - scroll (trackpad two-finger, mouse wheel) pans; shift + wheel pans sideways
//   - pinch (ctrlKey wheel events from trackpads) or ⌘/ctrl + wheel zooms around the pointer
// Each event moves a target viewport, and the real viewport eases toward it every animation
// frame, so coarse mouse-wheel notches glide and trackpad input stays continuous.
import { useEffect } from "react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";

/** Fraction of the remaining distance covered per 60 Hz frame. Higher = snappier, lower = floatier. */
const EASE = 0.32;
/** Largest single wheel step that counts, so a fast mouse wheel can't fling the view. */
const MAX_PAN_STEP = 240;
const ZOOM_PER_PIXEL = 0.0065;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reduceMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useSmoothWheel(
  el: HTMLElement | null,
  rf: Pick<ReactFlowInstance, "getViewport" | "setViewport">,
  { minZoom, maxZoom }: { minZoom: number; maxZoom: number },
) {
  useEffect(() => {
    if (!el) return;
    let target: Viewport | null = null;
    let raf = 0;
    let last = 0;

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0; target = null;
    };

    const step = (now: number) => {
      if (!target) return stop();
      const cur = rf.getViewport();
      const dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      // Frame-rate independent easing; no glide at all for people who asked for reduced motion.
      const k = reduceMotion() ? 1 : 1 - Math.pow(1 - EASE, dt / 16.7);
      const zoom = cur.zoom * Math.pow(target.zoom / cur.zoom, k);
      const next = { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k, zoom };
      const done = Math.abs(target.x - next.x) < 0.4 && Math.abs(target.y - next.y) < 0.4 && Math.abs(Math.log(target.zoom / zoom)) < 0.0015;
      rf.setViewport(done ? target : next);
      if (done) stop();
      else raf = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".react-flow__minimap, .nowheel")) return; // they handle their own wheel
      e.preventDefault();
      // Keep accumulating onto the in-flight target so fast scrolling doesn't lose distance.
      const base = target ?? rf.getViewport();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      let dx = e.deltaX * unit, dy = e.deltaY * unit;

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrlKey + small deltas; ⌘/ctrl + mouse wheel as large ones.
        const zoom = clamp(base.zoom * Math.exp(-clamp(dy, -60, 60) * ZOOM_PER_PIXEL * (unit > 1 || Math.abs(dy) >= 50 ? 1 : 1.6)), minZoom, maxZoom);
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        // Keep the point under the pointer fixed.
        target = { zoom, x: px - ((px - base.x) * zoom) / base.zoom, y: py - ((py - base.y) * zoom) / base.zoom };
      } else {
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        dx = clamp(dx, -MAX_PAN_STEP, MAX_PAN_STEP);
        dy = clamp(dy, -MAX_PAN_STEP, MAX_PAN_STEP);
        target = { ...base, x: base.x - dx, y: base.y - dy };
      }
      if (!raf) raf = requestAnimationFrame(step);
    };

    // Dragging, or an animated jump started elsewhere, takes over from the wheel.
    const onPointerDown = () => stop();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    (el as any).__stopSmoothWheel = stop;
    return () => {
      stop();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
    };
  }, [el, rf, minZoom, maxZoom]);
}

/** Cancel an in-flight wheel glide (call before starting an animated jump on the same canvas). */
export function stopSmoothWheel(el: HTMLElement | null) {
  (el as any)?.__stopSmoothWheel?.();
}
