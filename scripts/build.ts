// Plan Graph — helpers for writing or editing plan.json from a script.
//
// Write a short script (plan.build.ts, anywhere outside the user's source tree), import this
// module by absolute path, and run it with  node --experimental-strip-types <script>.
//
//   import { create, open, src } from "<skill>/scripts/build.ts";
//
//   const p = create({ name: "shorty", summary: "…", profiles: ["web", "api"] });
//   p.group("g.create", "Create links", "Shortening a URL, from the form to the API");
//   p.surface({ id: "web.home", profile: "web", kind: "page", name: "Home", address: "/", group: "g.create",
//               states: ["idle", "submitting", ["error", "Inline message under the input"]],
//               elements: [["web.home.url", "input", "Long URL", { type: "url", required: true }],
//                          ["web.home.shorten-btn", "button", "Shorten"]] });
//   p.interaction("web.home.shorten", "web.home", ["submit", "Submit the URL", "web.home.shorten-btn"], [
//     ["ok", "API returns 201", "web.result", "Short URL shown and focused"],
//     ["invalid", "URL fails validation", "web.home#error", "“Enter a full URL starting with http(s)://”"],
//   ], { calls: ["api.create-link.request"] });
//   p.decision({ id: "d.redirect-status", attachedTo: ["api.redirect"], question: "…", value: "302",
//                alternatives: ["301"], rationale: "…", impact: "high", checklistKey: "…" });
//   p.entry("web.home");
//   p.save("plan-graph/plan.json");   // writes, then lints; exits 1 on lint errors
//
// Editing an existing plan (after `plan.ts apply`, or to keep it in sync with code):
//
//   const p = open("plan-graph/plan.json");
//   p.remove("web.home.alias-taken", "Only reachable via the alias input you removed");
//   p.update("api.create-link.request.ok", { result: "201 {code, shortUrl}" }, "Alias field is gone");
//   p.save();
//
// Proposing a change instead of making it (the user asked for something in chat and should
// see it in the GUI before it lands). Edit exactly as above, then call propose() instead of
// save(): plan.json is left alone and the diff goes to plan-graph/proposal.json, which the GUI
// shows as a reviewable proposal with the decisions it changes and your questions:
//
//   const p = open("plan-graph/plan.json");
//   p.remove("web.home.alias-input", "You asked to drop custom aliases");
//   p.update("d.redirect-status", { value: "301" }, "Permanent links can be cached");
//   p.propose({ title: "Drop custom aliases", request: "can we get rid of custom aliases?",
//     summary: "Removes the alias input, its error outcomes, the API field and the CLI flag.",
//     questions: [{ id: "q.existing", question: "What happens to links already created with an alias?",
//       options: ["Keep working", "Redirect to a random code"], recommended: "Keep working",
//       refs: ["api.redirect"] }] });
//
// Putting a topic in focus: a question you need answered, a change you suggest, or a finding the
// user should see, with its breakdown and options. Written straight to plan-graph/focus.json (no
// save() needed); the GUI shows it in the Focus tab and the user's answer arrives in the next
// changeset. Use it instead of ending a chat reply with a question that needs a breakdown:
//
//   const p = open("plan-graph/plan.json");
//   p.focus({ id: "f.redirect", kind: "question", title: "Should short links redirect with 301 or 302?",
//     summary: "Browsers cache 301s, which would undercount clicks.", impact: "high",
//     context: ["The plan says 302 today (d.redirect-status)."], refs: ["d.redirect-status"],
//     options: [{ id: "302", label: "302 Found", pros: ["Every click is counted"], cons: ["One extra hop for repeat visitors"] },
//               { id: "301", label: "301 Moved Permanently", changes: "d.redirect-status → 301" }],
//     recommended: "302", rationale: "Click stats are the product." });
//   // next round, after `plan.ts apply` recorded the user's answer in the item's thread:
//   p.followUp("f.redirect", "302 it is. Should HEAD requests count as clicks?", { options: [...] });
//   p.resolveFocus("f.redirect", "302 kept; d.redirect-status confirmed.");
//
// Meta is filled in for you: new items get the current defaults (agent/proposed, or set
// p.defaults({ origin: "code", status: "confirmed", built: "yes" }) for extraction), plus the
// `note` and `sources` you pass. `update` and `remove` record why; `update` sets the item's
// status back to "proposed" so the user sees it, unless you pass { keepStatus: true }.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Plan, Surface, State, Element, Interaction, Outcome, Decision, Group, Meta, Ref, SourceRef, Effect,
} from "../schema/plan.ts";
import { buildIndex, deleteWithCascade, insertItem, type ItemType } from "../gui/src/model/plan.ts";
import { lint, type Profile } from "../gui/src/model/lint.ts";
import { diffPlans, toChangeset } from "../gui/src/model/diff.ts";
import { decisionImpacts, opRef } from "../gui/src/model/proposal.ts";
import type { Proposal, ProposalQuestion } from "../schema/proposal.ts";
import { checkFocusItem, emptyFocus, type FocusFile, type FocusItem } from "../gui/src/model/focus.ts";

