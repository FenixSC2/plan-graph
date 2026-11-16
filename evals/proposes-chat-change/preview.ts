// Grading helper: apply a proposal's ops to a plan the way the editor's "Accept all" does.
//   node --experimental-strip-types preview.ts <plan.json> <proposal.json> <out.json>
// Prints the indices of ops that failed to apply (empty line when all applied).
import fs from "node:fs";
import { applyProposal } from "../../gui/src/model/proposal.ts";

const [planPath, proposalPath, out] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
const { plan: next, failed } = applyProposal(plan, proposal.ops ?? []);
fs.writeFileSync(out, JSON.stringify(next, null, 2) + "\n");
console.log(failed.join(","));
