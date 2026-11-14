// Plan helpers: indexing, lookup, mutation primitives, structural cascades.
import type {
  Plan, Surface, State, Element, Interaction, Outcome, Decision, Group, Meta, Ref,
} from "../../../schema/plan.ts";

export type { Plan, Surface, State, Element, Interaction, Outcome, Decision, Group, Meta, Ref };

export type ItemType = "surface" | "state" | "element" | "interaction" | "outcome" | "decision" | "group";

export type Located =
  | { type: "surface"; ref: Ref; item: Surface }
  | { type: "state"; ref: Ref; item: State; parent: Surface }
  | { type: "element"; ref: Ref; item: Element; parent: Surface }
  | { type: "interaction"; ref: Ref; item: Interaction }
  | { type: "outcome"; ref: Ref; item: Outcome; parent: Interaction }
  | { type: "decision"; ref: Ref; item: Decision }
  | { type: "group"; ref: Ref; item: Group };

export type PlanIndex = Map<Ref, Located>;

export function buildIndex(plan: Plan): PlanIndex {
  const idx: PlanIndex = new Map();
  for (const g of plan.groups ?? []) idx.set(g.id, { type: "group", ref: g.id, item: g });
  for (const s of plan.surfaces) {
    idx.set(s.id, { type: "surface", ref: s.id, item: s });
    for (const st of s.states ?? []) {
      const ref = `${s.id}#${st.id}`;
      idx.set(ref, { type: "state", ref, item: st, parent: s });
    }
    for (const e of s.elements ?? []) idx.set(e.id, { type: "element", ref: e.id, item: e, parent: s });
  }
  for (const it of plan.interactions) {
    idx.set(it.id, { type: "interaction", ref: it.id, item: it });
    for (const o of it.outcomes) idx.set(o.id, { type: "outcome", ref: o.id, item: o, parent: it });
  }
  for (const d of plan.decisions) idx.set(d.id, { type: "decision", ref: d.id, item: d });
  return idx;
}

export const surfaceOf = (ref: Ref) => ref.split("#")[0];
export const stateOf = (ref: Ref): string | undefined => ref.split("#")[1];

export function clone<T>(x: T): T {
  return structuredClone(x);
}

/** Human label for any ref. */
export function labelOf(idx: PlanIndex, ref: Ref | null | undefined): string {
  if (ref == null) return "stays";
  const loc = idx.get(ref);
  if (!loc) return `⚠ ${ref}`;
  switch (loc.type) {
    case "surface": return loc.item.name;
    case "state": return `${loc.parent.name} · ${loc.item.id}`;
    case "element": return loc.item.label;
    case "interaction": return interactionLabel(idx, loc.item);
    case "outcome": return `${interactionLabel(idx, loc.parent)} → ${loc.item.when}`;
    case "decision": return loc.item.question;
    case "group": return loc.item.name;
  }
}

export function interactionLabel(idx: PlanIndex, it: Interaction): string {
  const el = it.trigger.element ? idx.get(it.trigger.element) : undefined;
  const target = el && el.type === "element" ? el.item.label : it.trigger.description;
  return `${it.trigger.kind} · ${target}`;
}

export function metaOf(loc: Located): Meta {
  return loc.item.meta;
}

/** Remove a single item by ref (and its children). Returns true if found. */
export function removeItem(plan: Plan, ref: Ref): boolean {
  const idx = buildIndex(plan);
  const loc = idx.get(ref);
  if (!loc) return false;
  const drop = <T>(arr: T[] | undefined, x: T) => {
    if (!arr) return;
    const i = arr.indexOf(x);
    if (i >= 0) arr.splice(i, 1);
  };
  switch (loc.type) {
    case "surface": drop(plan.surfaces, loc.item); break;
    case "state": drop(loc.parent.states, loc.item); break;
    case "element": drop(loc.parent.elements, loc.item); break;
    case "interaction": drop(plan.interactions, loc.item); break;
    case "outcome": drop(loc.parent.outcomes, loc.item); break;
    case "decision": drop(plan.decisions, loc.item); break;
    case "group": drop(plan.groups, loc.item); break;
  }
  return true;
}

/** Insert an item under its parent (or top level). Returns false if the parent is missing. */
export function insertItem(plan: Plan, type: ItemType, value: any, parent?: Ref): boolean {
  const idx = buildIndex(plan);
  const p = parent ? idx.get(parent) : undefined;
  switch (type) {
    case "surface": plan.surfaces.push(value); return true;
    case "interaction": plan.interactions.push(value); return true;
    case "decision": plan.decisions.push(value); return true;
    case "group": (plan.groups ??= []).push(value); return true;
    case "state":
      if (p?.type !== "surface") return false;
      (p.item.states ??= []).push(value); return true;
    case "element":
      if (p?.type !== "surface") return false;
      (p.item.elements ??= []).push(value); return true;
    case "outcome":
      if (p?.type !== "interaction") return false;
      p.item.outcomes.push(value); return true;
  }
}

