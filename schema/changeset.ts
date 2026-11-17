// Plan Graph — changeset schema (GUI → agent), v0 draft.

import type { Ref, Surface, State, Element, Interaction, Outcome, Decision, Group } from "./plan";
import type { ProposalResponse } from "./proposal";
import type { FocusResponse } from "./focus";

export interface Changeset {
  /** Hash of the plan.json the user was editing. Agent must rebase/ask if it no longer matches. */
  base: string;
  /** Overall message from the user, optional. */
  note?: string;
  ops: Op[];
  /**
   * The user's response to the agent's pending proposal (schema/proposal.ts), if they
   * answered it in this send. Ops they accepted are already included in `ops` above.
   */
  proposal?: ProposalResponse;
  /** The user's answers to items in focus (schema/focus.ts), one per item they answered. */
  focus?: FocusResponse[];
}

export type Op = AddOp | UpdateOp | RemoveOp | ConfirmOp | CommentOp;

/** A note on an item the user didn't change: a question, doubt, or request ("show me alternatives"). */
export interface CommentOp {
  op: "comment";
  ref: Ref;
  note: string;
}

type Addable =
  | { kind: "surface"; value: Surface }
  | { kind: "state"; parent: Ref; value: State }
  | { kind: "element"; parent: Ref; value: Element }
  | { kind: "interaction"; value: Interaction }
  | { kind: "outcome"; parent: Ref; value: Outcome }
  | { kind: "decision"; value: Decision }
  | { kind: "group"; value: Group };

/** New items from the GUI carry meta.origin = "user"; status "sketch" if underspecified. */
export type AddOp = { op: "add"; note?: string } & Addable;

/**
 * Shallow field update on any item. e.g. { ref: "x.outcome", set: { to: "web.dashboard" } }
 * ref "$plan" updates top-level plan fields (project, profiles, entryPoints).
 * A value of null means the field was cleared.
 */
export interface UpdateOp {
  op: "update";
  ref: Ref;
  set: Record<string, unknown>;
  note?: string;
}

/**
 * Remove an item. The GUI has already resolved structural fallout (no dangling refs remain
 * in this changeset). Semantic fallout is the agent's job, proposed back for review.
 */
export interface RemoveOp {
  op: "remove";
  ref: Ref;
  note?: string;
}

/** Mark items as reviewed and accepted as-is. */
export interface ConfirmOp {
  op: "confirm";
  refs: Ref[];
  note?: string;
}
