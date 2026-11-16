// Proposals (agent → GUI): preview, acceptance, and the decisions a proposal changes or touches.
// Shared by the GUI and the agent scripts (scripts/build.ts, scripts/plan.ts).
import type { Proposal, ProposalQuestion, ProposalResponse } from "../../../schema/proposal.ts";
import type { Op } from "./diff.ts";
import {
  buildIndex, clone, deleteWithCascade, insertItem, surfaceOf,
  type Decision, type ItemType, type Plan, type PlanIndex, type Ref,
} from "./plan.ts";

export type { Proposal, ProposalQuestion, ProposalResponse };

export type MarkKind = "add" | "update" | "remove";

/** The item an op is about. Confirm ops list several; the first stands for them. */
export function opRef(op: Op): Ref {
  switch (op.op) {
    case "add": return op.kind === "state" ? `${op.parent}#${(op.value as any).id}` : (op.value as any).id;
    case "confirm": return op.refs[0];
    default: return op.ref;
  }
}

/** Refs an add op brings in: the item and everything nested in it. */
function addedRefs(op: Extract<Op, { op: "add" }>): Ref[] {
  const v = op.value as any;
  const id = opRef(op);
  const out = [id];
  if (op.kind === "surface") {
    for (const st of v.states ?? []) out.push(`${v.id}#${st.id}`);
    for (const e of v.elements ?? []) out.push(e.id);
  }
  if (op.kind === "interaction") for (const o of v.outcomes ?? []) out.push(o.id);
  return out;
}

const markAll = (item: any, status: "confirmed") => {
  if (!item?.meta) return;
  item.meta = { ...item.meta, status };
  for (const k of ["states", "elements", "outcomes"]) for (const c of item[k] ?? []) markAll(c, status);
};

/**
 * Apply some of a proposal's ops to a plan. Removals cascade (like deleting in the GUI); a remove
 * whose target an earlier removal already took out counts as applied, not failed. Pick `include`
 * with `toggleOp` so ops that depend on each other are accepted together (otherwise a partial
 * accept can leave refs to items that were never added). With `confirm`, every item the accepted
 * ops add or change is marked confirmed: accepting a proposal is the user approving those values.
 * With `keepRemovals`, remove ops are skipped (the preview shows removed items struck through).
 */
export function applyProposal(
  plan: Plan,
  ops: Op[],
  include: Iterable<number> = ops.keys(),
  opts: { confirm?: boolean; keepRemovals?: boolean } = {},
): { plan: Plan; failed: number[] } {
  const p = clone(plan);
  const before = buildIndex(plan);
  const failed: number[] = [];
  const want = new Set(include);
  ops.forEach((op, i) => {
    if (!want.has(i)) return;
    const idx = buildIndex(p);
    switch (op.op) {
      case "confirm": {
        const hits = op.refs.filter((r) => idx.has(r));
        for (const r of hits) idx.get(r)!.item.meta = { ...idx.get(r)!.item.meta, status: "confirmed" };
        if (hits.length < op.refs.length) failed.push(i);
        break;
      }
      case "comment":
        if (!idx.has(op.ref)) failed.push(i);
        break;
      case "remove":
        // Gone already: either an earlier removal in this proposal cascaded it (fine), or it
        // was never there (the op no longer applies).
        if (!idx.has(op.ref)) { if (!before.has(op.ref)) failed.push(i); break; }
        if (!opts.keepRemovals) deleteWithCascade(p, op.ref);
        break;
      case "update": {
        if (op.ref === "$plan") { for (const [k, v] of Object.entries(op.set)) (p as any)[k] = v; break; }
        const loc = idx.get(op.ref);
        if (!loc) { failed.push(i); break; }
        for (const [k, v] of Object.entries(op.set)) {
          if (v === null && k !== "to") delete (loc.item as any)[k];
          else (loc.item as any)[k] = clone(v);
        }
        if (opts.confirm && loc.item.meta.status !== "sketch") loc.item.meta = { ...loc.item.meta, status: "confirmed" };
        break;
      }
      case "add": {
        const parent = "parent" in op ? op.parent : undefined;
        const value = clone(op.value) as any;
        if (opts.confirm && value.meta?.status !== "sketch") markAll(value, "confirmed");
        if (idx.has(opRef(op)) || !insertItem(p, op.kind as ItemType, value, parent)) failed.push(i);
        break;
      }
    }
  });
  return { plan: p, failed };
}

/**
 * Which ops each op needs: `requires.get(i)` holds the ops that must be accepted for op i to make
 * sense. An op needs the add ops that introduce the refs it uses (an interaction on a surface
 * the proposal adds, an outcome leading to it), and a removal needs the removals its cascade
 * implies (removing a surface takes its actions and the outcomes into it with it).
 */
