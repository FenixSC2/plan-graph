# Plan Graph — Design (v0 draft)

An agent skill that turns the decisions an AI would normally make silently into a
structured, editable plan. The user reviews and edits that plan through a graph GUI,
and their edits flow back to the agent as an unambiguous changeset.

## Principles

1. **`plan.json` is the source of truth.** The graph GUI is a view/editor over it. Any
   prose plan is generated from it, never the other way round.
2. **The core is platform-agnostic; profiles supply the vocabulary.** The core knows only
   *surfaces*, *interactions*, *outcomes* and *decisions*. A profile (web, cli, api, …)
   says what kinds of surfaces/elements/triggers exist, which states are mandatory, which
   decisions must always be addressed, and how tests are generated.
3. **Every item records who made it and whether it's been reviewed.** (`origin`, `status`)
   This is what lets the GUI show the user *only what needs attention*.
4. **Edits are structured ops against stable IDs.** The agent never interprets
   "make that button go somewhere else" — it receives `update outcome X: to = Y`.
5. **Every outcome is a test case.** Given surface/state → when trigger under condition →
   expect destination/result.

## Core model

| Concept | What it is | Web | CLI | API |
|---|---|---|---|---|
| **Surface** (node) | A place the user/caller can be | page, modal, toast | command, prompt | endpoint, webhook |
| **State** | A sub-state of a surface | loading, empty, error | awaiting-input | — |
| **Element** | A thing on a surface interactions hang off | button, input, link | arg, flag | param, body field, header |
| **Interaction** (edge) | A trigger on a surface | click Submit | invoke `short create` | `POST /api/links` |
| **Outcome** | One branch of an interaction | valid → /result | exit 0, prints URL | 201 `{code}` |
| **Effect** | A cross-surface side effect | form *calls* API | command *calls* API | endpoint *emits* event |
| **Decision** | An explicit choice + alternatives | session length | default output format | 301 vs 302 |
| **Group** | A collapsible subflow | "Auth", "Checkout" | "admin commands" | "/links/*" |

Surfaces from different profiles live in **one graph**. Cross-profile links are first-class:
a web form's interaction has an `effect` calling an API interaction; an API outcome can
land on a web surface (e.g. redirect miss → web 404 page). This is how one plan covers a
full-stack project.

### IDs and refs

- IDs are globally unique, human-readable, dotted: `web.home`, `web.home.shorten-btn`,
  `api.create-link.request`.
- A **ref** points at any item by ID. States use `#`: `web.home#error`.
- IDs never change once created (renames change `name`, not `id`), so changesets and
  tests stay valid.

### Provenance and review status (`meta`)

| `origin` | `status` | Meaning | GUI treatment |
|---|---|---|---|
| agent | `proposed` | Agent assumed it; not reviewed | amber / dashed — needs review |
| agent \| user | `confirmed` | User approved or authored it fully | solid |
| user | `sketch` | User added a placeholder; agent must elaborate | outlined, "needs detail" |
| code | `confirmed` | Clearly present in existing code | solid, with source link |
| code | `proposed` | Agent's uncertain reading of code, or an implicit decision it found | amber, with source link |

Separately, `built: no | partial | yes` tracks implementation, and `sources` links each
item to `file:line`. Review state and build state are independent: a confirmed item can
be unbuilt, and a built item can be unconfirmed. **Items where the plan and the code
disagree make up the work queue.**

The loop for user-added items: **user sketches → agent elaborates (new items are
`agent/proposed`) → user confirms.** So adding "a QR code popup" in the GUI doesn't
require the user to specify everything; the agent fills in the details as reviewable
assumptions.

Decisions also carry `impact: low | medium | high`. The default GUI view shows
`proposed` items sorted by impact, so the user reviews the 10–15 that matter rather
than all 150.

## Profiles

A profile is data (`profiles/*.json`), so adding a platform means adding a file, not
changing the core. A profile defines:

- `surfaceKinds`, `elementKinds`, `triggerKinds` — the allowed vocabulary
- `requiredStates` — e.g. a web page that loads data must model `loading`, `empty`, `error`
- `decisionChecklist` — questions the agent **must** answer explicitly for this
  platform (CLI: exit codes, stdout vs stderr, `--json`, TTY/color…). This checklist is
  the main source of *consistency*: every project on a platform surfaces the same
  categories of assumptions.
- `testTarget` — how outcomes become tests (Playwright / subprocess / HTTP)

## Changesets (GUI → agent)

When the user hits **Send changes**, the GUI emits a changeset (`schema/changeset.ts`):

- `base` — hash of the plan the user was editing. If the agent changed the plan in the
  meantime, the agent must rebase or ask, never silently overwrite.
