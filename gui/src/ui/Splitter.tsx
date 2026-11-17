// Resizable side panes: drag the edge between a pane and the graph to resize it, drag it most
// of the way shut to collapse it (the graph takes the space), double-click to reset. Keyboard:
// focus the handle, ←/→ resize (Shift for bigger steps), Enter collapses or restores.
// Widths are per browser, not per plan: they're about the screen, not the project.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type Side = "left" | "right";
export interface PaneWidths { left: number; right: number }

export const DEFAULT_WIDTHS: PaneWidths = { left: 320, right: 360 };
const MIN: PaneWidths = { left: 220, right: 260 };
/** The graph never gets narrower than this. */
const MIN_CANVAS = 280;
/** Dragged below this share of its minimum, a pane collapses to nothing. */
const COLLAPSE_AT = 0.6;
const KEY = "plan-graph:layout";

function readWidths(): PaneWidths {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s && typeof s.left === "number" && typeof s.right === "number") return { left: s.left, right: s.right };
  } catch { /* storage unavailable */ }
  return DEFAULT_WIDTHS;
}

/** What a pane may be, given the other pane and the window: 0 (collapsed) or between its minimum and what leaves the graph room. */
function clampWidth(side: Side, px: number, other: number, windowWidth: number): number {
  if (px < MIN[side] * COLLAPSE_AT) return 0;
  const max = Math.max(MIN[side], windowWidth - MIN_CANVAS - other);
  return Math.round(Math.min(Math.max(px, MIN[side]), max));
}

export function usePaneWidths() {
  const [widths, setWidths] = useState<PaneWidths>(readWidths);
  /** Last open width of each pane, for restoring a collapsed one. */
  const lastOpen = useRef<PaneWidths>({
    left: widths.left || DEFAULT_WIDTHS.left,
    right: widths.right || DEFAULT_WIDTHS.right,
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(widths)); } catch { /* ignore */ }
    if (widths.left) lastOpen.current.left = widths.left;
    if (widths.right) lastOpen.current.right = widths.right;
  }, [widths]);

  // A smaller window squeezes the panes (right first) before the graph drops below its minimum.
  useEffect(() => {
    const fit = () => setWidths((w) => {
      let { left, right } = w;
      const over = left + right + MIN_CANVAS - window.innerWidth;
      if (over <= 0) return w;
      const fromRight = right ? Math.min(over, right - MIN.right) : 0;
      right -= Math.max(0, fromRight);
      const rest = over - Math.max(0, fromRight);
      if (rest > 0 && left) left = Math.max(MIN.left, left - rest);
      return left === w.left && right === w.right ? w : { left, right };
    });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const setWidth = useCallback((side: Side, px: number) => {
    setWidths((w) => {
      const other = side === "left" ? w.right : w.left;
      const next = clampWidth(side, px, other, window.innerWidth);
      return w[side] === next ? w : { ...w, [side]: next };
    });
  }, []);
  const reset = useCallback((side: Side) => setWidth(side, DEFAULT_WIDTHS[side]), [setWidth]);
  const toggle = useCallback((side: Side) => {
    setWidths((w) => {
      if (w[side]) return { ...w, [side]: 0 };
      const other = side === "left" ? w.right : w.left;
      return { ...w, [side]: clampWidth(side, lastOpen.current[side], other, window.innerWidth) };
    });
  }, []);

  /** A drag that ended collapsed reopens at the width it started from, not the minimum it passed through. */
  const dragEnded = useCallback((side: Side, startWidth: number) => {
    setWidths((w) => {
      if (w[side] === 0 && startWidth > 0) lastOpen.current[side] = startWidth;
      return w;
    });
  }, []);

  return { widths, setWidth, reset, toggle, dragEnded };
}

interface SplitterProps {
  side: Side;
  width: number;
  onResize: (px: number) => void;
  onReset: () => void;
  onToggle: () => void;
  onDragEnd?: (startWidth: number) => void;
}

const LABEL: Record<Side, string> = { left: "sidebar", right: "inspector" };

export function Splitter({ side, width, onResize, onReset, onToggle, onDragEnd }: SplitterProps) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // A collapsed pane opens from nothing, so a drag starts where the handle is.
    drag.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    onResize(drag.current.w + (side === "left" ? dx : -dx));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const start = drag.current.w;
    drag.current = null;
    setDragging(false);
    onDragEnd?.(start);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) onResize((width || MIN[side]) + step);
    else if (e.key === shrink) onResize(Math.max(width - step, MIN[side]));
    else if (e.key === "Enter" || e.key === " ") onToggle();
    else if (e.key === "Home") onReset();
    else return;
    e.preventDefault();
  };

  // Cursor and no text selection everywhere while dragging, not just over the handle.
  useEffect(() => {
    document.body.classList.toggle("is-resizing", dragging);
    return () => document.body.classList.remove("is-resizing");
  }, [dragging]);

  const collapsed = width === 0;
  return (
    <div
      className={`splitter splitter-${side}${dragging ? " is-dragging" : ""}${collapsed ? " is-collapsed" : ""}`}
      style={side === "left" ? { left: Math.max(0, width - 4) } : { right: Math.max(0, width - 4) }}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${LABEL[side]}`}
      aria-valuenow={width}
      aria-valuemin={0}
      tabIndex={0}
      title={collapsed
        ? `Drag to open the ${LABEL[side]}, or press Enter`
        : `Drag to resize the ${LABEL[side]}. Drag it shut to give the graph the room. Double-click to reset.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={collapsed ? onToggle : onReset}
      onKeyDown={onKeyDown}
    >
      <span className="splitter-line" />
      {collapsed && <span className="splitter-grip" aria-hidden="true" />}
    </div>
  );
}
