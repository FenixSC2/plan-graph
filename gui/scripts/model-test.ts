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

// ── proposals: cascaded removals apply; dependent ops tick and untick together ──
{
  const { applyProposal, proposalRequires, toggleOp } = await import("../src/model/proposal.ts");
  const lintErrors = (p: any) => lint(p, profiles).filter((i) => i.severity === "error").length;

  // Removing a surface: the diff also lists its actions and inbound outcomes as removals.
  const gone = clone(base);
  deleteWithCascade(gone, "web.stats");
  const removeOps = toChangeset(diffPlans(base, gone), "").ops;
  assert.ok(removeOps.length > 1, "removing a surface lists its fallout as separate removals");
  const all = removeOps.map((_, i) => i);
  assert.deepEqual(applyProposal(base, removeOps, all).failed, [], "removals an earlier cascade already made count as applied");
  const reqR = proposalRequires(base, removeOps);
  const surf = removeOps.findIndex((o) => o.op === "remove" && o.ref === "web.stats");
  const implied = [...(reqR.get(surf) ?? [])];
  assert.ok(implied.length > 0, "the surface removal implies its cascaded removals");
  const child = implied[0];
  assert.ok(!toggleOp(all, child, reqR).includes(surf), "unticking a cascaded removal unticks the removal that implies it");

  // Adding a surface plus things that point at it.
  const added = clone(base);
  added.surfaces.push({ id: "web.settings", profile: "web", kind: "page", name: "Settings", meta: { origin: "agent", status: "proposed" } });
  added.interactions.push({ id: "web.settings.back", from: "web.settings", trigger: { kind: "click", description: "Back" },
    outcomes: [{ id: "web.settings.back.go", when: "always", to: "web.home", meta: { origin: "agent", status: "proposed" } }], meta: { origin: "agent", status: "proposed" } });
  const addOps = toChangeset(diffPlans(base, added), "").ops;
  const reqA = proposalRequires(base, addOps);
  const addSurf = addOps.findIndex((o) => o.op === "add" && o.kind === "surface");
  const without = toggleOp(addOps.map((_, i) => i), addSurf, reqA);
  assert.equal(lintErrors(applyProposal(base, addOps, without).plan), 0, "unticking an added surface unticks what depends on it: no dangling refs");
  const dependent = addOps.findIndex((_, i) => i !== addSurf);
  assert.ok(toggleOp([], dependent, reqA).includes(addSurf), "ticking an op ticks what it needs");
  console.log(`OK — proposal dependencies: ${removeOps.length} cascaded removals, ${addOps.length} dependent adds`);
}

// ── focus: fingerprints, whose turn, answers recorded in threads, checks ──
{
  const { focusSig, turnOf, sortFocus, recordResponses, checkFocusItem, describeAnswer } = await import("../src/model/focus.ts");
  type FocusFile = import("../src/model/focus.ts").FocusFile;
  const file: FocusFile = {
    version: 1,
    items: [
      { id: "f.low", kind: "finding", title: "Low", impact: "low", status: "open" },
      { id: "f.redirect", kind: "question", title: "301 or 302?", impact: "high", status: "open", refs: ["d.redirect-status"],
        options: [{ id: "302", label: "302 Found" }, { id: "301", label: "301 Moved Permanently" }], recommended: "302" },
      { id: "f.done", kind: "question", title: "Done", status: "resolved", resolution: "Settled" },
    ],
  };
  const idx = buildIndex(base);
  assert.deepEqual(file.items.flatMap((i) => checkFocusItem(i, idx)), [], "valid items pass");
  assert.match(checkFocusItem({ ...file.items[1], recommended: "307" }, idx).join(), /recommended/, "recommendation must be an option");
  assert.match(checkFocusItem({ ...file.items[1], refs: ["web.nowhere"] }, idx).join(), /not in the plan/, "refs must exist");

  assert.deepEqual(sortFocus(file.items).map((i) => i.id), ["f.redirect", "f.low", "f.done"], "open by impact, resolved last");
  const sig = focusSig(file.items[1]);
  assert.equal(focusSig({ ...file.items[1], updatedAt: "later" }), sig, "timestamps don't change the fingerprint");
  assert.equal(turnOf(file.items[1]), "user");

  const unmatched = recordResponses(file, [
    { id: "f.redirect", title: "301 or 302?", sig, choice: "301", text: "  links never change  " },
    { id: "f.done", title: "Done", sig: "x", text: "late" },
  ], "2026-01-01T00:00:00Z");
  assert.deepEqual(unmatched.map((r) => r.id), ["f.done"], "answers to resolved items are reported, not recorded");
  const it = file.items[1];
  assert.deepEqual(it.thread, [{ from: "user", choice: "301", choiceLabel: "301 Moved Permanently", text: "links never change", at: "2026-01-01T00:00:00Z" }]);
  assert.equal(turnOf(it), "agent", "after the user's answer it's the agent's turn");
  assert.notEqual(focusSig(it), sig, "a recorded answer changes the fingerprint, so the GUI drops the sent draft");
  assert.equal(describeAnswer(it, it.thread![0] as any), "301 Moved Permanently — links never change");
  it.options = [{ id: "head", label: "Count HEAD" }];
  assert.equal(describeAnswer(it, it.thread![0] as any), "301 Moved Permanently — links never change", "the label survives new options");
  it.thread!.push({ from: "agent", text: "OK" });
  assert.equal(turnOf(it), "user", "the agent's follow-up hands it back");
  console.log("OK — focus");
}