- `ops` — `add | update | remove | confirm`, each optionally with a free-text `note`
  carrying the user's intent ("we don't need aliases for v1").

**Who handles what on removal:**
- The GUI handles *structural* consequences: it won't emit a changeset with dangling
  refs (removing a surface prompts to retarget or remove the edges into it).
- The agent handles *semantic* consequences: removing the alias input means the
  "alias taken" outcomes, the 409 response and CLI exit code should also go. The agent
  proposes those follow-on removals as `proposed` changes for review.

## Proposals (agent → GUI)

When the user asks for a change in chat, the agent doesn't edit `plan.json` and describe
the result in prose. It writes a **proposal** (`schema/proposal.ts`): the same ops as a
changeset, plus a title, the user's request, a summary and open questions. The GUI shows it
as a diff. It previews the ops on the graph (added, changed and struck-through items) and
lists the decisions the proposal adds, changes or removes. It also lists decisions attached
to what the proposal touches, which might no longer hold, and asks the agent's questions.

The user ticks the ops they want and accepts. Accepted ops are applied to their working
copy as their own edits, marked confirmed, so they flow back through the normal changeset.
The response (accepted and rejected op indices, answers, a free-text reply) rides along in
`Changeset.proposal`. The same op pipeline carries both directions, so a proposal can never
mean something different from what gets applied.

## Focus (agent ⇄ user)

The Review tab lists every unreviewed item, which on a real plan is hundreds. **Focus**
(`schema/focus.ts`) is the short list the agent and the user are actually talking about: a
question the agent can't settle alone, a change it suggests, or a finding the user should
see. Each item carries its own breakdown: what is true today, the options with their pros,
cons and what each would change, and the agent's recommendation.

Only the agent writes `focus.json` (`PlanBuilder.focus()`, `followUp()`, `resolveFocus()`).
The user's answers travel in `Changeset.focus`, each with the fingerprint of the item as the
user saw it. `plan.ts apply` appends them to the item's thread. The last turn in the thread
says whose move it is, so a topic can go several rounds and keep its history. A proposal's
questions belong to that one proposal; a focus item lasts until it's resolved.

## Retroactive mode (existing projects)

The same plan and GUI, filled in from code instead of from a request:

1. **Detect profiles** from the stack (router config → web, CLI framework → cli,
   route handlers → api).
2. **Extract** surfaces, elements, interactions and outcomes. Everything gets
   `origin: code`, `built: yes`, and `sources` pointing to where it lives.
3. **Surface implicit decisions.** Run each profile's `decisionChecklist` against the
   code and record what it actually does (e.g. "redirects use 302", "errors are toasts")
   as `origin: code, status: proposed` decisions. These are choices someone made without
   writing them down, and they are the most valuable part of the extraction.
4. **Lint the result.** On existing code, lint warnings are findings: unreachable pages,
   missing error paths, endpoints nothing calls.
5. **Hand off to the normal loop.** From here it works like forward mode. GUI edits to
   built items set `built: partial`/`no`, which puts them in the work queue.

Extraction is a static read plus judgment, not a proof, so anything the agent can't pin
down (dynamic routes, feature flags, runtime-generated commands) stays `proposed` with a
`note` explaining the uncertainty. `syncedAt` records the commit the plan matches, so a
later re-sync only re-reads files changed since then. That re-sync is also how
drift is detected on projects without full test coverage.

## Lint rules (run by both GUI and agent)

- Dangling refs; duplicate IDs
- Unreachable surfaces (no inbound outcome and not an entry point)
- Dead ends (surface with no outbound interaction, unless marked terminal)
- Fallible interactions with a single outcome (missing error path)
- Missing `requiredStates` per profile
- Unanswered `decisionChecklist` items
- Unresolved `sketch` items before implementation starts

## The loop

```
forward:     user request      → agent drafts plan.json (answers each checklist; all proposed)
retroactive: existing codebase → agent extracts plan.json (origin code, built yes, sources)
  → lint
  → review_plan()  ── blocks ──▶  GUI: user edits, adds, removes, confirms
                    ◀── changeset ──
  → agent applies changeset, elaborates sketches, re-lints
  → repeat until no high-impact proposed items / no sketches
  → implement; generate tests from outcomes; done = every outcome has a passing test
  → code changes later update plan.json in the same step (drift = failing test)
```

## Open questions

- Should `confirmed` items be locked against agent edits, or just flagged when changed?
- Granularity for elements: does every input field need to be an element, or only
  those with interactions/decisions attached?
- How are non-interactive concerns (data model, perf, deployment) represented — as
  decisions attached to the project root, or as a separate non-graph section?