/** What you pass to focus(): an item without its bookkeeping. */
export type FocusSpec = Omit<FocusItem, "status" | "thread" | "createdAt" | "updatedAt" | "resolution"> & { status?: FocusItem["status"] };
/** What a follow-up may change for the next round. */
export type FocusRevision = Partial<Pick<FocusItem, "title" | "summary" | "context" | "options" | "recommended" | "rationale" | "refs" | "impact" | "kind">>;

const SKILL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** A source reference: src("server.js", 42) or src("server.js"). */
export const src = (file: string, line?: number): SourceRef => (line ? { file, line } : { file });

/** Extra meta you can pass on any item: a note for the reviewer, code locations, overrides. */
export interface MetaExtra {
  note?: string;
  sources?: SourceRef[];
  meta?: Partial<Meta>;
}

/** "id" | ["id", "description"] | full State minus meta. */
export type StateSpec = string | [string, string] | (Omit<State, "meta"> & MetaExtra);
/** [id, kind, label, spec?] | full Element minus meta. */
export type ElementSpec = [string, string, string, Record<string, unknown>?] | (Omit<Element, "meta"> & MetaExtra);
/** [case, when, to, result?] — id becomes `<interaction>.<case>` | full outcome with `case`. */
export type OutcomeSpec =
  | [string, string, Ref | null, string?]
  | ({ case: string; when: string; to: Ref | null; result?: string } & MetaExtra);
/** [kind, description, element?] | full trigger. */
export type TriggerSpec = [string, string, Ref?] | Interaction["trigger"];

export type SurfaceSpec = Omit<Surface, "meta" | "states" | "elements"> & MetaExtra & {
  states?: StateSpec[];
  elements?: ElementSpec[];
};

export class PlanBuilder {
  plan: Plan;
  file?: string;
  private base: Meta = { origin: "agent", status: "proposed" };

  /** The plan as loaded by open(), for propose(). */
  private original?: { text: string; plan: Plan };

  constructor(plan: Plan, file?: string, originalText?: string) {
    this.plan = plan;
    this.file = file;
    if (originalText !== undefined) this.original = { text: originalText, plan: JSON.parse(originalText) };
  }

  /** Default meta for items created from now on. */
  defaults(meta: Meta): this {
    this.base = { ...meta };
    return this;
  }

  /** Builds a meta object from the current defaults. */
  meta(extra: MetaExtra = {}): Meta {
    const m: Meta = { ...this.base, ...extra.meta };
    if (extra.sources?.length) m.sources = extra.sources;
    if (extra.note) m.note = extra.note;
    return m;
  }

  private strip<T extends object>(x: T & MetaExtra): T {
    const { note, sources, meta, ...rest } = x as any;
    return rest;
  }

  // ------------------------------------------------------------ creating

  /** A group of related surfaces. `description` is one line on what this area is for. */
  group(id: string, name: string, description?: string | MetaExtra, extra?: MetaExtra): this {
    const desc = typeof description === "string" ? description : undefined;
    const meta = this.meta(typeof description === "string" ? extra : description);
    (this.plan.groups ??= []).push({ id, name, ...(desc ? { description: desc } : {}), meta });
    return this;
  }

  entry(...refs: Ref[]): this {
    for (const r of refs) if (!this.plan.entryPoints.includes(r)) this.plan.entryPoints.push(r);
    return this;
  }

  state(spec: StateSpec): State {
    if (typeof spec === "string") return { id: spec, meta: this.meta() };
    if (Array.isArray(spec)) return { id: spec[0], description: spec[1], meta: this.meta() };
    return { ...this.strip(spec), meta: this.meta(spec) };
  }

  element(spec: ElementSpec): Element {
    if (Array.isArray(spec)) {
      const [id, kind, label, s] = spec;
      return { id, kind, label, ...(s ? { spec: s } : {}), meta: this.meta() };
    }
    return { ...this.strip(spec), meta: this.meta(spec) };
  }

