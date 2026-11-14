import { createContext } from "react";
import type { PlanIndex, Ref } from "../model/plan.ts";

export interface UIContextValue {
  selected: Ref | null;
  select: (ref: Ref | null) => void;
  agentChanged: Set<Ref>;
  index: PlanIndex;
}

export const UIContext = createContext<UIContextValue>({
  selected: null,
  select: () => {},
  agentChanged: new Set(),
  index: new Map(),
});
