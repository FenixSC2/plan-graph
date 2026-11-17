// Plan Graph agent CLI. Run with:  node --experimental-strip-types <skill>/scripts/plan.ts <command> <plan.json> [options]
//
//   lint    <plan>                 lint the plan; exit 1 if there are errors
//   outline <plan>                 compact text view of the graph (surfaces → interactions → outcomes)
//   tests   <plan>                 test matrix: one case per outcome, grouped by profile test target
//   serve   <plan> [--port N]      start the review GUI (foreground; run it in the background) and print its URL;
//                                  reuses an editor already serving this plan, skips ports serving another
//   wait    <plan> [--timeout S]   block until the user sends a changeset, then show it (exit 2 on timeout)
//   show    <plan>                 show the pending changeset, with labels and a to-do list
//   apply   <plan> [--rebase]      apply the pending changeset's ops to plan.json; the GUI waits until `done`
//   done    <plan>                 lint, then release the plan so the GUI picks it up
//   proposal <plan> [--withdraw]   show your pending proposal (from PlanBuilder.propose()), or withdraw it
//   focus   <plan>                 show the focus list (PlanBuilder.focus()): open items, whose turn, threads
//
// The model code is shared with the GUI, so ops apply here exactly as they do there.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildIndex, labelOf, surfaceOf, type Plan, type PlanIndex, type Ref } from "../gui/src/model/plan.ts";
import { applyOps, type Changeset, type Op } from "../gui/src/model/diff.ts";
import { lint, type Profile } from "../gui/src/model/lint.ts";
import { decisionImpacts } from "../gui/src/model/proposal.ts";
import type { Proposal } from "../schema/proposal.ts";
import { describeAnswer, optionLabel, recordResponses, sortFocus, turnOf, type FocusFile } from "../gui/src/model/focus.ts";

const SKILL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const [cmd, planArg, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? (rest[i + 1] ?? "") : undefined;
};
const flag = (name: string) => rest.includes(`--${name}`);

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
if (!planArg) die(`usage: plan.ts ${cmd} <plan.json>`);

const planPath = path.resolve(planArg);
const changesetPath = path.join(path.dirname(planPath), "changeset.json");
// While the agent works, the changeset is renamed: the GUI then holds off adopting plan.json and refuses new sends.
const applyingPath = path.join(path.dirname(planPath), "changeset.applying.json");
// The agent's pending proposal (PlanBuilder.propose()). The GUI shows it until the user answers.
const proposalPath = path.join(path.dirname(planPath), "proposal.json");
// The agent's focus list (PlanBuilder.focus()): topics in play with the user. Answers arrive in the changeset.
const focusPath = path.join(path.dirname(planPath), "focus.json");
const profilesDir = path.resolve(opt("profiles") ?? path.join(SKILL_DIR, "profiles"));