  outcome(interactionId: Ref, spec: OutcomeSpec): Outcome {
    if (Array.isArray(spec)) {
      const [c, when, to, result] = spec;
      return { id: `${interactionId}.${c}`, when, to, ...(result ? { result } : {}), meta: this.meta() };
    }
    const { case: c, ...rest } = this.strip(spec) as any;
    return { id: `${interactionId}.${c}`, ...rest, meta: this.meta(spec) };
  }

  surface(spec: SurfaceSpec): Surface {
    const { states, elements, ...rest } = this.strip(spec);
    const s: Surface = { ...(rest as any), meta: this.meta(spec) };
    if (states?.length) s.states = states.map((x) => this.state(x));
    if (elements?.length) s.elements = elements.map((x) => this.element(x));
    this.plan.surfaces.push(s);
    return s;
  }

  interaction(
    id: Ref,
    from: Ref,
    trigger: TriggerSpec,
    outcomes: OutcomeSpec[],
    opts: MetaExtra & { calls?: Ref[]; effects?: Effect[] } = {},
  ): Interaction {
    const t = Array.isArray(trigger)
      ? { kind: trigger[0], description: trigger[1], ...(trigger[2] ? { element: trigger[2] } : {}) }
      : trigger;
    const effects = [...(opts.calls ?? []).map((target) => ({ kind: "calls" as const, target })), ...(opts.effects ?? [])];
    const it: Interaction = {
      id, from, trigger: t,
      ...(effects.length ? { effects } : {}),
      outcomes: outcomes.map((o) => this.outcome(id, o)),
      meta: this.meta(opts),
    };
    this.plan.interactions.push(it);
    return it;
  }

  decision(spec: Omit<Decision, "meta"> & MetaExtra): Decision {
    const d: Decision = { ...this.strip(spec), meta: this.meta(spec) };
    this.plan.decisions.push(d);
    return d;
  }

  /** Add a state, element or outcome to an existing surface or interaction. */
  addTo(parent: Ref, type: "state" | "element" | "outcome", spec: any): this {
    const value = type === "state" ? this.state(spec) : type === "element" ? this.element(spec) : this.outcome(parent, spec);
    if (!insertItem(this.plan, type as ItemType, value, parent)) throw new Error(`addTo: no ${type === "outcome" ? "interaction" : "surface"} ${parent}`);
    return this;
  }

  // ------------------------------------------------------------ editing

  /** The live item for a ref (edit it in place), or throws. */
  get<T = any>(ref: Ref): T {
    const idx = buildIndex(this.plan);
    const loc = idx.get(ref);
    if (!loc) {
      const stem = ref.split(/[.#]/).slice(0, 2).join(".");
      const near = [...idx.keys()].filter((k) => k.startsWith(stem)).slice(0, 8);
      throw new Error(`No item ${ref}${near.length ? `. Similar: ${near.join(", ")}` : ""}`);
    }
    return loc.item as T;
  }

  has(ref: Ref): boolean {
    return buildIndex(this.plan).has(ref);
  }

  /**
   * Change fields on an existing item and say why. The item goes back to "proposed" so the
   * user reviews it (pass keepStatus for your own unreviewed items or pure bookkeeping).
   */
  update(ref: Ref, set: Record<string, unknown>, note?: string, opts: { keepStatus?: boolean } = {}): this {
    const item = this.get(ref);
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined || v === null) delete item[k];
      else item[k] = v;
    }
    if (!opts.keepStatus && item.meta.status !== "sketch") item.meta.status = "proposed";
    if (note) item.meta.note = note;
    return this;
  }

  /** Remove an item and everything that dangles from it. Returns what the cascade did. */
  remove(ref: Ref, why?: string): string[] {
    if (!this.has(ref)) throw new Error(`remove: no item ${ref}`);
    const lines = deleteWithCascade(this.plan, ref).lines;
    this.removed.push({ ref, why, lines });
    return lines;
  }

  /** Removals made in this session, for your reply to the user. */
  removed: { ref: Ref; why?: string; lines: string[] }[] = [];

  // ------------------------------------------------------------ output