export interface CascadeReport {
  lines: string[];
}

/**
 * Remove refs that no longer resolve: decision attachments, entry points, call effects,
 * trigger elements, outcome destinations (→ removed), interaction origins (→ removed).
 * Mutates the plan. Reports what it did.
 */
export function pruneDangling(plan: Plan, report: CascadeReport) {
  for (let pass = 0; pass < 3; pass++) {
    const idx = buildIndex(plan);
    let changed = false;
    plan.entryPoints = plan.entryPoints.filter((r) => {
      if (idx.has(r)) return true;
      report.lines.push(`Remove entry point ${r}`); changed = true; return false;
    });
    for (const it of [...plan.interactions]) {
      if (!idx.has(it.from)) {
        report.lines.push(`Remove interaction “${it.trigger.description}” (its surface is gone)`);
        removeItem(plan, it.id); changed = true; continue;
      }
      if (it.trigger.element && !idx.has(it.trigger.element)) {
        report.lines.push(`Unlink trigger element from “${it.trigger.description}”`);
        delete it.trigger.element; changed = true;
      }
      if (it.effects) {
        const keep = it.effects.filter((e) => e.kind !== "calls" || idx.has(e.target));
        if (keep.length !== it.effects.length) {
          report.lines.push(`Drop ${it.effects.length - keep.length} call(s) from “${it.trigger.description}”`);
          it.effects = keep; changed = true;
        }
      }
      for (const o of [...it.outcomes]) {
        if (o.to != null && !idx.has(o.to)) {
          report.lines.push(`Remove outcome “${o.when}” (its destination is gone)`);
          it.outcomes.splice(it.outcomes.indexOf(o), 1); changed = true;
        }
      }
    }
    for (const d of [...plan.decisions]) {
      const keep = d.attachedTo.filter((r) => idx.has(r));
      if (keep.length !== d.attachedTo.length) {
        if (keep.length === 0) {
          report.lines.push(`Remove decision “${d.question}” (everything it applied to is gone)`);
          plan.decisions.splice(plan.decisions.indexOf(d), 1);
        } else {
          report.lines.push(`Detach decision “${d.question}” from removed items`);
          d.attachedTo = keep;
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** Refs of outcomes (anywhere) whose destination is this surface or one of its states. */
export function inboundOutcomes(plan: Plan, surfaceId: Ref): Outcome[] {
  const out: Outcome[] = [];
  for (const it of plan.interactions) {
    if (surfaceOf(it.from) === surfaceId) continue;
    for (const o of it.outcomes) if (o.to != null && surfaceOf(o.to) === surfaceId) out.push(o);
  }
  return out;
}

/**
 * Delete with structural fallout. For surfaces, inbound outcomes are retargeted
 * (if retargetTo is given) or removed. For states, inbound outcomes and interactions
 * fall back to the parent surface. Everything else dangling is pruned.
 */
export function deleteWithCascade(plan: Plan, ref: Ref, retargetTo?: Ref): CascadeReport {
  const report: CascadeReport = { lines: [] };
  const idx = buildIndex(plan);
  const loc = idx.get(ref);
  if (!loc) return report;

  if (loc.type === "surface" && retargetTo) {
    for (const o of inboundOutcomes(plan, ref)) {
      o.to = retargetTo;
      report.lines.push(`Retarget “${o.when}” → ${labelOf(idx, retargetTo)}`);
    }
  }
  if (loc.type === "state") {
    for (const it of plan.interactions) {
      if (it.from === ref) { it.from = loc.parent.id; report.lines.push(`Move “${it.trigger.description}” to ${loc.parent.name}`); }
      for (const o of it.outcomes) {
        if (o.to === ref) { o.to = loc.parent.id; report.lines.push(`Retarget “${o.when}” → ${loc.parent.name}`); }
      }
    }
  }
  removeItem(plan, ref);
  pruneDangling(plan, report);
  return report;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "item";
}

export function uniqueId(idx: PlanIndex, base: string): string {
  if (!idx.has(base)) return base;
  for (let i = 2; ; i++) if (!idx.has(`${base}-${i}`)) return `${base}-${i}`;
}

export const userMeta = (status: "confirmed" | "sketch" = "confirmed"): Meta => ({ origin: "user", status });