const hashOf = (text: string) => "sha256:" + crypto.createHash("sha256").update(text).digest("hex");
const readText = () => {
  if (!fs.existsSync(planPath)) die(`No plan at ${planPath}`);
  return fs.readFileSync(planPath, "utf8");
};
const readPlan = (): Plan => {
  try { return JSON.parse(readText()); } catch (e) { return die(`plan.json is not valid JSON: ${(e as Error).message}`); }
};
const loadProfiles = (plan: Plan): Record<string, Profile> => {
  const out: Record<string, Profile> = {};
  for (const id of plan.profiles ?? []) {
    const p = path.join(profilesDir, `${id}.json`);
    if (fs.existsSync(p)) out[id] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return out;
};
const readJson = (p: string) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
/** While applying, the answered proposal is kept inside changeset.applying.json (proposal.json is gone). */
type StoredChangeset = Changeset & { proposalSnapshot?: Proposal };
const readChangeset = (): StoredChangeset | null => readJson(changesetPath) ?? readJson(applyingPath);
const readProposal = (): Proposal | null => readJson(proposalPath);
const readFocus = (): FocusFile | null => readJson(focusPath);

const status = (meta: { origin: string; status: string; built?: string } | undefined) =>
  meta ? `[${meta.origin}/${meta.status}${meta.built && meta.built !== "no" ? `, built ${meta.built}` : ""}]` : "";

// ---------------------------------------------------------------- lint

function printLint(plan: Plan): number {
  const issues = lint(plan, loadProfiles(plan));
  const missing = (plan.profiles ?? []).filter((p) => !fs.existsSync(path.join(profilesDir, `${p}.json`)));
  for (const p of missing) console.log(`error    profile “${p}” not found in ${profilesDir}`);
  const order = { error: 0, warning: 1, info: 2 } as const;
  for (const i of [...issues].sort((a, b) => order[a.severity] - order[b.severity])) {
    console.log(`${i.severity.padEnd(8)} ${i.message}${i.ref ? `  (${i.ref})` : ""}`);
  }
  const n = (s: string) => issues.filter((i) => i.severity === s).length;
  const errors = n("error") + missing.length;
  console.log(`\n${errors} error(s), ${n("warning")} warning(s), ${n("info")} info`);
  return errors;
}

// ---------------------------------------------------------------- outline

function outline(plan: Plan) {
  console.log(`${plan.project.name} — ${plan.mode}, profiles: ${plan.profiles.join(", ")}`);
  console.log(`entry points: ${plan.entryPoints.join(", ")}\n`);
  for (const s of plan.surfaces) {
    const flags = [plan.entryPoints.includes(s.id) && "entry", s.terminal && "terminal"].filter(Boolean).join(", ");
    console.log(`${s.id}  ${s.kind} “${s.name}”${s.address ? `  ${s.address}` : ""}${flags ? `  (${flags})` : ""}  ${status(s.meta)}`);
    if (s.states?.length) console.log(`  states: ${s.states.map((st) => st.id).join(", ")}`);
    for (const it of plan.interactions.filter((i) => surfaceOf(i.from) === s.id)) {
      const on = it.from.includes("#") ? ` (in ${it.from.split("#")[1]})` : "";
      console.log(`  ▸ ${it.id}: ${it.trigger.kind} ${it.trigger.description}${on}  ${status(it.meta)}`);
      for (const e of it.effects ?? []) console.log(`      ${e.kind} ${e.target}`);
      for (const o of it.outcomes) {
        console.log(`      • ${o.when} → ${o.to ? o.to : "stays"}${o.result ? ` — ${o.result}` : ""}`);
      }
    }
  }
  console.log(`\ndecisions:`);
  for (const d of plan.decisions) {
    const where = d.attachedTo.length ? d.attachedTo.join(", ") : "project-wide";
    console.log(`  ${d.id} (${d.impact}${d.checklistKey ? `, ${d.checklistKey}` : ""}) ${status(d.meta)}  [${where}]`);
    console.log(`    ${d.question} → ${d.value}`);
  }
}

// ---------------------------------------------------------------- tests

function tests(plan: Plan) {
  const idx = buildIndex(plan);
  const profiles = loadProfiles(plan);
  const byTarget = new Map<string, string[]>();
  let n = 0;
  for (const it of plan.interactions) {
    const s = idx.get(surfaceOf(it.from));
    const profile = s?.type === "surface" ? s.item.profile : "?";
    const target = profiles[profile]?.testTarget ?? "unknown";
    const lines = byTarget.get(target) ?? [];
    for (const o of it.outcomes) {
      n++;
      lines.push(
        `- ${o.id}\n` +
        `    given: ${labelOf(idx, it.from)}${s?.type === "surface" && s.item.address ? ` (${s.item.address})` : ""}\n` +
        `    when:  ${it.trigger.kind} ${it.trigger.description} — ${o.when}\n` +
        `    then:  ${o.to ? `at ${labelOf(idx, o.to)} (${o.to})` : "stays"}${o.result ? `; ${o.result}` : ""}` +
        (o.meta.built ? `\n    built: ${o.meta.built}` : ""),
      );
    }
    byTarget.set(target, lines);
  }
  for (const [target, lines] of byTarget) console.log(`## ${target}\n\n${lines.join("\n")}\n`);
  console.log(`${n} test case(s). Put the outcome id in each test's name so coverage can be checked.`);
}

// ---------------------------------------------------------------- changesets

function describeOp(op: Op, idx: PlanIndex): string {
  const lbl = (r: Ref) => (r === "$plan" ? "the plan" : `${r} (${labelOf(idx, r)})`);
  const note = op.note ? `\n    note: ${op.note}` : "";
  switch (op.op) {
    case "confirm": return `confirm ${op.refs.join(", ")}${note}`;
    case "comment": return `comment on ${lbl(op.ref)}${note}`;
    case "remove": return `remove ${lbl(op.ref)}${note}`;
    case "update": {
      const fields = Object.entries(op.set)
        .map(([k, v]) => `    ${k} = ${v === null ? "(cleared)" : JSON.stringify(v)}`)
        .join("\n");
      return `update ${lbl(op.ref)}\n${fields}${note}`;
    }
    case "add": {
      const v = op.value as any;
      const parent = "parent" in op ? ` under ${op.parent}` : "";
      const st = v.meta?.status === "sketch" ? " [SKETCH — elaborate]" : "";
      return `add ${op.kind} ${v.id}${parent}${st}\n    ${JSON.stringify(v)}${note}`;
    }
  }
}

function showChangeset(cs: StoredChangeset, plan: Plan) {
  const idx = buildIndex(plan);
  console.log(`Changeset: ${cs.ops.length} op(s), base ${cs.base.slice(0, 19)}…`);
  if (cs.note) console.log(`\nUser's overall note: ${cs.note}`);
  const todo: string[] = [];

  const r = cs.proposal;
  if (r) {
    const p = cs.proposalSnapshot ?? readProposal();
    const prop = p?.id === r.id ? p : null;
    console.log(`\nResponse to your proposal “${r.title}”: accepted ${r.accepted.length}, rejected ${r.rejected.length} of ${r.accepted.length + r.rejected.length} op(s).`);
    console.log("Accepted ops are included in the ops below, marked confirmed: the user approved them.");
    if (r.rejected.length) {
      console.log("Rejected:");
      for (const i of r.rejected) console.log(`  - ${prop?.ops[i] ? describeOp(prop.ops[i], idx).split("\n")[0] : `op ${i}`}`);
      todo.push("Rejected proposal ops: leave them out. If an accepted op needed one of them, say so; don't re-propose the same thing unasked");
    }
    for (const q of prop?.questions ?? []) {
      const a = r.answers[q.id];
      console.log(`Q: ${q.question}\n   ${a ? `A: ${a}` : "(unanswered)"}`);
      if (a) todo.push(`Act on the answer to “${q.question}”: ${a}`);
      else todo.push(`Unanswered: “${q.question}”. Ask in chat, or go with your recommendation${q.recommended ? ` (${q.recommended})` : ""} and say so`);
    }
    for (const [qid, a] of Object.entries(r.answers)) if (!prop?.questions?.some((q) => q.id === qid)) console.log(`Answer to ${qid}: ${a}`);
    if (r.reply) { console.log(`User's reply to the proposal: ${r.reply}`); todo.push("Act on the reply to your proposal"); }
  }

  if (cs.focus?.length) {
    const file = readFocus();
    console.log(`\nAnswers to ${cs.focus.length} item(s) in focus:`);
    for (const r of cs.focus) {
      const item = file?.items.find((i) => i.id === r.id);
      const answer = item ? describeAnswer(item, r) : [r.choice, r.text].filter(Boolean).join(" — ");
      console.log(`  ${r.id} “${r.title}”\n    → ${answer}`);
      const picked = item && r.choice ? item.options?.find((o) => o.id === r.choice) : undefined;
      if (picked?.changes) console.log(`    (that option changes: ${picked.changes})`);
      todo.push(
        `Focus ${r.id}: act on “${answer}”${item && r.choice ? ` (${optionLabel(item, r.choice)})` : ""}. ` +
        (r.done ? "The user considers it settled: make the change if there is one, then resolveFocus() with one line on where it landed"
          : "Then resolveFocus() if that settles it, or followUp() with your reply (and new options if the answer opens a new choice)"),
      );
    }
  }

  console.log("");
  cs.ops.forEach((op, i) => console.log(`${i + 1}. ${describeOp(op, idx)}`));

  // Removals the user accepted from your own proposal already carry their fallout.
  const prop = r && (cs.proposalSnapshot ?? readProposal());
  const proposed = new Set(r && prop?.id === r.id ? r.accepted.map((i) => prop.ops[i]).filter((o) => o?.op === "remove").map((o) => (o as { ref: Ref }).ref) : []);

  for (const op of cs.ops) {
    if (op.op === "add" && (op.value as any).meta?.status === "sketch") todo.push(`Elaborate sketch ${(op.value as any).id}`);
    if (op.op === "comment") todo.push(`Comment on ${op.ref}: “${op.note}” — a question gets an answer in chat (offer bigger changes, don't make them); a request is an edit`);
    if (op.op === "remove" && !proposed.has(op.ref)) todo.push(`Check semantic fallout of removing ${op.ref} (related outcomes, decisions, other profiles)`);
    if (op.op !== "comment" && op.op !== "confirm" && op.note) todo.push(`Act on the note for ${"ref" in op ? op.ref : (op.value as any).id}`);
  }
  if (cs.note) todo.push("Act on the overall note");
  if (todo.length) console.log(`\nYour to-do after applying:\n${todo.map((t) => `  - ${t}`).join("\n")}`);
}

async function wait() {
  const timeout = Number(opt("timeout") ?? 0) * 1000;
  const start = Date.now();
  while (!fs.existsSync(changesetPath)) {
    if (timeout && Date.now() - start > timeout) die("No changeset yet (timed out).", 2);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 200)); // let the write finish
  showChangeset(readChangeset()!, readPlan());
}

