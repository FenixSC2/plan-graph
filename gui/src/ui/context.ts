import { createContext } from "react";
import type { PlanIndex, Ref } from "../model/plan.ts";

export interface UIContextValue {
  selected: Ref | null;
  select: (ref: Ref | null) => void;
  agentChanged: Set<Ref>;
  index: PlanIndex;
  /** Zoom the canvas to a group (leaving the group map if it's showing). */
  openGroup?: (groupId: string) => void;
}

export const UIContext = createContext<UIContextValue>({
  selected: null,
  select: () => {},
  agentChanged: new Set(),
  index: new Map(),
});

/**
 * True when the canvas is zoomed out far enough that node details are unreadable. Nodes then
 * render as compact cards and edges drop their labels, which keeps large plans cheap to draw.
 */
export const CompactContext = createContext(false);