export function proposalRequires(plan: Plan, ops: Op[]): Map<number, Set<number>> {
  const requires = new Map<number, Set<number>>();
  const need = (i: number, j: number) => { if (i !== j) (requires.get(i) ?? requires.set(i, new Set()).get(i)!).add(j); };

  // Refs introduced by each add op.
  const introducedBy = new Map<Ref, number>();
  ops.forEach((op, j) => { if (op.op === "add") for (const r of addedRefs(op)) introducedBy.set(r, j); });
  const strings = (x: unknown, out: string[] = []): string[] => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) for (const v of x) strings(v, out);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) if (k !== "meta" && k !== "note") strings(v, out);
    return out;
  };
  ops.forEach((op, i) => {
    if (op.op !== "add" && op.op !== "update") return;
    const own = new Set(op.op === "add" ? addedRefs(op) : []);
    for (const s of strings(op.op === "add" ? { parent: "parent" in op ? op.parent : undefined, value: op.value } : op.set)) {
      for (const r of [s, surfaceOf(s)]) {
        const j = introducedBy.get(r);
        if (j !== undefined && !own.has(r)) need(i, j);
      }
    }
  });

  // Removals implied by each removal's cascade.
  const removes = ops.map((op, j) => (op.op === "remove" ? { j, ref: op.ref } : null)).filter((x): x is { j: number; ref: Ref } => !!x);
  if (removes.length > 1) {
    const idx = buildIndex(plan);
    for (const { j: i, ref } of removes) {
      if (!idx.has(ref)) continue;
      const after = clone(plan);
      deleteWithCascade(after, ref);
      const left = buildIndex(after);
      for (const r of removes) if (r.j !== i && idx.has(r.ref) && !left.has(r.ref)) need(i, r.j);
    }
  }
  return requires;
}

/**
 * Tick or untick op `i`, keeping dependencies consistent: ticking also ticks what it needs;
 * unticking also unticks whatever needs it.
 */