function proposal() {
  const p = readProposal();
  if (!p) return console.log("No pending proposal.");
  if (flag("withdraw")) {
    // Don't pull a proposal the user has already answered: apply/show need it to describe the ops.
    if (readChangeset()?.proposal?.id === p.id) die(`The user has already answered “${p.title}”. Run \`plan.ts apply\` (it removes the proposal) instead of withdrawing.`);
    fs.unlinkSync(proposalPath);
    return console.log(`Withdrew “${p.title}”. The GUI drops it within a couple of seconds.`);
  }
  const plan = readPlan();
  const idx = buildIndex(plan);
  const current = hashOf(readText());
  console.log(`Proposal “${p.title}” (${p.id}), ${p.ops.length} op(s)${p.base !== current ? " — plan.json changed since; the GUI applies it on top and flags ops that no longer apply" : ""}`);
  if (p.request) console.log(`User asked: ${p.request}`);
  if (p.summary) console.log(p.summary);
  console.log("");
  p.ops.forEach((op, i) => console.log(`${i}. ${describeOp(op, idx)}`));
  const impacts = decisionImpacts(plan, p);
  if (impacts.length) {
    console.log("\nDecisions:");
    for (const d of impacts) console.log(`  ${d.kind.padEnd(8)} ${d.ref} (${d.decision.impact}): ${d.decision.question}`);
  }
  for (const q of p.questions ?? []) console.log(`\nQ ${q.id}: ${q.question}${q.options ? `\n   options: ${q.options.join(" | ")}` : ""}${q.recommended ? `\n   recommended: ${q.recommended}` : ""}`);
}

