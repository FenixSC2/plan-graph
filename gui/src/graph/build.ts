// Plan → React Flow nodes/edges, plus dagre auto-layout.
import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { stateOf, surfaceOf, type Element, type Interaction, type Outcome, type Plan, type PlanIndex, type Ref, type Surface } from "../model/plan.ts";

export interface Row {
  interaction: Interaction;
  fromState?: string;
  stays: Outcome[];
}

export interface SurfaceData extends Record<string, unknown> {
  surface: Surface;
  rows: Row[];
  freeElements: Element[];
  isEntry: boolean;
}

export type SurfaceNodeT = Node<SurfaceData, "surface">;
export type XY = { x: number; y: number };

export const NODE_W = 280;

export function rowsFor(plan: Plan, surfaceId: string): Row[] {
  return plan.interactions
    .filter((it) => surfaceOf(it.from) === surfaceId)
    .map((it) => ({ interaction: it, fromState: stateOf(it.from), stays: it.outcomes.filter((o) => o.to == null) }));
}

function estimateHeight(s: Surface, rows: Row[], free: Element[]): number {
  let h = 74;
  if (s.states?.length) h += 34;
  for (const r of rows) h += 30 + r.stays.length * 18;
  if (free.length) h += 34 + Math.ceil(free.length / 3) * 22;
  return h + 34;
}

export function buildNodes(plan: Plan, positions: Record<string, XY>): SurfaceNodeT[] {
  return plan.surfaces.map((s) => {
    const rows = rowsFor(plan, s.id);
    const used = new Set(rows.map((r) => r.interaction.trigger.element).filter(Boolean));
    const freeElements = (s.elements ?? []).filter((e) => !used.has(e.id));
    return {
      id: s.id,
      type: "surface",
      position: positions[s.id] ?? { x: 0, y: 0 },
      data: { surface: s, rows, freeElements, isEntry: plan.entryPoints.includes(s.id) },
      style: { width: NODE_W },
    };
  });
}

export function autoLayout(plan: Plan): Record<string, XY> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 140, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const heights: Record<string, number> = {};
  for (const s of plan.surfaces) {
    const rows = rowsFor(plan, s.id);
    const used = new Set(rows.map((r) => r.interaction.trigger.element));
    const h = estimateHeight(s, rows, (s.elements ?? []).filter((e) => !used.has(e.id)));
    heights[s.id] = h;
    g.setNode(s.id, { width: NODE_W, height: h });
  }
  const ids = new Set(plan.surfaces.map((s) => s.id));
  for (const it of plan.interactions) {
    const from = surfaceOf(it.from);
    for (const o of it.outcomes) {
      if (o.to == null) continue;
      const to = surfaceOf(o.to);
      if (to !== from && ids.has(from) && ids.has(to)) g.setEdge(from, to);
    }
    for (const ef of it.effects ?? []) {
      if (ef.kind !== "calls") continue;
      const target = plan.interactions.find((x) => x.id === ef.target);
      if (target && ids.has(from)) g.setEdge(from, surfaceOf(target.from));
    }
  }
  dagre.layout(g);
  const out: Record<string, XY> = {};
  for (const s of plan.surfaces) {
    const n = g.node(s.id);
    out[s.id] = { x: n.x - NODE_W / 2, y: n.y - heights[s.id] / 2 };
  }
  return out;
}

export interface EdgeData extends Record<string, unknown> {
  outcomeId?: Ref;
  interactionId: Ref;
  kind: "outcome" | "call";
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function buildEdges(plan: Plan, idx: PlanIndex, selected: Ref | null, showCalls: boolean): Edge<EdgeData>[] {
  const edges: Edge<EdgeData>[] = [];
  for (const it of plan.interactions) {
    const source = surfaceOf(it.from);
    if (!idx.has(source)) continue;
    for (const o of it.outcomes) {
      if (o.to == null || !idx.has(o.to)) continue;
      const st = stateOf(o.to);
      const isSel = selected === o.id || selected === it.id;
      const status = o.meta.status;
      edges.push({
        id: o.id,
        source,
        sourceHandle: it.id,
        target: surfaceOf(o.to),
        targetHandle: "in",
        reconnectable: "target",
        selected: selected === o.id,
        label: trunc(o.when, 30) + (st ? `  → ${st}` : ""),
        className: `edge-${status}${isSel ? " edge-selected" : ""}`,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        zIndex: isSel ? 10 : 0,
        data: { outcomeId: o.id, interactionId: it.id, kind: "outcome" },
      });
    }
    if (!showCalls) continue;
    for (const ef of it.effects ?? []) {
      if (ef.kind !== "calls") continue;
      const t = idx.get(ef.target);
      if (!t || t.type !== "interaction") continue;
      edges.push({
        id: `call:${it.id}->${ef.target}`,
        source,
        sourceHandle: it.id,
        target: surfaceOf(t.item.from),
        targetHandle: "in",
        reconnectable: false,
        label: "calls",
        className: "edge-call" + (selected === it.id ? " edge-selected" : ""),
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        data: { interactionId: it.id, kind: "call" },
      });
    }
  }
  return edges;
}

/** The surface that contains (or best represents) a ref, for focusing the canvas. */
export function surfaceFor(idx: PlanIndex, ref: Ref): string | undefined {
  const loc = idx.get(ref);
  if (!loc) return undefined;
  switch (loc.type) {
    case "surface": return loc.item.id;
    case "state":
    case "element": return loc.parent.id;
    case "interaction": return surfaceOf(loc.item.from);
    case "outcome": return surfaceOf(loc.parent.from);
    case "decision": return loc.item.attachedTo.length ? surfaceFor(idx, loc.item.attachedTo[0]) : undefined;
    case "group": return undefined;
  }
}
