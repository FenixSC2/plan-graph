// Groups as the high-level map of a plan: membership, per-group stats, links between groups,
// and a two-level layout that keeps each group's surfaces together.
import dagre from "@dagrejs/dagre";
import { surfaceOf, type Plan, type PlanIndex, type Ref } from "../model/plan.ts";
import type { Issue } from "../model/lint.ts";

export const UNGROUPED = "__ungrouped";

export interface Cluster {
  id: string;
  name: string;
  description?: string;
  surfaces: Ref[];
}

/** Every group with its surfaces, in plan order, plus an "Ungrouped" bucket when needed. */
export function clusters(plan: Plan): Cluster[] {
  const out = new Map<string, Cluster>();
  for (const g of plan.groups ?? []) out.set(g.id, { id: g.id, name: g.name, description: g.description, surfaces: [] });
  const loose: Ref[] = [];
  for (const s of plan.surfaces) {
    const c = s.group ? out.get(s.group) : undefined;
    if (c) c.surfaces.push(s.id); else loose.push(s.id);
  }
  const list = [...out.values()].filter((c) => c.surfaces.length);
  if (loose.length) list.push({ id: UNGROUPED, name: "Ungrouped", surfaces: loose });
  return list;
}

/** surface id → cluster id */
export function membership(plan: Plan): Map<Ref, string> {
  const m = new Map<Ref, string>();
  for (const c of clusters(plan)) for (const s of c.surfaces) m.set(s, c.id);
  return m;
}

/** The surface an item belongs to (for issues and review items), if any. */
function surfaceOfRef(idx: PlanIndex, ref: Ref): Ref | undefined {
  const loc = idx.get(ref);
  if (!loc) return idx.has(surfaceOf(ref)) ? surfaceOf(ref) : undefined;
  switch (loc.type) {
    case "surface": return loc.item.id;
    case "state": case "element": return loc.parent.id;
    case "interaction": return surfaceOf(loc.item.from);
    case "outcome": return surfaceOf(loc.parent.from);
    case "decision": return loc.item.attachedTo.length ? surfaceOfRef(idx, loc.item.attachedTo[0]) : undefined;
    default: return undefined;
  }
}

export interface ClusterStats {
  surfaces: number;
  profiles: Record<string, number>;
  actions: number;
  outcomes: number;
  /** Reviewable items: surfaces, states, elements, actions, outcomes. */
  items: number;
  /** Of those, the ones not yet confirmed. */
  unreviewed: number;
  sketches: number;
  /** Lint warnings and errors about items in this group. */
  problems: number;
  /** Decisions attached to items in this group that are still proposed. */
  openDecisions: number;
}

export function clusterStats(plan: Plan, idx: PlanIndex, issues: Issue[]): Map<string, ClusterStats> {
  const member = membership(plan);
  const stats = new Map<string, ClusterStats>();
  const get = (sid: Ref | undefined) => {
    const cid = sid ? member.get(sid) : undefined;
    if (!cid) return undefined;
    let s = stats.get(cid);
    if (!s) stats.set(cid, (s = { surfaces: 0, profiles: {}, actions: 0, outcomes: 0, items: 0, unreviewed: 0, sketches: 0, problems: 0, openDecisions: 0 }));
    return s;
  };
  const tally = (st: ClusterStats, status: string) => {
    st.items++;
    if (status === "sketch") st.sketches++;
    if (status !== "confirmed") st.unreviewed++;
  };
  for (const s of plan.surfaces) {
    const st = get(s.id)!;
    st.surfaces++;
    st.profiles[s.profile] = (st.profiles[s.profile] ?? 0) + 1;
    tally(st, s.meta.status);
    for (const x of s.states ?? []) tally(st, x.meta.status);
    for (const x of s.elements ?? []) tally(st, x.meta.status);
  }
  for (const it of plan.interactions) {
    const st = get(surfaceOf(it.from));
    if (!st) continue;
    st.actions++;
    st.outcomes += it.outcomes.length;
    tally(st, it.meta.status);
    for (const o of it.outcomes) tally(st, o.meta.status);
  }
  for (const d of plan.decisions) {
    if (d.meta.status === "confirmed" || !d.attachedTo.length) continue;
    const st = get(surfaceOfRef(idx, d.attachedTo[0]));
    if (st) st.openDecisions++;
  }
  for (const i of issues) {
    if (i.severity === "info" || !i.ref) continue;
    const st = get(surfaceOfRef(idx, i.ref));
    if (st) st.problems++;
  }
  return stats;
}

