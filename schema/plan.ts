// Plan Graph — core plan schema (v0 draft).
// Platform-agnostic: profile files (profiles/*.json) supply the allowed `kind` vocabularies.

/** Globally unique, stable, dotted ID. e.g. "web.home", "api.create-link.request". */
export type Id = string;

/** Reference to any item by ID. States are addressed as "<surfaceId>#<stateId>". */
export type Ref = string;

/**
 * agent — the agent proposed it while planning
 * user  — the user added it in the GUI
 * code  — extracted from an existing codebase (retroactive mode)
 */
export type Origin = "agent" | "user" | "code";

/**
 * proposed  — not yet reviewed by the user (an agent assumption, or an uncertain reading of code)
 * confirmed — user approved it (or authored it in full); for extracted items, a clear fact in code
 * sketch    — user-added placeholder; agent must elaborate before implementation
 */
export type Status = "proposed" | "confirmed" | "sketch";

/**
 * Implementation state, independent of review state.
 * The set of items where the plan differs from what's built is the work queue.
 */
export type Built = "no" | "partial" | "yes";

export interface SourceRef {
  file: string;
  line?: number;
}

export interface Meta {
  origin: Origin;
  status: Status;
  /** Defaults to "no" when absent. Extracted items start as "yes". */
  built?: Built;
  /** Where this lives in code. Required for origin "code"; filled in as items get built. */
  sources?: SourceRef[];
  /** Free-text intent or rationale, from either party. */
  note?: string;
}

export interface Plan {
  version: 1;
  project: {
    name: string;
    summary: string;
  };
  /**
   * forward     — planned before code exists
   * retroactive — extracted from an existing codebase
   * Informational only: after the first round of edits, both modes work identically.
   */
  mode: "forward" | "retroactive";
  /** Git commit the plan was last synced against, if any. Used to scope re-extraction. */
  syncedAt?: string;
  /** Profiles in use, e.g. ["web", "api", "cli"]. Each must exist in profiles/. */
  profiles: string[];
  /** Surfaces where a user/caller can start (home page, CLI root, public endpoints). */
  entryPoints: Ref[];
  groups?: Group[];
  surfaces: Surface[];
  interactions: Interaction[];
  decisions: Decision[];
}

export interface Group {
  id: Id;
  name: string;
  meta: Meta;
}

export interface Surface {
  id: Id;
  /** Which profile this surface belongs to. */
  profile: string;
  /** From the profile's surfaceKinds, e.g. "page" | "modal" | "command" | "endpoint". */
  kind: string;
  name: string;
  description?: string;
  /** Profile-specific addressing: route, command signature, HTTP method + path. */
  address?: string;
  group?: Id;
  /** No outbound interaction is expected (suppresses the dead-end lint). */
  terminal?: boolean;
  states?: State[];
  elements?: Element[];
  meta: Meta;
}

export interface State {
  /** Local to the surface; referenced as "<surfaceId>#<id>". */
  id: string;
  description?: string;
  meta: Meta;
}

export interface Element {
  id: Id;
  /** From the profile's elementKinds, e.g. "button" | "input" | "flag" | "body-field". */
  kind: string;
  label: string;
  /** Kind-specific details: validation, defaults, required, type, placeholder, … */
  spec?: Record<string, unknown>;
  meta: Meta;
}

export interface Interaction {
  id: Id;
  /** Surface (or surface#state) the trigger happens on. */
  from: Ref;
  trigger: {
    /** From the profile's triggerKinds, e.g. "click" | "submit" | "on-enter" | "invoke" | "request". */
    kind: string;
    /** The element that fires it, if any. */
    element?: Ref;
    description: string;
  };
  /** Cross-surface side effects, e.g. a web form calling an API interaction. */
  effects?: Effect[];
  outcomes: Outcome[];
  meta: Meta;
}

export interface Effect {
  kind: "calls" | "emits" | "writes" | "reads";
  /** For "calls": another interaction. For others: a free-form resource name. */
  target: Ref;
  description?: string;
}

export interface Outcome {
  id: Id;
  /** The condition for this branch, in plain language. Becomes the test's precondition. */
  when: string;
  /** Destination surface/state. null = stays where it is. */
  to: Ref | null;
  /** Observable result beyond navigation: status code, exit code, output, UI feedback. */
  result?: string;
  meta: Meta;
}

export interface Decision {
  id: Id;
  /** Items this decision affects. Empty = project-wide. */
  attachedTo: Ref[];
  question: string;
  value: string;
  alternatives?: string[];
  rationale?: string;
  impact: "low" | "medium" | "high";
  /** If this answers an item from a profile's decisionChecklist, its key. */
  checklistKey?: string;
  meta: Meta;
}
