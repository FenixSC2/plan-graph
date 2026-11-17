// Plan Graph — focus schema (agent → GUI → agent).
//
// Focus is the short list of things the agent and the user are working through right now:
// a question the agent can't settle alone, a change it suggests, or a finding the user should
// see. The review pile holds every unreviewed item in the plan; focus holds the handful that
// need a conversation. Each item carries its own breakdown (what is true now, the options with
// their pros, cons and what each changes) and a thread, so a topic can go back and forth over
// several rounds without being retyped in chat.
//
// The agent writes plan-graph/focus.json (via PlanBuilder.focus() / followUp() / resolveFocus()
// in scripts/build.ts). The GUI never writes it: the user's answers travel in the next
// changeset (Changeset.focus), and `plan.ts apply` records them in each item's thread.

import type { Ref } from "./plan";

export interface FocusFile {
  version: 1;
  items: FocusItem[];
}

export interface FocusItem {
  /** Stable, e.g. "f.session-storage". Never reused for a different topic. */
  id: string;
  /**
   * question — the agent needs the user to choose or answer
   * change   — the agent suggests a change; the options are how to go about it (or not)
   * finding  — something the user should know; acknowledging it is enough
   */
  kind: "question" | "change" | "finding";
  /** The question or topic, as one line. */
  title: string;
  /** Why it's in focus and what's at stake, 1–3 sentences. */
  summary?: string;
  /** The breakdown: what the code or plan does today, the facts that bear on the choice. */
  context?: string[];
  options?: FocusOption[];
  /** The option the agent would pick (an option id). */
  recommended?: string;
  /** Why the recommendation wins, one sentence. */
  rationale?: string;
  /** Plan items the topic is about (decisions, surfaces…), linked in the GUI. */
  refs?: Ref[];
  impact?: "low" | "medium" | "high";
  /** open: in play. resolved: settled; kept, collapsed, so the history stays readable. */
  status: "open" | "resolved";
  /** The agent's closing line once resolved: what was decided and where it landed. */
  resolution?: string;
  /** Later rounds, oldest first. The last entry says whose turn it is. */
  thread?: FocusTurn[];
  createdAt?: string;
  updatedAt?: string;
}

export interface FocusOption {
  /** Short, stable within the item: "encrypted-adapter". */
  id: string;
  label: string;
  /** What choosing it means, concretely. */
  detail?: string;
  pros?: string[];
  cons?: string[];
  /** What it changes in the plan or the code ("adds a revoke RPC", "no schema change"). */
  changes?: string;
}

export type FocusTurn =
  | { from: "agent"; text: string; at?: string }
  | { from: "user"; choice?: string; /** The option's label when chosen: options change between rounds. */ choiceLabel?: string; text?: string; done?: boolean; at?: string };

/** One answer from the user, carried in Changeset.focus. */
export interface FocusResponse {
  id: string;
  /** The item's title when answered, so the agent can read the response without focus.json. */
  title: string;
  /** Fingerprint of the item as the user saw it (focusSig). */
  sig: string;
  /** An option id. */
  choice?: string;
  /** Free text: an answer of their own, a follow-up question, or a reply. */
  text?: string;
  /** The user considers it settled ("Got it" on a finding, or "That's all" on a question). */
  done?: boolean;
}