function focus() {
  const file = readFocus();
  if (!file?.items.length) return console.log("Nothing in focus.");
  const items = sortFocus(file.items);
  const open = items.filter((i) => i.status === "open");
  const turn = (i: (typeof items)[number]) => ({ user: "user's turn", agent: "YOUR TURN: the user answered", none: "resolved" })[turnOf(i)];
  console.log(`Focus: ${open.length} open, ${items.length - open.length} resolved.`);
  for (const it of items) {
    console.log(`\n${it.id}  [${it.kind}${it.impact ? `, ${it.impact}` : ""}] ${turn(it)}\n  ${it.title}`);
    if (it.status === "resolved") { if (it.resolution) console.log(`  resolution: ${it.resolution}`); continue; }
    for (const o of it.options ?? []) console.log(`    ${o.id === it.recommended ? "*" : "-"} ${o.id}: ${o.label}`);
    for (const t of it.thread ?? []) console.log(`  ${t.from === "agent" ? "agent" : "user "}: ${t.from === "agent" ? t.text : describeAnswer(it, t)}`);
  }
}

function apply() {
  if (!fs.existsSync(changesetPath)) {
    die(fs.existsSync(applyingPath)
      ? "This changeset is already applied. Finish your edits, then run `done`."
      : `No pending changeset at ${changesetPath}`);
  }
  const cs: Changeset = readJson(changesetPath);
  const text = readText();
  const plan: Plan = JSON.parse(text);
  const current = hashOf(text);
  if (cs.base !== current && !flag("rebase")) {
    die(
      "plan.json changed after the user made these edits (base hash mismatch).\n" +
      "Re-run with --rebase to apply them on top anyway; ops whose targets are gone are reported, not applied.",
    );
  }
  const { plan: next, failed } = applyOps(plan, cs.ops);
  // A value the user set themselves is reviewed by definition: mark it confirmed. (Done here,
  // not in applyOps, because the GUI reuses applyOps to replay unsent edits.)
  const nextIdx = buildIndex(next);
  for (const op of cs.ops) {
    if (op.op !== "update" || op.ref === "$plan" || "meta" in op.set || failed.includes(op)) continue;
    const loc = nextIdx.get(op.ref);
    if (loc && loc.item.meta.status !== "sketch") loc.item.meta = { ...loc.item.meta, status: "confirmed" };
  }
  // An answered proposal is done: keep a copy with the changeset (for `show`) and drop proposal.json.
  const prop = readProposal();
  const stored: StoredChangeset = cs.proposal && prop?.id === cs.proposal.id ? { ...cs, proposalSnapshot: prop } : cs;
  fs.writeFileSync(applyingPath, JSON.stringify(stored, null, 2) + "\n");
  fs.unlinkSync(changesetPath);
  if (stored.proposalSnapshot) fs.unlinkSync(proposalPath);
  // Leave plan.json alone on an answers-only round: rewriting it could change its formatting,
  // which the GUI would report as a plan update.
  if (cs.ops.length) fs.writeFileSync(planPath, JSON.stringify(next, null, 2) + "\n");
  // Focus answers go into their items' threads: the history stays with the topic, and the GUI
  // shows each answered item as waiting for you.
  const file = readFocus();
  let unmatchedFocus: string[] = [];
  if (cs.focus?.length && file) {
    unmatchedFocus = recordResponses(file, cs.focus).map((r) => r.id);
    fs.writeFileSync(focusPath, JSON.stringify(file, null, 2) + "\n");
  }
  showChangeset(stored, plan);
  if (failed.length) {
    console.log(`\n${failed.length} op(s) did not apply (target missing or id taken):`);
    for (const op of failed) console.log(`  - ${describeOp(op, buildIndex(plan)).split("\n")[0]}`);
  }
  if (unmatchedFocus.length) console.log(`\nFocus answers for items that are gone or already resolved: ${unmatchedFocus.join(", ")}. Read them above; they were not recorded.`);
  console.log(`\nApplied to ${planPath}. The GUI shows "waiting for agent" and holds off until you run \`done\`.`);
}