export interface ClusterLink {
  source: string;
  target: string;
  /** Outcomes on the source group's surfaces that lead into the target group. */
  outcomes: number;
  /** Cross-group `calls` effects (e.g. a screen calling an API endpoint). */
  calls: number;
}

/** Aggregated connections between groups (self-links omitted). */
export function clusterLinks(plan: Plan, idx: PlanIndex): ClusterLink[] {
  const member = membership(plan);
  const links = new Map<string, ClusterLink>();
  const add = (fromSurface: Ref, toSurface: Ref, kind: "outcomes" | "calls") => {
    const a = member.get(fromSurface), b = member.get(toSurface);
    if (!a || !b || a === b) return;
    const key = `${a}->${b}`;
    let l = links.get(key);
    if (!l) links.set(key, (l = { source: a, target: b, outcomes: 0, calls: 0 }));
    l[kind]++;
  };
  for (const it of plan.interactions) {
    const from = surfaceOf(it.from);
    for (const o of it.outcomes) if (o.to != null) add(from, surfaceOf(o.to), "outcomes");
    for (const ef of it.effects ?? []) {
      if (ef.kind !== "calls") continue;
      const t = idx.get(ef.target);
      if (t?.type === "interaction") add(from, surfaceOf(t.item.from), "calls");
    }
  }
  return [...links.values()];
}

/* ───────────── layout ───────────── */

export const REGION_PAD = 36;
export const REGION_HEAD = 64;
const GAP_X = 60;
const GAP_Y = 36;

type XY = { x: number; y: number };

/** Lay out one cluster's surfaces; positions are relative to the cluster's content box. */
function layoutCluster(ids: Ref[], edges: [Ref, Ref][], width: number, heights: Record<string, number>) {
  const pos: Record<string, XY> = {};
  if (ids.length === 1) {
    pos[ids[0]] = { x: 0, y: 0 };
    return { pos, w: width, h: heights[ids[0]] };
  }
  if (edges.length >= ids.length * 0.5) {
    // Connected flow (screens leading to screens): left-to-right flow chart.
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: GAP_Y, ranksep: 110 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const id of ids) g.setNode(id, { width, height: heights[id] });
    for (const [a, b] of edges) g.setEdge(a, b);
    dagre.layout(g);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const n = g.node(id);
      const x = n.x - width / 2, y = n.y - heights[id] / 2;
      pos[id] = { x, y };
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width); maxY = Math.max(maxY, y + heights[id]);
    }
    for (const id of ids) pos[id] = { x: pos[id].x - minX, y: pos[id].y - minY };
    return { pos, w: maxX - minX, h: maxY - minY };
  }
  // Mostly unconnected (e.g. a set of API endpoints): masonry grid, roughly 1.6:1 wide.
  const avgH = ids.reduce((s, id) => s + heights[id], 0) / ids.length;
  const cols = Math.max(1, Math.min(ids.length, Math.round(Math.sqrt((1.6 * ids.length * (avgH + GAP_Y)) / (width + GAP_X)))));
  const colH = new Array(cols).fill(0);
  for (const id of ids) {
    const c = colH.indexOf(Math.min(...colH));
    pos[id] = { x: c * (width + GAP_X), y: colH[c] };
    colH[c] += heights[id] + GAP_Y;
  }
  return { pos, w: cols * (width + GAP_X) - GAP_X, h: Math.max(...colH) - GAP_Y };
}