  /**
   * Write your edits as a proposal for the user to review in the GUI, instead of saving them.
   * plan.json is not touched. Refuses (exit code 1, nothing written) if the edited plan has
   * lint errors or the user has sent changes you haven't applied yet.
   */
  propose(
    info: { title: string; summary?: string; request?: string; questions?: ProposalQuestion[]; id?: string },
    { profilesDir = path.join(SKILL_DIR, "profiles") } = {},
  ): Proposal | null {
    if (!this.original || !this.file) throw new Error("propose: open the plan with open(file) first");
    const dir = path.dirname(path.resolve(this.file));
    if (fs.existsSync(path.join(dir, "changeset.json")) || fs.existsSync(path.join(dir, "changeset.applying.json"))) {
      console.log("The user has sent changes you haven't finished applying. Run `plan.ts apply` and `done` first, then propose.");
      process.exitCode = 1;
      return null;
    }
    const current = fs.readFileSync(this.file, "utf8");
    if (current !== this.original.text) {
      console.log("plan.json changed since you opened it. Re-open it and redo your edits, then propose.");
      process.exitCode = 1;
      return null;
    }
    for (const q of info.questions ?? []) {
      if (q.recommended && q.options && !q.options.includes(q.recommended)) throw new Error(`propose: question ${q.id}: recommended must be one of its options`);
    }

    const ops = toChangeset(diffPlans(this.original.plan, this.plan), "").ops;
    // Say why each removal happens: your reason, or which removal it follows from.
    const why = new Map(this.removed.map((r) => [r.ref, r.why]));
    const roots = this.removed.map((r) => r.ref);
    for (const op of ops) {
      if (op.op !== "remove" || op.note) continue;
      const w = why.get(op.ref);
      op.note = w ?? (roots.length === 1 ? `Follows from removing ${roots[0]}` : "Structural fallout of the removals in this proposal");
    }
    if (!ops.length && !info.questions?.length) {
      console.log("propose: nothing to propose (no edits and no questions).");
      process.exitCode = 1;
      return null;
    }

    const profiles: Record<string, Profile> = {};
    for (const id of this.plan.profiles) {
      const p = path.join(profilesDir, `${id}.json`);
      if (fs.existsSync(p)) profiles[id] = JSON.parse(fs.readFileSync(p, "utf8"));
    }
    const errors = lint(this.plan, profiles).filter((i) => i.severity === "error");
    if (errors.length) {
      for (const i of errors) console.log(`error    ${i.message}${i.ref ? `  (${i.ref})` : ""}`);
      console.log("\nThe plan with your proposal applied has lint errors. Fix them, then propose again.");
      process.exitCode = 1;
      return null;
    }

    const now = new Date();
    const proposal: Proposal = {
      // Millisecond time plus a random suffix: two proposals in the same second still differ.
      id: info.id ?? `p-${now.toISOString().replace(/[-:.Z]/g, "")}-${crypto.randomBytes(2).toString("hex")}`,
      base: "sha256:" + crypto.createHash("sha256").update(this.original.text).digest("hex"),
      createdAt: now.toISOString(),
      title: info.title,
      ...(info.summary ? { summary: info.summary } : {}),
      ...(info.request ? { request: info.request } : {}),
      ops,
      ...(info.questions?.length ? { questions: info.questions } : {}),
    };
    const out = path.join(dir, "proposal.json");
    fs.writeFileSync(out, JSON.stringify(proposal, null, 2) + "\n");

    console.log(`Wrote ${out}: “${proposal.title}”, ${ops.length} op(s), ${info.questions?.length ?? 0} question(s). plan.json is unchanged.`);
    for (const op of ops) console.log(`  ${op.op.padEnd(7)} ${opRef(op)}${op.note ? `  — ${op.note}` : ""}`);
    const impacts = decisionImpacts(this.original.plan, proposal);
    if (impacts.length) {
      console.log("Decisions the GUI will show with it:");
      for (const d of impacts) console.log(`  ${d.kind.padEnd(8)} ${d.ref} (${d.decision.impact}): ${d.decision.question}`);
    }
    console.log("The GUI shows it in the Proposal tab within a couple of seconds. Wait for the user's send (`plan.ts wait`).");
    return proposal;
  }

  // ------------------------------------------------------------ focus

  private focusPath(): string {
    if (!this.file) throw new Error("focus: open the plan with open(file) first, so focus.json lands next to it");
    return path.join(path.dirname(path.resolve(this.file)), "focus.json");
  }
  private readFocusFile(): FocusFile {
    const f = this.focusPath();
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : emptyFocus();
  }
  private writeFocusFile(file: FocusFile, item: FocusItem, what: string): void {
    const problems = checkFocusItem(item, buildIndex(this.plan));
    if (problems.length) throw new Error(`focus: ${problems.join("; ")}`);
    fs.writeFileSync(this.focusPath(), JSON.stringify(file, null, 2) + "\n");
    const open = file.items.filter((i) => i.status === "open").length;
    console.log(`Focus ${what}: ${item.id} “${item.title}”. ${open} open item(s); the GUI shows them in the Focus tab within a couple of seconds.`);
  }