function done() {
  const errors = printLint(readPlan());
  if (errors) die("\nFix the errors before handing the plan back.");
  if (fs.existsSync(applyingPath)) fs.unlinkSync(applyingPath);
  if (fs.existsSync(changesetPath)) {
    console.log("\nA changeset that was never applied is still pending: run `apply` (or `show`) for it next.");
  } else {
    console.log("Plan released; the GUI will pick it up within a couple of seconds.");
  }
}

/** Newest modification time of the GUI sources (anything that changes the built bundle). */
function newestSource(dir: string): number {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestSource(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

const realpath = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** What is listening on a port: null when nothing is, the plan path for a plan-graph editor,
 *  "" for anything else (or an editor that won't say). */
async function servedPlan(port: number): Promise<string | null> {
  const get = async (route: string) => (await fetch(`http://localhost:${port}${route}`, { signal: AbortSignal.timeout(3000) })).json();
  try {
    const status = await get("/api/status");
    if (typeof status?.planPath === "string") return status.planPath;
    if (status && "hash" in status) return (await get("/api/plan").catch(() => null))?.planPath ?? ""; // editors before 0.3.1
    return "";
  } catch (e: any) {
    return e?.cause?.code === "ECONNREFUSED" ? null : "";
  }
}

async function serve() {
  const gui = path.join(SKILL_DIR, "gui");
  const vite = path.join(gui, "node_modules/vite/bin/vite.js");
  if (!fs.existsSync(vite)) die(`GUI dependencies are missing. Run: npm install --prefix ${gui}`);
  readPlan();

  // Each plan gets one editor. Reuse the one already serving this plan; when another plan's
  // editor (or anything else) holds the port, move on to the next, unless --port was given.
  const asked = opt("port");
  let port = Number(asked ?? 5199);
  for (let tries = 0; ; tries++, port++) {
    const served = await servedPlan(port);
    if (served === null) break;
    const what = served ? `the editor for ${served}` : "something that isn't this plan's editor";
    if (served && realpath(served) === realpath(planPath)) {
      console.log(`The editor for this plan is already running: http://localhost:${port}  (give the user this URL)`);
      return;
    }
    if (asked) die(`Port ${port} is in use by ${what}. Pick another --port, or leave --port out to use the next free one.`);
    if (tries === 20) die(`Ports ${port - 20}–${port} are all in use. Pass a free --port.`);
    console.log(`Port ${port} is in use by ${what}; trying ${port + 1}.`);
  }
  const env = { ...process.env, PLAN: planPath, PORT: String(port) };

  // Serve the production build: React's development build is several times slower and
  // renders everything twice, which large plans feel. Rebuild only when the sources changed.
  const dist = path.join(gui, "dist");
  const built = path.join(dist, "index.html");
  if (!fs.existsSync(built) || fs.statSync(built).mtimeMs < newestSource(gui)) {
    console.log("Building the review GUI…");
    // Build into a private folder and swap it in, so two `serve`s starting at once never
    // serve a half-written bundle.
    const tmp = path.join(gui, `.dist-${process.pid}`);
    const b = spawnSync(process.execPath, [vite, "build", gui, "--outDir", tmp, "--emptyOutDir", "--logLevel", "warn"], { stdio: "inherit", env });
    if (b.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); die("GUI build failed."); }
    fs.rmSync(dist, { recursive: true, force: true });
    try { fs.renameSync(tmp, dist); } catch { fs.rmSync(tmp, { recursive: true, force: true }); } // another serve won the race
  }
  // Serve in this process rather than a child: killing `serve` then always frees the port,
  // where a child vite outlived its parent and kept serving a stale plan.
  Object.assign(process.env, env);
  const { preview } = await import(pathToFileURL(path.join(gui, "node_modules/vite/dist/node/index.js")).href);
  try {
    await preview({ root: gui, configFile: path.join(gui, "vite.config.ts"), logLevel: "warn", preview: { port, strictPort: true } });
  } catch (e: any) {
    die(`Couldn't start the editor on port ${port}: ${e?.message ?? e}`);
  }
  console.log(`The editor for this plan: http://localhost:${port}  (give the user this URL)`);
}

switch (cmd) {
  case "lint": process.exit(printLint(readPlan()) ? 1 : 0);
  case "outline": outline(readPlan()); break;
  case "tests": tests(readPlan()); break;
  case "show": { const cs = readChangeset(); if (!cs) die("No pending changeset."); showChangeset(cs, readPlan()); break; }
  case "wait": await wait(); break;
  case "apply": apply(); break;
  case "done": done(); break;
  case "proposal": proposal(); break;
  case "focus": focus(); break;
  case "serve": await serve(); break;
  default: die(`Unknown command “${cmd}”. Run with --help.`);
}