export function toggleOp(included: number[], i: number, requires: Map<number, Set<number>>): number[] {
  const set = new Set(included);
  if (set.has(i)) {
    const stack = [i];
    while (stack.length) {
      const k = stack.pop()!;
      if (!set.delete(k)) continue;
      for (const [a, reqs] of requires) if (reqs.has(k) && set.has(a)) stack.push(a);
    }
  } else {
    const stack = [i];
    while (stack.length) {
      const k = stack.pop()!;
      if (set.has(k)) continue;
      set.add(k);
      for (const r of requires.get(k) ?? []) stack.push(r);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** A short fingerprint of a proposal's content, so a revised proposal that reuses an id is still seen as new. */
export function proposalSig(p: Pick<Proposal, "title" | "ops" | "questions">): string {
  const s = JSON.stringify([p.title, p.ops, p.questions ?? []]);
  let h = 5381;
  for (let k = 0; k < s.length; k++) h = ((h << 5) + h + s.charCodeAt(k)) | 0;
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** What each item in the preview is: added, changed or removed by the proposal. */
export function proposalMarks(ops: Op[], include: Iterable<number> = ops.keys()): Map<Ref, MarkKind> {
  const m = new Map<Ref, MarkKind>();
  const want = new Set(include);
  ops.forEach((op, i) => {
    if (!want.has(i)) return;
    if (op.op === "add") for (const r of addedRefs(op)) m.set(r, "add");
    else if (op.op === "update" && op.ref !== "$plan") m.set(op.ref, m.get(op.ref) === "add" ? "add" : "update");
    else if (op.op === "remove") m.set(op.ref, "remove");
  });
  return m;
}

/** True when `ref` is marked removed, directly or through its parent (a removed surface's rows…). */
export function isRemoved(marks: Map<Ref, MarkKind>, ref: Ref, idx: PlanIndex): boolean {
  if (marks.get(ref) === "remove") return true;
  const loc = idx.get(ref);
  if (!loc) return false;
  if (loc.type === "state" || loc.type === "element") return marks.get(loc.parent.id) === "remove";
  if (loc.type === "outcome") return marks.get(loc.parent.id) === "remove" || marks.get(surfaceOf(loc.parent.from)) === "remove";
  if (loc.type === "interaction") return marks.get(surfaceOf(loc.item.from)) === "remove";
  return false;
}

// ─────────────────────────────────────────────── decisions

export interface DecisionImpact {
  ref: Ref;
  /**
   * added    — the proposal records a new decision (often one the change implies)
   * changed  — the proposal changes this decision's answer or wording
   * removed  — the proposal drops it
   * affected — not edited, but attached to items the proposal changes: may need revisiting
   */
  kind: "added" | "changed" | "removed" | "affected";
  /** The decision as it would be after the proposal (or as it is, for removed/affected). */
  decision: Decision;
  before?: Decision;
  /** Fields the proposal changes, for "changed". */
  fields?: string[];
  /** For "affected": the changed items this decision is attached to. */
  via?: Ref[];
  /** Index of the op that adds/changes/removes it. */
  op?: number;
  /** Questions in the proposal that mention it. */
  questions?: string[];
}

/** Decisions the proposal adds, changes or removes, plus the ones attached to what it changes. */
export function decisionImpacts(base: Plan, proposal: Pick<Proposal, "ops" | "questions">, include: Iterable<number> = proposal.ops.keys()): DecisionImpact[] {
  const idx = buildIndex(base);
  const want = new Set(include);
  const { plan: after } = applyProposal(base, proposal.ops, want);
  const afterIdx = buildIndex(after);
  const out = new Map<Ref, DecisionImpact>();
  const touched = new Set<Ref>();

  proposal.ops.forEach((op, i) => {
    if (!want.has(i) || op.op === "confirm" || op.op === "comment") return;
    if (op.op === "add" && op.kind === "decision") {
      out.set(opRef(op), { ref: opRef(op), kind: "added", decision: op.value as Decision, op: i });
      return;
    }
    const ref = opRef(op);
    const loc = idx.get(ref);
    if (loc?.type === "decision") {
      if (op.op === "remove") { out.set(ref, { ref, kind: "removed", decision: loc.item, before: loc.item, op: i }); return; }
      if (op.op === "update") {
        const fields = Object.keys(op.set).filter((k) => k !== "meta" && k !== "attachedTo");
        const now = afterIdx.get(ref)?.item as Decision | undefined;
        if (fields.length) { out.set(ref, { ref, kind: "changed", decision: now ?? loc.item, before: loc.item, fields, op: i }); return; }
      }
    }
    if (ref === "$plan") return;
    touched.add(ref);
    if (op.op === "add" && "parent" in op) touched.add(op.parent);
    if (op.op === "add" && op.kind === "outcome" && "parent" in op) touched.add(surfaceOf((idx.get(op.parent)?.item as any)?.from ?? ""));
  });

  // Decisions attached to something the proposal touches (or to the surface that contains it).
  const containing = (r: Ref): Ref[] => {
    const loc = idx.get(r) ?? afterIdx.get(r);
    if (!loc) return [r];
    switch (loc.type) {
      case "state": case "element": return [r, loc.parent.id];
      case "outcome": return [r, loc.parent.id, surfaceOf(loc.parent.from)];
      case "interaction": return [r, surfaceOf(loc.item.from)];
      default: return [r];
    }
  };
  const reach = new Map<Ref, Ref>(); // attach point → touched item that reaches it
  for (const t of touched) for (const r of containing(t)) if (!reach.has(r)) reach.set(r, t);
  for (const d of base.decisions) {
    if (out.has(d.id)) continue;
    const via = [...new Set(d.attachedTo.filter((a) => reach.has(a)).map((a) => reach.get(a)!))];
    if (via.length) out.set(d.id, { ref: d.id, kind: "affected", decision: (afterIdx.get(d.id)?.item as Decision) ?? d, via });
  }

  for (const q of proposal.questions ?? []) {
    for (const r of q.refs ?? []) {
      const hit = out.get(r);
      if (hit) (hit.questions ??= []).push(q.id);
      else {
        const loc = idx.get(r);
        if (loc?.type === "decision") out.set(r, { ref: r, kind: "affected", decision: loc.item, via: [], questions: [q.id] });
      }
    }
  }
  const order = { changed: 0, added: 1, removed: 2, affected: 3 };
  const impact = { high: 0, medium: 1, low: 2 };
  return [...out.values()].sort((a, b) => order[a.kind] - order[b.kind] || impact[a.decision.impact] - impact[b.decision.impact]);
}

/** A response with every op accepted or rejected (indices not in `accepted` are rejected). */
export function makeResponse(p: Proposal, accepted: number[], answers: Record<string, string>, reply: string): ProposalResponse {
  const acc = [...new Set(accepted)].sort((a, b) => a - b);
  const ans = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  return {
    id: p.id, title: p.title,
    accepted: acc,
    rejected: p.ops.map((_, i) => i).filter((i) => !acc.includes(i)),
    answers: ans,
    ...(reply.trim() ? { reply: reply.trim() } : {}),
  };
}
