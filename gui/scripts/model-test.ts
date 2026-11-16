// Round-trip checks for the model: diff → applyOps reproduces the edited plan; revert restores base.
import fs from "node:fs";
import assert from "node:assert/strict";
import { buildIndex, clone, deleteWithCascade, type Plan } from "../src/model/plan.ts";
import { applyOps, diffPlans, revertChange, toChangeset } from "../src/model/diff.ts";
import { lint } from "../src/model/lint.ts";

const base: Plan = JSON.parse(fs.readFileSync(new URL("../../examples/link-shortener/plan.json", import.meta.url), "utf8"));
const profiles = Object.fromEntries(base.profiles.map((p) => [p, JSON.parse(fs.readFileSync(new URL(`../../profiles/${p}.json`, import.meta.url), "utf8"))]));
const norm = (p: Plan) => JSON.stringify(p, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
const sortAll = (p: Plan) => { const q = clone(p); q.surfaces.sort((a, b) => a.id.localeCompare(b.id)); q.interactions.sort((a, b) => a.id.localeCompare(b.id)); q.decisions.sort((a, b) => a.id.localeCompare(b.id)); for (const s of q.surfaces) { s.elements?.sort((a, b) => a.id.localeCompare(b.id)); s.states?.sort((a, b) => a.id.localeCompare(b.id)); } for (const i of q.interactions) i.outcomes.sort((a, b) => a.id.localeCompare(b.id)); return q; };

// Edits: confirm, update, remove element, add surface with state, add interaction, delete surface w/ retarget, delete state.
const cur = clone(base);
let idx = buildIndex(cur);
(idx.get("d.redirect-status")!.item.meta as any).status = "confirmed";
const exp = idx.get("d.expiry")!.item as any; exp.value = "After 1 year"; exp.meta = { ...exp.meta, status: "confirmed" };
cur.entryPoints.push("web.stats");
deleteWithCascade(cur, "web.home.alias-input");
cur.surfaces.push({ id: "web.qr-modal", profile: "web", kind: "modal", name: "QR", states: [{ id: "open", meta: { origin: "user", status: "confirmed" } }], meta: { origin: "user", status: "sketch" } });
cur.interactions.push({ id: "web.result.show-qr", from: "web.result", trigger: { kind: "click", description: "QR" }, outcomes: [{ id: "web.result.show-qr.open", when: "always", to: "web.qr-modal", meta: { origin: "user", status: "confirmed" } }], meta: { origin: "user", status: "confirmed" } });
const rep = deleteWithCascade(cur, "web.not-found", "web.home");
deleteWithCascade(cur, "web.stats#empty");
(buildIndex(cur).get("web.result.copy.ok")!.item as any).to = "web.home";

const changes = diffPlans(base, cur, { "d.expiry": "dead links", "d.auth": "should stats be private?" });
assert.ok(changes.some((c) => c.kind === "comment" && c.ref === "d.auth"), "note on unchanged item becomes a comment");
const cs = toChangeset(changes, "sha256:x", "first pass");
console.log(cs.ops.map((o) => `${o.op} ${"ref" in o ? o.ref : "refs" in o ? o.refs.join(",") : (o as any).value.id}`).join("\n"));
console.log("cascade:", rep.lines);

const { plan: applied, failed } = applyOps(base, cs.ops);
assert.equal(failed.length, 0, "no failed ops");
assert.equal(norm(sortAll(applied)), norm(sortAll(cur)), "applyOps(base, diff) == cur");

let back = cur;
for (const c of diffPlans(base, cur)) back = revertChange(base, back, c);
assert.equal(diffPlans(base, back).length, 0, "reverting every change restores base");

assert.equal(lint(base, profiles).filter((i) => i.severity === "error").length, 0, "example has no lint errors");
assert.equal(lint(cur, profiles).filter((i) => i.severity === "error").length, 0, "cascade leaves no dangling refs");
console.log(`OK — ${changes.length} changes, ${cs.ops.length} ops`);

// ── proposals: preview keeps removals for display, accept cascades and confirms, decision impacts ──
{
  const { applyProposal, decisionImpacts, proposalMarks, makeResponse } = await import("../src/model/proposal.ts");
  const edited = clone(base);
  deleteWithCascade(edited, "web.home.alias-input");
  deleteWithCascade(edited, "web.home.shorten.taken");
  const rs = buildIndex(edited).get("d.redirect-status")!.item as any;
  rs.value = "301"; rs.meta = { ...rs.meta, status: "proposed", note: "permanent" };
  edited.decisions.push({ id: "d.legacy", attachedTo: ["api.redirect"], question: "Old aliases?", value: "keep", impact: "medium", meta: { origin: "agent", status: "proposed" } });
  const ops = toChangeset(diffPlans(base, edited), "").ops;
  const proposal = { ops, questions: [{ id: "q", question: "?", refs: ["d.code-format"] }] };

  const all = applyProposal(base, ops);
  assert.equal(all.failed.length, 0, "every proposal op applies");
  assert.equal(norm(sortAll(all.plan)), norm(sortAll(edited)), "applyProposal(base, all ops) == edited plan");

  const preview = applyProposal(base, ops, undefined, { keepRemovals: true });
  assert.ok(buildIndex(preview.plan).has("web.home.alias-input"), "preview keeps removed items to strike them through");
  const marks = proposalMarks(ops);
  assert.equal(marks.get("web.home.alias-input"), "remove");
  assert.equal(marks.get("d.legacy"), "add");

  const removeIdx = ops.findIndex((o) => o.op === "remove" && o.ref === "web.home.alias-input");
  const partial = applyProposal(base, ops, [removeIdx], { confirm: true });
  assert.equal(lint(partial.plan, profiles).filter((i) => i.severity === "error").length, 0, "partial accept cascades: no dangling refs");
  const accepted = applyProposal(base, ops, undefined, { confirm: true }).plan;
  assert.equal((buildIndex(accepted).get("d.redirect-status")!.item.meta as any).status, "confirmed", "accepted updates are confirmed");
  assert.equal((buildIndex(accepted).get("d.legacy")!.item.meta as any).status, "confirmed", "accepted adds are confirmed");

  const impacts = decisionImpacts(base, proposal);
  const kind = (r: string) => impacts.find((d) => d.ref === r)?.kind;
  assert.equal(kind("d.redirect-status"), "changed");
  assert.equal(kind("d.legacy"), "added");
  assert.equal(kind("d.code-format"), "affected", "decisions named in a question are listed");

  const resp = makeResponse({ id: "p", base: "", title: "t", ops }, [removeIdx], { q: " yes ", x: "  " }, "");
  assert.equal(resp.accepted.length + resp.rejected.length, ops.length);
  assert.deepEqual(resp.answers, { q: "yes" }, "blank answers are dropped, others trimmed");
  console.log(`OK — proposal: ${ops.length} ops, ${impacts.length} decision impacts`);
}