  /**
   * Put a topic in focus, or replace one with the same id (its thread is kept). Ask in focus
   * when an answer needs a breakdown; keep it to what changes the plan or the build.
   */
  focus(spec: FocusSpec): FocusItem {
    const file = this.readFocusFile();
    const now = new Date().toISOString();
    const prev = file.items.find((i) => i.id === spec.id);
    const item: FocusItem = {
      ...spec,
      status: spec.status ?? "open",
      ...(prev?.thread?.length ? { thread: prev.thread } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    file.items = prev ? file.items.map((i) => (i.id === spec.id ? item : i)) : [...file.items, item];
    this.writeFocusFile(file, item, prev ? "replaced" : "added");
    return item;
  }

  /** Reply on an item after the user answered: your turn in its thread, plus any new options or context. */
  followUp(id: string, text: string, revise: FocusRevision = {}): FocusItem {
    const file = this.readFocusFile();
    const item = file.items.find((i) => i.id === id);
    if (!item) throw new Error(`followUp: nothing in focus with id ${id}`);
    const now = new Date().toISOString();
    const prevRecommended = item.recommended;
    Object.assign(item, revise, { status: "open", updatedAt: now });
    if (revise.options && !revise.recommended && item.recommended && !revise.options.some((o) => o.id === item.recommended)) delete item.recommended;
    // A rationale belongs to the recommendation it explains.
    if (item.recommended !== prevRecommended && !revise.rationale) delete item.rationale;
    (item.thread ??= []).push({ from: "agent", text, at: now });
    this.writeFocusFile(file, item, "followed up");
    return item;
  }

  /** Settle an item: one line on what was decided and where it landed in the plan. */
  resolveFocus(id: string, resolution: string): FocusItem {
    const file = this.readFocusFile();
    const item = file.items.find((i) => i.id === id);
    if (!item) throw new Error(`resolveFocus: nothing in focus with id ${id}`);
    Object.assign(item, { status: "resolved", resolution, updatedAt: new Date().toISOString() });
    this.writeFocusFile(file, item, "resolved");
    return item;
  }

  /** Write plan.json (2-space JSON) and lint it. Exits 1 if lint finds errors. */
  save(file = this.file, { profilesDir = path.join(SKILL_DIR, "profiles"), quiet = false } = {}): void {
    if (!file) throw new Error("save: no file given");
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.plan, null, 2) + "\n");

    const profiles: Record<string, Profile> = {};
    for (const id of this.plan.profiles) {
      const p = path.join(profilesDir, `${id}.json`);
      if (fs.existsSync(p)) profiles[id] = JSON.parse(fs.readFileSync(p, "utf8"));
      else console.log(`error    profile “${id}” not found in ${profilesDir}`);
    }
    const issues = lint(this.plan, profiles);
    const count = (s: string) => issues.filter((i) => i.severity === s).length;
    const n = {
      surfaces: this.plan.surfaces.length,
      interactions: this.plan.interactions.length,
      outcomes: this.plan.interactions.reduce((a, i) => a + i.outcomes.length, 0),
      decisions: this.plan.decisions.length,
    };
    console.log(`Wrote ${file}: ${n.surfaces} surfaces, ${n.interactions} interactions, ${n.outcomes} outcomes, ${n.decisions} decisions.`);
    if (!quiet) for (const i of issues.filter((i) => i.severity !== "info")) {
      console.log(`${i.severity.padEnd(8)} ${i.message}${i.ref ? `  (${i.ref})` : ""}`);
    }
    console.log(`${count("error")} error(s), ${count("warning")} warning(s), ${count("info")} info (run plan.ts lint for all)`);
    if (count("error")) process.exitCode = 1;
  }
}

/** Start a new plan. */
export function create(project: {
  name: string;
  summary: string;
  profiles: string[];
  mode?: Plan["mode"];
  syncedAt?: string;
}): PlanBuilder {
  const { name, summary, profiles, mode = "forward", syncedAt } = project;
  return new PlanBuilder({
    version: 1,
    project: { name, summary },
    mode,
    ...(syncedAt ? { syncedAt } : {}),
    profiles,
    entryPoints: [],
    groups: [],
    surfaces: [],
    interactions: [],
    decisions: [],
  });
}

/** Load an existing plan for editing. save() with no argument writes it back. */
export function open(file: string): PlanBuilder {
  const text = fs.readFileSync(file, "utf8");
  return new PlanBuilder(JSON.parse(text), file, text);
}
