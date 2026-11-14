// Changeset generation (diff base → current), application (rebase / agent side), and per-change revert.
import type { Changeset, Op } from "../../../schema/changeset.ts";
import { buildIndex, clone, insertItem, removeItem, type ItemType, type Plan, type Ref } from "./plan.ts";

export type { Changeset, Op };

const CHILD_KEYS: Record<string, string[]> = {
  surface: ["states", "elements"],
  interaction: ["outcomes"],
};
const PLAN_KEYS = ["project", "profiles", "entryPoints"] as const;
const TYPE_ORDER: ItemType[] = ["group", "surface", "state", "element", "interaction", "outcome", "decision"];

interface Flat {
  type: ItemType | "plan";
  ref: Ref;
  parent?: Ref;
  own: Record<string, unknown>;
  full: unknown;
}

function stable(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

function flatten(plan: Plan): Map<Ref, Flat> {
  const m = new Map<Ref, Flat>();
  const own = (type: string, item: any) => {
    const o: Record<string, unknown> = { ...item };
    for (const k of CHILD_KEYS[type] ?? []) delete o[k];
    return o;
  };
  const planOwn: Record<string, unknown> = {};
  for (const k of PLAN_KEYS) planOwn[k] = plan[k];
  m.set("$plan", { type: "plan", ref: "$plan", own: planOwn, full: null });
  for (const [ref, loc] of buildIndex(plan)) {
    const parent = loc.type === "state" || loc.type === "element" || loc.type === "outcome" ? loc.parent.id : undefined;
    m.set(ref, { type: loc.type, ref, parent, own: own(loc.type, loc.item), full: loc.item });
  }
  return m;
}

/** One reviewable change, for the Changes panel. Confirms are listed per ref and merged on send. */
export interface Change {
  key: string;
  kind: "add" | "update" | "remove" | "confirm" | "comment";
  type: ItemType | "plan";
  ref: Ref;
  fields?: string[];
  op: Op;
}

export function diffPlans(base: Plan, cur: Plan, notes: Record<Ref, string> = {}): Change[] {
  const a = flatten(base);
  const b = flatten(cur);
  const changes: Change[] = [];
  const note = (ref: Ref) => (notes[ref]?.trim() ? { note: notes[ref].trim() } : {});

  for (const [ref, fa] of a) {
    const fb = b.get(ref);
    if (!fb) {
      if (fa.parent && !b.has(fa.parent)) continue; // parent removal covers it
      changes.push({ key: `remove:${ref}`, kind: "remove", type: fa.type, ref, op: { op: "remove", ref, ...note(ref) } });
      continue;
    }
    const keys = new Set([...Object.keys(fa.own), ...Object.keys(fb.own)]);
    const changed = [...keys].filter((k) => stable(fa.own[k]) !== stable(fb.own[k]));
    if (changed.length === 0) continue;
    const ma = fa.own.meta as any, mb = fb.own.meta as any;
    const onlyStatus =
      changed.length === 1 && changed[0] === "meta" &&
      stable({ ...ma, status: null }) === stable({ ...mb, status: null }) && mb?.status === "confirmed";
    if (onlyStatus) {
      changes.push({ key: `confirm:${ref}`, kind: "confirm", type: fa.type, ref, op: { op: "confirm", refs: [ref], ...note(ref) } });
    } else {
      const set: Record<string, unknown> = {};
      for (const k of changed) set[k] = fb.own[k] === undefined ? null : fb.own[k];
      changes.push({ key: `update:${ref}`, kind: "update", type: fa.type, ref, fields: changed, op: { op: "update", ref, set, ...note(ref) } });
    }
  }
  for (const [ref, fb] of b) {
    if (a.has(ref)) continue;
    if (fb.parent && !a.has(fb.parent)) continue; // included in parent's add value
    const value = clone(fb.full) as any;
    const kind = fb.type as ItemType;
    const op = (fb.parent ? { op: "add", kind, parent: fb.parent, value, ...note(ref) } : { op: "add", kind, value, ...note(ref) }) as Op;
    changes.push({ key: `add:${ref}`, kind: "add", type: kind, ref, op });
  }
  // Notes on items that weren't otherwise changed become comments.
  const touched = new Set(changes.map((c) => c.ref));
  for (const [ref, text] of Object.entries(notes)) {
    if (!text.trim() || touched.has(ref) || !b.has(ref)) continue;
    const fb = b.get(ref)!;
    changes.push({ key: `comment:${ref}`, kind: "comment", type: fb.type, ref, op: { op: "comment", ref, note: text.trim() } });
  }
  const rank = (c: Change) => ["confirm", "update", "remove", "add", "comment"].indexOf(c.kind) * 10 + Math.max(0, TYPE_ORDER.indexOf(c.type as ItemType));
  return changes.sort((x, y) => rank(x) - rank(y));
}

export function toChangeset(changes: Change[], base: string, note?: string): Changeset {
  // Plain confirms merge into one op; confirms carrying a note keep their own op.
  const confirms = changes.filter((c) => c.kind === "confirm");
  const plain = confirms.filter((c) => !c.op.note);
  const ops: Op[] = [];
  if (plain.length) ops.push({ op: "confirm", refs: plain.map((c) => c.ref) });
  for (const c of confirms) if (c.op.note) ops.push(c.op);
  for (const c of changes) if (c.kind !== "confirm") ops.push(c.op);
  return { base, ...(note?.trim() ? { note: note.trim() } : {}), ops };
}

/** Apply ops to a plan, tolerating ops whose targets are gone. Same semantics the agent uses. */
export function applyOps(plan: Plan, ops: Op[]): { plan: Plan; failed: Op[] } {
  const p = clone(plan);
  const failed: Op[] = [];
  for (const op of ops) {
    const idx = buildIndex(p);
    switch (op.op) {
      case "confirm":
        for (const r of op.refs) {
          const loc = idx.get(r);
          if (loc) loc.item.meta = { ...loc.item.meta, status: "confirmed" };
          else failed.push({ op: "confirm", refs: [r] });
        }
        break;
      case "update": {
        if (op.ref === "$plan") {
          for (const [k, v] of Object.entries(op.set)) (p as any)[k] = v;
          break;
        }
        const loc = idx.get(op.ref);
        if (!loc) { failed.push(op); break; }
        for (const [k, v] of Object.entries(op.set)) {
          if (v === null && k !== "to") delete (loc.item as any)[k];
          else (loc.item as any)[k] = v;
        }
        break;
      }
      case "remove":
        if (!removeItem(p, op.ref)) failed.push(op);
        break;
      case "comment":
        if (!idx.has(op.ref)) failed.push(op);
        break;
      case "add": {
        const parent = "parent" in op ? op.parent : undefined;
        const id = op.kind === "state" ? `${parent}#${(op.value as any).id}` : (op.value as any).id;
        if (idx.has(id) || !insertItem(p, op.kind, clone(op.value), parent)) failed.push(op);
        break;
      }
    }
  }
  return { plan: p, failed };
}

/** Undo one change in `cur`, restoring what `base` had. */
export function revertChange(base: Plan, cur: Plan, change: Change): Plan {
  const next = clone(cur);
  if (change.type === "plan") {
    for (const k of PLAN_KEYS) (next as any)[k] = clone(base[k]);
    return next;
  }
  const baseIdx = buildIndex(base);
  const curIdx = buildIndex(next);
  switch (change.kind) {
    case "comment":
      break; // notes live outside the plan; the caller clears them
    case "add":
      removeItem(next, change.ref);
      break;
    case "remove": {
      const loc = baseIdx.get(change.ref);
      if (!loc) break;
      const parent = loc.type === "state" || loc.type === "element" || loc.type === "outcome" ? loc.parent.id : undefined;
      insertItem(next, loc.type, clone(loc.item), parent);
      break;
    }
    case "confirm":
    case "update": {
      const b = baseIdx.get(change.ref), c = curIdx.get(change.ref);
      if (!b || !c) break;
      const keys = change.kind === "confirm" ? ["meta"] : change.fields ?? [];
      for (const k of keys) {
        const v = (b.item as any)[k];
        if (v === undefined) delete (c.item as any)[k];
        else (c.item as any)[k] = clone(v);
      }
      break;
    }
  }
  return next;
}

/** Refs whose own fields differ between two plans (added or changed). Used to badge agent updates. */
export function changedRefs(prev: Plan, next: Plan): Set<Ref> {
  const out = new Set<Ref>();
  const a = flatten(prev), b = flatten(next);
  for (const [ref, fb] of b) {
    if (ref === "$plan") continue;
    const fa = a.get(ref);
    if (!fa || stable(fa.own) !== stable(fb.own)) out.add(ref);
  }
  return out;
}
