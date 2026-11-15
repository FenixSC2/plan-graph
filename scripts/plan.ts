// Plan Graph agent CLI. Run with:  node --experimental-strip-types <skill>/scripts/plan.ts <command> <plan.json> [options]
//
//   lint    <plan>                 lint the plan; exit 1 if there are errors
//   outline <plan>                 compact text view of the graph (surfaces → interactions → outcomes)
//   tests   <plan>                 test matrix: one case per outcome, grouped by profile test target
//   serve   <plan> [--port N]      start the review GUI (foreground; run it in the background)
//   wait    <plan> [--timeout S]   block until the user sends a changeset, then show it (exit 2 on timeout)
//   show    <plan>                 show the pending changeset, with labels and a to-do list
//   apply   <plan> [--rebase]      apply the pending changeset's ops to plan.json; the GUI waits until `done`
//   done    <plan>                 lint, then release the plan so the GUI picks it up
//
// The model code is shared with the GUI, so ops apply here exactly as they do there.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { buildIndex, labelOf, surfaceOf, type Plan, type PlanIndex, type Ref } from "../gui/src/model/plan.ts";
import { applyOps, type Changeset, type Op } from "../gui/src/model/diff.ts";
import { lint, type Profile } from "../gui/src/model/lint.ts";

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
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
if (!planArg) die(`usage: plan.ts ${cmd} <plan.json>`);

const planPath = path.resolve(planArg);
const changesetPath = path.join(path.dirname(planPath), "changeset.json");
// While the agent works, the changeset is renamed: the GUI then holds off adopting plan.json and refuses new sends.
const applyingPath = path.join(path.dirname(planPath), "changeset.applying.json");
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
const readChangeset = (): Changeset | null => readJson(changesetPath) ?? readJson(applyingPath);

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

function showChangeset(cs: Changeset, plan: Plan) {
  const idx = buildIndex(plan);
  console.log(`Changeset: ${cs.ops.length} op(s), base ${cs.base.slice(0, 19)}…`);
  if (cs.note) console.log(`\nUser's overall note: ${cs.note}`);
  console.log("");
  cs.ops.forEach((op, i) => console.log(`${i + 1}. ${describeOp(op, idx)}`));

  const todo: string[] = [];
  for (const op of cs.ops) {
    if (op.op === "add" && (op.value as any).meta?.status === "sketch") todo.push(`Elaborate sketch ${(op.value as any).id}`);
    if (op.op === "comment") todo.push(`Comment on ${op.ref}: “${op.note}” — a question gets an answer in chat (offer bigger changes, don't make them); a request is an edit`);
    if (op.op === "remove") todo.push(`Check semantic fallout of removing ${op.ref} (related outcomes, decisions, other profiles)`);
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
  fs.renameSync(changesetPath, applyingPath);
  fs.writeFileSync(planPath, JSON.stringify(next, null, 2) + "\n");
  showChangeset(cs, plan);
  if (failed.length) {
    console.log(`\n${failed.length} op(s) did not apply (target missing or id taken):`);
    for (const op of failed) console.log(`  - ${describeOp(op, buildIndex(plan)).split("\n")[0]}`);
  }
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

function serve() {
  const gui = path.join(SKILL_DIR, "gui");
  const vite = path.join(gui, "node_modules/vite/bin/vite.js");
  if (!fs.existsSync(vite)) die(`GUI dependencies are missing. Run: npm install --prefix ${gui}`);
  readPlan();
  const port = opt("port") ?? "5199";
  const env = { ...process.env, PLAN: planPath, PORT: port };

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
  const child = spawn(process.execPath, [vite, "preview", gui, "--port", port, "--strictPort"], { stdio: "inherit", env });
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (cmd) {
  case "lint": process.exit(printLint(readPlan()) ? 1 : 0);
  case "outline": outline(readPlan()); break;
  case "tests": tests(readPlan()); break;
  case "show": { const cs = readChangeset(); if (!cs) die("No pending changeset."); showChangeset(cs, readPlan()); break; }
  case "wait": await wait(); break;
  case "apply": apply(); break;
  case "done": done(); break;
  case "serve": serve(); break;
  default: die(`Unknown command “${cmd}”. Run with --help.`);
}
