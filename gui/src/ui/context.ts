import { createContext } from "react";
import type { PlanIndex, Ref } from "../model/plan.ts";
import type { MarkKind } from "../model/proposal.ts";

export interface UIContextValue {
  selected: Ref | null;
  select: (ref: Ref | null) => void;
  agentChanged: Set<Ref>;
  index: PlanIndex;
  /** While a proposal is previewed: what it adds, changes or removes. */
  marks?: Map<Ref, MarkKind>;
  /**
   * Trace along the graph: glide the canvas to where `ref` leads and select it. An outcome
   * goes to its destination, an interaction to the surface it's on, a surface to itself.
   */
  follow?: (ref: Ref) => void;
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
