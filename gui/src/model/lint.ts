// Plan lint rules (see DESIGN.md). Errors block sending; warnings and info are advisory.
import { buildIndex, surfaceOf, type Plan, type Ref } from "./plan.ts";

export interface Profile {
  id: string;
  name: string;
  surfaceKinds: string[];
  elementKinds: string[];
  triggerKinds: string[];
  addressFormat?: string;
  requiredStates?: Record<string, string[]>;
  decisionChecklist: { key: string; question: string }[];
  testTarget: string;
}

export interface Issue {
  severity: "error" | "warning" | "info";
  message: string;
  ref?: Ref;
}

const FALLIBLE = new Set(["submit", "request", "invoke"]);
/** Plans with more surfaces than this should group every surface. */
export const GROUP_THRESHOLD = 15;

export function lint(plan: Plan, profiles: Record<string, Profile>): Issue[] {
  const issues: Issue[] = [];
  const idx = buildIndex(plan);
  const err = (message: string, ref?: Ref) => issues.push({ severity: "error", message, ref });
  const warn = (message: string, ref?: Ref) => issues.push({ severity: "warning", message, ref });
  const info = (message: string, ref?: Ref) => issues.push({ severity: "info", message, ref });

  // duplicate ids
  const seen = new Set<string>();
  const all: string[] = [
    ...plan.surfaces.flatMap((s) => [s.id, ...(s.elements ?? []).map((e) => e.id), ...(s.states ?? []).map((st) => `${s.id}#${st.id}`)]),
    ...plan.interactions.flatMap((i) => [i.id, ...i.outcomes.map((o) => o.id)]),
    ...plan.decisions.map((d) => d.id),
  ];
  for (const id of all) {
    if (seen.has(id)) err(`Duplicate id ${id}`, id);
    seen.add(id);
  }

  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const s of plan.surfaces) {
    const p = profiles[s.profile];
    if (!p) { err(`Unknown profile “${s.profile}”`, s.id); continue; }
    if (!p.surfaceKinds.includes(s.kind)) warn(`${s.name}: “${s.kind}” isn't a ${p.name} surface kind`, s.id);
    for (const e of s.elements ?? []) {
      if (!p.elementKinds.includes(e.kind)) warn(`${e.label}: “${e.kind}” isn't a ${p.name} element kind`, e.id);
    }
  }
  for (const it of plan.interactions) {
    if (!idx.has(it.from)) { err(`Interaction “${it.trigger.description}” starts on missing ${it.from}`, it.id); continue; }
    const from = surfaceOf(it.from);
    outbound.add(from);
    const s = idx.get(from);
    const p = s?.type === "surface" ? profiles[s.item.profile] : undefined;
    if (p && !p.triggerKinds.includes(it.trigger.kind)) warn(`“${it.trigger.kind}” isn't a ${p.name} trigger`, it.id);
    if (it.trigger.element && !idx.has(it.trigger.element)) err(`Trigger element ${it.trigger.element} is missing`, it.id);
    for (const ef of it.effects ?? []) {
      if (ef.kind !== "calls") continue;
      const t = idx.get(ef.target);
      if (!t) err(`Calls missing ${ef.target}`, it.id);
      else if (t.type === "interaction") inbound.add(surfaceOf(t.item.from));
    }
    if (it.outcomes.length === 0) warn(`“${it.trigger.description}” has no outcomes`, it.id);
    else if (it.outcomes.length === 1 && FALLIBLE.has(it.trigger.kind)) warn(`“${it.trigger.description}” can fail but has only one outcome`, it.id);
    for (const o of it.outcomes) {
      if (o.to == null) continue;
      if (!idx.has(o.to)) err(`Outcome “${o.when}” leads to missing ${o.to}`, o.id);
      else inbound.add(surfaceOf(o.to));
    }
  }
  for (const d of plan.decisions) {
    for (const r of d.attachedTo) if (!idx.has(r)) err(`Decision “${d.question}” is attached to missing ${r}`, d.id);
  }
  for (const r of plan.entryPoints) if (!idx.has(r)) err(`Entry point ${r} is missing`);

  for (const s of plan.surfaces) {
    if (!inbound.has(s.id) && !plan.entryPoints.includes(s.id)) warn(`${s.name} is unreachable`, s.id);
    if (!outbound.has(s.id) && !s.terminal) warn(`${s.name} is a dead end (no way onward; mark terminal if intended)`, s.id);
  }

  const answered = new Set(plan.decisions.map((d) => d.checklistKey).filter(Boolean));
  for (const pid of plan.profiles) {
    const p = profiles[pid];
    if (!p) continue;
    for (const c of p.decisionChecklist) {
      if (!answered.has(c.key)) info(`${p.name}: unanswered — ${c.question}`);
    }
  }

  for (const [ref, loc] of idx) {
    if (loc.item.meta?.status === "sketch") info(`Sketch needs detail from the agent: ${"name" in loc.item ? loc.item.name : ref}`, ref);
  }

  // Readability: large plans are navigated by group (regions on the canvas, the group map).
  const groupIds = new Set((plan.groups ?? []).map((g) => g.id));
  for (const s of plan.surfaces) if (s.group && !groupIds.has(s.group)) err(`${s.name} is in missing group ${s.group}`, s.id);
  if (plan.surfaces.length > GROUP_THRESHOLD) {
    const loose = plan.surfaces.filter((s) => !s.group || !groupIds.has(s.group));
    if (loose.length) warn(`${loose.length} of ${plan.surfaces.length} surfaces aren't in a group. Plans this size are read by group: give every surface one.`, loose[0].id);
    for (const g of plan.groups ?? []) if (!g.description) info(`Group “${g.name}” has no description (one line on what this area is for)`, g.id);
  }
  return issues;
}
