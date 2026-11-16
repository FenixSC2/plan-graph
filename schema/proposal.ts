// Plan Graph — proposal schema (agent → GUI).
//
// A proposal is a changeset the agent *suggests* but has not applied: usually a change the
// user asked for in chat ("drop aliases", "add team invites"). The agent writes it to
// plan-graph/proposal.json (via PlanBuilder.propose() in scripts/build.ts) and plan.json stays
// untouched. The GUI shows it as a reviewable diff, previews it on the graph, lists the
// decisions it changes or puts in question, and asks the agent's open questions. The user
// accepts some or all of the ops (they become the user's own edits), answers the questions,
// and sends; the response comes back inside the next changeset (Changeset.proposal).

import type { Ref } from "./plan";
import type { Op } from "./changeset";

export interface Proposal {
  /** Unique per proposal, e.g. "p-20261115-1432". A new id is a new proposal to review. */
  id: string;
  /** Hash of the plan.json the ops were made against. */
  base: string;
  createdAt?: string;
  /** Short name for the change: "Drop custom aliases". */
  title: string;
  /** What the change does and why, in a sentence or three. */
  summary?: string;
  /** What the user asked for, in their words, so they can check the proposal against it. */
  request?: string;
  /** Same ops as a changeset. Agent-made items keep meta agent/proposed and a meta.note saying why. */
  ops: Op[];
  /** Things the agent could not settle without the user. Ask only what changes the plan. */
  questions?: ProposalQuestion[];
}

export interface ProposalQuestion {
  id: string;
  question: string;
  /** Suggested answers, shown as buttons. The user can always type their own. */
  options?: string[];
  /** The option the agent would pick; must be one of `options` if given. */
  recommended?: string;
  /** Why it matters / what each answer would change. One line. */
  why?: string;
  /** Items the question is about (decisions, surfaces…), so the GUI can link them. */
  refs?: Ref[];
}

/** The user's answer to a proposal, carried in Changeset.proposal. */
export interface ProposalResponse {
  id: string;
  title: string;
  /** Indices into Proposal.ops. Accepted ops are also in Changeset.ops, as the user's edits. */
  accepted: number[];
  rejected: number[];
  /** Question id → the user's answer. Unanswered questions are absent. */
  answers: Record<string, string>;
  /** Free-text reply to the agent about the proposal. */
  reply?: string;
}