/**
 * Two-level layout: each group is laid out on its own, then groups are arranged left to
 * right by how they link to each other. Ungrouped surfaces are placed as their own blocks.
 */
export function layoutGrouped(plan: Plan, idx: PlanIndex, width: number, heights: Record<string, number>): Record<string, XY> {
  const blocks: { id: string; ids: Ref[]; framed: boolean }[] = [];
  for (const c of clusters(plan)) {
    if (c.id === UNGROUPED) for (const s of c.surfaces) blocks.push({ id: `solo:${s}`, ids: [s], framed: false });
    else blocks.push({ id: c.id, ids: c.surfaces, framed: true });
  }
  const blockOf = new Map<Ref, string>();
  for (const b of blocks) for (const s of b.ids) blockOf.set(s, b.id);

  // Surface-level edges, split into inside-block and between-block.
  const inner = new Map<string, [Ref, Ref][]>();
  const between = new Map<string, number>();
  const link = (a: Ref, b: Ref) => {
    const ba = blockOf.get(a), bb = blockOf.get(b);
    if (!ba || !bb) return;
    if (ba === bb) { if (a !== b) (inner.get(ba) ?? inner.set(ba, []).get(ba)!).push([a, b]); }
    else between.set(`${ba}\u0000${bb}`, (between.get(`${ba}\u0000${bb}`) ?? 0) + 1);
  };
  for (const it of plan.interactions) {
    const from = surfaceOf(it.from);
    for (const o of it.outcomes) if (o.to != null) link(from, surfaceOf(o.to));
    for (const ef of it.effects ?? []) {
      const t = ef.kind === "calls" ? idx.get(ef.target) : undefined;
      if (t?.type === "interaction") link(from, surfaceOf(t.item.from));
    }
  }

  const laid = new Map(blocks.map((b) => [b.id, layoutCluster(b.ids, inner.get(b.id) ?? [], width, heights)]));
  const size = (b: { id: string; framed: boolean }) => {
    const l = laid.get(b.id)!;
    return b.framed ? { w: l.w + 2 * REGION_PAD, h: l.h + REGION_HEAD + REGION_PAD } : { w: l.w, h: l.h };
  };
  const order = flowOrder(blocks.map((b) => ({ id: b.id, ...size(b) })), between);

  // Pack blocks into rows, in flow order, aiming for a landscape canvas (about 16:10).
  const GAP = 90;
  const area = blocks.reduce((a, b) => { const s = size(b); return a + (s.w + GAP) * (s.h + GAP); }, 0);
  const rowWidth = Math.max(...blocks.map((b) => size(b).w), Math.sqrt(area * 1.6));
  const placed = new Map<string, XY>();
  let x = 0, y = 0, rowH = 0;
  for (const id of order) {
    const s = size(blocks.find((b) => b.id === id)!);
    if (x > 0 && x + s.w > rowWidth) { x = 0; y += rowH + GAP; rowH = 0; }
    placed.set(id, { x, y });
    x += s.w + GAP;
    rowH = Math.max(rowH, s.h);
  }

  const out: Record<string, XY> = {};
  for (const b of blocks) {
    const p = placed.get(b.id)!, l = laid.get(b.id)!;
    const ox = p.x + (b.framed ? REGION_PAD : 0), oy = p.y + (b.framed ? REGION_HEAD : 0);
    for (const s of b.ids) out[s] = { x: ox + l.pos[s].x, y: oy + l.pos[s].y };
  }
  return out;
}

/**
 * Order blocks so that ones leading to others come first: dagre's left-to-right rank, then
 * top-to-bottom within a rank. Used to place groups in reading order.
 */
export function flowOrder(items: { id: string; w: number; h: number }[], links: Map<string, number>): string[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const it of items) g.setNode(it.id, { width: it.w, height: it.h });
  for (const [key, n] of links) {
    const [a, b] = key.split("\u0000");
    if (g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b, { weight: n });
  }
  dagre.layout(g);
  return items
    .map((it) => ({ id: it.id, x: g.node(it.id).x, y: g.node(it.id).y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((it) => it.id);
}
